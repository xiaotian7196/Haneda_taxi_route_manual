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

export function route(ap: Airport, req: RouteRequest): RouteResult | null {
  const n = req.via.length;
  const K = n + 1;
  const N = ap.xy.length;
  const cost = new Float64Array(N * K).fill(Infinity);
  const prev = new Int32Array(N * K).fill(-1);
  const viaIdx = req.via.map((r) => ap.refs.indexOf(r));
  const heap = new Heap();

  const nodePenalty = (node: number) => {
    if (node === req.goal || node === req.start) return 0;
    const rw = ap.runwayNode.get(node);
    if (!rw) return 0;
    return rw === req.ownRunway ? OWN_RUNWAY : CROSSING;
  };
  const step = (node: number, k: number, ref: number): [number, number] => {
    if (k < n && ref === viaIdx[k]) return [k + 1, 1];
    if (k > 0 && ref === viaIdx[k - 1]) return [k, 1];
    if (ref === 0) return [k, UNNAMED];
    void node;
    return [k, OFF_TEMPLATE];
  };

  const startState = req.start * K;
  cost[startState] = 0;
  if (req.firstHop !== undefined) {
    const e = ap.adj[req.start].find((a) => a.to === req.firstHop)!;
    const [k] = step(req.start, 0, e.ref);
    const s = req.firstHop * K + k;
    cost[s] = e.len;
    prev[s] = startState;
    heap.push([e.len, s]);
  } else heap.push([0, startState]);

  const goalXY = ap.xy[req.goal];
  let best = -1, bestCost = Infinity;
  while (heap.size) {
    const [c, s] = heap.pop();
    if (c > cost[s] || c >= bestCost) continue;
    const node = (s / K) | 0, k = s % K;
    if (node === req.goal) {
      const total = c + (n - k) * MISS;
      if (total < bestCost) { bestCost = total; best = s; }
      continue;
    }
    if (req.firstHop !== undefined && s === startState) continue;
    for (const a of ap.adj[node]) {
      const [k2, mult] = step(node, k, a.ref);
      const nc = c + a.len * mult + nodePenalty(a.to);
      const s2 = a.to * K + k2;
      if (nc < cost[s2]) {
        cost[s2] = nc; prev[s2] = s;
        // A* would need an admissible bound; plain Dijkstra is fast enough here.
        heap.push([nc, s2]);
      }
    }
  }
  void goalXY;
  if (best < 0) return null;

  const states: number[] = [];
  for (let s = best; s >= 0; s = prev[s]) states.push(s);
  states.reverse();
  const nodes = states.map((s) => (s / K) | 0);
  const refs: string[] = [];
  let length = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const e = ap.adj[nodes[i]].find((a) => a.to === nodes[i + 1])!;
    refs.push(ap.refs[e.ref]);
    length += e.len;
  }
  const kEnd = best % K;
  return { nodes, refs, length, missed: req.via.slice(kEnd) };
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
    if (bridges || (!g.ref && g.length < 90 && prevG && (i < raw.length - 1 || prevG.ref))) {
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
