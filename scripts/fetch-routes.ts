// Step 1 of the data pipeline: turn real roads, terrain and weather into route files.
//
//   npm run fetch-routes            uses saved responses in data/cache when they exist
//   npm run fetch-routes -- --fresh  ignores the cache and downloads everything again
//
// Writes data/routes/<routeId>.json for each route in config/routes.json.
// Uses the Mapbox Directions API when MAPBOX_TOKEN is set in .env.local,
// otherwise the free public OSRM router (same roads, no key needed).

import fs from "node:fs";
import path from "node:path";
import routesConfig from "../config/routes.json";
import { DATA_CONFIG as C } from "../config/data";
import { distanceM, movingAverage, pointToSegmentM, resample, type LonLat } from "../lib/data/geo";
import type { Route, RoutePoint, RouteWeather } from "../lib/trip-types";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const ROUTES_DIR = path.join(process.cwd(), "data", "routes");
const FRESH = process.argv.includes("--fresh");
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const USER_AGENT = "regen-coach-hackathon/0.1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch once, then reuse the saved JSON so the demo never depends on the network.
async function cached<T>(name: string, download: () => Promise<T>): Promise<T> {
  const file = path.join(CACHE_DIR, name);
  if (!FRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`  downloading ${name}`);
  const data = await download();
  fs.writeFileSync(file, JSON.stringify(data));
  await sleep(C.requestDelayMs);
  return data;
}

async function getJson(url: string, init?: RequestInit) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...init?.headers } });
    if (res.ok) return res.json();
    if (attempt >= 3 || res.status < 429) throw new Error(`${res.status} ${res.statusText} from ${url.split("?")[0]}`);
    await sleep(3000 * attempt);
  }
}

// ---------- Directions ----------

interface Directions {
  source: string;
  coordinates: LonLat[];
  segmentMaxSpeedMps: (number | null)[]; // one per segment between coordinates, when known
}

async function fetchDirections(r: (typeof routesConfig.routes)[number]): Promise<Directions> {
  const pair = `${r.start.lon},${r.start.lat};${r.end.lon},${r.end.lat}`;
  if (MAPBOX_TOKEN) {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pair}?geometries=geojson&overview=full&annotations=maxspeed,distance&access_token=${MAPBOX_TOKEN}`;
    const json = await getJson(url);
    const route = json.routes[0];
    type MaxSpeed = { speed?: number; unit?: string; unknown?: boolean; none?: boolean };
    const maxspeed: MaxSpeed[] = route.legs.flatMap((leg: { annotation?: { maxspeed?: MaxSpeed[] } }) => leg.annotation?.maxspeed ?? []);
    return {
      source: "Mapbox Directions API",
      coordinates: route.geometry.coordinates,
      segmentMaxSpeedMps: maxspeed.map((m) =>
        m.unknown || m.none || !m.speed ? null : m.unit === "mph" ? m.speed * 0.44704 : m.speed / 3.6,
      ),
    };
  }
  const json = await getJson(`https://router.project-osrm.org/route/v1/driving/${pair}?overview=full&geometries=geojson`);
  return { source: "OSRM (OpenStreetMap routing)", coordinates: json.routes[0].geometry.coordinates, segmentMaxSpeedMps: [] };
}

// ---------- Elevation (Open-Meteo, no key) ----------

async function fetchElevation(points: LonLat[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += C.elevationBatchSize) {
    const batch = points.slice(i, i + C.elevationBatchSize);
    const lat = batch.map((p) => p[1].toFixed(5)).join(",");
    const lon = batch.map((p) => p[0].toFixed(5)).join(",");
    const json = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
    out.push(...json.elevation);
    await sleep(C.requestDelayMs);
  }
  return out;
}

// ---------- Roads, surfaces and stops (Overpass / OpenStreetMap, no key) ----------

