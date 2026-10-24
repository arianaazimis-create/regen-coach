// GET /api/compare?route=hill&condition=wet
// The three compare-mode columns on the same route and condition:
//   conventional = smooth driver with regen switched off (only one variable changes vs the smooth column)
//   smooth, aggressive = hybrid with regen on
// Add &samples=true to include the per-second samples for drawing all three on the map.

import type { NextRequest } from "next/server";
import { getTrip, tripId } from "@/lib/data/store";
import type { Condition } from "@/lib/trip-types";

const CONDITIONS = ["dry", "wet", "snow", "mud"];

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const route = q.get("route") ?? "hill";
  const condition = (q.get("condition") ?? "dry") as Condition;
  const withSamples = q.get("samples") === "true";
  if (!CONDITIONS.includes(condition))
    return Response.json({ error: `condition must be one of ${CONDITIONS.join(", ")}` }, { status: 400 });

  const ids = {
    conventional: tripId(route, "smooth", condition, false),
    smooth: tripId(route, "smooth", condition),
    aggressive: tripId(route, "aggressive", condition),
  };
  const columns: Record<string, unknown> = {};
  for (const [column, id] of Object.entries(ids)) {
    const trip = await getTrip(id);
    if (!trip) return Response.json({ error: `Missing trip "${id}". Run npm run data.` }, { status: 404 });
    const s = trip.summary;
    columns[column] = {
      tripId: id,
      header: trip.header,
      coaching: trip.coaching,
      // The rows of the compare table, in the order the plan lists them
      rows: {
        energyRecoveredKwh: s.energyRecoveredKwh,
        brakeHeatKwh: s.brakeHeatKwh,
        fuelUsedGallons: s.fuelUsedGallons,
        fuelCostDollars: s.fuelCostDollars,
        co2Kg: s.co2Kg,
        regenSharePct: s.regenSharePct,
        score: s.score,
      },
      summary: s,
      ...(withSamples ? { samples: trip.samples } : {}),
    };
  }
  return Response.json({ simulated: true, estimate: true, route, condition, columns });
}
