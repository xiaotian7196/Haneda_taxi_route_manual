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
  (e.g. `34L → A → J → E` for T2). All variants are routed and shown; the shortest is preselected
  and the others appear as faint alternatives you can tap.
- **Runway crossings** are flagged on the map and in the step list.
- **Chart grid** – 500 m cells (columns A–Z without I/O, rows 1–n) with edge rulers; every step and stand shows its grid reference.
- **GSI background map** – the pale map or aerial photo from GSI Tiles (Geospatial Information Authority of Japan), or no background. Switch with the layers button.
- Full-screen map with pan, wheel/pinch zoom, taxiway signs, hover highlighting, light/dark mode and a mobile bottom sheet.

## Getting started

Requirements: Node.js 22.6+ (scripts run TypeScript directly), and X-Plane 12 with Navigraph data in `Custom Data`.

```bash
npm install
npm run build:data          # or: npm run build:data -- "<path to X-Plane 12/Custom Data>"
npm run dev
```

`npm run build` produces a static site in `dist/`. `npm test` routes every flow / runway / terminal combination as a smoke test.

## Data

| Source | Used for | Licence |
| --- | --- | --- |
| X-Plane 12 `Custom Data/CIFP/RJTT.dat` (Navigraph AIRAC) | Runway thresholds and displaced thresholds | Navigraph personal-use terms |
| OpenStreetMap via Overpass (`data/osm-rjtt.json`) | Taxiways, stands, aprons, terminals, runway ends | © OpenStreetMap contributors, ODbL |
| [GSI Tiles](https://maps.gsi.go.jp/development/ichiran.html) (`pale`, `seamlessphoto`) | Background map, loaded at runtime | Geospatial Information Authority of Japan (attribution shown on the map) |

`scripts/build-data.ts` merges both into `src/data/rjtt.json` (local metric coordinates around the ARP).
Because that file contains Navigraph-derived values it is git-ignored. Do not publish it; rebuild it locally
from your own subscription. To refresh the OSM geometry run `npm run fetch:osm`.

## How routing works

1. Taxiway ways become an undirected graph. Stands connect to it through their OSM lead-in lines (or
   the nearest taxiway segment).
2. Runway centerlines come from the CIFP thresholds. Taxiway nodes within 14 m of a centerline are runway
   nodes. That gives exits and entries, and lets the router penalise crossings and forbid back-taxi on the active runway.
3. Each published route is a list of taxiways (`src/procedures.ts`). The router (`src/router.ts`) runs
   Dijkstra over `(directed edge, progress)` states. Edges on the current or next listed taxiway cost 1×,
   unnamed apron lines cost 1.35×, and any other taxiway costs 2.4×. So the path follows the published
   flow and still connects through short links.
   Because the state is the edge just travelled, turns sharper than 105° are not allowed.
   That rules out reversing at a junction or doubling back through a fillet. Arrivals must also
   enter the stand lead-in line in the direction of travel.
4. Exits and entries are traced back to their true turn-off point on the centerline. An exit
   must leave at 100° or less to the landing direction. An entry must not need more than a 105° turn onto
   the runway (140° within 300 m of the runway end). So high-speed exits built for the opposite
   direction are never offered.
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
scripts/              data fetch, build and route smoke test
public/RJTT.png       app icon
```
