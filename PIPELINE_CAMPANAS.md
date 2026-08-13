# Pipeline de campañas — flujo del código actual

**Fecha:** 2026-06-29 · Diagramas del comportamiento **actual** (BullMQ + Redis + DynamoDB).
Abrir con el preview de Markdown de VSCode para ver los diagramas Mermaid renderizados.

---

## 1. Vista general del sistema

Cómo se conectan los componentes, colas y stores.

```mermaid
flowchart TB
    FE["Frontend"] -->|"POST /dispatch"| API["CampaignDispatchController"]
    FE -->|"GET /progress (poll 2s)"| API

    API -->|"enqueue 1 job/campaña"| QD["cola: campaign-dispatch"]
    QD --> ORCH["Orchestrator worker"]
    ORCH -->|"fan-out lotes ~100"| QS["cola: campaign-send"]
    ORCH -.->|"segmentos grandes"| S3["S3 manifest"]

    QS --> SW["Send workers"]
    SW -->|"sendMessage"| PROV["Twilio / Meta API"]
    SW -->|"createOrClaim / persistSID / addStatus"| DDB[("DynamoDB: campaign-messages")]
    SW -->|"acquire tokens (Lua)"| RL["Redis: ratelimit:lane"]
    SW -->|"guard EXISTS"| BOT[("Redis sesiones del bot (externo)")]
    SW -->|"increment"| PR["Redis: campaign:progress"]
    API -->|"read (réplica)"| PR

    PROV -->|"status callback"| WH["TwilioStatusController /twilio/status"]
    WH -->|"dedupe SET NX"| RD["Redis: wh:dedupe:*"]
    WH -->|"persist evento crudo"| WE[("DynamoDB: webhook-events")]
    WH -->|"enqueue"| QR["cola: status-reduce"]
    QR --> SR["status-reduce worker"]
    SR -->|"addStatus idempotente"| DDB

    CRON["reconcile cron"] --> QRC["cola: reconcile-missing-status"]
    QRC --> RW["reconcile worker"]
    RW -->|"fetch estado"| PROV
    RW --> DDB
```

---

## 2. Disparo (HTTP → 202)

`CampaignDispatchController.dispatch` — valida barato y responde rápido; no toca el
segmento real ni envía nada.

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant C as DispatchController
    participant R as Redis
    participant P as ProgressService
    participant DB as DynamoDB
    participant Q as cola campaign-dispatch

    FE->>C: POST /:channel/:campaign/dispatch
    C->>C: assertPipelineReady (Redis >= 5)
    C->>R: SET campaign:lock:<id> NX EX 30
    alt lock ya tomado
        C-->>FE: 409 ALREADY_DISPATCHING
    end
    C->>DB: getById campaign / template / channel
    C->>C: resolver provider (twilio | meta)
    C->>DB: segment.segmentDataCount (estimación O(1))
    C->>P: withLaunchLock → findActiveCampaignId
    alt ya hay otra campaña activa
        C-->>FE: 409 CONCURRENCY_LIMIT
    else
        C->>P: initialise(status = queuing)
    end
    C->>Q: add(dispatch job)
    C->>DB: update(dispatched = true)
    C-->>FE: 202 + progressUrl
```

---

## 3. Orquestador (worker de `campaign-dispatch`)

1 job = 1 campaña. Cuenta el total autoritativo y hace el **fan-out** en lotes. No envía.

```mermaid
flowchart TB
    J["job campaign-dispatch"] --> HB["heartbeat cada 15s"]
    HB --> LOAD["cargar campaign / template / channel / segment"]
    LOAD --> GUARD{"canal tiene chatwootId?"}
    GUARD -->|no| FAIL["status = failed (sin inbox)"]
    GUARD -->|sí| COUNT["countBySegment (total autoritativo)"]
    COUNT --> ZERO{"total = 0?"}
    ZERO -->|sí| COMP["status = completed (sin contactos)"]
    ZERO -->|no| METRICS["initializeCampaignMetrics + setTotals"]
    METRICS --> PATH{"S3 manifest habilitado?"}

    PATH -->|"sí (grande)"| EXP["exportSegmentToS3AndManifest"]
    EXP --> STREAM["stream-enqueue: 1 batch por chunk listo"]

    PATH -->|"no (inline)"| PAGE["streamBySegment (páginas de 500)"]
    PAGE --> PREP["prepareContact + dedup Set por teléfono"]
    PREP --> BATCH["acumular hasta batchSize (100)"]

    STREAM --> ENQ["enqueueIdempotentBatch"]
    BATCH --> ENQ
    ENQ --> JOBID["jobId = campaign:&lt;id&gt;:send:&lt;epoch&gt;:&lt;idx&gt;"]
    JOBID --> QNX["progress.queued++ una sola vez (SET NX)"]
    QNX --> ADV["setStatusIfCurrent(sending) — no pisa pause/cancel"]
