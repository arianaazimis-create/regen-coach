// Shared contract between all four streams (plan section 3).
// If you change anything in this file, tell the whole team right away.

export type Driver = "smooth" | "aggressive" | "mixed";
export type Condition = "dry" | "wet" | "snow" | "mud";
export type MissedCause = "late braking" | "low grip" | "full battery" | "cold battery";

// ---------- Route input (made by Stream 2, read by Stream 1's model) ----------

export interface RoutePoint {
  distM: number; // meters from route start
  lat: number;
  lon: number;
  elevation: number; // meters, smoothed
  grade: number; // percent slope, positive = uphill
  speedLimitMps: number; // meters per second
  roadClass: string; // OpenStreetMap highway tag, e.g. "primary", "residential"
  surface: string; // OpenStreetMap surface tag, e.g. "asphalt", "gravel"
  unpaved: boolean;
  stop: null | "traffic_signals" | "stop" | "end"; // the car must stop here
}

export interface RouteWeather {
  temperatureC: number;
  precipitationLast24hMm: number;
  snowfallLast24hCm: number;
  fetchedAt: string;
}

export interface Route {
  routeId: string; // "hill" | "flat" | "mixed"
  name: string;
  terrain: string;
  city: string;
  distanceM: number;
  points: RoutePoint[]; // about one every 10 meters
  weather: RouteWeather;
  source: string; // where the geometry came from
}

// ---------- Trip output (made by Stream 1's model, served by Stream 2) ----------

export interface TripHeader {
  tripId: string; // e.g. "hill-smooth-dry" or "hill-smooth-dry-noregen"
  routeId: string;
  driver: Driver;
  vehicle: string;
  condition: Condition;
  regenEnabled: boolean;
  distanceM: number;
  simulated: true; // always true: label as simulated in the UI
}

export interface TripSample {
  t: number; // seconds since start
  lat: number;
  lon: number;
  speed: number; // m/s
  elevation: number; // m
  grade: number; // percent
  brake: number; // 0..1
  regenKw: number;
  frictionKw: number;
  soc?: number; // 0..1
  missed: MissedCause | null;
}

export interface MissedEvent {
  t: number;
  lat: number;
  lon: number;
  cause: MissedCause;
  lostKwh: number;
}

export interface TripSummary {
  score: number; // 0..100
  label: string; // plain-word label, e.g. "Efficient"
  energyRecoveredKwh: number;
  energyCeilingKwh: number; // the most this trip's braking could have recovered
  theoreticalKwh?: number; // cheat-sheet ceiling: eta * (descent energy + stop kinetic energy)
  brakeHeatKwh: number;
  regenSharePct: number; // share of braking energy handled by regen
  missedEvents: MissedEvent[];
  gallonsSaved: number;
  dollarsSaved: number;
  co2AvoidedKg: number;
  fuelUsedGallons: number;
  fuelCostDollars: number;
  co2Kg: number;
  moneyLeftOnTableDollars: number;
  durationS: number;
  estimate: true; // always true: label as an estimate in the UI
}

export interface CoachingTip {
  text: string;
  source: "claude" | "rules";
  basedOn: string[]; // the facts the tip was written from (the "credit line")
}

export interface Trip {
  header: TripHeader;
  samples: TripSample[];
  summary: TripSummary;
  coaching?: CoachingTip;
}

// What Stream 1's model must export from lib/physics/index.ts
export type SimulateTrip = (
  route: Route,
  driver: Driver,
  condition: Condition,
  options: { regenEnabled: boolean },
) => Trip;
