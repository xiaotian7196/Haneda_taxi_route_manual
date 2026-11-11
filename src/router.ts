// Template-constrained shortest path.
// State = (directed edge, k): k = how many taxiways of the template have been
// entered. Edges on the current/next template taxiway cost 1x; anything else is
// allowed but penalised, so the result follows the published flow whenever that
// is reasonable. The finished path is then checked for detours a taxi clearance
// would never contain (see findLoop / findHairpin).
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
  /** direction the aircraft is moving when it reaches `start` (departures) */
  startDir?: XY;
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

/** binary min-heap over parallel arrays: one search pushes tens of thousands of entries */
class Heap {
  private c: number[] = [];
  private s: number[] = [];
  cost = 0;
  state = 0;
  push(cost: number, state: number) {
    const c = this.c, s = this.s;
    let i = c.length;
    c.push(cost); s.push(state);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p]; s[i] = s[p];
      i = p;
    }
    c[i] = cost; s[i] = state;
  }
  /** pop the cheapest entry into `cost` / `state`; false when empty */
  pop(): boolean {
    const c = this.c, s = this.s;
    if (!c.length) return false;
    this.cost = c[0]; this.state = s[0];
    const lastC = c.pop()!, lastS = s.pop()!;
    if (c.length) {
      const n = c.length;
      let i = 0;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= n) break;
        if (m + 1 < n && c[m + 1] < c[m]) m++;
        if (c[m] >= lastC) break;
        c[i] = c[m]; s[i] = s[m];
        i = m;
      }
      c[i] = lastC; s[i] = lastS;
    }
    return true;
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
const MISS = 4000;

// A taxi clearance never leaves a junction and comes back to it. The graph,
// however, is full of fillets and roundabouts that make such a detour look
// short, so the search would happily turn a 180° there. Any returned path is
// checked for a closed excursion and, if one is found, its edges are banned and
// the search is repeated without them.
const LOOP_RADIUS = 30; // m: how close the path has to come back to itself
const LOOP_MIN_LEN = 70; // m: shortest path between the two visits worth calling a detour
const LOOP_HEADING = 110; // deg: the two visits must point in near-opposite directions

// A wide U-turn is the other way a route "cheats": it sweeps round a long fillet
// and comes back facing the other way, which no single node turn reveals.
const HAIRPIN_SPAN = 150; // m inspected either side of a node
const HAIRPIN_ANGLE = 135; // deg of net heading change

const LOOP_TRIES = 4; // rounds of banning one detour and searching again

function turnDeg(a: XY, b: XY, c: XY): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
  const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (l < 1e-9) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / l))) * 180) / Math.PI;
}

/** first closed excursion of the node list, as a half-open index range [i, j) */
function findLoop(ap: Airport, nodes: number[]): [number, number] | null {
  const p = nodes.map((n) => ap.xy[n]);
  const m = p.length;
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + dist(p[i - 1], p[i]);
  for (let j = 3; j < m; j++) {
    for (let i = 0; i < j - 1; i++) {
      if (cum[j] - cum[i] < LOOP_MIN_LEN) continue;
      if (dist(p[i], p[j]) > LOOP_RADIUS) continue;
      let d = Math.abs(((bearing(p[j - 1], p[j]) - bearing(p[i], p[i + 1])) * 180) / Math.PI) % 360;
      if (d > 180) d = 360 - d;
      if (d > LOOP_HEADING) return [i, j];
    }
  }
  return null;
}

/** first direction reversal of the node list, as a half-open edge range [i, j) */
function findHairpin(ap: Airport, nodes: number[]): [number, number] | null {
  for (let i = 2; i < nodes.length - 2; i++) {
    const hin = headingNear(ap, nodes, i, -1, HAIRPIN_SPAN);
    const hout = headingNear(ap, nodes, i, 1, HAIRPIN_SPAN);
    let d = Math.abs(((hout - hin) * 180) / Math.PI) % 360;
    if (d > 180) d = 360 - d;
    if (d <= HAIRPIN_ANGLE) continue;
    // ban the stretch the reversal is spent on, so the search has to approach otherwise
    let j = i, acc = 0;
    while (acc < HAIRPIN_SPAN && j + 1 < nodes.length) { acc += dist(ap.xy[nodes[j]], ap.xy[nodes[j + 1]]); j++; }
    return [i, j];
  }
  return null;
}

