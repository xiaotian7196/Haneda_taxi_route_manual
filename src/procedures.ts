// Standard taxi logic for RJTT, after Kono_Hana,
// "Tokyo International (Haneda) departure & arrival taxi overview"
// (bilibili opus 780986004248985619).
// `via` is the ordered list of taxiways after vacating / before lining up.
// ATC instructions always take precedence.
import type { Group } from "./airport.ts";
import type { Text } from "./i18n.ts";

export type FlowId = "N" | "SA" | "SC";
export interface Flow {
  id: FlowId;
  name: Text;
  arr: string[];
  dep: string[];
}
export const FLOWS: Flow[] = [
  { id: "N", name: { en: "North flow", ja: "北風運用" }, arr: ["34L", "34R"], dep: ["34R", "05"] },
  { id: "SA", name: { en: "South flow · Bay", ja: "南風運用 · 好天時" }, arr: ["22", "23"], dep: ["16L", "16R"] },
  { id: "SC", name: { en: "South flow · City", ja: "南風運用 · 都心ルート" }, arr: ["16L", "16R"], dep: ["16R", "22"] },
];

export interface Template {
  via: string[];
  /** departure: runway entry / holding point taxiway */
  entry?: string;
  note?: Text;
  /** arrival: recommended turn-off side */
  side?: "L" | "R";
  flows?: FlowId[];
  /** the published taxiways must be flown even when a direct line is shorter */
  strict?: boolean;
  /** arrival: only for stands whose number is inside one of these inclusive ranges */
  stands?: [number, number][];
}
type Table = Record<string, Partial<Record<Group, Template[]>>>;

export const ARRIVALS: Table = {
  "34L": {
    T1: [{ via: ["W"], side: "R" }, { via: ["A"], side: "R" }],
    T2: [
      { via: ["A", "J", "E"], side: "R" },
      { via: ["A", "J", "R"], side: "R" },
      { via: ["A", "H"], side: "R", note: { en: "Stands on the south side of T2", ja: "T2 南側スポット" } },
    ],
    T3: [{ via: [], side: "L", note: { en: "Turn left off the runway straight onto the T3 apron", ja: "左に離脱してそのまま T3 エプロンへ" } }],
  },
  "34R": {
    // T1 arrivals: the north side is worked via K, the south side via G, and the
    // shorter of the two is the one to fly
    T1: [
      { via: ["C", "K", "W"], side: "L" },
      { via: ["C", "G", "W"], side: "L" },
    ],
    T2: [{ via: ["C"], side: "L" }],
    T3: [
      { via: ["C", "K", "A15"], side: "L", note: { en: "Cross 34L on A15", ja: "A15 で 34L を横断" } },
      { via: ["C", "G", "A3"], side: "L", note: { en: "Cross 34L on A3", ja: "A3 で 34L を横断" } },
    ],
  },
  "22": {
    // landing on 22: the south T1 stands (and the 2xx block beside them) turn off onto
    // M and L and cross 16R on the nearest of L11 / L9 / L6 (L10 is a high-speed exit,
    // not a taxiway); the north pier runs up B and crosses on A15
    T1: [
      { via: ["M", "L", "L11"], side: "L", stands: [[1, 34], [201, 214]], strict: true, note: { en: "Cross 16R on L11", ja: "L11 で 16R を横断" } },
      { via: ["M", "L", "L9"], side: "L", stands: [[1, 34], [201, 214]], strict: true, note: { en: "Cross 16R on L9", ja: "L9 で 16R を横断" } },
      { via: ["M", "L", "L6"], side: "L", stands: [[1, 34], [201, 214]], strict: true, note: { en: "Cross 16R on L6", ja: "L6 で 16R を横断" } },
      { via: ["B", "L15", "A15", "K", "R"], side: "L", strict: true, stands: [[35, 200], [300, 350]], note: { en: "Cross 16R on A15", ja: "A15 で 16R を横断" } },
      { via: ["B", "L15", "A15", "K", "R"], side: "L", strict: true, stands: [[401, 402]], note: { en: "Cross 16R on A15", ja: "A15 で 16R を横断" } },
      { via: [], side: "L", stands: [[351, 366]], note: { en: "Direct to the T1 north pier", ja: "T1 北ウイングへ直接" } },
    ],
    T2: [
      // the north-side T2 stands are worked via E rather than down R
      { via: ["B", "L15", "A15", "K", "E"], side: "L", strict: true, note: { en: "Cross 16R on A15", ja: "A15 で 16R を横断" } },
    ],
    T3: [{ via: ["M", "L"], side: "L" }, { via: [], side: "L", note: { en: "T3 north-wing stands", ja: "T3 北ウイングのスポット" } }],
  },
  "23": {
    // landing on 23: the south stands are worked up R and then H, joining E if needed
    T1: [{ via: ["R", "H"] }],
    T2: [{ via: ["R", "H"] }],
    T3: [{ via: ["R", "G", "A"], note: { en: "Cross 16R on A", ja: "A で 16R を横断" } }],
  },
  "16L": {
    T1: [{ via: ["C", "G", "A"], side: "R" }, { via: ["C", "G", "W"], side: "R" }],
    T2: [{ via: ["C"], side: "R" }],
    T3: [{ via: ["C", "G", "A3"], side: "R", note: { en: "Cross 16R on A3", ja: "A3 で 16R を横断" } }],
  },
  "16R": {
    T1: [{ via: [], side: "L", note: { en: "Turn left off the runway straight onto the apron", ja: "左に離脱してそのままエプロンへ" } }],
    T2: [{ via: ["A", "H", "E"], side: "L" }],
    T3: [{ via: [], side: "R", note: { en: "Turn right off the runway straight onto the T3 apron", ja: "右に離脱してそのまま T3 エプロンへ" } }],
  },
};

