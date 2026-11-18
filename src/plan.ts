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
    // taxiways a movement may not use, from the published handling rules
    const num = parseInt(stand.ref, 10);
    // T1 arrivals are worked via K (north) or G (south); J and H are not used
    // the eastern T2 stands (56-73, 81-84) are not worked via R
    const avoidRefs = stand.group === "T1" ? ["J", "H"]
      : stand.group === "T2" && ((num >= 56 && num <= 73) || (num >= 81 && num <= 84)) ? ["R"]
      : undefined;
    // the direct route from an exit only depends on the exit and the banned set
    const direct = new Map<string, ReturnType<typeof route>>();
    const directRoute = (exit: Exit, avoid?: string[]) => {
      const key = `${exit.node}|${avoid ? avoid.join(",") : ""}`;
      if (!direct.has(key)) {
        direct.set(key, route(ap, { start: exit.node, firstHop: exit.next, goal: stand.entry, via: [], ownRunway: own, goalDir, avoidRefs: avoid }));
      }
      return direct.get(key) ?? null;
    };
    // T1 may use K (north) or G (south) — J and H are banned — but a stand on the
    // south side must not be worked via K: that route runs up the north side and
    // comes all the way back down
    let list = templates(ARRIVALS, req.runway, stand.group, req.flow);
    if (stand.group === "T1" && stand.y < 0) {
      const south = list.filter((t) => !t.via.includes("K"));
      if (south.length) list = south;
    }
    for (const t of list) {
      let candidates = req.point ? exits.filter((e) => exitKey(e) === req.point) : exits.filter((e) => e.s >= MIN_EXIT_S);
      // a stand is only ever served from its own side of the runway
      const standSide = ap.sideOf(req.runway, [stand.x, stand.y]);
      const sameSide = candidates.filter((e) => e.side === standSide);
      if (sameSide.length) candidates = sameSide;
      if (!req.point && t.side && candidates.some((e) => e.side === t.side)) candidates = candidates.filter((e) => e.side === t.side);
      let best: PlanOption | null = null;

      // first pass keeps clear of the banned taxiways; only if that hides the stand
      // altogether do we fall back to them
      const pick = (avoid?: string[]) => {
        best = null;
        let bestScore = Infinity;
        for (const exit of candidates) {
          const r = route(ap, { start: exit.node, firstHop: exit.next, goal: stand.entry, via: t.via, ownRunway: own, goalDir, avoidRefs: avoid });
          if (!r) continue;
          // Following the published taxiways must not mean driving round an apron
          // island: when the direct route is much shorter, take it and say which
          // published taxiways it left out.
          const d = directRoute(exit, avoid);
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
      };
      pick(avoidRefs);
      if (!best && avoidRefs) pick(undefined);
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
  // nearest first: which side of the apron a stand is worked from is decided by taxi
  // distance, so the shortest option is the one shown by default
  uniq.sort((a, b) => a.length - b.length);
  // a published route that comes out far longer than the nearest one is a detour,
  // not a variant: drop it instead of offering it
  const min = Math.min(...uniq.map((o) => o.length));
  return uniq.filter((o) => o.length <= min * 1.35);
}

/** index of the shortest option — the one the chips tag and the panel selects */
export function bestIndex(opts: PlanOption[]): number {
  let bi = 0;
  opts.forEach((o, i) => {
    if (o.length < opts[bi].length) bi = i;
  });
  return bi;
}