export function route(ap: Airport, req: RouteRequest): RouteResult | null {
  const n = req.via.length;
  const K = n + 1;
  const E = ap.edgeTo.length;
  const viaIdx = req.via.map((r) => ap.refs.indexOf(r));
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

  /** Dijkstra with `banned` directed edges removed; returns the best edge list and its template level */
  const search = (banned: Set<number>): { edges: number[]; k: number } | null => {
    const cost = new Float64Array(E * K).fill(Infinity);
    const prev = new Int32Array(E * K).fill(-1);
    const heap = new Heap();

    const seed = (e: number) => {
      const [k, mult, extra] = step(0, ap.edgeRef[e]);
      // leaving a stand: charge the turn out of the lead-in line as well, but only
      // once the first edge is long enough for its direction to mean anything
      const ang = req.startDir && ap.edgeLen[e] >= 20
        ? turnDeg([xy[req.start][0] - req.startDir[0], xy[req.start][1] - req.startDir[1]], xy[req.start], xy[ap.edgeTo[e]])
        : 0;
      const c = ap.edgeLen[e] * mult + extra + nodePenalty(ap.edgeTo[e], req.start) + Math.max(0, ang - 45) * TURN_COST;
      const s = e * K + k;
      if (c < cost[s]) { cost[s] = c; heap.push(c, s); }
    };
    if (req.firstHop !== undefined) {
      const e = ap.out[req.start].find((e) => ap.edgeTo[e] === req.firstHop);
      if (e === undefined) return null;
      seed(e);
    } else ap.out[req.start].forEach(seed); // pushback: either direction along the lead-in

    let best = -1, bestCost = Infinity;
    while (heap.pop()) {
      const c = heap.cost, s = heap.state;
      if (c > cost[s] || c >= bestCost) continue;
      const e = (s / K) | 0, k = s % K;
      const from = ap.edgeFrom[e], node = ap.edgeTo[e];
      if (node === req.goal && (req.goalFrom === undefined || from === req.goalFrom)) {
        const total = c + (n - k) * MISS + goalCost(e);
        if (total < bestCost) { bestCost = total; best = s; }
        continue;
      }
      for (const e2 of ap.out[node]) {
        if (banned.has(e2)) continue;
        const to = ap.edgeTo[e2];
        if (to === from) continue;
        const ang = turnDeg(xy[from], xy[node], xy[to]);
        // a metre-long stub says nothing about the real direction of a turn
        if (ang > MAX_TURN && ap.edgeLen[e] > 12 && ap.edgeLen[e2] > 12) continue;
        const [k2, mult, extra] = step(k, ap.edgeRef[e2]);
        const nc = c + ap.edgeLen[e2] * mult + extra + nodePenalty(to, node)
          + ang * TURN_ALL + Math.max(0, ang - 45) * TURN_COST + refChange(ap.edgeRef[e], ap.edgeRef[e2]);
        const s2 = e2 * K + k2;
        if (nc < cost[s2]) { cost[s2] = nc; prev[s2] = s; heap.push(nc, s2); }
      }
    }
    if (best < 0) return null;
    const edges: number[] = [];
    for (let s = best; s >= 0; s = prev[s]) edges.push((s / K) | 0);
    edges.reverse();
    return { edges, k: best % K };
  };

  const banned = new Set<number>();
  let found = search(banned);
  if (!found) return null;
  let result = finish(found);

  for (let tries = 0; tries < LOOP_TRIES; tries++) {
    const bad = findLoop(ap, result.nodes) ?? findHairpin(ap, result.nodes);
    if (!bad) break;
    for (let i = bad[0]; i < bad[1]; i++) banned.add(found.edges[i]);
    const next = search(banned);
    if (!next) break; // the detour was unavoidable; keep it rather than losing the route
    found = next;
    result = finish(found);
  }
  return result;

  function finish(f: { edges: number[]; k: number }): RouteResult {
    const nodes = [ap.edgeFrom[f.edges[0]], ...f.edges.map((e) => ap.edgeTo[e])];
    const refs = f.edges.map((e) => ap.refs[ap.edgeRef[e]]);
    const length = f.edges.reduce((a, e) => a + ap.edgeLen[e], 0);
    return { nodes, refs, length, missed: req.via.slice(f.k) };
  }
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
