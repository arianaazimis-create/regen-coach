// GET /api/trips/hill-smooth-dry               the full trip: header, samples, summary, coaching
// GET /api/trips/hill-smooth-dry?samples=false  same without the per-second samples

import type { NextRequest } from "next/server";
import { getTrip } from "@/lib/data/store";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/trips/[id]">) {
  const { id } = await ctx.params;
  const trip = await getTrip(id);
  if (!trip) return Response.json({ error: `No trip called "${id}". See /api/trips for the list.` }, { status: 404 });
  if (request.nextUrl.searchParams.get("samples") === "false") {
    return Response.json({ ...trip, samples: undefined });
  }
  return Response.json(trip);
}
