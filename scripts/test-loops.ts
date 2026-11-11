// Finds routes that wind back on themselves: total heading change within any
// 400 m stretch above 200 deg means the path loops around an island.
import { readFileSync } from "node:fs";
import { Airport, type XY } from "../src/airport.ts";
import { plan } from "../src/plan.ts";
import { FLOWS } from "../src/procedures.ts";

const ap = new Airport(JSON.parse(readFileSync(new URL("../src/data/rjtt.json", import.meta.url), "utf8")));
const stands = process.argv.slice(2).length ? process.argv.slice(2) : ["10", "20", "61", "68", "110", "143", "505"];

function worstWinding(line: XY[]): number {
  const seg: { len: number; turn: number }[] = [];
  for (let i = 1; i + 1 < line.length; i++) {
    const a = line[i - 1], b = line[i], c = line[i + 1];
    let d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    seg.push({ len: Math.hypot(c[0] - b[0], c[1] - b[1]), turn: Math.abs((d * 180) / Math.PI) });
  }
  let worst = 0;
  for (let i = 0; i < seg.length; i++) {
    let len = 0, turn = 0;
    for (let j = i; j < seg.length && len < 400; j++) { len += seg[j].len; turn += seg[j].turn; }
    worst = Math.max(worst, turn);
  }
  return worst;
}

let bad = 0, total = 0;
for (const f of FLOWS) {
  for (const mode of ["arr", "dep"] as const) {
    for (const rwy of mode === "arr" ? f.arr : f.dep) {
      const points = mode === "arr" ? [undefined, ...ap.exits(rwy).map((e) => e.ref + e.side)] : [undefined];
      for (const stand of stands) for (const point of points) {
        for (const o of plan(ap, { mode, flow: f.id, runway: rwy, stand, point })) {
          total++;
          // judge the taxi itself: drop the stand lead-in (pushback / parking turn)
          const lead = ap.stand(stand)!.path.length / 2 - 1;
          const w = worstWinding(mode === "arr" ? o.line.slice(0, o.line.length - lead) : o.line.slice(lead));
          if (w > 200) { bad++; console.log(`${f.id} ${mode} ${rwy} ${point ?? "auto"} spot ${stand}: ${Math.round(w)}°  ${o.summary}`); }
        }
      }
    }
  }
}
console.log(`${bad} / ${total} routes wind more than 200° within 400 m`);
