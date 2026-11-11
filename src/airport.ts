// Airport data model: graph, runways, runway exits / entries.
export type XY = [number, number];
export type Group = "T1" | "T2" | "T3";

export interface RawData {
  origin: { lat: number; lon: number };
  refs: string[];
  nodes: number[];
  edges: number[];
  ways: { r: string; k: string; w: number; p: number[] }[];
  runways: RawRunway[];
  aprons: number[][];
  terminals: { n: string; p: number[] }[];
  holds: { r: string; p: XY }[];
  stands: Stand[];
}
export interface RawRunway {
  id: string;
  width: number;
  p0: XY;
  p1: XY;
  thr: Record<string, XY>;
  disp: Record<string, number>;
}
export interface Stand {
  ref: string;
  x: number;
  y: number;
  entry: number;
  path: number[];
  group: Group;
}
export interface Adj {
  to: number;
  ref: number;
  len: number;
}
/** A runway end as seen from an aircraft using it (landing or taking off). */
export interface RunwayEnd {
  ident: string;
  runway: RawRunway;
  thr: XY;
  /** unit vector in the direction of travel */
  u: XY;
  /** physical runway extent along u, measured from the threshold */
  sMin: number;
  sMax: number;
}
export interface Junction {
  pin?: XY;
  ref: string;
  node: number;
  /** along-track distance from the threshold */
  s: number;
}
export interface Leg extends Junction {
  /** next node from the turn-off point along this taxiway */
  next: number;
  side: "L" | "R";
  /** angle between the runway direction of travel and the taxiway leaving it, degrees */
  angle: number;
  /** a point on this taxiway just beyond the runway edge (map pin) */
  pin: XY;
}
export type Exit = Leg;

const CL_TOL = 14; // m from centerline to count as "on the runway"

export class Airport {
  readonly data: RawData;
  readonly xy: XY[];
  readonly adj: Adj[][];
  readonly refs: string[];
  /** node index -> runway id, for nodes lying on a runway centerline */
  readonly runwayNode = new Map<number, string>();
  /** directed edges (both directions of every segment) */
  readonly edgeFrom: number[] = [];
  readonly edgeTo: number[] = [];
  readonly edgeRef: number[] = [];
  readonly edgeLen: number[] = [];
  /** node -> outgoing directed edge ids */
  readonly out: number[][];

  constructor(data: RawData) {
    this.data = data;
    this.refs = data.refs;
    this.xy = [];
    for (let i = 0; i < data.nodes.length; i += 2) this.xy.push([data.nodes[i], data.nodes[i + 1]]);
    this.adj = this.xy.map(() => []);
    for (let i = 0; i < data.edges.length; i += 3) {
      const a = data.edges[i], b = data.edges[i + 1], r = data.edges[i + 2];
      const len = dist(this.xy[a], this.xy[b]);
      this.adj[a].push({ to: b, ref: r, len });
      this.adj[b].push({ to: a, ref: r, len });
    }
    this.out = this.xy.map(() => []);
    this.adj.forEach((list, a) => {
      for (const e of list) {
        const id = this.edgeTo.push(e.to) - 1;
        this.edgeFrom.push(a);
        this.edgeRef.push(e.ref);
        this.edgeLen.push(e.len);
        this.out[a].push(id);
      }
    });
    for (const rw of data.runways) {
      const ends = rw.id.split("/");
      const e = this.end(ends[0]);
      this.xy.forEach((p, i) => {
        if (!this.adj[i].length) return;
        const { s, d } = alongCross(e, p);
        if (Math.abs(d) < CL_TOL && s >= e.sMin - 5 && s <= e.sMax + 5) this.runwayNode.set(i, rw.id);
      });
    }
  }

  runway(ident: string): RawRunway {
    const rw = this.data.runways.find((r) => r.id.split("/").includes(ident));
    if (!rw) throw new Error(`runway ${ident}`);
    return rw;
  }

  end(ident: string): RunwayEnd {
    const runway = this.runway(ident);
    const [a, b] = runway.id.split("/");
    const other = ident === a ? b : a;
    const thr = runway.thr[ident];
    const to = runway.thr[other];
    const L = dist(thr, to);
    const u: XY = [(to[0] - thr[0]) / L, (to[1] - thr[1]) / L];
    const e: RunwayEnd = { ident, runway, thr, u, sMin: 0, sMax: L };
    const s0 = alongCross(e, runway.p0).s, s1 = alongCross(e, runway.p1).s;
    e.sMin = Math.min(s0, s1);
    e.sMax = Math.max(s0, s1);
    return e;
  }