export const DEPARTURES: Table = {
  "34R": {
    T1: [{ via: ["H", "C"] }, { via: ["A"], entry: "C1", note: { en: "Night: Runway C single-runway operation", ja: "夜間 C 滑走路単独運用時" } }],
    T2: [{ via: ["C"] }],
    T3: [
      { via: ["L4", "H", "C"], note: { en: "Cross 34L on L4", ja: "L4 で 34L を横断" } },
      { via: ["A"], entry: "C1", note: { en: "Night: Runway C single-runway operation", ja: "夜間 C 滑走路単独運用時" } },
    ],
  },
  "05": {
    T1: [
      { via: ["W", "A"], note: { en: "Then join ROUTE5", ja: "その後 ROUTE5 に合流" } },
      { via: ["H", "R"], note: { en: "Then join ROUTE5", ja: "その後 ROUTE5 に合流" } },
    ],
    T2: [{ via: ["E", "S"] }, { via: ["R"], note: { en: "T2 south side · join ROUTE5", ja: "T2 南側 · ROUTE5 に合流" } }],
    T3: [{ via: ["L3"], note: { en: "Cross 34L on L3, then join ROUTE5", ja: "L3 で 34L を横断後 ROUTE5 に合流" } }],
  },
  "16L": {
    T1: [{ via: ["W", "K", "C14"], entry: "C14" }],
    T2: [
      { via: ["C", "C13"], entry: "C13" },
      { via: ["C", "C12"], entry: "C12", note: { en: "C12 available on request", ja: "C12 はリクエスト可" } },
    ],
    T3: [{ via: ["L15", "A15", "K", "C14"], entry: "C14", note: { en: "Cross 34L on L15", ja: "L15 で 34L を横断" } }],
  },
  "16R": {
    T1: [{ via: ["A", "A14"], entry: "A14" }],
    T2: [
      { via: ["E", "J", "A14"], entry: "A14" },
      { via: ["R", "J", "A14"], entry: "A14", note: { en: "T2 north side", ja: "T2 北側" } },
    ],
    T3: [
      { via: ["P", "M", "L", "L14"], entry: "L14", flows: ["SA"], note: { en: "Do not turn from P onto L before M (keeps clear of 22 arrivals)", ja: "M より手前で P から L に入らないこと（22 到着機を避けるため）" } },
      { via: ["P", "B", "L15"], entry: "L15" },
      { via: ["L", "L14"], entry: "L14", flows: ["SC"] },
    ],
  },
  "22": {
    T1: [{ via: ["B", "B13"], entry: "B13" }],
    T2: [{ via: ["J", "R", "B14"], entry: "B14" }],
    T3: [{ via: ["L15", "A15", "B"], note: { en: "Cross 16R on L15 · do not pass the GP HOLD line without clearance", ja: "L15 で 16R を横断 · 許可なく GP HOLD ラインを越えないこと" } }],
  },
};

export function templates(table: Table, rwy: string, group: Group, flow: FlowId): Template[] {
  const list = (table[rwy]?.[group] ?? []).filter((t) => !t.flows || t.flows.includes(flow));
  return list.length ? list : [{ via: [], note: { en: "No published route; shortest path used", ja: "標準ルートなし · 最短経路を使用" } }];
}

/**
 * Arrival exits that are taxied to the end of their own taxiway before turning
 * off, instead of taking the first connector.
 * L12 is the rapid exit from 34L for the T3 apron: it runs north-west past the
 * L11 junction and loops back south onto L. Leaving it at L11 cuts across the
 * loop, so the L12 clearance is flown in the direction of the exit pavement
 * (north-west) until the taxiway ends at L.
 */
export const EXIT_RUNOUT = new Set(["L12"]);
