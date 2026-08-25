/**
 * Logs de Vercel, mirados por PATRON y no por la palabra "error".
 *
 * Existe porque buscando "error" se me paso el bug mas caro de todos: quince
 * GET a /stock/<uuid> con el mismo segundo, todos nivel `info`, que eran Next
 * precargando una ficha por cada fila de la tabla. El error estaba en lo que yo
 * filtraba, no en lo que faltaba.
 *
 * Uso:  node scripts/ver-logs.mjs [erp-unamargo|web-unamargo] [rama]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PROYECTO = process.argv[2] ?? "erp-unamargo";
const RAMA = process.argv[3] ?? "develop";
const CFG = path.join(os.homedir(), ".vercel-surlabs");
const TOKEN = JSON.parse(fs.readFileSync(path.join(CFG, "auth.json"), "utf8")).token;
const TEAM = JSON.parse(fs.readFileSync(path.join(CFG, "config.json"), "utf8")).currentTeam;

const pedir = async (ruta) => {
  const url = `https://api.vercel.com${ruta}${ruta.includes("?") ? "&" : "?"}teamId=${TEAM}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.text();
};
/** Un objeto JSON. */
const apiJson = async (ruta) => JSON.parse(await pedir(ruta));
/** Una linea JSON por evento (JSONL). */
const api = async (ruta) =>
  (await pedir(ruta)).trim().split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

const lista = (await apiJson(`/v6/deployments?app=${PROYECTO}&limit=20`)).deployments ?? [];
const dep = (Array.isArray(lista) ? lista : []).find(
  (d) => (d.meta?.githubCommitRef ?? "") === RAMA,
);
if (!dep) { console.log(`No hay deploys de "${RAMA}" en ${PROYECTO}.`); process.exit(0); }
console.log(`  ${PROYECTO} · rama ${RAMA} · ${dep.url}\n`);

const eventos = await api(`/v3/deployments/${dep.uid}/events?limit=1000`);
if (eventos.length === 0) { console.log("  Sin eventos en la ventana disponible."); process.exit(0); }

const pedidos = eventos.filter((e) => e.requestPath);
const errores = eventos.filter(
  (e) => e.level === "error" || (e.responseStatusCode ?? 0) >= 500 ||
    /error|unhandled|timeout|exceeded/i.test(String(e.message ?? e.text ?? "")),
);

console.log(`  ${eventos.length} eventos · ${pedidos.length} pedidos · ${errores.length} con error\n`);

// --- 1. RAFAGAS: muchos pedidos en el mismo segundo -------------------------
// Es la firma de una precarga descontrolada, y no aparece buscando "error".
const porSegundo = new Map();
for (const p of pedidos) {
  const s = Math.floor((p.timestamp ?? p.created ?? 0) / 1000);
  if (!porSegundo.has(s)) porSegundo.set(s, []);
  porSegundo.get(s).push(p.requestPath);
}
const rafagas = [...porSegundo.entries()].filter(([, v]) => v.length >= 5)
  .sort((a, b) => b[1].length - a[1].length).slice(0, 5);
console.log("  RAFAGAS (5+ pedidos en el mismo segundo)");
if (rafagas.length === 0) console.log("    ninguna\n");
else {
  for (const [s, rutas] of rafagas) {
    const familia = new Map();
    for (const r of rutas) {
      const f = r.replace(/\/[0-9a-f-]{8,}/g, "/<id>");
      familia.set(f, (familia.get(f) ?? 0) + 1);
    }
    const top = [...familia.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([f, n]) => `${n}x ${f}`).join(", ");
    console.log(`    ${new Date(s * 1000).toISOString().slice(11, 19)}  ${rutas.length} pedidos  ->  ${top}`);
  }
  console.log();
}

// --- 2. RUTAS MAS PEDIDAS ---------------------------------------------------
const familias = new Map();
for (const p of pedidos) {
  const f = p.requestPath.replace(/\/[0-9a-f-]{8,}/g, "/<id>");
  familias.set(f, (familias.get(f) ?? 0) + 1);
}
console.log("  RUTAS MAS PEDIDAS");
[...familias.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([f, n]) => console.log(`    ${String(n).padStart(4)}x  ${f}`));
console.log();

// --- 3. ERRORES, con el mensaje entero -------------------------------------
console.log("  ERRORES");
if (errores.length === 0) console.log("    ninguno");
else {
  const vistos = new Set();
  for (const e of errores.slice(0, 12)) {
    const msg = String(e.message ?? e.text ?? `HTTP ${e.responseStatusCode}`).replace(/\s+/g, " ").trim();
    const clave = msg.slice(0, 90);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    console.log(`    ${e.requestPath ?? ""} ${msg.slice(0, 260)}`);
  }
}
