// GET /api/routes   the three demo routes (id, name, terrain, distance)

import { listRoutes } from "@/lib/data/store";

export async function GET() {
  return Response.json({ routes: await listRoutes() });
}
