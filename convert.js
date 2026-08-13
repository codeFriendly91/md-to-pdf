#!/usr/bin/env node
/**
 * md2pdf — Convierte Markdown a PDF "bonito" usando el motor de Chrome/Edge.
 *
 * Uso:
 *   node convert.js <archivo.md> [salida.pdf] [opciones]
 *
 * Opciones:
 *   --landscape        Página horizontal (útil para tablas muy anchas)
 *   --theme=light|dark Tema de color (default: light)
 *   --no-toc           No generar tabla de contenidos
 *   --keep-html        Conservar el .html intermedio (para depurar)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { renderHtml, htmlToPdf } from "./lib/render.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positionals = argv.filter((a) => !a.startsWith("--"));
const getOpt = (name, def) => {
  const f = [...flags].find((x) => x.startsWith(`--${name}=`));
  return f ? f.split("=").slice(1).join("=") : def;
};

const input = positionals[0];
if (!input) {
  console.error("Uso: node convert.js <archivo.md> [salida.pdf] [--landscape] [--theme=light|dark] [--no-toc] [--keep-html]");
  process.exit(1);
}
const inputPath = resolve(input);
if (!existsSync(inputPath)) {
  console.error(`No existe el archivo: ${inputPath}`);
  process.exit(1);
}

const outputPath = resolve(positionals[1] || inputPath.replace(/\.md$/i, "") + ".pdf");
const options = {
  landscape: flags.has("--landscape"),
  theme: getOpt("theme", "light"),
  toc: !flags.has("--no-toc"),
};

const source = readFileSync(inputPath, "utf8");
const { html } = renderHtml(source, options);

if (flags.has("--keep-html")) {
  const htmlPath = outputPath.replace(/\.pdf$/i, "") + ".html";
  writeFileSync(htmlPath, html, "utf8");
  console.log(`HTML -> ${htmlPath}`);
}

try {
  await htmlToPdf(html, outputPath, options);
  console.log(`OK -> ${outputPath}`);
} catch (e) {
  console.error("Falló el render:", e.message);
  process.exit(1);
}
