// Step 2 of the data pipeline: run the physics model for every route, driver and condition.
//
//   npm run generate-trips
//
// Reads data/routes/*.json, writes data/trips/<tripId>.json and data/trips/index.json.
// Keeps any coaching tips already written by `npm run coach`, so you can re-run this freely.

import fs from "node:fs";
import path from "node:path";
import { simulateTrip } from "../lib/physics";
import type { Condition, Driver, Route, Trip } from "../lib/trip-types";

const ROUTES_DIR = path.join(process.cwd(), "data", "routes");
const TRIPS_DIR = path.join(process.cwd(), "data", "trips");
const DRIVERS: Driver[] = ["smooth", "aggressive", "mixed"];
const CONDITIONS: Condition[] = ["dry", "wet", "snow", "mud"];

fs.mkdirSync(TRIPS_DIR, { recursive: true });
const routeIndex: { routeId: string }[] = JSON.parse(fs.readFileSync(path.join(ROUTES_DIR, "index.json"), "utf8"));
const index = [];

for (const { routeId } of routeIndex) {
  const route: Route = JSON.parse(fs.readFileSync(path.join(ROUTES_DIR, `${routeId}.json`), "utf8"));
  console.log(`\n${route.name}`);
  for (const condition of CONDITIONS) {
    const line: string[] = [];
    for (const driver of DRIVERS) {
      for (const regenEnabled of [true, false]) {
        const trip: Trip = simulateTrip(route, driver, condition, { regenEnabled });
        const file = path.join(TRIPS_DIR, `${trip.header.tripId}.json`);
        if (fs.existsSync(file)) {
          const old: Trip = JSON.parse(fs.readFileSync(file, "utf8"));
          if (old.coaching) trip.coaching = old.coaching;
        }
        fs.writeFileSync(file, JSON.stringify(trip));
        index.push({ ...trip.header, score: trip.summary.score, label: trip.summary.label, hasCoaching: !!trip.coaching });
        if (regenEnabled) line.push(`${driver} ${trip.summary.score}`);
      }
    }
    console.log(`  ${condition.padEnd(5)} scores: ${line.join(", ")}`);
  }
}

fs.writeFileSync(path.join(TRIPS_DIR, "index.json"), JSON.stringify(index, null, 2));
console.log(`\nWrote ${index.length} trips to data/trips/. Next: npm run coach`);
