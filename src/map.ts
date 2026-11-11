// Full-screen SVG airport map: pan / zoom, chart grid, taxiway signs, stands, route.
import { Airport, dist, toLatLon, toLocal, type RunwayEnd, type XY } from "./airport.ts";
import type { PlanOption } from "./plan.ts";
import { t } from "./i18n.ts";

const NS = "http://www.w3.org/2000/svg";
const CELL = 500; // grid cell, metres
const COLS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // chart style: no I / O

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}
const pt = (p: XY) => `${p[0].toFixed(1)},${(-p[1]).toFixed(1)}`;
const poly = (pts: XY[]) => "M" + pts.map(pt).join("L");
const pairs = (flat: number[]): XY[] => {
  const out: XY[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};

// GSI (Geospatial Information Authority of Japan) tiles — attribution required
export type Basemap = "pale" | "photo" | "none";
const TILE_URL: Record<Exclude<Basemap, "none">, string> = {
  pale: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
  photo: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
};
const BASE_Z = 14; // always-loaded cover for the whole airport
const WIDE_Z = 12; // coarse surround so zoomed-out views have no empty edges
const MAX_Z = 18;
const lon2tile = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const lat2tile = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const tile2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tile2lat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

export interface Bounds { x0: number; y0: number; x1: number; y1: number }
export interface MapPoint { key: string; label: string; at: XY; anchor: XY }

export class MapView {
  private svg: SVGSVGElement;
  private world: SVGGElement;
  private tilesG: SVGGElement;
  private baseTiles: SVGGElement;
  private detailTiles: SVGGElement;
  private basemap: Basemap = "none";
  private tileTimer = 0;
  private gridG: SVGGElement;
  private overlay: SVGGElement;
  private pointsG: SVGGElement;
  private standsG: SVGGElement;
  private rulers: HTMLElement;
  private tooltip: HTMLElement;
  private ap: Airport;
  private k = 0.2;
  private tx = 0;
  private ty = 0;
  private anim = 0;
  readonly bounds: Bounds;
  private grid: Bounds;
  pad = { left: 0, bottom: 0, right: 76, top: 0 };
  onStand: (ref: string) => void = () => {};
  onPoint: (key: string) => void = () => {};
  onAlt: (i: number) => void = () => {};

  constructor(svg: SVGSVGElement, rulers: HTMLElement, tooltip: HTMLElement, ap: Airport) {
    this.svg = svg;
    this.rulers = rulers;
    this.tooltip = tooltip;
    this.ap = ap;
    this.bounds = this.computeBounds();
    const b = this.bounds;
    this.grid = {
      x0: Math.floor(b.x0 / CELL) * CELL, x1: Math.ceil(b.x1 / CELL) * CELL,
      y0: Math.floor(b.y0 / CELL) * CELL, y1: Math.ceil(b.y1 / CELL) * CELL,
    };
    this.world = el("g", {}, svg);
    this.tilesG = el("g", { class: "tiles" }, this.world);
    this.baseTiles = el("g", {}, this.tilesG);
    this.detailTiles = el("g", {}, this.tilesG);
    this.gridG = el("g", { class: "grid" }, this.world);
    const base = el("g", {}, this.world);
    const signs = el("g", { class: "lbl-wrap" }, this.world);
    this.overlay = el("g", {}, this.world);
    this.standsG = el("g", {}, this.world);
    this.pointsG = el("g", {}, this.world);
    this.drawGrid();
    this.drawBase(base);
    this.drawSigns(signs);
    this.drawStands();
    this.bindInput();
    new ResizeObserver(() => this.apply()).observe(svg);
  }

  // ---------- data extents ----------
  private computeBounds(): Bounds {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x: number, y: number) => {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    };
    for (const w of this.ap.data.ways) for (let i = 0; i < w.p.length; i += 2) add(w.p[i], w.p[i + 1]);
    for (const r of this.ap.data.runways) { add(...r.p0); add(...r.p1); }
    return { x0, y0, x1, y1 };
  }

  gridRef(p: XY): string {
    const c = Math.floor((p[0] - this.grid.x0) / CELL);
    const r = Math.floor((this.grid.y1 - p[1]) / CELL) + 1;
    return `${COLS[c] ?? "?"}${r}`;
  }

  // ---------- static layers ----------
  private drawGrid() {
    const g = this.grid;
    for (let x = g.x0; x <= g.x1; x += CELL) el("line", { x1: x, x2: x, y1: -g.y1, y2: -g.y0 }, this.gridG);
    for (let y = g.y0; y <= g.y1; y += CELL) el("line", { x1: g.x0, x2: g.x1, y1: -y, y2: -y }, this.gridG);
  }

  private drawBase(g: SVGGElement) {
    const d = this.ap.data;
    for (const a of d.aprons) el("path", { d: poly(pairs(a)) + "Z", class: "apron" }, g);
    // taxiways, widest first
    const tw = el("g", {}, g);
    const cl = el("g", {}, g);
    for (const w of [...d.ways].sort((a, b) => b.w - a.w)) {
      const path = poly(pairs(w.p));
      const p = el("path", { d: path, class: "tw", "stroke-width": Math.max(w.w, 15) }, tw);
      if (w.r) {
        p.addEventListener("pointerenter", (e) => this.hoverTw(w.r, e as PointerEvent, true));
        p.addEventListener("pointermove", (e) => this.hoverTw(w.r, e as PointerEvent, true));
        p.addEventListener("pointerleave", (e) => this.hoverTw(w.r, e as PointerEvent, false));
        p.dataset.ref = w.r;
      }
      el("path", { d: path, class: "cl" }, cl);
    }
    for (const t of d.terminals) el("path", { d: poly(pairs(t.p)) + "Z", class: "terminal" }, g);

    for (const r of d.runways) {
      const rg = el("g", {}, g);
      el("line", { x1: r.p0[0], y1: -r.p0[1], x2: r.p1[0], y2: -r.p1[1], class: "rwy", "stroke-width": r.width, "data-rwy": r.id }, rg);
      el("line", { x1: r.p0[0], y1: -r.p0[1], x2: r.p1[0], y2: -r.p1[1], class: "rwy-cl" }, rg);
      for (const id of r.id.split("/")) {
        const e = this.ap.end(id);
        const t = e.thr;
        const n: XY = [-e.u[1], e.u[0]];
        const h = r.width / 2;
        el("line", {
          x1: t[0] + n[0] * h, y1: -(t[1] + n[1] * h), x2: t[0] - n[0] * h, y2: -(t[1] - n[1] * h),
          stroke: "var(--runway-mark)", "stroke-width": 6,
        }, rg);
        // ident just outside the physical end, upright
        const off = -e.sMin + 140;
        const at: XY = [t[0] - e.u[0] * off, t[1] - e.u[1] * off];
        const lg = el("g", { transform: `translate(${pt(at)})` }, rg);
        const inner = el("g", { class: "scaled" }, lg);
        el("rect", { x: -17, y: -10, width: 34, height: 20, rx: 6, class: "rwy-id-bg" }, inner);
        el("text", { class: "rwy-id", "text-anchor": "middle", "dominant-baseline": "central" }, inner).textContent = id;
      }
    }
  }

  private drawSigns(g: SVGGElement) {
    type Cand = { r: string; at: XY; len: number };
    const cands: Cand[] = [];
    for (const w of this.ap.data.ways) {
      if (!w.r) continue;
      const p = pairs(w.p);
      let len = 0;
      for (let i = 1; i < p.length; i++) len += dist(p[i - 1], p[i]);
      if (len < 70) continue;
      let acc = 0, at = p[0];
      for (let i = 1; i < p.length; i++) {
        const s = dist(p[i - 1], p[i]);
        if (acc + s >= len / 2) {
          const t = (len / 2 - acc) / s;
          at = [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
          break;
        }
        acc += s;
      }
      cands.push({ r: w.r, at, len });
    }
    cands.sort((a, b) => b.len - a.len);
    const placed: Cand[] = [];
    for (const c of cands) {
      const minor = /\d/.test(c.r);
      const spacing = minor ? 400 : 650;
      if (placed.some((p) => p.r === c.r && dist(p.at, c.at) < spacing)) continue;
      if (placed.some((p) => dist(p.at, c.at) < 45)) continue;
      placed.push(c);
      const lg = el("g", { transform: `translate(${pt(c.at)})` }, g);
      const inner = el("g", { class: `scaled tw-sign${minor ? " minor" : ""}` }, lg);
      const w = 9 + c.r.length * 7;
      el("rect", { x: -w / 2, y: -8, width: w, height: 16, rx: 4 }, inner);
      el("text", {}, inner).textContent = c.r;
    }
  }

  private drawStands() {
    for (const s of this.ap.data.stands) {
      const g = el("g", { transform: `translate(${pt([s.x, s.y])})`, class: "stand-g", "data-ref": s.ref }, this.standsG);
      const inner = el("g", { class: "scaled" }, g);
      el("circle", { r: 9, class: "stand-hit" }, inner);
      el("circle", { r: 3.6, class: "stand-dot" }, inner);
      el("text", { y: 13, class: "stand-lbl" }, inner).textContent = s.ref;
      el("title", {}, g).textContent = `Spot ${s.ref} · ${s.group}`;
      g.addEventListener("click", (e) => { e.stopPropagation(); this.onStand(s.ref); });
    }
  }

  private hoverTw(ref: string, e: PointerEvent, on: boolean) {
    if (this.dragging) return;
    this.svg.querySelectorAll<SVGPathElement>(`.tw[data-ref="${CSS.escape(ref)}"]`).forEach((p) => p.classList.toggle("hover", on));
    this.tooltip.classList.toggle("show", on);
    if (on) {
      this.tooltip.textContent = ref;
      const r = this.svg.getBoundingClientRect();
      this.tooltip.style.left = `${e.clientX - r.left}px`;
      this.tooltip.style.top = `${e.clientY - r.top}px`;
    }
  }

  // ---------- dynamic layers ----------
  selectStand(ref: string | null) {
    this.standsG.querySelectorAll(".stand-g").forEach((g) => g.classList.toggle("selected", g.getAttribute("data-ref") === ref));
    const sel = ref && this.standsG.querySelector(`[data-ref="${CSS.escape(ref)}"]`);
    if (sel) this.standsG.appendChild(sel);
  }

  setActiveRunway(end: RunwayEnd | null, mode: "arr" | "dep") {
    this.overlay.querySelectorAll(".rwy-active, .rwy-arrow").forEach((e) => e.remove());
    if (!end) return;
    const r = end.runway;
    el("line", {
      x1: r.p0[0], y1: -r.p0[1], x2: r.p1[0], y2: -r.p1[1], class: "rwy-active", "stroke-width": r.width + 50,
    }, this.overlay).classList.add("rwy-active");
    // direction arrow before the threshold
    const back = mode === "arr" ? 900 : -60;
    const at: XY = [end.thr[0] - end.u[0] * back, end.thr[1] - end.u[1] * back];
    const ang = (Math.atan2(-end.u[1], end.u[0]) * 180) / Math.PI;
    const g = el("g", { transform: `translate(${pt(at)}) rotate(${ang})`, class: "rwy-arrow" }, this.overlay);
    const inner = el("g", { class: "scaled" }, g);
    el("path", { d: "M-14,-9 L6,0 L-14,9 L-9,0 Z", fill: "var(--blue)", stroke: "#fff", "stroke-width": 1.5 }, inner);
  }

  setPoints(points: MapPoint[], selected: string | null) {
    this.pointsG.replaceChildren();
    for (const p of points) {
      const g = el("g", { transform: `translate(${pt(p.at)})`, class: `exit-pin${p.key === selected ? " selected" : ""}` }, this.pointsG);
      const inner = el("g", { class: "scaled" }, g);
      const w = 12 + p.label.length * 7;
      el("rect", { x: -w / 2, y: -9, width: w, height: 18, rx: 9 }, inner);
      el("text", {}, inner).textContent = p.label;
      g.addEventListener("click", (e) => { e.stopPropagation(); this.onPoint(p.key); });
    }
  }

  setRoute(opts: PlanOption[], sel: number) {
    this.overlay.querySelectorAll(".route").forEach((e) => e.remove());
    if (!opts.length) return;
    const root = el("g", { class: "route" }, this.overlay);
    opts.forEach((o, i) => {
      if (i === sel) return;
      const p = el("path", { d: poly(o.line), class: "route-alt" }, root);
      el("title", {}, p).textContent = t("alt", { s: o.summary });
      p.addEventListener("click", (e) => { e.stopPropagation(); this.onAlt(i); });
    });
    const o = opts[sel];
    const d = poly(o.line);
    el("path", { d, class: "route-casing" }, root);
    const line = el("path", { d, class: "route-line" }, root) as SVGPathElement;
    // non-scaling strokes dash in screen pixels, so size the draw-in animation in px
    const px = line.getTotalLength() * this.k + 20;
    line.setAttribute("stroke-dasharray", `${px} ${px}`);
    line.setAttribute("stroke-dashoffset", String(px));
    line.classList.add("route-draw");
    line.addEventListener("animationend", () => {
      line.removeAttribute("stroke-dasharray");
      line.removeAttribute("stroke-dashoffset");
      line.classList.remove("route-draw");
    }, { once: true });

    // direction chevrons every ~260 m
    let acc = 130;
    for (let i = 1; i < o.line.length; i++) {
      const a = o.line[i - 1], b = o.line[i];
      const s = dist(a, b);
      while (acc < s) {
        const t = acc / s;
        const at: XY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const ang = (Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI;
        const g = el("g", { transform: `translate(${pt(at)}) rotate(${ang})`, class: "chev" }, root);
        el("path", { d: "M-2,-3.2 L1.4,0 L-2,3.2", class: "scaled" }, g);
        acc += 260;
      }
      acc -= s;
    }
    for (const c of o.crossAt) {
      const g = el("g", { transform: `translate(${pt(c.at)})`, class: "cross-mark" }, root);
      const inner = el("g", { class: "scaled" }, g);
      el("rect", { x: -9, y: -9, width: 18, height: 18, rx: 4, transform: "rotate(45)" }, inner);
      el("text", {}, inner).textContent = "!";
      el("title", {}, g).textContent = t("crossTitle", { r: c.rw });
    }
    const s = el("g", { transform: `translate(${pt(o.line[0])})`, class: "pin-start" }, root);
    el("circle", { r: 6, class: "scaled" }, s);
    const e = el("g", { transform: `translate(${pt(o.line[o.line.length - 1])})`, class: "pin-end" }, root);
    const ei = el("g", { class: "scaled" }, e);
    el("path", { d: "M0,0 C-3,-6 -9,-10 -9,-17 A9,9 0 1 1 9,-17 C9,-10 3,-6 0,0 Z", class: "pin-body" }, ei);
    el("circle", { cy: -17, r: 3.5, class: "pin-dot" }, ei);
  }

  // ---------- view ----------
  private minK() {
    const r = this.svg.getBoundingClientRect();
    return Math.min(r.width / (this.bounds.x1 - this.bounds.x0), r.height / (this.bounds.y1 - this.bounds.y0)) * 0.35;
  }

  private apply() {
    const k = this.k;
    this.world.setAttribute("transform", `translate(${this.tx.toFixed(2)},${this.ty.toFixed(2)}) scale(${k})`);
    this.svg.style.setProperty("--inv", String(1 / k));
    this.svg.dataset.zoom = k < 0.32 ? "far" : k < 0.9 ? "mid" : "near";
    this.updateRulers();
    this.updateScale();
    clearTimeout(this.tileTimer);
    this.tileTimer = window.setTimeout(() => this.updateTiles(), 90);
  }

  // ---------- GSI basemap ----------
  setBasemap(b: Basemap) {
    if (b === this.basemap) return;
    this.basemap = b;
    this.svg.dataset.base = b;
    this.baseTiles.replaceChildren();
    this.detailTiles.replaceChildren();
    if (b !== "none") {
      const o = this.ap.data.origin, g = this.grid;
      // wide low-res surround first, then the airport at BASE_Z on top
      const M = 9000;
      const [wN, wW] = toLatLon(o, [g.x0 - M, g.y1 + M]);
      const [wS, wE] = toLatLon(o, [g.x1 + M, g.y0 - M]);
      this.addTiles(this.baseTiles, WIDE_Z, wW, wN, wE, wS);
      const [latN, lonW] = toLatLon(o, [g.x0, g.y1]);
      const [latS, lonE] = toLatLon(o, [g.x1, g.y0]);
      this.addTiles(this.baseTiles, BASE_Z, lonW, latN, lonE, latS);
    }
    this.updateTiles();
  }

  private tile(z: number, x: number, y: number): SVGImageElement {
    const o = this.ap.data.origin;
    const [x0, yN] = toLocal(o, tile2lat(y, z), tile2lon(x, z));
    const [x1, yS] = toLocal(o, tile2lat(y + 1, z), tile2lon(x + 1, z));
    const pad = 0.6 * (156543 / 2 ** z) * 0.82; // ~0.6 tile px of overlap hides seams
    const url = TILE_URL[this.basemap as Exclude<Basemap, "none">].replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    const img = el("image", {
      href: url, x: x0 - pad, y: -yN - pad, width: x1 - x0 + 2 * pad, height: yN - yS + 2 * pad,
      preserveAspectRatio: "none", "data-k": `${z}/${x}/${y}`,
    });
    img.addEventListener("error", () => img.remove()); // ocean tiles may not exist
    return img;
  }

  private addTiles(g: SVGGElement, z: number, lonW: number, latN: number, lonE: number, latS: number, keep?: Set<string>) {
    const xa = Math.floor(lon2tile(lonW, z)), xb = Math.floor(lon2tile(lonE, z));
    const ya = Math.floor(lat2tile(latN, z)), yb = Math.floor(lat2tile(latS, z));
    if ((xb - xa + 1) * (yb - ya + 1) > 160) return;
    const have = new Map([...g.children].map((c) => [c.getAttribute("data-k")!, c]));
    for (let x = xa; x <= xb; x++)
      for (let y = ya; y <= yb; y++) {
        const k = `${z}/${x}/${y}`;
        keep?.add(k);
        if (!have.has(k)) g.appendChild(this.tile(z, x, y));
      }
  }

  private updateTiles() {
    if (this.basemap === "none") return;
    const r = this.svg.getBoundingClientRect();
    const o = this.ap.data.origin;
    const mpp = 156543.03 * Math.cos((o.lat * Math.PI) / 180);
    const z = Math.min(MAX_Z, Math.round(Math.log2(mpp * this.k * Math.min(devicePixelRatio || 1, 2))));
    if (z <= BASE_Z) { this.detailTiles.replaceChildren(); return; }
    const w0: XY = [(0 - this.tx) / this.k, -(0 - this.ty) / this.k];
    const w1: XY = [(r.width - this.tx) / this.k, -(r.height - this.ty) / this.k];
    const [latN, lonW] = toLatLon(o, w0);
    const [latS, lonE] = toLatLon(o, w1);
    const keep = new Set<string>();
    this.addTiles(this.detailTiles, z, lonW, latN, lonE, latS, keep);
    // drop tiles from other zoom levels / off screen once the new ones are requested
    for (const c of [...this.detailTiles.children]) if (!keep.has(c.getAttribute("data-k")!)) c.remove();
  }

  private updateRulers() {
    const r = this.svg.getBoundingClientRect();
    const g = this.grid;
    const frag = document.createDocumentFragment();
    const left = this.pad.left + 12, top = this.pad.top + 12;
    const cellPx = CELL * this.k;
    if (cellPx < 22) { this.rulers.replaceChildren(); return; }
    for (let c = 0, x = g.x0; x < g.x1; x += CELL, c++) {
      const sx = (x + CELL / 2) * this.k + this.tx;
      if (sx < left + 10 || sx > r.width - this.pad.right) continue;
      const s = document.createElement("span");
      s.textContent = COLS[c] ?? "";
      s.style.left = `${sx}px`;
      s.style.top = `${top}px`;
      frag.appendChild(s);
    }
    for (let i = 1, y = g.y1; y > g.y0; y -= CELL, i++) {
      const sy = -(y - CELL / 2) * this.k + this.ty;
      if (sy < top + 12 || sy > r.height - this.pad.bottom - 8) continue;
      const s = document.createElement("span");
      s.textContent = String(i);
      s.style.left = `${left}px`;
      s.style.top = `${sy}px`;
      frag.appendChild(s);
    }
    this.rulers.replaceChildren(frag);
  }

  private updateScale() {
    const bar = document.getElementById("scale-bar"), label = document.getElementById("scale-label");
    if (!bar || !label) return;
    const nice = [20, 50, 100, 200, 250, 500, 1000, 2000];
    const m = nice.find((n) => n * this.k >= 70) ?? 2000;
    bar.style.width = `${m * this.k}px`;
    label.textContent = m >= 1000 ? `${m / 1000} km` : `${m} m`;
  }

  setGridVisible(v: boolean) {
    this.gridG.classList.toggle("hidden", !v);
    this.rulers.classList.toggle("hidden", !v);
  }

  /** fit world bounds into the free screen area */
  fit(b: Bounds, animate = true, maxK = 2.2) {
    const r = this.svg.getBoundingClientRect();
    const w = r.width - this.pad.left - this.pad.right - 48;
    const h = r.height - this.pad.bottom - this.pad.top - 48;
    const k = Math.min(maxK, w / Math.max(b.x1 - b.x0, 1), h / Math.max(b.y1 - b.y0, 1));
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const sx = this.pad.left + 24 + w / 2, sy = this.pad.top + 24 + h / 2;
    this.animateTo(k, sx - cx * k, sy + cy * k, animate);
  }
  fitAll(animate = true) { this.fit(this.bounds, animate); }
  fitPoints(pts: XY[], animate = true, minSpan = 500) {
    if (!pts.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const hx = Math.max((x1 - x0) / 2, minSpan / 2), hy = Math.max((y1 - y0) / 2, minSpan / 2);
    this.fit({ x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy }, animate);
  }

  private animateTo(k: number, tx: number, ty: number, animate: boolean) {
    cancelAnimationFrame(this.anim);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce) { this.k = k; this.tx = tx; this.ty = ty; this.apply(); return; }
    const k0 = this.k, tx0 = this.tx, ty0 = this.ty, t0 = performance.now(), D = 650;
    // interpolate in log-zoom around a fixed screen anchor so motion feels natural
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / D);
      const e = 1 - Math.pow(1 - t, 4);
      this.k = k0 * Math.pow(k / k0, e);
      const f = k0 === k ? e : (this.k - k0) / (k - k0);
      this.tx = tx0 + (tx - tx0) * f;
      this.ty = ty0 + (ty - ty0) * f;
      this.apply();
      if (t < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  zoomBy(f: number, sx?: number, sy?: number, animate = false) {
    const r = this.svg.getBoundingClientRect();
    sx ??= this.pad.left + (r.width - this.pad.left - this.pad.right) / 2;
    sy ??= (r.height - this.pad.bottom) / 2;
    const k = Math.max(this.minK(), Math.min(8, this.k * f));
    const wx = (sx - this.tx) / this.k, wy = (sy - this.ty) / this.k;
    this.animateTo(k, sx - wx * k, sy - wy * k, animate);
  }

  // ---------- input ----------
  private dragging = false;
  private bindInput() {
    const svg = this.svg;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch: { d: number; k: number } | null = null;

    svg.addEventListener("pointerdown", (e) => {
      cancelAnimationFrame(this.anim);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.k };
      }
    });
    svg.addEventListener("pointermove", (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4 && !this.dragging) {
        this.dragging = true;
        svg.classList.add("dragging");
        svg.setPointerCapture(e.pointerId);
        this.tooltip.classList.remove("show");
      }
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = svg.getBoundingClientRect();
        const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
        const k = Math.max(this.minK(), Math.min(8, (pinch.k * d) / pinch.d));
        const wx = (cx - this.tx) / this.k, wy = (cy - this.ty) / this.k;
        this.k = k; this.tx = cx - wx * k; this.ty = cy - wy * k;
        this.tx += dx / 2; this.ty += dy / 2;
      } else if (this.dragging) {
        this.tx += dx; this.ty += dy;
      }
      this.apply();
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) {
        this.dragging = false;
        svg.classList.remove("dragging");
      }
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    // swallow the click that ends a drag so stands aren't picked by accident
    svg.addEventListener("click", (e) => { if (moved > 4) e.stopPropagation(); }, true);
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.anim);
      const r = svg.getBoundingClientRect();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.zoomBy(Math.exp(-delta * 0.0018), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    svg.addEventListener("dblclick", (e) => {
      const r = svg.getBoundingClientRect();
      this.zoomBy(2, e.clientX - r.left, e.clientY - r.top, true);
    });
  }
}
