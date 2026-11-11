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
  ref: string;
  node: number;
  /** along-track distance from the threshold */
  s: number;
}
export interface Exit extends Junction {
  /** first node off the runway on this exit */
  next: number;
  side: "L" | "R";
  /** angle between runway heading and exit, degrees */
  angle: number;
}

const CL_TOL = 14; // m from centerline to count as "on the runway"

export class Airport {
  readonly data: RawData;
  readonly xy: XY[];
  readonly adj: Adj[][];
  readonly refs: string[];
  /** node index -> runway id, for nodes lying on a runway centerline */
  readonly runwayNode = new Map<number, string>();

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

  /** named taxiway junctions on a runway centerline, sorted from the threshold */
  junctions(ident: string): Junction[] {
    const e = this.end(ident);
    const out: Junction[] = [];
    for (const [node, id] of this.runwayNode) {
      if (id !== e.runway.id) continue;
      const s = alongCross(e, this.xy[node]).s;
      for (const a of this.adj[node]) {
        const ref = this.refs[a.ref];
        if (!ref || this.runwayNode.get(a.to) === id) continue;
        if (!out.some((j) => j.ref === ref && Math.abs(j.s - s) < 60)) out.push({ ref, node, s });
      }
    }
    return out.sort((a, b) => a.s - b.s);
  }

  /** runway exits usable after landing on `ident` */
  exits(ident: string): Exit[] {
    const e = this.end(ident);
    const out: Exit[] = [];
    for (const [node, id] of this.runwayNode) {
      if (id !== e.runway.id) continue;
      const s = alongCross(e, this.xy[node]).s;
      if (s < 900) continue; // nobody vacates in the first 900 m
      for (const a of this.adj[node]) {
        const ref = this.refs[a.ref];
        if (!ref || this.runwayNode.get(a.to) === id) continue;
        // look ~60 m down the exit to get its real direction
        const far = this.walk(node, a.to, a.ref, 60);
        const v: XY = [this.xy[far][0] - this.xy[node][0], this.xy[far][1] - this.xy[node][1]];
        const vl = Math.hypot(v[0], v[1]) || 1;
        const cos = (v[0] * e.u[0] + v[1] * e.u[1]) / vl;
        const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        if (angle > 100) continue; // would need a back-turn
        const cross = e.u[0] * v[1] - e.u[1] * v[0];
        const side = cross > 0 ? "L" : "R";
        if (out.some((x) => x.ref === ref && x.side === side)) continue;
        out.push({ ref, node, s, next: a.to, side, angle: Math.round(angle) });
      }
    }
    return out.sort((a, b) => a.s - b.s);
  }

  private walk(from: number, to: number, ref: number, minLen: number): number {
    let prev = from, cur = to, acc = dist(this.xy[from], this.xy[to]);
    while (acc < minLen) {
      const nx = this.adj[cur].find((a) => a.to !== prev && a.ref === ref);
      if (!nx) break;
      acc += nx.len;
      prev = cur;
      cur = nx.to;
    }
    return cur;
  }

  stand(ref: string): Stand | undefined {
    return this.data.stands.find((s) => s.ref === ref);
  }
}

export const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function alongCross(e: RunwayEnd, p: XY) {
  const dx = p[0] - e.thr[0], dy = p[1] - e.thr[1];
  return { s: dx * e.u[0] + dy * e.u[1], d: e.u[0] * dy - e.u[1] * dx };
}
