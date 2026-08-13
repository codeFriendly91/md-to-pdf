#!/usr/bin/env node
/**
 * UI web local para md2pdf.
 *   node server.js [puerto]
 * Abrí http://localhost:3000 en el navegador.
 */
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, readFileSync as read, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { renderHtml, htmlToPdf, findBrowser } from "./lib/render.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const PREFERRED_PORT = Number(process.argv[2]) || 4321;
const NO_OPEN = process.argv.includes("--no-open");

const send = (res, status, type, body) => {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const page = readFileSync(join(__dir, "public", "index.html"));
      return send(res, 200, "text/html; charset=utf-8", page);
    }

    if (req.method === "GET" && req.url === "/health") {
      const browser = findBrowser();
      return send(res, 200, "application/json", JSON.stringify({ ok: !!browser, browser }));
    }

    if (req.method === "POST" && req.url === "/convert") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString("utf8");
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return send(res, 400, "application/json", JSON.stringify({ error: "JSON inválido" }));
      }

      const { markdown = "", filename = "documento.md", theme = "light", toc = true, landscape = false } = data;
      if (!markdown.trim()) {
        return send(res, 400, "application/json", JSON.stringify({ error: "No hay contenido Markdown" }));
      }

      const opts = { theme, toc: !!toc, landscape: !!landscape };
      const { html } = renderHtml(markdown, opts);

      const tmp = mkdtempSync(join(tmpdir(), "md2pdf-srv-"));
      const pdfPath = join(tmp, "out.pdf");
      try {
        await htmlToPdf(html, pdfPath, opts);
        const pdf = read(pdfPath);
        const outName = filename.replace(/\.md$/i, "") + ".pdf";
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${encodeURIComponent(outName)}"`,
          "Content-Length": pdf.length,
        });
        return res.end(pdf);
      } finally {
        try { rmSync(tmp, { recursive: true, force: true }); } catch {}
      }
    }

    send(res, 404, "text/plain", "No encontrado");
  } catch (e) {
    send(res, 500, "application/json", JSON.stringify({ error: e.message }));
  }
});

function openBrowser(url) {
  if (NO_OPEN) return;
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {}
}

function start(port, attemptsLeft = 12) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log(`  Puerto ${port} ocupado, probando ${port + 1}…`);
      start(port + 1, attemptsLeft - 1);
    } else {
      console.error("  No pude iniciar el servidor:", err.message);
      process.exit(1);
    }
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    const browser = findBrowser();
    console.log(`\n  md2pdf UI  ->  ${url}\n`);
    if (!browser) {
      console.warn("  ⚠  No se encontró Chrome ni Edge: la conversión va a fallar.\n");
    } else {
      console.log(`  Navegador para render: ${browser}\n`);
    }
    console.log("  (Para cerrar el programa, cerrá esta ventana.)\n");
    openBrowser(url);
  });
}

start(PREFERRED_PORT);
