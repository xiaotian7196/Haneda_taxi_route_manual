// UI strings. English + Japanese, switchable at runtime.
export type Lang = "en" | "ja";
export type Text = Record<Lang, string>;

const S = {
  title: { en: "Haneda Taxi Guide", ja: "羽田タキシーガイド" },
  eyebrow: { en: "RJTT · Tokyo Haneda", ja: "RJTT · 東京国際空港" },
  arrival: { en: "Arrival", ja: "到着" },
  departure: { en: "Departure", ja: "出発" },
  flow: { en: "Runway configuration", ja: "滑走路運用" },
  flowHint: { en: "{name} — arrivals {arr} · departures {dep}", ja: "{name} — 到着 {arr} ・ 出発 {dep}" },
  runway: { en: "Runway", ja: "滑走路" },
  stand: { en: "Stand", ja: "スポット" },
  search: { en: "Search stand, e.g. 61, 110, T3", ja: "スポット検索（例: 61、110、T3）" },
  noMatch: { en: "No stand matches “{q}”", ja: "「{q}」に一致するスポットはありません" },
  exit: { en: "Runway exit · {rwy}", ja: "離脱誘導路 · {rwy}" },
  entry: { en: "Runway entry · {rwy}", ja: "滑走路進入点 · {rwy}" },
  auto: { en: "Auto", ja: "自動" },
  standard: { en: "Standard", ja: "標準" },
  left: { en: "L", ja: "左" },
  right: { en: "R", ja: "右" },
  leftExit: { en: "Left turn-off", ja: "左離脱" },
  rightExit: { en: "Right turn-off", ja: "右離脱" },
  enterRunway: { en: "Runway entry", ja: "滑走路進入" },
  full: { en: "Full length", ja: "全長" },
  remain: { en: "{d} left", ja: "残り {d}" },
  grid: { en: "Grid", ja: "グリッド" },
  groupT1: { en: "Terminal 1 side", ja: "第1ターミナル側" },
  groupT2: { en: "Terminal 2 side", ja: "第2ターミナル側" },
  groupT3: { en: "Terminal 3 side (Intl)", ja: "第3ターミナル側（国際線）" },
  pickStand: {
    en: "Pick a stand from the list or tap a dot on the map to build the standard taxi route {dir}.",
    ja: "リストまたは地図上の点からスポットを選ぶと、{dir}の標準タキシールートを表示します。",
  },
  dirArr: { en: "from the runway exit to the stand", ja: "離脱誘導路からスポットまで" },
  dirDep: { en: "from the stand to the runway", ja: "スポットから滑走路まで" },
  noRoute: { en: "No route found for Spot {s}. Try another {p}.", ja: "スポット {s} へのルートが見つかりません。別の{p}を選んでください。" },
  noRouteArr: { en: "exit", ja: "離脱誘導路" },
  noRouteDep: { en: "entry", ja: "進入点" },
  direct: { en: "Direct", ja: "直行" },
  shortest: { en: "Shortest", ja: "最短" },
  minutes: { en: "≈ {m} min · 15 kt", ja: "約 {m} 分 · 15 kt" },
  crossWarn: {
    en: "Crosses runway {r}. Stop at the holding point and wait for tower clearance before crossing.",
    ja: "滑走路 {r} を横断します。停止位置で止まり、管制の許可を得てから横断してください。",
  },
  missedWarn: {
    en: "{t} from the standard route is not connected in the map data; the nearest path was used instead.",
    ja: "標準ルートの {t} は地図データ上で接続されていないため、最寄りの経路で代替しています。",
  },
  vacate: { en: "Vacate runway {rwy} via {x}, turning {side}", ja: "{x} で{side}に離脱 · 滑走路 {rwy}" },
  sideL: { en: "left", ja: "左" },
  sideR: { en: "right", ja: "右" },
  fromThr: { en: "{d} from threshold · grid {g}", ja: "進入端から {d} · グリッド {g}" },
  push: { en: "Push back from {s}, taxi via {t}", ja: "{s} からプッシュバック、{t} を走行" },
  apron: { en: "apron", ja: "エプロン" },
  gridRef: { en: "Grid {g}", ja: "グリッド {g}" },
  turn_straight: { en: "Continue onto {t}", ja: "直進して {t} へ" },
  turn_left: { en: "Turn left onto {t}", ja: "左折して {t} へ" },
  turn_right: { en: "Turn right onto {t}", ja: "右折して {t} へ" },
  "turn_sharp-left": { en: "Sharp left onto {t}", ja: "鋭く左折して {t} へ" },
  "turn_sharp-right": { en: "Sharp right onto {t}", ja: "鋭く右折して {t} へ" },
  turn_start: { en: "Taxi via {t}", ja: "{t} を走行" },
  cross: { en: "Cross runway {r}", ja: "滑走路 {r} を横断" },
  crossSub: { en: "Hold short · cross only when cleared", ja: "手前で停止 · 許可後に横断" },
  arrive: { en: "Arrive at {s}", ja: "{s} に到着" },
  holdAt: { en: "Hold short at {x}", ja: "{x} の停止位置で待機" },
  holdSub: { en: "Runway {rwy} · {avail}", ja: "滑走路 {rwy} · {avail}" },
  fullTo: { en: "full-length departure", ja: "全長離陸" },
  avail: { en: "{d} available", ja: "使用可能 {d}" },
  alt: { en: "Alternative: {s}", ja: "代替: {s}" },
  crossTitle: { en: "Runway crossing {r}", ja: "滑走路横断 {r}" },
  footer: {
    en: "Taxi logic after Kono_Hana, “Tokyo International (Haneda) departure & arrival taxi overview” (bilibili). Runway thresholds from X-Plane Custom Data (Navigraph AIRAC); taxiway geometry © OpenStreetMap contributors (ODbL). For flight simulation only — ATC instructions always take precedence.",
    ja: "タキシーの考え方は Kono_Hana「東京国際空港（羽田）出発・到着タキシー概要」（bilibili）に基づきます。滑走路進入端は X-Plane Custom Data（Navigraph AIRAC）、誘導路形状は © OpenStreetMap contributors（ODbL）。フライトシミュレーター専用です。常に管制指示が優先されます。",
  },
  zoomIn: { en: "Zoom in", ja: "拡大" },
  zoomOut: { en: "Zoom out", ja: "縮小" },
  fitAll: { en: "Show whole airport", ja: "空港全体を表示" },
  mapLabel: { en: "RJTT taxiway map", ja: "RJTT 誘導路マップ" },
  rwyA: { en: "Runway A", ja: "A滑走路" },
  rwyB: { en: "Runway B", ja: "B滑走路" },
  rwyC: { en: "Runway C", ja: "C滑走路" },
  rwyD: { en: "Runway D", ja: "D滑走路" },
} satisfies Record<string, Text>;

export type Key = keyof typeof S;
let lang: Lang = "en";
export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l === "ja" ? "ja" : "en";
}
export function t(key: Key, vars: Record<string, string | number> = {}): string {
  return S[key][lang].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
export const tx = (text: Text) => text[lang];
