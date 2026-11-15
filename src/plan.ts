// Turns a user selection into one routed option per published template.
import type { Airport, Exit, Leg, XY } from "./airport.ts";
import { ARRIVALS, DEPARTURES, templates, type FlowId, type Template } from "./procedures.ts";
import { route, steps, type Step } from "./router.ts";

export interface PlanRequest {
  mode: "arr" | "dep";
  flow: FlowId;
  runway: string;
  stand: string;
  /** arrival: exit key `${ref}${side}`; departure: entry taxiway ref */
  point?: string;
}
export interface PlanOption {
  template: Template;
  exit?: Exit;
  entry?: Leg;
  steps: Step[];
  line: XY[];
  length: number;
  missed: string[];
  summary: string;
  crossings: string[];
  crossAt: { rw: string; at: XY }[];
}

function crossPoints(ap: Airport, nodes: number[], own: string) {
  const out: { rw: string; at: XY }[] = [];
  let last = "";
  nodes.forEach((n, i) => {
    const rw = ap.runwayNode.get(n) ?? "";
    if (rw && rw !== own && rw !== last && i > 0 && i < nodes.length - 1) out.push({ rw, at: ap.xy[n] });
    last = rw;
  });
  return out;
}

export const MIN_EXIT_S = 1500;
const LIKELY_EXIT_S = 2100;
export const exitKey = (e: Exit) => e.ref + e.side;

export function plan(ap: Airport, req: PlanRequest): PlanOption[] {
  const stand = ap.stand(req.stand);
  if (!stand) return [];
  const standLine: XY[] = [];
  for (let i = 0; i < stand.path.length; i += 2) standLine.push([stand.path[i], stand.path[i + 1]]);
  const own = ap.runway(req.runway).id;
  const out: PlanOption[] = [];

  // direction of the stand lead-in line as it leaves the taxiway network
  const lead = standLine.find((p) => Math.hypot(p[0] - standLine[0][0], p[1] - standLine[0][1]) > 3);
  const goalDir: XY | undefined = lead && [lead[0] - standLine[0][0], lead[1] - standLine[0][1]];

  if (req.mode === "arr") {
    const exits = ap.exits(req.runway);
    // the direct route from an exit only depends on the exit, so share it between templates
    const direct = new Map<number, ReturnType<typeof route>>();
    const directRoute = (exit: Exit) => {
      if (!direct.has(exit.node)) {
        direct.set(exit.node, route(ap, { start: exit.node, firstHop: exit.next, goal: stand.entry, via: [], ownRunway: own, goalDir }));
      }
      return direct.get(exit.node) ?? null;
    };
    for (const t of templates(ARRIVALS, req.runway, stand.group, req.flow)) {
      let candidates = req.point ? exits.filter((e) => exitKey(e) === req.point) : exits.filter((e) => e.s >= MIN_EXIT_S);
      if (!req.point && t.side && candidates.some((e) => e.side === t.side)) candidates = candidates.filter((e) => e.side === t.side);
      let best: PlanOption | null = null;
      let bestScore = Infinity;
      for (const exit of candidates) {
        const r = route(ap, { start: exit.node, firstHop: exit.next, goal: stand.entry, via: t.via, ownRunway: own, goalDir });
        if (!r) continue;
        // Following the published taxiways must not mean driving round an apron
        // island: when the direct route is much shorter, take it and say which
        // published taxiways it left out.
        const d = directRoute(exit);
        const use = d && r.length > d.length * 1.2 ? d : r;
        const missed = use === d ? t.via.filter((v) => !use.refs.includes(v)) : r.missed;
        // prefer exits around a typical airliner landing roll over long roll-outs
        const score = use.length + Math.max(0, exit.s - LIKELY_EXIT_S) * 2 + missed.length * 4000;
        if (best && bestScore <= score) continue;
        bestScore = score;
        const st = steps(ap, use, own);
        best = {
          template: t, exit, steps: st,
          line: [...use.nodes.map((n) => ap.xy[n]), ...standLine.slice(1)],
          length: use.length, missed,
          summary: [...st.map((s) => s.ref).filter(Boolean), `Spot ${stand.ref}`].join(" → "),
          crossings: [...new Set(st.map((s) => s.crossing).filter((c): c is string => !!c))],
          crossAt: crossPoints(ap, use.nodes, own),
        };
      }
      if (best) out.push(best);
    }
  } else {
    const junctions = ap.junctions(req.runway);
    for (const t of templates(DEPARTURES, req.runway, stand.group, req.flow)) {
      const want = req.point ?? t.entry;
      const entry = (want && junctions.find((j) => j.ref === want)) || junctions[0];
      if (!entry) continue;
      const r = route(ap, {
        start: stand.entry, goal: entry.node, goalFrom: (entry as Leg).next, via: t.via, ownRunway: own,
        // the aircraft leaves the stand along its lead-in line, i.e. opposite to goalDir
        startDir: goalDir && [-goalDir[0], -goalDir[1]],
      });
      if (!r) continue;
      const st = steps(ap, r, own);
      out.push({
        template: t, entry, steps: st,
        line: [...[...standLine].reverse(), ...r.nodes.slice(1).map((n) => ap.xy[n])],
        length: r.length, missed: r.missed,
        summary: [`Spot ${stand.ref}`, ...st.map((s) => s.ref).filter(Boolean), `RWY ${req.runway}`].join(" → "),
        crossings: [...new Set(st.map((s) => s.crossing).filter((c): c is string => !!c))],
        crossAt: crossPoints(ap, r.nodes, own),
      });
    }
  }
  // collapse duplicates (two templates resolving to the same path)
  const uniq = out.filter((o, i) => out.findIndex((p) => p.summary === o.summary) === i);
  // a hand-picked exit/entry can make some published routes absurd: drop the detours
  if (!req.point) return uniq;
  const min = Math.min(...uniq.map((o) => o.length));
  return uniq.filter((o) => o.length <= min * 1.35);
}

/** index of the preferred option (fewest missed taxiways, then shortest); tags the option chips */
export function bestIndex(opts: PlanOption[]): number {
  let bi = 0;
  opts.forEach((o, i) => {
    const b = opts[bi];
    if (o.missed.length < b.missed.length || (o.missed.length === b.missed.length && o.length < b.length)) bi = i;
  });
  return bi;
}
