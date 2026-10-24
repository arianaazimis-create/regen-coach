// Reads the cached route and trip JSON from data/. No live API calls at demo time.

import fs from "node:fs/promises";
import path from "node:path";
import type { Condition, Driver, Route, Trip, TripHeader } from "../trip-types";

const DATA_DIR = path.join(process.cwd(), "data");
const SAFE_ID = /^[a-z0-9-]+$/;

export type TripIndexEntry = TripHeader & { score: number; label: string; hasCoaching: boolean };

async function readJson<T>(...parts: string[]): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, ...parts), "utf8"));
  } catch {
    return null;
  }
}

export async function listTrips(): Promise<TripIndexEntry[]> {
  return (await readJson<TripIndexEntry[]>("trips", "index.json")) ?? [];
}

export async function getTrip(tripId: string): Promise<Trip | null> {
  if (!SAFE_ID.test(tripId) || tripId === "index") return null;
  return readJson<Trip>("trips", `${tripId}.json`);
}

export async function listRoutes() {
  return (await readJson<{ routeId: string; name: string; terrain: string; distanceM: number }[]>("routes", "index.json")) ?? [];
}

export async function getRoute(routeId: string): Promise<Route | null> {
  if (!SAFE_ID.test(routeId) || routeId === "index") return null;
  return readJson<Route>("routes", `${routeId}.json`);
}

export function tripId(routeId: string, driver: Driver, condition: Condition, regenEnabled = true) {
  return `${routeId}-${driver}-${condition}${regenEnabled ? "" : "-noregen"}`;
}
