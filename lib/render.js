/**
 * Núcleo de conversión Markdown -> HTML -> PDF.
 * Usado por el CLI (convert.js) y por el servidor de la UI (server.js).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import hljs from "highlight.js";
import puppeteer from "puppeteer-core";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const MERMAID_BUNDLE = join(projectRoot, "node_modules/mermaid/dist/mermaid.min.js");

/** Detecta la ruta de Chrome o Edge instalado. */
export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

/** Convierte Markdown a un documento HTML completo y con estilo. */
export function renderHtml(source, opts = {}) {
  const { theme = "light", toc = true, landscape = false } = opts;

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight(str, lang) {
      // Los bloques ```mermaid no son código: van a un contenedor que se
      // dibuja como diagrama (SVG) durante el render con puppeteer.
      if (lang === "mermaid") {
        return `<pre class="mermaid">${md.utils.escapeHtml(str)}</pre>`;
      }
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
        } catch {}
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
    },
  });

  const headings = [];
  md.use(anchor, {
    level: [1, 2, 3],
    slugify: (s) => "h-" + s.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, ""),
    callback: (token, info) => {
      if (["h1", "h2", "h3"].includes(token.tag)) {
        headings.push({ level: Number(token.tag[1]), slug: info.slug, title: info.title });
      }
    },
  });

  const body = md.render(source);
  const title = (source.match(/^#\s+(.+)$/m)?.[1] || "Documento").trim();

  const tocItems = headings.filter((t) => t.level >= 2);
  const tocHtml =
    toc && tocItems.length
      ? `<nav class="toc">
          <div class="toc-title">Contenido</div>
          <ul>
            ${tocItems
              .map(
                (t) =>
                  `<li class="toc-l${t.level}"><a href="#${t.slug}">${md.utils.escapeHtml(t.title)}</a></li>`
              )
              .join("\n")}
          </ul>
        </nav>`
      : "";

  const hljsCss = readFileSync(
    join(projectRoot, "node_modules/highlight.js/styles/" + (theme === "dark" ? "github-dark.css" : "github.css")),
    "utf8"
  );

  const css = buildCss(theme, hljsCss, landscape);

  return {
    title,
    html: `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${md.utils.escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
<main class="page">
  <header class="cover"><h1 class="cover-title">${md.utils.escapeHtml(title)}</h1></header>
  ${tocHtml}
  <article class="content">${body}</article>
</main>
</body>
</html>`,
  };
}

/**
 * Renderiza un HTML a PDF manejando el Chrome/Edge ya instalado con
 * puppeteer-core. Si el documento tiene diagramas Mermaid, los dibuja
 * (a SVG) y ESPERA a que terminen antes de imprimir — así nunca salen
 * cortados ni a medio renderizar.
 */
export async function htmlToPdf(html, outputPath, opts = {}) {
  const { theme = "light" } = opts;
  const executablePath = findBrowser();
  if (!executablePath) throw new Error("No encontré Chrome ni Edge instalado.");

  const hasMermaid = html.includes('class="mermaid"');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    if (hasMermaid) {
      await page.addScriptTag({ path: MERMAID_BUNDLE });
      const mermaidTheme = theme === "dark" ? "dark" : "default";
      // Dibuja cada diagrama por separado: si uno falla, no tumba al resto.
      await page.evaluate(async (mermaidTheme) => {
        const mermaid = window.mermaid;
        mermaid.initialize({
          startOnLoad: false,
          theme: mermaidTheme,
          securityLevel: "loose",
          flowchart: { htmlLabels: true, useMaxWidth: true, curve: "basis" },
          sequence: { useMaxWidth: true },
          state: { useMaxWidth: true },
        });
        const nodes = Array.from(document.querySelectorAll("pre.mermaid"));
        for (let i = 0; i < nodes.length; i++) {
          const el = nodes[i];
          const src = el.textContent;
          try {
            const { svg } = await mermaid.render("mmd-" + i, src);
            el.innerHTML = svg;
            el.setAttribute("data-rendered", "1");
          } catch (e) {
            el.innerHTML =
              '<div class="mermaid-error">No se pudo renderizar este diagrama: ' +
              ((e && e.message) || e) +
              "</div>";
          }
        }
      }, mermaidTheme);
      // Garantía extra: todos los contenedores quedaron resueltos.
      await page
        .waitForFunction(
          () => Array.from(document.querySelectorAll("pre.mermaid")).every((el) => el.children.length > 0),
          { timeout: 30000 }
        )
        .catch(() => {});
    }

    await page.pdf({
      path: outputPath,
      printBackground: true,
      preferCSSPageSize: true, // respeta el @page (A4 + landscape) del CSS
    });
  } finally {
    await browser.close();
  }
  return outputPath;
}

