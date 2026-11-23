// Turns a user selection into one routed option per published template.
import { dist, type Airport, type Exit, type Leg, type XY } from "./airport.ts";
import { ARRIVALS, DEPARTURES, EXIT_RUNOUT, templates, type FlowId, type Template } from "./procedures.ts";
import { route, steps, type RouteResult, type Step } from "./router.ts";

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

interface Runout {
  /** turn-off point ... end of the exit taxiway */
  nodes: number[];
  length: number;
}

/**
 * The stretch of an exit taxiway that still has to be taxied after vacating,
 * from the turn-off point to the node where the taxiway ends at another named
 * taxiway. Most exits are a short connector, but a rapid exit such as L12 is a
 * long curve that loops back onto L: the first connector off it (L11) is a
 * shortcut across the loop, not the cleared direction of travel.
 */
function exitRunouts(ap: Airport, exit: Exit): Runout[] {
  const out: Runout[] = [];
  const seen = new Set([exit.node, exit.next]);
  const walk = (nodes: number[], length: number) => {
    const cur = nodes[nodes.length - 1];
    const prev = nodes[nodes.length - 2];
    const nexts = ap.adj[cur].filter((a) => a.to !== prev && !seen.has(a.to));
    const same = nexts.filter((a) => ap.refs[a.ref] === exit.ref);
    // the exit taxiway is over where it stops existing and another named taxiway starts
    if (!same.length && nexts.some((a) => a.ref !== 0 && ap.refs[a.ref] !== exit.ref)) {
      out.push({ nodes: [...nodes], length });
    }
    for (const a of same) {
      if (length + a.len > 1500) continue;
      seen.add(a.to);
      walk([...nodes, a.to], length + a.len);
      seen.delete(a.to);
    }
  };
  walk([exit.node, exit.next], dist(ap.xy[exit.node], ap.xy[exit.next]));
  return out;
}

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
    const north = req.runway === "34L" || req.runway === "34R";
    // north flow: T1 arrivals are worked via K or G and never through J or H;
    // T3 arrivals on 34R cross 34L on A15 or A3, never down J;
    // south flow: the eastern T2 stands (56-73, 81-84) are not worked via R
    const avoidRefs = stand.group === "T1" && north ? ["J", "H"]
      : stand.group === "T3" && req.runway === "34R" ? ["J"]
      : stand.group === "T2" && north && ((num >= 56 && num <= 73) || (num >= 81 && num <= 84)) ? ["R"]
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
    // templates that only apply to part of the terminal (by stand number)
    const standNum = parseInt(stand.ref, 10);
    if (list.some((t) => t.stands)) {
      const inRange = list.filter((t) => !t.stands || t.stands.some(([a, b]) => standNum >= a && standNum <= b));
      if (inRange.length) list = inRange;
    }
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
          let use: RouteResult | null = null;
          let missed: string[] = [];
          // an exit with a long runout keeps the aircraft on its own taxiway; the
          // connector to L11 for example is a shortcut, not the clearance
          const runs = EXIT_RUNOUT.has(exit.ref) ? exitRunouts(ap, exit) : [];
          for (const run of runs) {
            const end = run.nodes[run.nodes.length - 1];
            const r = route(ap, { start: end, goal: stand.entry, via: t.via, ownRunway: own, goalDir, avoidRefs: avoid });
            if (!r) continue;
            const combined: RouteResult = {
              nodes: [...run.nodes, ...r.nodes.slice(1)],
              refs: [...Array(run.nodes.length - 1).fill(exit.ref), ...r.refs],
              length: run.length + r.length,
              missed: r.missed,
            };
            if (!use || combined.length < use.length) use = combined;
          }
          if (use) {
            missed = use.missed;
          } else {
            const r = route(ap, { start: exit.node, firstHop: exit.next, goal: stand.entry, via: t.via, ownRunway: own, goalDir, avoidRefs: avoid });
            if (!r) continue;
            // Following the published taxiways must not mean driving round an apron
            // island: when the direct route is much shorter, take it and say which
            // published taxiways it left out.
            const d = directRoute(exit, avoid);
            const chosen: RouteResult = t.strict || !d || r.length <= d.length * 1.2 ? r : d;
            use = chosen;
            missed = chosen === d ? t.via.filter((v) => !chosen.refs.includes(v)) : r.missed;
          }
          if (!use) continue;
          // prefer a shallow turn-off around a typical landing roll over a long
          // roll-out or a sharp exit
          const score = use.length + Math.max(0, exit.s - LIKELY_EXIT_S) * 2 + exit.angle * 3 + missed.length * 4000;
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
  // nearest first, but a route that follows the published taxiways beats a shorter
  // one that skips them: that is the option the chips tag and the panel selects
  uniq.sort((a, b) => a.missed.length - b.missed.length || a.length - b.length);
  // a published route that comes out far longer than the nearest one is a detour,
  // not a variant: drop it instead of offering it
  const pool = uniq.some((o) => !o.missed.length) ? uniq.filter((o) => !o.missed.length) : uniq;
  const min = Math.min(...pool.map((o) => o.length));
  return uniq.filter((o) => o.length <= min * 1.35);
}

/** index of the recommended option: fewest skipped taxiways, then shortest */
export function bestIndex(opts: PlanOption[]): number {
  const key = (o: PlanOption) => o.missed.length * 1e6 + o.length;
  let bi = 0;
  opts.forEach((o, i) => {
    if (key(o) < key(opts[bi])) bi = i;
  });
  return bi;
}
