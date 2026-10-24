# Stream 2: Data and API

This is everything Stream 2 owns: real road, terrain and weather data for three Austin routes, the simulated
trips built from it, AI coaching tips, and the API routes the map and UI read from.
**All driving data is simulated. All savings numbers are estimates.**

## What is already done

| Task from the plan | Status | Where |
|---|---|---|
| Repo and environment variables | Done (keys go in `.env.local`, see `.env.example`) | project root |
| Fetch the three demo routes | Done. Uses Mapbox if a token is set, otherwise free OSRM routing | `scripts/fetch-routes.ts` |
| Resample every 10 m, elevation and grade | Done (Open-Meteo elevation, smoothed) | same script |
| Speed limit, road class, surface, stops | Done (OpenStreetMap via Overpass) | same script |
| Weather per route | Done (Open-Meteo: temperature, rain and snow in the last 24 h) | same script |
| Cache every response | Done. Saved in `data/cache/`, so the demo needs no network | `data/cache/` |
| Trip generator | Done. 3 routes × 3 drivers × 4 conditions × regen on/off = 72 trips | `scripts/generate-trips.ts` |
| API routes: list, get one, compare | Done | `app/api/` |
| AI coaching tip per trip | Done. Uses Claude when a key is set, otherwise rule-based tips | `scripts/coach.ts` |
| Sample trip for teammates | Done | `data/sample-trip.json` |
| Leaderboard (optional) | Not started. First thing to cut if time is short | |

## The three routes (Austin, TX)

| Id | Name | Length | Stops | Notes |
|---|---|---|---|---|
| `hill` | Westlake Hills to Downtown | 7.9 km | 19 | Long descent into town, the best demo route |
| `flat` | East Austin loop | 5.3 km | 13 | Gentle terrain |
| `mixed` | South Lamar to the Capitol | 7.7 km | 30 | Lots of signals |

To change a route, edit the start and end points in `config/routes.json`, then run `npm run data -- --fresh`.

## Commands

Run these in a terminal from the project folder.

| Command | What it does |
|---|---|
| `npm install` | One-time setup after you download the project |
| `npm run data` | Runs all three steps below in order |
| `npm run fetch-routes` | Builds `data/routes/` from the cache (add `-- --fresh` to download again) |
| `npm run generate-trips` | Runs the physics model and writes `data/trips/` |
| `npm run coach` | Adds coaching tips to trips that don't have one yet (add `-- --all` to redo all) |
| `npm run dev` | Starts the app at http://localhost:3000 |

## Message for teammates: how to use the API

Trip ids are `<route>-<driver>-<condition>`, for example `hill-smooth-dry`. Add `-noregen` for the
conventional-car baseline, for example `hill-smooth-dry-noregen`.
Drivers: `smooth`, `aggressive`, `mixed`. Conditions: `dry`, `wet`, `snow`, `mud`.

| Call | Returns |
|---|---|
| `GET /api/routes` | The three routes |
| `GET /api/routes/hill` | One route with every 10 m point: lat, lon, elevation, grade, speed limit, surface, stops |
| `GET /api/trips` | Every trip with its score (filters: `?route=hill&driver=smooth&condition=wet&regen=true`) |
| `GET /api/trips/hill-smooth-dry` | The full trip: header, one sample per second, summary, coaching tip |
| `GET /api/trips/hill-smooth-dry?samples=false` | Same without the samples (small and fast) |
| `GET /api/compare?route=hill&condition=wet` | The compare-mode columns: `conventional`, `smooth`, `aggressive`, each with the table rows |
| `GET /api/compare?route=hill&condition=wet&samples=true` | Same plus samples, to draw all three on the map |

The exact data shape is in `lib/trip-types.ts`. Beyond the plan's contract, trips also include:
`header.routeId`, `summary.label` (a plain-word label), `summary.missedEvents` (one per braking episode,
with lat/lon for map markers), `summary.regenSharePct`, fuel/cost/CO2 rows for compare mode,
`summary.moneyLeftOnTableDollars`, and `coaching` (`text`, `source`, and `basedOn` for the credit line).

**Stream 3 (map):** color segments with `regenKw` vs `frictionKw` on each sample; put markers at `summary.missedEvents`.
**Stream 4 (UI):** "conventional" in compare mode is the smooth driver with regen off, so only one thing changes.

## Message for Stream 1 (physics)

`lib/physics/index.ts` is a **stand-in model** I wrote so trips exist today. It follows the cheat sheet,
and all its numbers are in `config/physics.ts`. Replace it with your model whenever you like: keep exporting
`simulateTrip(route, driver, condition, { regenEnabled })` returning a `Trip`, then run `npm run generate-trips`.
Your input is the `Route` type in `lib/trip-types.ts`.

One note: the stand-in scores trips as "share of the braking energy that a perfect regen system could have
recovered". The cheat-sheet ceiling (descent energy + stop energy) is also saved as `summary.theoreticalKwh`,
but it ignores drag and rolling losses, so even perfect driving only scored about 60 with it.

Current stand-in scores (smooth / aggressive / mixed): hill dry 97 / 69 / 88, hill snow 81 / 64 / 73.

## Turning on Claude coaching tips

1. Copy `.env.example` to a new file called `.env.local`.
2. Paste the team's Claude API key after `ANTHROPIC_API_KEY=`.
3. Run `npm run coach`. It replaces the rule-based tips with Claude-written ones (36 short calls).

The tips use `claude-opus-5-5`. If Claude declines a request, the API retries it on a fallback model automatically.
