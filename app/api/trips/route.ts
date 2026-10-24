// GET /api/trips                      every trip (header + score, no samples)
// GET /api/trips?route=hill&condition=wet&driver=smooth&regen=true   filter by any of these

import type { NextRequest } from "next/server";
import { listTrips } from "@/lib/data/store";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const trips = (await listTrips()).filter(
    (t) =>
      (!q.get("route") || t.routeId === q.get("route")) &&
      (!q.get("driver") || t.driver === q.get("driver")) &&
      (!q.get("condition") || t.condition === q.get("condition")) &&
      (!q.get("regen") || String(t.regenEnabled) === q.get("regen")),
  );
  return Response.json({ simulated: true, count: trips.length, trips });
}
