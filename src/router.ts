// Template-constrained shortest path.
// State = (node, k): k = how many taxiways of the template have been entered.
// Edges on the current/next template taxiway cost 1x; anything else is allowed
// but penalised, so the result follows the published flow whenever possible.
import { Airport, dist, type XY } from "./airport.ts";

export interface RouteRequest {
  start: number;
  /** optional forced first hop (arrival exit direction) */
  firstHop?: number;
  goal: number;
  via: string[];
  /** runway the aircraft is leaving/joining: its nodes are only allowed at start/goal */
  ownRunway?: string;
  /** direction of the stand lead-in leaving the goal node (arrivals) */
  goalDir?: XY;
  /** the goal only counts when reached from this node (departures: along the chosen entry) */
  goalFrom?: number;
}
export interface RouteResult {
  nodes: number[];
  refs: string[]; // ref of edge i (nodes[i] -> nodes[i+1])
  length: number;
  missed: string[];
}

const UNNAMED = 1.35;
const OFF_TEMPLATE = 2.4;
const CROSSING = 350;
const OWN_RUNWAY = 1e6;
const MISS = 4000;

class Heap {
  private a: [number, number][] = [];
  get size() { return this.a.length; }
  push(v: [number, number]) {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop(): [number, number] {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

// Edge-based search: the state is the directed edge just travelled, so turn
// angles are known and reversals / cusps at junctions can be ruled out.
const MAX_TURN = 105; // deg; anything sharper is a U-turn an airliner cannot make
const TURN_COST = 2; // extra m per degree above 45 deg
const TURN_ALL = 0.8; // m per degree of any heading change: long curving detours are not free
const REF_CHANGE = 70; // m per change of taxiway name: stops weaving between parallels
const REF_CHANGE_APRON = 25; // named <-> unnamed apron line
const SKIP = 350; // m to drop one taxiway of the published list rather than loop to touch it
const BAD_STAND_ENTRY = 2500;

function turnDeg(a: XY, b: XY, c: XY): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
  const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (l < 1e-9) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / l))) * 180) / Math.PI;
}

export function route(ap: Airport, req: RouteRequest): RouteResult | null {
  const n = req.via.length;
  const K = n + 1;
  const E = ap.edgeTo.length;
  const cost = new Float64Array(E * K).fill(Infinity);
  const prev = new Int32Array(E * K).fill(-1);
  const viaIdx = req.via.map((r) => ap.refs.indexOf(r));
  const heap = new Heap();
  const xy = ap.xy;

  const nodePenalty = (node: number, from: number) => {
    if (node === req.start) return 0;
    if (node === req.goal && (req.goalFrom === undefined || from === req.goalFrom)) return 0;
    const rw = ap.runwayNode.get(node);
    if (!rw) return 0;
    return rw === req.ownRunway ? OWN_RUNWAY : CROSSING;
  };
  // -> [new progress, length multiplier, flat extra cost]
  const step = (k: number, ref: number): [number, number, number] => {
    if (k < n && ref === viaIdx[k]) return [k + 1, 1, 0];
    if (k > 0 && ref === viaIdx[k - 1]) return [k, 1, 0];
    if (k + 1 < n && ref === viaIdx[k + 1]) return [k + 2, 1, SKIP];
    if (ref === 0) return [k, UNNAMED, 0];
    return [k, OFF_TEMPLATE, 0];
  };
  const refChange = (a: number, b: number) => (a === b ? 0 : a === 0 || b === 0 ? REF_CHANGE_APRON : REF_CHANGE);
  const goalCost = (e: number) => {
    // arriving at the stand: the lead-in line must continue the direction of travel
    if (!req.goalDir) return 0;
    const a = xy[ap.edgeFrom[e]], b = xy[ap.edgeTo[e]];
    const c: XY = [b[0] + req.goalDir[0], b[1] + req.goalDir[1]];
    return turnDeg(a, b, c) > MAX_TURN ? BAD_STAND_ENTRY : 0;
  };

  const seed = (e: number) => {
    const [k, mult, extra] = step(0, ap.edgeRef[e]);
    const c = ap.edgeLen[e] * mult + extra + nodePenalty(ap.edgeTo[e], req.start);
    const s = e * K + k;
    if (c < cost[s]) { cost[s] = c; heap.push([c, s]); }
  };
  if (req.firstHop !== undefined) {
    const e = ap.out[req.start].find((e) => ap.edgeTo[e] === req.firstHop);
    if (e === undefined) return null;
    seed(e);
  } else ap.out[req.start].forEach(seed); // pushback: any direction

  let best = -1, bestCost = Infinity;
  while (heap.size) {
    const [c, s] = heap.pop();
    if (c > cost[s] || c >= bestCost) continue;
    const e = (s / K) | 0, k = s % K;
    const from = ap.edgeFrom[e], node = ap.edgeTo[e];
    if (node === req.goal && (req.goalFrom === undefined || from === req.goalFrom)) {
      const total = c + (n - k) * MISS + goalCost(e);
      if (total < bestCost) { bestCost = total; best = s; }
      continue;
    }
    for (const e2 of ap.out[node]) {
      const to = ap.edgeTo[e2];
      if (to === from) continue;
      const ang = turnDeg(xy[from], xy[node], xy[to]);
      if (ang > MAX_TURN) continue;
      const [k2, mult, extra] = step(k, ap.edgeRef[e2]);
      const nc = c + ap.edgeLen[e2] * mult + extra + nodePenalty(to, node)
        + ang * TURN_ALL + Math.max(0, ang - 45) * TURN_COST + refChange(ap.edgeRef[e], ap.edgeRef[e2]);
      const s2 = e2 * K + k2;
      if (nc < cost[s2]) { cost[s2] = nc; prev[s2] = s; heap.push([nc, s2]); }
    }
  }
  if (best < 0) return null;

  const edges: number[] = [];
  for (let s = best; s >= 0; s = prev[s]) edges.push((s / K) | 0);
  edges.reverse();
  const nodes = [ap.edgeFrom[edges[0]], ...edges.map((e) => ap.edgeTo[e])];
  const refs = edges.map((e) => ap.refs[ap.edgeRef[e]]);
  const length = edges.reduce((a, e) => a + ap.edgeLen[e], 0);
  return { nodes, refs, length, missed: req.via.slice(best % K) };
}

