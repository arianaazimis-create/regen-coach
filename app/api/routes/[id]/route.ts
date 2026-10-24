// GET /api/routes/hill   one route with every 10 m point: position, elevation, grade, speed limit, surface, stops

import { getRoute } from "@/lib/data/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/routes/[id]">) {
  const { id } = await ctx.params;
  const route = await getRoute(id);
  if (!route) return Response.json({ error: `No route called "${id}". See /api/routes.` }, { status: 404 });
  return Response.json(route);
}
