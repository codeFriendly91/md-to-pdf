# INFORMÁTICA II — Guía de resolución del TEO Final

> **Objetivo del ejercicio:** armar una planilla de ventas donde, al ingresar un **número de
> cliente**, se completen solos sus datos (Apellido y Nombre, Dirección, Teléfono); y al ingresar
> un **código de artículo** y una **cantidad**, se calcule solo el **Total a Abonar**.
>
> La herramienta central es la función **`BUSCARV`** (o **`CONSULTAV`** según la versión de Office).
> Son la misma función con distinto nombre.

---

## 1. Idea general

El ejercicio se resuelve con **búsquedas automáticas**: vos escribís un código y Excel va a otra
tabla, encuentra la fila que coincide y trae el dato que le pedís.

Vas a trabajar con **tres cosas**:

1. **Tabla de Clientes** — tiene: N° de cliente, Apellido y Nombre, Dirección, Teléfono.
2. **Tabla de Artículos** — tiene: Código de artículo, Descripción, Precio.
3. **Planilla de Ventas** (la hoja principal) — donde cargás N° de cliente, código de artículo y
   cantidad, y el resto se completa con fórmulas.

---

## 2. Cómo funciona `BUSCARV` / `CONSULTAV`

La función busca un valor en la **primera columna** de una tabla y devuelve un dato de **otra
columna** de la misma fila.

### Sintaxis

```
=BUSCARV( valor_buscado ; matriz_tabla ; núm_columna ; FALSO )
```

| Parámetro | Qué es | Ejemplo |
|---|---|---|
| **valor_buscado** | El dato que escribís (ej. el N° de cliente) | `A2` |
| **matriz_tabla** | El rango de la tabla donde buscar (incluye todas sus columnas) | `Clientes!$A$2:$D$100` |
| **núm_columna** | El **número** de columna de esa tabla de donde traer el dato (se cuenta desde 1) | `2` |
| **coincidencia** | Poné siempre **`FALSO`** (coincidencia exacta) | `FALSO` |

> 📌 **`FALSO` es clave.** Si lo omitís, Excel hace una búsqueda aproximada y te puede traer datos
> equivocados. Para códigos de cliente/artículo va **siempre** `FALSO` (o `0`, que es lo mismo).

> 📌 **Separador `;` o `,`**: según tu configuración de Windows, Excel usa punto y coma (`;`) o coma
> (`,`) entre los parámetros. Si una da error, probá con el otro.

---

## 3. Las columnas de datos del cliente

Supongamos que en la **Planilla de Ventas** tenés esta estructura (ajustá las letras de columna a
tu planilla real):

| Celda | Contenido |
|---|---|
| `A2` | N° de cliente (lo escribís vos) |
| `B2` | Apellido y Nombre → **fórmula** |
| `C2` | Dirección → **fórmula** |
| `D2` | Teléfono → **fórmula** |

Y la **Tabla de Clientes** (en una hoja llamada `Clientes`) tiene:

| Columna | A | B | C | D |
|---|---|---|---|---|
| **Dato** | N° cliente | Apellido y Nombre | Dirección | Teléfono |
| **N° de columna** | 1 | 2 | 3 | 4 |

### Fórmulas

**Apellido y Nombre** (columna 2 de la tabla de clientes) → en `B2`:

```
=BUSCARV( A2 ; Clientes!$A$2:$D$100 ; 2 ; FALSO )
```

**Dirección** (columna 3) → en `C2`:

```
=BUSCARV( A2 ; Clientes!$A$2:$D$100 ; 3 ; FALSO )
```

**Teléfono** (columna 4) → en `D2`:

```
=BUSCARV( A2 ; Clientes!$A$2:$D$100 ; 4 ; FALSO )
```

> 🔒 **¿Por qué los `$`?** Fijan el rango de la tabla (referencia **absoluta**). Así, si copiás la
> fórmula hacia abajo para más filas de venta, el rango de la tabla **no se desplaza**. El valor
> buscado (`A2`) va **sin** `$` para que sí acompañe cada fila.

---

## 4. La columna "Total a Abonar"

Acá hay **dos pasos**: primero buscar el **precio** del artículo, y después **multiplicarlo por la
cantidad**.

