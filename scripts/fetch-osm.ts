// Downloads RJTT aeroway geometry from OpenStreetMap (ODbL) via Overpass.
// Usage: npm run fetch:osm   (then npm run build:data)
import { writeFileSync } from "node:fs";

const BBOX = "35.525,139.74,35.575,139.83";
const query = `[out:json][timeout:90];(
way["aeroway"~"taxiway|runway|apron|terminal|taxilane|parking_position|holding_position|stopway"](${BBOX});
node["aeroway"~"parking_position|gate|holding_position"](${BBOX});
);out geom;`;

const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "taxi-guide-script" },
  body: "data=" + encodeURIComponent(query),
});
if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
writeFileSync(new URL("../data/osm-rjtt.json", import.meta.url), await res.text());
console.log("saved data/osm-rjtt.json");
