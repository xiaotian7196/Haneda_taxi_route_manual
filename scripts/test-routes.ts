// Smoke test: every flow / runway / terminal combination should route.
import { readFileSync } from "node:fs";
import { Airport } from "../src/airport.ts";
import { plan } from "../src/plan.ts";
import { FLOWS } from "../src/procedures.ts";

const ap = new Airport(JSON.parse(readFileSync(new URL("../src/data/rjtt.json", import.meta.url), "utf8")));
const sample = { T1: "10", T2: "61", T3: "110" } as const;

for (const f of FLOWS) {
  for (const rwy of f.arr) {
    const exits = ap.exits(rwy);
    console.log(`\n[${f.id}] ARR ${rwy} exits: ${exits.map((e) => e.ref + e.side).join(" ")}`);
    for (const [g, ref] of Object.entries(sample)) {
      for (const p of plan(ap, { mode: "arr", flow: f.id, runway: rwy, stand: ref })) {
        console.log(`  ${g} ${ref}: ${p.summary}  ${Math.round(p.length)}m ${p.missed.length ? "MISSED " + p.missed : ""}`);
      }
    }
  }
  for (const rwy of f.dep) {
    console.log(`\n[${f.id}] DEP ${rwy} entries: ${ap.junctions(rwy).map((j) => j.ref).join(" ")}`);
    for (const [g, ref] of Object.entries(sample)) {
      for (const p of plan(ap, { mode: "dep", flow: f.id, runway: rwy, stand: ref })) {
        console.log(`  ${g} ${ref}: ${p.summary}  ${Math.round(p.length)}m ${p.missed.length ? "MISSED " + p.missed : ""}`);
      }
    }
  }
}
