// STAND-IN MODEL written by Stream 2 so trips can be generated before Stream 1's model is ready.
// Stream 1: replace this file with your model. Keep exporting `simulateTrip` with the same
// signature (see SimulateTrip in lib/trip-types.ts) and the generator will pick it up.
//
// Follows the plan's physics cheat sheet: forces on the car, regen and friction split,
// grip cap, battery fade, and score = recovered energy / recoverable ceiling.

import { AIR_DENSITY_15C, CONDITIONS, DRIVERS, GRAVITY, SAVINGS, STOPS, SURFACES, VEHICLE as V } from "../../config/physics";
import type { MissedCause, MissedEvent, SimulateTrip, Trip, TripSample } from "../trip-types";

interface Step {
  t0: number; t1: number; // seconds
  i0: number; i1: number; // route point indices (equal for a dwell at a stop)
  v0: number; v1: number;
  brakeWheelKw: number; regenKw: number; frictionKw: number; brake: number; soc: number;
  missed: MissedCause | null;
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export const simulateTrip: SimulateTrip = (route, driver, condition, { regenEnabled }) => {
  const pts = route.points;
  const d = DRIVERS[driver];
  const c = CONDITIONS[condition];
  const surface = SURFACES[c.surface];
  const temperatureC = c.temperatureC ?? route.weather.temperatureC;
  const airDensity = AIR_DENSITY_15C * (288.15 / (273.15 + temperatureC));
  const m = V.massKg;
  const gripDecel = surface.friction * GRAVITY; // whole-car limit
  const regenGripDecel = surface.friction * GRAVITY * V.drivenAxleWeightShare * V.regenGripMargin; // driven wheels only

  // 1. Which stops does the car actually stop at, and how hard does it brake for each?
  const stopAt = new Map<number, { dwell: number; decel: number }>();
  let signalCount = 0, stopCount = 0;
  pts.forEach((p, i) => {
    if (!p.stop) return;
    if (p.stop === "traffic_signals" && signalCount++ % STOPS.signalStopsEvery !== 0) return;
    stopCount++;
    const hard = d.hardStopEvery > 0 && stopCount % d.hardStopEvery === 0;
    const decel = (hard ? DRIVERS.aggressive.decelMps2 : d.decelMps2) * c.decelFactor;
    stopAt.set(i, {
      dwell: p.stop === "traffic_signals" ? STOPS.signalDwellS : p.stop === "stop" ? STOPS.stopSignDwellS : 0,
      decel: Math.min(decel, gripDecel * 0.95),
    });
  });

  // 2. Speed profile on the 10 m grid: target speed, then braking (backward) and acceleration (forward) limits.
  const v = pts.map((p) => p.speedLimitMps * d.speedFactor * c.speedFactor);
  v[0] = 0;
  stopAt.forEach((_, i) => (v[i] = 0));
  let decel = d.decelMps2;
  for (let i = pts.length - 2; i >= 0; i--) {
    if (stopAt.has(i + 1)) decel = stopAt.get(i + 1)!.decel;
    const ds = pts[i + 1].distM - pts[i].distM;
    v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * decel * ds));
  }
  const accel = d.accelMps2 * Math.min(1, c.decelFactor + 0.15);
  for (let i = 1; i < pts.length; i++) {
    const ds = pts[i].distM - pts[i - 1].distM;
    v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * accel * ds));
  }

  // 3. Power at each step: how much braking the road asks for, and how it splits between regen and friction.
  const steps: Step[] = [];
  let t = 0, soc = V.startSoc;
  let eRegen = 0, eFriction = 0, eBrakeWheel = 0, ePropulsion = 0, eDescent = 0, eStops = 0;
  let peakSinceStop = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ds = pts[i + 1].distM - pts[i].distM;
    const v0 = v[i], v1 = v[i + 1];
    const vAvg = Math.max((v0 + v1) / 2, 0.3);
    const dt = ds / vAvg;
    const a = (v1 ** 2 - v0 ** 2) / (2 * ds);
    const theta = Math.atan(pts[i].grade / 100);
    const force =
      m * GRAVITY * Math.sin(theta) +
      surface.rollingResistance * m * GRAVITY * Math.cos(theta) +
      0.5 * airDensity * V.dragCoefficient * V.frontalAreaM2 * vAvg ** 2 +
      m * a;
    const powerKw = (force * vAvg) / 1000;

    let brakeWheelKw = 0, regenKw = 0, frictionKw = 0;
    let missed: MissedCause | null = null;
    if (powerKw < 0) {
      brakeWheelKw = -powerKw;
      if (regenEnabled) {
        const gripKw = (m * regenGripDecel * vAvg) / 1000;
        const fade = soc <= V.socFadeStart ? 1 : Math.max(0, (1 - soc) / (1 - V.socFadeStart));
        const cold = temperatureC < 0 ? V.coldBatteryFactor : 1;
        const batteryKw = V.maxRegenKw * fade * cold;
        const limits: [number, MissedCause][] = [
          [V.maxRegenKw, "late braking"],
          [gripKw, "low grip"],
          [batteryKw, temperatureC < 0 && fade > 0.5 ? "cold battery" : "full battery"],
        ];
        const motorKw = Math.min(brakeWheelKw, ...limits.map((l) => l[0]));
        regenKw = motorKw * V.regenEfficiency;
        frictionKw = brakeWheelKw - motorKw;
        if (frictionKw > 0.5) missed = limits.reduce((lo, l) => (l[0] < lo[0] ? l : lo))[1];
        soc = Math.min(1, soc + (regenKw * dt) / 3600 / V.batteryUsableKwh);
      } else {
        frictionKw = brakeWheelKw;
      }
    } else {
      ePropulsion += (powerKw * dt) / 3600;
      if (regenEnabled && soc > V.minSoc)
        soc = Math.max(V.minSoc, soc - (powerKw * V.electricAssistShare * dt) / 3600 / V.batteryUsableKwh);
    }

    eRegen += (regenKw * dt) / 3600;
    eFriction += (frictionKw * dt) / 3600;
    eBrakeWheel += (brakeWheelKw * dt) / 3600;
    eDescent += Math.max(0, pts[i].elevation - pts[i + 1].elevation) * m * GRAVITY / 3.6e6;
    peakSinceStop = Math.max(peakSinceStop, v0);
    const gripUsed = brakeWheelKw > 0 ? (brakeWheelKw * 1000) / vAvg / (m * gripDecel) : 0;
    steps.push({
      t0: t, t1: t + dt, i0: i, i1: i + 1, v0, v1, brakeWheelKw, regenKw, frictionKw,
      brake: Math.min(1, gripUsed), soc, missed,
    });
    t += dt;

    const stop = stopAt.get(i + 1);
    if (stop) {
      eStops += 0.5 * m * peakSinceStop ** 2 / 3.6e6;
      peakSinceStop = 0;
      if (stop.dwell > 0) {
        steps.push({ t0: t, t1: t + stop.dwell, i0: i + 1, i1: i + 1, v0: 0, v1: 0, brakeWheelKw: 0, regenKw: 0, frictionKw: 0, brake: 0.3, soc, missed: null });
        t += stop.dwell;
      }
    }
  }

  // 4. Resample to one sample per second for the map replay and charts.
  const samples: TripSample[] = [];
  let k = 0;
  for (let s = 0; s <= Math.floor(t); s++) {
    while (k < steps.length - 1 && steps[k].t1 < s) k++;
    const st = steps[k];
    const f = st.t1 > st.t0 ? Math.min(1, Math.max(0, (s - st.t0) / (st.t1 - st.t0))) : 0;
    const p0 = pts[st.i0], p1 = pts[st.i1];
    // A missed opportunity shorter than a second still shows up on the nearest sample
    const nearby = steps.slice(Math.max(0, k - 2), k + 3).find((x) => x.missed && x.t1 > s - 0.5 && x.t0 <= s + 0.5);
    samples.push({
      t: s,
      lat: round(p0.lat + (p1.lat - p0.lat) * f, 6),
      lon: round(p0.lon + (p1.lon - p0.lon) * f, 6),
      speed: round(st.v0 + (st.v1 - st.v0) * f),
      elevation: round(p0.elevation + (p1.elevation - p0.elevation) * f, 1),
      grade: p0.grade,
      brake: round(st.brake),
      regenKw: round(st.regenKw),
      frictionKw: round(st.frictionKw),
      soc: regenEnabled ? round(st.soc, 3) : undefined,
      missed: nearby?.missed ?? null,
    });
  }

  // 5. Group missed steps into events (one per braking episode) for the map markers.
  const missedEvents: MissedEvent[] = [];
  let current: (MissedEvent & { causes: Record<string, number> }) | null = null;
  for (const st of steps) {
    if (st.missed) {
      const lostKwh = (st.frictionKw * V.regenEfficiency * (st.t1 - st.t0)) / 3600;
      if (!current) {
        current = { t: round(st.t0, 0), lat: pts[st.i0].lat, lon: pts[st.i0].lon, cause: st.missed, lostKwh: 0, causes: {} };
      }
      current.lostKwh += lostKwh;
      current.causes[st.missed] = (current.causes[st.missed] ?? 0) + lostKwh;
    } else if (current && st.brakeWheelKw === 0) {
      const { causes, ...event } = current;
      event.cause = Object.entries(causes).sort((x, y) => y[1] - x[1])[0][0] as MissedCause;
      event.lostKwh = round(event.lostKwh, 4);
      if (event.lostKwh >= 0.001) missedEvents.push(event);
      current = null;
    }
  }

  // 6. Summary and savings.
  // Ceiling: what a perfect regen system (no power, grip or battery limits) would have recovered
  // from the braking this trip needed. The cheat-sheet version, eta * (descent + stop energy), is kept
  // as theoreticalKwh for reference; it ignores drag and rolling losses, so even ideal driving scored ~60.
  const ceiling = V.regenEfficiency * eBrakeWheel;
  const theoreticalKwh = V.regenEfficiency * (eDescent + eStops);
  const score = regenEnabled ? Math.round(Math.min(100, (100 * eRegen) / Math.max(ceiling, 1e-6))) : 0;
  const usefulKwhPerGallon = SAVINGS.kwhPerGallon * SAVINGS.engineEfficiency;
  const gallonsSaved = eRegen / usefulKwhPerGallon;
  const fuelUsed = Math.max(0, ePropulsion / usefulKwhPerGallon - gallonsSaved);
  const lostKwh = missedEvents.reduce((sum, e) => sum + e.lostKwh, 0);
  const label = !regenEnabled
    ? "No regen (conventional car)"
    : score >= 80 ? "Efficient" : score >= 60 ? "Good" : score >= 40 ? "Room to improve" : "Leaving energy on the road";

  const trip: Trip = {
    header: {
      tripId: `${route.routeId}-${driver}-${condition}${regenEnabled ? "" : "-noregen"}`,
      routeId: route.routeId,
      driver,
      vehicle: V.name,
      condition,
      regenEnabled,
      distanceM: route.distanceM,
      simulated: true,
    },
    samples,
    summary: {
      score,
      label,
      energyRecoveredKwh: round(eRegen, 3),
      energyCeilingKwh: round(ceiling, 3),
      theoreticalKwh: round(theoreticalKwh, 3),
      brakeHeatKwh: round(eFriction, 3),
      regenSharePct: eBrakeWheel > 0 ? Math.round((100 * (eBrakeWheel - eFriction)) / eBrakeWheel) : 0,
      missedEvents,
      gallonsSaved: round(gallonsSaved, 4),
      dollarsSaved: round(gallonsSaved * SAVINGS.gasPriceDollars, 3),
      co2AvoidedKg: round(gallonsSaved * SAVINGS.co2KgPerGallon, 3),
      fuelUsedGallons: round(fuelUsed, 4),
      fuelCostDollars: round(fuelUsed * SAVINGS.gasPriceDollars, 3),
      co2Kg: round(fuelUsed * SAVINGS.co2KgPerGallon, 3),
      moneyLeftOnTableDollars: round((lostKwh / usefulKwhPerGallon) * SAVINGS.gasPriceDollars, 3),
      durationS: Math.round(t),
      estimate: true,
    },
  };
  return trip;
};