/** Conveniencia: Markdown -> PDF en un paso. */
export async function convertMarkdown(source, outputPath, opts = {}) {
  const { html } = renderHtml(source, opts);
  return htmlToPdf(html, outputPath, opts);
}

function buildCss(theme, hljsCss, landscape) {
  const dark = theme === "dark";
  const c = dark
    ? { bg: "#0d1117", fg: "#e6edf3", muted: "#8b949e", border: "#30363d", accent: "#58a6ff", thBg: "#161b22", zebra: "#11161d", codeBg: "#161b22", quote: "#1c2128" }
    : { bg: "#ffffff", fg: "#1f2328", muted: "#636c76", border: "#d0d7de", accent: "#0969da", thBg: "#f0f3f6", zebra: "#f6f8fa", codeBg: "#f6f8fa", quote: "#f6f8fa" };

  return `
${hljsCss}

@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 16mm 14mm 18mm 14mm; }
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; background: ${c.bg}; color: ${c.fg};
  font-family: "Segoe UI", -apple-system, "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5pt; line-height: 1.55;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.content { max-width: 100%; }

.cover { border-bottom: 3px solid ${c.accent}; padding-bottom: 10px; margin-bottom: 18px; }
.cover-title { font-size: 23pt; font-weight: 700; margin: 0; line-height: 1.2; }

h1, h2, h3, h4 { font-weight: 700; line-height: 1.25; break-after: avoid-page; }
h1 { font-size: 18pt; margin: 22px 0 10px; padding-bottom: 4px; border-bottom: 2px solid ${c.border}; }
h2 { font-size: 14.5pt; margin: 20px 0 8px; padding-bottom: 3px; border-bottom: 1px solid ${c.border}; }
h3 { font-size: 12pt; margin: 16px 0 6px; }
h4 { font-size: 10.5pt; margin: 12px 0 4px; color: ${c.muted}; }

p { margin: 7px 0; }
a { color: ${c.accent}; text-decoration: none; word-break: break-word; }
.header-anchor { display: none; }
ul, ol { margin: 7px 0; padding-left: 22px; }
li { margin: 3px 0; }
hr { border: none; border-top: 1px solid ${c.border}; margin: 18px 0; }

.toc { border: 1px solid ${c.border}; border-radius: 6px; background: ${c.zebra}; padding: 12px 18px; margin: 0 0 18px; break-inside: avoid; }
.toc-title { font-weight: 700; font-size: 11pt; margin-bottom: 6px; }
.toc ul { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 28px; }
.toc li { margin: 2px 0; break-inside: avoid; }
.toc-l3 { padding-left: 14px; font-size: 9pt; }
.toc a { color: ${c.fg}; }
.toc-l2 > a { font-weight: 600; }

code { font-family: "Cascadia Code", "Consolas", "SF Mono", monospace; font-size: 8.8pt; background: ${c.codeBg}; padding: 1px 5px; border-radius: 4px; border: 1px solid ${c.border}; word-break: break-word; }
pre { break-inside: avoid; }
pre code, pre.hljs { display: block; padding: 10px 12px; font-size: 8.6pt; line-height: 1.45; border: 1px solid ${c.border}; border-radius: 6px; background: ${c.codeBg}; overflow-wrap: anywhere; white-space: pre-wrap; }
pre code { border: none; padding: 0; background: transparent; }

/* ---------- diagramas Mermaid ---------- */
pre.mermaid {
  background: transparent; border: none; padding: 6px 0; margin: 14px 0;
  text-align: center; white-space: normal; break-inside: avoid;
}
pre.mermaid svg {
  max-width: 100%;
  /* limita la altura para que un diagrama alto entre en una página */
  max-height: ${landscape ? "150mm" : "235mm"};
  height: auto; width: auto;
}
.mermaid-error {
  color: #f85149; font-weight: 600; font-size: 9pt; text-align: left;
  border: 1px solid #f85149; border-radius: 6px; padding: 8px 12px; background: rgba(248,81,73,.08);
}

blockquote { margin: 10px 0; padding: 8px 14px; border-left: 4px solid ${c.accent}; background: ${c.quote}; border-radius: 0 6px 6px 0; color: ${c.fg}; break-inside: avoid; }
blockquote p { margin: 4px 0; }

table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 8.8pt; break-inside: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; break-after: auto; }
th, td { border: 1px solid ${c.border}; padding: 5px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }
th { background: ${c.thBg}; font-weight: 700; }
tbody tr:nth-child(even) { background: ${c.zebra}; }
table code { font-size: 8pt; padding: 0 3px; }

img { max-width: 100%; }
strong { font-weight: 700; }
`;
}