```

---

## 4. Send worker (worker de `campaign-send`)

1 job = 1 lote de ~100 contactos. Procesa por **ventanas de concurrencia** paceadas por
el token bucket. Acá ocurre el envío real y toda la idempotencia.

```mermaid
flowchart TB
    START["processSendBatch(job)"] --> LOAD["cargar contactos (inline o manifest S3)"]
    LOAD --> STALE{"campaña terminal?"}
    STALE -->|sí| SKIP["skip lote"]
    STALE -->|no| WIN{"quedan contactos?"}

    WIN -->|no| DONE["lote terminado"]
    WIN -->|sí| CP{"cancelled / paused?"}
    CP -->|cancelled| BRK["break"]
    CP -->|paused| YLD["moveToDelayed + DelayedError (cede slot)"]
    CP -->|no| ACQ["rateLimiter.acquire(N tokens)"]
    ACQ -->|timeout transient| YLD
    ACQ --> PAR["processContact x N en paralelo"]

    PAR --> CLAIM["createOrClaimDispatch (DynamoDB cond. write + lease)"]
    CLAIM -->|"null (ya enviado/claimeado)"| SKP["skipped"]
    CLAIM --> GRD{"conversación activa en Chatwoot?"}
    GRD -->|sí| BLK["addStatus = blocked"]
    GRD -->|no| SEND["providerService.sendMessage (+ statusCallback ?c=&m=)"]

    SEND -->|ambiguo| AMB["releaseClaimAmbiguous → reconciler"]
    SEND -->|"transient (breaker/ratelimit/blip)"| TR["releaseClaimForRetry → yield lote"]
    SEND -->|error permanente| FL["addStatus = failed"]
    SEND -->|ok| PSID["persistProviderMessageId (SID + estado inicial foldeado)"]

    SKP --> AGG
    BLK --> AGG
    AMB --> AGG
    FL --> AGG
    PSID --> AGG["agregar outcomes de la ventana"]
    AGG --> INC["progress.increment(submitted/failed/blocked) — 1 op/ventana"]
    INC --> TRC{"hubo transient en la ventana?"}
    TRC -->|sí| YLD
    TRC -->|no| WIN
```

Notas clave:
- **Idempotencia:** ID de fila determinístico (`deterministicCampaignMessageId(campaignId, phone)`)
  + `createOrClaimDispatch` con lease → un re-run de BullMQ skipea lo ya enviado.
- **Lease heartbeat:** renueva el claim cada 20s mientras el envío está en vuelo; si se
  pierde, el resultado se trata como ambiguo (ni retry ni failed).
- **Errores transient ≠ failed:** no queman al contacto; liberan el claim y re-encolan el lote.

---

## 5. Ingesta de webhooks + reducción de estado

Persist-first: el controller persiste y encola; el worker reduce el estado.

```mermaid
sequenceDiagram
    participant T as Twilio
    participant W as TwilioStatusController
    participant R as Redis (wh:dedupe)
    participant WE as DynamoDB webhook-events
    participant Q as cola status-reduce
    participant SR as status-reduce worker
    participant CM as DynamoDB campaign-messages

    T->>W: POST /twilio/status (StatusCallback)
    W->>W: verificar firma
    W->>R: SET wh:dedupe:<sig> NX EX (2d)
    alt duplicado (key ya existe)
        W-->>T: 200 OK (suprimido)
    else nuevo
        W->>WE: persistir evento crudo
        W->>Q: add(reduce, jobId = wrev-<id>)
        W-->>T: 200 OK
        Q->>SR: job
        SR->>WE: getById(eventId)
        SR->>CM: addStatus (idempotente, order guard) vía (c,m) o SID
        alt SID no encontrado
            SR-->>Q: throw SID_NOT_FOUND (retry x10 backoff)
        else
            SR->>WE: markProcessed
        end
    end
    Note over SR,WE: Sweeper cada 60s re-encola eventos processed=false (blip de Redis)
```

---

## 6. Máquina de estados del MENSAJE

`addStatus` aplica concurrencia optimista + **order guard**: nunca baja de un estado
terminal o superior (un `sent` tardío no pisa un `delivered`).

```mermaid
stateDiagram-v2
    [*] --> processing: createOrClaimDispatch
    processing --> queued: estado inicial provider / webhook
    processing --> sent: estado inicial provider / webhook
    processing --> blocked: Chatwoot guard
    processing --> failed: error permanente
    queued --> sent: webhook
    sent --> delivered: webhook
    delivered --> read: webhook
    queued --> failed
    sent --> failed
    delivered --> [*]
    read --> [*]
    failed --> [*]
    blocked --> [*]
    note right of read: terminal
    note right of failed: terminal (no se revierte)
```

---

## 7. Máquina de estados de la CAMPAÑA (progress)

```mermaid
stateDiagram-v2
    [*] --> queuing: initialise
    queuing --> sending: primer batch encolado
    sending --> paused: pause
    paused --> sending: resume
    sending --> completed: processed >= total
    queuing --> failed: error orquestador
    sending --> cancelled: cancel / halt
    paused --> cancelled: cancel
    completed --> [*]
    failed --> [*]
    cancelled --> [*]
```

---

## 8. Mapa de uso de Redis (estado actual)

Dónde pega cada cosa durante un disparo — el contexto del incidente.

```mermaid
flowchart LR
    subgraph Redis["Redis (hoy compartido con Chatwoot)"]
        BULL["bull:* — 4 colas BullMQ"]
        PROG["campaign:progress:* — contadores"]
        RLK["ratelimit:lane — token bucket"]
        LOCK["campaign:lock:* / queued:* — locks NX"]
        DED["wh:dedupe:twilio:* — TTL 2d (alta cardinalidad)"]
    end
    subgraph BotRedis["Redis del bot (externo, read-only)"]
        SESS["whatsapp:+E164-inboxId — guard"]
    end
    ORCH["Orchestrator"] --> BULL
    ORCH --> LOCK
    ORCH --> PROG
    SWk["Send worker"] --> BULL
    SWk --> RLK
    SWk --> PROG
    SWk --> SESS
    WHk["Webhook controller"] --> DED
    WHk --> BULL
```

> Referencias de código: `campaign-dispatch.controller.ts`, `campaign-dispatch.worker.ts`,
> `campaign-send.worker.ts`, `status-reduce.worker.ts`, `rate-limiter.service.ts`,
> `webhookEvents.model.ts`, `config/queue.config.ts`, `config/redis.config.ts`.