interface OsmElement {
  type: "way" | "node";
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

async function fetchOverpass(points: LonLat[]): Promise<{ elements: OsmElement[] }> {
  const pad = 0.002;
  const s = Math.min(...points.map((p) => p[1])) - pad;
  const n = Math.max(...points.map((p) => p[1])) + pad;
  const w = Math.min(...points.map((p) => p[0])) - pad;
  const e = Math.max(...points.map((p) => p[0])) + pad;
  const bbox = `${s},${w},${n},${e}`;
  const query = `[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${bbox});
  node["highway"~"^(traffic_signals|stop)$"](${bbox});
);
out geom;`;
  return getJson("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
}

function parseMaxspeed(tag?: string): number | null {
  if (!tag) return null;
  const m = tag.match(/([\d.]+)\s*(mph)?/);
  if (!m) return null;
  return m[2] ? Number(m[1]) * 0.44704 : Number(m[1]) / 3.6;
}

// Find the nearest OpenStreetMap road for each route point, using a coarse grid so it stays fast.
function matchRoads(points: LonLat[], ways: OsmElement[]) {
  const cell = 0.001;
  const key = (lon: number, lat: number) => `${Math.floor(lon / cell)}:${Math.floor(lat / cell)}`;
  const grid = new Map<string, { a: LonLat; b: LonLat; tags: Record<string, string> }[]>();
  for (const way of ways) {
    const g = way.geometry ?? [];
    for (let i = 0; i < g.length - 1; i++) {
      const seg = { a: [g[i].lon, g[i].lat] as LonLat, b: [g[i + 1].lon, g[i + 1].lat] as LonLat, tags: way.tags ?? {} };
      const k = key((seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(seg);
    }
  }
  return points.map((p) => {
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
    let best: Record<string, string> | null = null;
    let bestD = C.roadSnapDistanceM;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const seg of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const d = pointToSegmentM(p, seg.a, seg.b);
          if (d < bestD) { bestD = d; best = seg.tags; }
        }
    return best;
  });
}

// ---------- Weather (Open-Meteo, no key) ----------

async function fetchWeather(p: LonLat): Promise<RouteWeather> {
  const json = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${p[1]}&longitude=${p[0]}&current=temperature_2m&hourly=precipitation,snowfall&past_days=1&forecast_days=1&timezone=UTC`,
  );
  const now = Date.now();
  let rain = 0, snow = 0;
  json.hourly.time.forEach((t: string, i: number) => {
    const age = now - Date.parse(t + "Z");
    if (age >= 0 && age <= 24 * 3600 * 1000) {
      rain += json.hourly.precipitation[i] ?? 0;
      snow += json.hourly.snowfall[i] ?? 0;
    }
  });
  return {
    temperatureC: json.current.temperature_2m,
    precipitationLast24hMm: Math.round(rain * 10) / 10,
    snowfallLast24hCm: Math.round(snow * 10) / 10,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------- Build one route ----------

async function buildRoute(r: (typeof routesConfig.routes)[number]): Promise<Route> {
  console.log(`\n${r.routeId}: ${r.name}`);
  const directions = await cached(`${r.routeId}.directions.json`, () => fetchDirections(r));
  const samples = resample(directions.coordinates, C.resampleSpacingM);
  const lonlats = samples.map((s) => s.lonlat);

  const rawElevation = await cached(`${r.routeId}.elevation.json`, () => fetchElevation(lonlats));
  const elevation = movingAverage(rawElevation, C.elevationSmoothingPoints);

  const osm = await cached(`${r.routeId}.overpass.json`, () => fetchOverpass(lonlats));
  const ways = osm.elements.filter((e) => e.type === "way");
  const stopNodes = osm.elements.filter((e) => e.type === "node");
  const roadTags = matchRoads(lonlats, ways);

  const weather = await cached(`${r.routeId}.weather.json`, () => fetchWeather(lonlats[Math.floor(lonlats.length / 2)]));

  const points: RoutePoint[] = samples.map((s, i) => {
    const tags = roadTags[i] ?? {};
    const surface = tags.surface ?? "asphalt";
    const roadClass = tags.highway ?? "unknown";
    const speedLimitMps =
      directions.segmentMaxSpeedMps[s.segment] ??
      parseMaxspeed(tags.maxspeed) ??
      C.speedByRoadClass[roadClass.replace("_link", "")] ??
      C.defaultSpeedLimitMps;
    const prev = Math.max(0, i - C.gradeSpanPoints), next = Math.min(samples.length - 1, i + C.gradeSpanPoints);
    const run = samples[next].distM - samples[prev].distM;
    const rawGrade = run > 0 ? ((elevation[next] - elevation[prev]) / run) * 100 : 0;
    const grade = Math.max(-C.maxGradePct, Math.min(C.maxGradePct, rawGrade));
    return {
      distM: Math.round(s.distM * 10) / 10,
      lat: Number(s.lonlat[1].toFixed(6)),
      lon: Number(s.lonlat[0].toFixed(6)),
      elevation: Math.round(elevation[i] * 10) / 10,
      grade: Math.round(grade * 100) / 100,
      speedLimitMps: Math.round(speedLimitMps * 10) / 10,
      roadClass,
      surface,
      unpaved: C.unpavedSurfaces.includes(surface),
      stop: null,
    };
  });

  // Snap traffic signals and stop signs to the closest route point, merging ones that are close together.
  let lastStopDist = -Infinity;
  const hits = stopNodes
    .map((node) => {
      let bestI = -1, bestD = C.stopSnapDistanceM;
      const p: LonLat = [node.lon!, node.lat!];
      for (let i = 0; i < points.length; i++) {
        const d = distanceM(p, [points[i].lon, points[i].lat]);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      return { i: bestI, kind: node.tags?.highway as "traffic_signals" | "stop" };
    })
    .filter((h) => h.i > 0)
    .sort((a, b) => a.i - b.i);
  for (const h of hits) {
    if (points[h.i].distM - lastStopDist < C.minStopSpacingM) continue;
    points[h.i].stop = h.kind;
    lastStopDist = points[h.i].distM;
  }
  points[points.length - 1].stop = "end";

  const route: Route = {
    routeId: r.routeId,
    name: r.name,
    terrain: r.terrain,
    city: routesConfig.city,
    distanceM: Math.round(points[points.length - 1].distM),
    points,
    weather,
    source: `${directions.source}; elevation and weather from Open-Meteo; roads and stops from OpenStreetMap`,
  };
  const climb = points.reduce((sum, p, i) => sum + (i ? Math.max(0, p.elevation - points[i - 1].elevation) : 0), 0);
  console.log(
    `  ${(route.distanceM / 1000).toFixed(1)} km, ${points.length} points, ` +
      `${points.filter((p) => p.stop && p.stop !== "end").length} stops, ${Math.round(climb)} m climb, ` +
      `${weather.temperatureC}°C, ${weather.precipitationLast24hMm} mm rain in 24 h`,
  );
  return route;
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(ROUTES_DIR, { recursive: true });
  console.log(MAPBOX_TOKEN ? "Using Mapbox Directions." : "No MAPBOX_TOKEN found, using the free OSRM router.");
  const index = [];
  for (const r of routesConfig.routes) {
    const route = await buildRoute(r);
    fs.writeFileSync(path.join(ROUTES_DIR, `${r.routeId}.json`), JSON.stringify(route));
    index.push({ routeId: route.routeId, name: route.name, terrain: route.terrain, distanceM: route.distanceM });
  }
  fs.writeFileSync(path.join(ROUTES_DIR, "index.json"), JSON.stringify(index, null, 2));
  console.log("\nDone. Route files are in data/routes/. Next: npm run generate-trips");
}

main().catch((err) => {
  console.error("\nSomething went wrong:", err.message);
  process.exit(1);
});
