// Smoke test: every flow / runway / terminal combination should route, and no
// route may double back on itself (the router is supposed to remove those).
import { readFileSync } from "node:fs";
import { Airport, dist, type XY } from "../src/airport.ts";
import { plan, type PlanOption } from "../src/plan.ts";
import { FLOWS } from "../src/procedures.ts";

const ap = new Airport(JSON.parse(readFileSync(new URL("../src/data/rjtt.json", import.meta.url), "utf8")));
const sample = { T1: "10", T2: "61", T3: "110" } as const;

const bearing = (a: XY, b: XY) => Math.atan2(b[0] - a[0], b[1] - a[1]);
/** heading at `i` over at least `span` metres of path, clamped to the ends */
function heading(pts: XY[], i: number, dir: 1 | -1, span: number) {
  let j = i, acc = 0;
  while (acc < span && j + dir >= 0 && j + dir < pts.length) {
    acc += dist(pts[j], pts[j + dir]);
    j += dir;
  }
  return dir === 1 ? bearing(pts[i], pts[j]) : bearing(pts[j], pts[i]);
}
/** biggest net direction change along a route, in degrees */
function maxReversal(pts: XY[]): number {
  let worst = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    if (dist(pts[0], pts[i]) < 90 || dist(pts[i], pts[pts.length - 1]) < 90) continue; // clamped window
    let d = Math.abs(((heading(pts, i, 1, 90) - heading(pts, i, -1, 90)) * 180) / Math.PI) % 360;
    if (d > 180) d = 360 - d;
    worst = Math.max(worst, d);
  }
  return worst;
}

let failures = 0;
const check = (o: PlanOption, label: string) => {
  const r = maxReversal(o.line);
  if (r > 130) {
    failures++;
    console.log(`  BAD ${label}: reverses ${r.toFixed(0)}° — ${o.summary}`);
  }
};

for (const f of FLOWS) {
  for (const rwy of f.arr) {
    const exits = ap.exits(rwy);
    console.log(`\n[${f.id}] ARR ${rwy} exits: ${exits.map((e) => e.ref + e.side).join(" ")}`);
    for (const [g, ref] of Object.entries(sample)) {
      for (const p of plan(ap, { mode: "arr", flow: f.id, runway: rwy, stand: ref })) {
        console.log(`  ${g} ${ref}: ${p.summary}  ${Math.round(p.length)}m ${p.missed.length ? "MISSED " + p.missed : ""}`);
        check(p, `${f.id} ARR ${rwy} ${ref}`);
      }
    }
  }
  for (const rwy of f.dep) {
    console.log(`\n[${f.id}] DEP ${rwy} entries: ${ap.junctions(rwy).map((j) => j.ref).join(" ")}`);
    for (const [g, ref] of Object.entries(sample)) {
      for (const p of plan(ap, { mode: "dep", flow: f.id, runway: rwy, stand: ref })) {
        console.log(`  ${g} ${ref}: ${p.summary}  ${Math.round(p.length)}m ${p.missed.length ? "MISSED " + p.missed : ""}`);
        check(p, `${f.id} DEP ${rwy} ${ref}`);
      }
    }
  }
}

if (failures) {
  console.log(`\n${failures} route(s) double back on themselves`);
  process.exitCode = 1;
}
