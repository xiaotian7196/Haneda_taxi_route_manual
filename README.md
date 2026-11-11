# Haneda Taxi Guide (RJTT)

An Apple-style, full-screen taxi route guide for Tokyo Haneda (RJTT), built for flight simulation.
Pick a runway configuration, a runway, a stand and (optionally) a runway exit or entry point, and the
guide draws the standard taxi route on a gridded airport map with turn-by-turn steps.

The UI is available in **English** and **Japanese** (switch in the panel header).

> For flight simulation only. Not for real-world navigation. ATC instructions always take precedence.

## Features

- **Arrival mode** – runway exit → stand. Exits are detected from the taxiway network, labelled with
  turn side (L/R) and distance from the threshold, and can be picked from the list or on the map.
  "Auto" picks a realistic exit for the published route.
- **Departure mode** – stand → runway holding point, with the published entry (e.g. C14, A14, L15) as default.
- **Runway configurations** – North flow (34L/34R in, 34R/05 out), South flow · Bay (22/23 in,
  16L/16R out) and South flow · City (16L/16R in, 16R/22 out).
- **Published taxi logic** – each runway/terminal pair has one or more standard routes
  (e.g. `34L → A → J → E` for T2). All variants are routed and shown; the first published one is
  preselected, the shortest is tagged, and the others appear as faint alternatives you can tap.
- **Runway crossings** are flagged on the map and in the step list.
- **Chart grid** – 500 m cells (columns A–Z without I/O, rows 1–n) with edge rulers; every step and stand shows its grid reference.
- **GSI background map** – the pale map or aerial photo from GSI Tiles (Geospatial Information Authority of Japan), or no background. Switch with the layers button.
- Full-screen map with pan, wheel/pinch zoom, taxiway signs, hover highlighting, light/dark mode and a mobile bottom sheet.

## Getting started

Requirements: Node.js 22.6+ (scripts run TypeScript directly).

```bash
npm install
npm run dev
```

All data the app needs is already in the repository, so no X-Plane install is required to run it.
`npm run build` produces a static site in `dist/`. `npm test` routes every flow / runway / terminal combination as a smoke test. `npm run test:loops` lists routes that wind more than 200° within 400 m.

### Refreshing the data

```bash
npm run extract:navdata -- "<path to X-Plane 12/Custom Data>"   # new AIRAC cycle
npm run fetch:osm                                                # newer OSM geometry
npm run build:data                                               # regenerate src/data/rjtt.json
```

`extract:navdata` copies only what the guide uses out of X-Plane's `Custom Data`: the `RWY:` records from
`CIFP/RJTT.dat` go into `data/navdata/RJTT.dat`, and the AIRAC cycle info goes into `data/navdata/cycle.json`.
It defaults to `K:/SteamLibrary/steamapps/common/X-Plane 12/Custom Data`, or you can set `XPLANE_CUSTOM_DATA`.

## Data

| Source | File | Used for | Licence |
| --- | --- | --- | --- |
| X-Plane 12 Custom Data (Navigraph AIRAC, see `data/navdata/cycle.json`) | `data/navdata/RJTT.dat` | Runway thresholds and displaced thresholds | Navigraph / Jeppesen terms |
| OpenStreetMap via Overpass | `data/osm-rjtt.json` | Taxiways, stands, aprons, terminals, runway ends | © OpenStreetMap contributors, ODbL |
| [GSI Tiles](https://maps.gsi.go.jp/development/ichiran.html) (`pale`, `seamlessphoto`) | loaded at runtime | Background map | Geospatial Information Authority of Japan (attribution shown on the map) |

`scripts/build-data.ts` merges the first two into `src/data/rjtt.json` (local metric coordinates around the ARP).

## How routing works

1. Taxiway ways become an undirected graph. Stands connect to it through their OSM lead-in lines (or
   the nearest taxiway segment).
2. Runway centerlines come from the CIFP thresholds. Taxiway nodes within 14 m of a centerline are runway
   nodes. That gives exits and entries, and lets the router penalise crossings and forbid back-taxi on the active runway.
3. Each published route is a list of taxiways (`src/procedures.ts`). The router (`src/router.ts`) runs
   Dijkstra over `(directed edge, progress)` states. Edges on the current or next listed taxiway cost 1×,
   unnamed apron lines cost 1.35×, and any other taxiway costs 2.4×. So the path follows the published
   flow and still connects through short links; finishing the route without a listed taxiway costs 4 km,
   and one taxiway of the list may be skipped at a fixed cost instead of detouring just to touch it.
   Because the state is the edge just travelled, turns sharper than 105° are not allowed at a junction
   (metre-long junction stubs are exempt, their direction is noise). Every degree of turning costs a
   little, and so does every change of taxiway name, so gentle curves can't add up to a loop and the
   path doesn't weave between parallel taxiways. Arrivals must also enter the stand
   lead-in line in the direction of travel, and the turn out of it is charged on departure; departures
   must reach the runway along the chosen entry taxiway.
   The finished path is then inspected for the two detours a taxi clearance never contains: a closed
   excursion that leaves a junction and comes back to it, and a reversal that sweeps round a long fillet.
   When one is found, the search is repeated with those edges excluded, so the result is the shortest
   path that still makes sense to taxi. A published taxiway that cannot be reached without such a detour
   is left out and reported as missed rather than driven around.
4. Exits and entries are traced back to their true turn-off point, where the taxiway leaves the runway
   pavement rather than where it happens to touch the centerline — a shallow connector would otherwise
   be pulled hundreds of metres down the runway and onto its neighbour's junction. An exit
   must leave at 100° or less to the landing direction. An entry must not need more than a 105° turn onto
   the runway (140° within 300 m of the runway end). So high-speed exits built for the opposite
   direction are never offered. When an exit or entry is picked by hand, published-route options that
   come out more than 35% longer than the best one are dropped.
5. The path is grouped into steps by taxiway name, with turn direction and runway-crossing callouts.

## Credits

Taxi logic follows Kono_Hana, "Tokyo International (Haneda) departure & arrival taxi overview"
(bilibili opus 780986004248985619, last edited 2024-01). That article describes general practice and
does not list one-way restrictions or hot spots.

## Project layout

```
index.html            app shell
src/main.ts           UI state and panel rendering
src/map.ts            SVG map, grid, pan/zoom
src/router.ts         template-constrained Dijkstra and turn-by-turn steps
src/plan.ts           selection → routed options
src/procedures.ts     published taxi routes per runway / terminal
src/airport.ts        graph model, runway exits and entries
src/i18n.ts           English / Japanese strings
scripts/              nav data extract, OSM fetch, data build, route smoke test
data/navdata/         runway records extracted from X-Plane Custom Data
public/RJTT.png       app icon
```