  /**
   * Every named taxiway leaving the runway centerline, one per (taxiway, side).
   * High-speed exits run within a few metres of the centerline for a while, so
   * the chain is traced back to its true turn-off point (closest to the centerline).
   */
  private legs(ident: string): Leg[] {
    const e = this.end(ident);
    const id = e.runway.id;
    const pin = e.runway.width / 2 + 35;
    const out: Leg[] = [];
    for (const [node, rw] of this.runwayNode) {
      if (rw !== id) continue;
      for (const a of this.adj[node]) {
        const ref = this.refs[a.ref];
        if (!ref || this.runwayNode.get(a.to) === id) continue;
        // trace back along the same taxiway through runway nodes
        const chain = [a.to, node];
        for (let prev = a.to, cur = node; ;) {
          const nx = this.adj[cur].find((x) => x.to !== prev && x.ref === a.ref && this.runwayNode.get(x.to) === id);
          if (!nx || chain.includes(nx.to)) break;
          chain.push(nx.to);
          prev = cur;
          cur = nx.to;
        }
        chain.reverse(); // runway-most ... node, a.to
        let ri = 0;
        chain.forEach((n, i) => {
          if (i < chain.length - 1 && Math.abs(alongCross(e, this.xy[n]).d) < Math.abs(alongCross(e, this.xy[chain[ri]]).d)) ri = i;
        });
        const root = chain[ri];
        // continue outward to just beyond the runway edge for the map pin / direction
        const path = this.follow(chain[chain.length - 2], a.to, a.ref, (n) => Math.abs(alongCross(e, this.xy[n]).d) >= pin, 450);
        const off = path[path.length - 1];
        const v: XY = [this.xy[off][0] - this.xy[root][0], this.xy[off][1] - this.xy[root][1]];
        const vl = Math.hypot(v[0], v[1]) || 1;
        const angle = (Math.acos(Math.max(-1, Math.min(1, (v[0] * e.u[0] + v[1] * e.u[1]) / vl))) * 180) / Math.PI;
        const side = e.u[0] * v[1] - e.u[1] * v[0] > 0 ? "L" : "R";
        if (out.some((x) => x.ref === ref && x.side === side && Math.abs(x.s - alongCross(e, this.xy[root]).s) < 150)) continue;
        out.push({
          ref, side, node: root, next: chain[ri + 1], s: alongCross(e, this.xy[root]).s,
          angle: Math.round(angle), pin: this.xy[off],
        });
      }
    }
    return out.sort((x, y) => x.s - y.s);
  }

  /** runway entries for a departure on `ident`: no back-turn onto the runway */
  junctions(ident: string): Leg[] {
    // entering means travelling the leg inwards; the turn onto the runway is 180 - angle
    // (wider turns are fine at the runway end, where full-length line-ups happen)
    return this.legs(ident).filter((l) => 180 - l.angle <= (l.s < 300 ? 140 : 105));
  }

  /** runway exits usable after landing on `ident` */
  exits(ident: string): Exit[] {
    return this.legs(ident).filter((l) => l.s >= 900 && l.angle <= 100);
  }

  /** walk along `ref` from (from -> to) until `stop(node)` or `maxLen`; returns the visited nodes */
  private follow(from: number, to: number, ref: number, stop: (n: number) => boolean, maxLen: number): number[] {
    const path = [to];
    let prev = from, cur = to, acc = dist(this.xy[from], this.xy[to]);
    while (!stop(cur) && acc < maxLen) {
      const nx = this.adj[cur].find((a) => a.to !== prev && a.ref === ref);
      if (!nx) break;
      acc += nx.len;
      prev = cur;
      cur = nx.to;
      path.push(cur);
    }
    return path;
  }

  stand(ref: string): Stand | undefined {
    return this.data.stands.find((s) => s.ref === ref);
  }
}

// Local metric frame used by scripts/build-data.ts (equirectangular around the ARP)
const M_PER_DEG_LAT = 111_132;
const mPerDegLon = (lat0: number) => 111_320 * Math.cos((lat0 * Math.PI) / 180);
export function toLatLon(o: { lat: number; lon: number }, p: XY): [number, number] {
  return [o.lat + p[1] / M_PER_DEG_LAT, o.lon + p[0] / mPerDegLon(o.lat)];
}
export function toLocal(o: { lat: number; lon: number }, lat: number, lon: number): XY {
  return [(lon - o.lon) * mPerDegLon(o.lat), (lat - o.lat) * M_PER_DEG_LAT];
}

export const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function alongCross(e: RunwayEnd, p: XY) {
  const dx = p[0] - e.thr[0], dy = p[1] - e.thr[1];
  return { s: dx * e.u[0] + dy * e.u[1], d: e.u[0] * dy - e.u[1] * dx };
}