Supongamos en la Planilla de Ventas:

| Celda | Contenido |
|---|---|
| `E2` | Código de artículo (lo escribís vos) |
| `F2` | Cantidad (la escribís vos) |
| `G2` | Total a Abonar → **fórmula** |

Y la **Tabla de Artículos** (hoja `Articulos`):

| Columna | A | B | C |
|---|---|---|---|
| **Dato** | Código | Descripción | Precio |
| **N° de columna** | 1 | 2 | 3 |

### Fórmula del Total (en `G2`)

El precio está en la **columna 3** de la tabla de artículos. Lo buscás y lo multiplicás por la
cantidad (`F2`):

```
=BUSCARV( E2 ; Articulos!$A$2:$C$100 ; 3 ; FALSO ) * F2
```

**Cómo se lee:** "buscá el código `E2` en la tabla de artículos, traé el precio (columna 3) y
multiplicá ese precio por la cantidad `F2`".

---

## 5. Probar las fórmulas

Como pide la consigna, en las celdas de **entrada** (N° de cliente, código de artículo y cantidad)
**no van fórmulas**: son datos que escribís vos a mano para probar. Por ejemplo:

- En `A2` escribí un N° de cliente que exista en la tabla de clientes → `B2`, `C2`, `D2` deben
  completarse solas con sus datos.
- En `E2` escribí un código de artículo que exista → en `F2` una cantidad (ej. `3`) → `G2` debe
  mostrar el precio × 3.

Si todo se completa solo al cambiar esos números, las fórmulas están bien.

---

## 6. Opcional: evitar el error `#N/D`

Si escribís un código que **todavía no cargaste** (o dejás la celda vacía), `BUSCARV` muestra
`#N/D` (no disponible). Para que en su lugar aparezca un mensaje prolijo, envolvé la fórmula con
**`SI.ERROR`**:

```
=SI.ERROR( BUSCARV( A2 ; Clientes!$A$2:$D$100 ; 2 ; FALSO ) ; "Cliente no encontrado" )
```

Y para el total:

```
=SI.ERROR( BUSCARV( E2 ; Articulos!$A$2:$C$100 ; 3 ; FALSO ) * F2 ; "" )
```

> Esto es un plus de prolijidad; el ejercicio se aprueba igual sin `SI.ERROR`, pero queda mejor.

---

## 7. Checklist antes de entregar

- [ ] Existe una **tabla de Clientes** con N° de cliente, Apellido y Nombre, Dirección y Teléfono.
- [ ] Existe una **tabla de Artículos** con Código, Descripción y Precio.
- [ ] Las columnas Apellido y Nombre, Dirección y Teléfono usan **BUSCARV/CONSULTAV** apuntando a la
      tabla de clientes, con el **número de columna correcto** (2, 3 y 4) y `FALSO`.
- [ ] La columna **Total a Abonar** usa BUSCARV/CONSULTAV para traer el **precio** y lo **multiplica
      por la cantidad**.
- [ ] Los rangos de las tablas van con **`$`** (referencia absoluta).
- [ ] Probaste con un **N° de cliente**, un **código de artículo** y una **cantidad** reales, y todo
      se completó solo.
- [ ] Guardaste el archivo y lo subiste al **"Espacio para subir el TEO Final"**.

---

## 8. Resumen de las fórmulas (para copiar y adaptar)

```excel
Apellido y Nombre :  =BUSCARV(A2; Clientes!$A$2:$D$100; 2; FALSO)
Dirección         :  =BUSCARV(A2; Clientes!$A$2:$D$100; 3; FALSO)
Teléfono          :  =BUSCARV(A2; Clientes!$A$2:$D$100; 4; FALSO)
Total a Abonar    :  =BUSCARV(E2; Articulos!$A$2:$C$100; 3; FALSO) * F2
```

> Reemplazá las letras de columna (`A2`, `E2`, `F2`), los nombres de hoja (`Clientes`, `Articulos`)
> y los rangos por los que correspondan a **tu** planilla. Si usás **CONSULTAV**, la sintaxis es
> idéntica: solo cambia el nombre por `CONSULTAV`.