// ---------- turn-by-turn ----------
export interface Step {
  ref: string; // "" = apron / unnamed
  length: number;
  turn: "start" | "left" | "right" | "straight" | "sharp-left" | "sharp-right";
  at: XY;
  crossing?: string; // runway crossed at the end of this step
}

const bearing = (a: XY, b: XY) => Math.atan2(b[0] - a[0], b[1] - a[1]);
function headingNear(ap: Airport, nodes: number[], i: number, dir: 1 | -1, minLen = 35): number {
  const p = ap.xy[nodes[i]];
  let j = i, acc = 0;
  while (acc < minLen && j + dir >= 0 && j + dir < nodes.length) {
    acc += dist(ap.xy[nodes[j]], ap.xy[nodes[j + dir]]);
    j += dir;
  }
  return dir === 1 ? bearing(p, ap.xy[nodes[j]]) : bearing(ap.xy[nodes[j]], p);
}

export function steps(ap: Airport, r: RouteResult, ownRunway?: string): Step[] {
  // group edges by taxiway
  const raw: { ref: string; from: number; to: number; length: number }[] = [];
  r.refs.forEach((ref, i) => {
    const len = dist(ap.xy[r.nodes[i]], ap.xy[r.nodes[i + 1]]);
    const last = raw[raw.length - 1];
    if (last && last.ref === ref) { last.to = i + 1; last.length += len; }
    else raw.push({ ref, from: i, to: i + 1, length: len });
  });
  // absorb short unnamed pieces into the neighbouring named taxiway
  const merged: typeof raw = [];
  for (let i = 0; i < raw.length; i++) {
    const g = raw[i];
    const prevG = merged[merged.length - 1];
    const nextG = raw[i + 1];
    const bridges = !g.ref && prevG && nextG && nextG.ref === prevG.ref; // X → apron → X
    // a few metres clipped across another taxiway at a junction is not a step of its own
    const sliver = g.ref && g.length < 25 && prevG && nextG;
    if (bridges || sliver || (!g.ref && g.length < 90 && prevG && (i < raw.length - 1 || prevG.ref))) {
      prevG.to = g.to; prevG.length += g.length; continue;
    }
    if (prevG && prevG.ref === g.ref) { prevG.to = g.to; prevG.length += g.length; continue; }
    merged.push({ ...g });
  }
  return merged.map((g, i) => {
    let turn: Step["turn"] = "start";
    if (i > 0) {
      const hin = headingNear(ap, r.nodes, g.from, -1);
      const hout = headingNear(ap, r.nodes, g.from, 1);
      let d = ((hout - hin) * 180) / Math.PI;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      turn = Math.abs(d) < 30 ? "straight" : d > 0
        ? (d > 120 ? "sharp-right" : "right")
        : (d < -120 ? "sharp-left" : "left");
    }
    let crossing: string | undefined;
    for (let j = g.from + 1; j <= g.to && j < r.nodes.length - 1; j++) {
      const rw = ap.runwayNode.get(r.nodes[j]);
      if (rw && rw !== ownRunway) { crossing = rw; break; }
    }
    return { ref: g.ref, length: g.length, turn, at: ap.xy[r.nodes[g.from]], crossing };
  });
}
