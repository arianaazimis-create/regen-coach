// Step 3 of the data pipeline: write an AI coaching tip into every regen trip.
//
//   npm run coach            only trips without a tip yet
//   npm run coach -- --all   rewrite every tip
//
// Uses Claude when ANTHROPIC_API_KEY is set in .env.local. Without a key it writes
// simple rule-based tips, so the app always has something to show.

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_CONFIG } from "../config/data";
import type { CoachingTip, Route, Trip } from "../lib/trip-types";

const TRIPS_DIR = path.join(process.cwd(), "data", "trips");
const ROUTES_DIR = path.join(process.cwd(), "data", "routes");
const ALL = process.argv.includes("--all");
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const SYSTEM = `You are Regen Coach, a friendly driving coach for Toyota Camry Hybrid drivers.
You get facts about one simulated trip. Write one coaching tip of at most two short sentences that tells the
driver the single most useful thing to do differently next time to recover more braking energy.
Use only the numbers you are given, round them, and do not invent new ones. Plain text, no lists or markdown.`;

// The facts the tip is based on. These also become the tip's credit line in the UI.
function facts(trip: Trip, route: Route): string[] {
  const s = trip.summary;
  const causes: Record<string, number> = {};
  for (const e of s.missedEvents) causes[e.cause] = (causes[e.cause] ?? 0) + 1;
  const causeList = Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n}x ${c}`).join(", ");
  return [
    `Route: ${route.name} (${route.terrain}, ${(route.distanceM / 1000).toFixed(1)} km)`,
    `Driver profile: ${trip.header.driver}; road condition: ${trip.header.condition}`,
    `Score: ${s.score}/100 (${s.label})`,
    `Recovered ${s.energyRecoveredKwh} kWh of a possible ${s.energyCeilingKwh} kWh; ${s.regenSharePct}% of braking went to regen`,
    `Energy lost as brake heat: ${s.brakeHeatKwh} kWh`,
    `Missed regen events: ${s.missedEvents.length}${causeList ? ` (${causeList})` : ""}`,
    `Money left on the table: $${s.moneyLeftOnTableDollars.toFixed(2)} this trip`,
  ];
}

const ROAD_WORD = { dry: "dry", wet: "wet", snow: "snowy", mud: "muddy" };

function ruleTip(trip: Trip): string {
  const s = trip.summary;
  const counts: Record<string, number> = {};
  for (const e of s.missedEvents) counts[e.cause] = (counts[e.cause] ?? 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!top || s.score >= 95) return `Great trip: ${s.regenSharePct}% of your braking went back into the battery. Keep easing off early before stops.`;
  if (top === "late braking") return `${counts[top]} stops were braked too hard for regen to keep up. Lift off earlier and brake gently to turn more of that energy into charge.`;
  if (top === "low grip") return `On ${ROAD_WORD[trip.header.condition]} roads the car limits regen to keep the tires gripping. Start slowing sooner and more gently so more of your braking can be regen.`;
  if (top === "full battery") return `The battery filled up on the long descents, so the friction brakes took over. Using a little electric power before a big hill leaves room to recover more.`;
  return `A cold battery accepts less charge, so regen was capped. Gentle, early braking still recovers the most energy in the cold.`;
}

async function claudeTip(basedOn: string[]): Promise<string> {
  const response = await client!.beta.messages.create({
    model: CLAUDE_CONFIG.model,
    max_tokens: CLAUDE_CONFIG.maxTokens,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: basedOn.join("\n") }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
  if (!text) throw new Error("empty response");
  return text;
}

async function main() {
  console.log(client ? `Writing tips with ${CLAUDE_CONFIG.model}.` : "No ANTHROPIC_API_KEY found, writing rule-based tips.");
  const routes = new Map<string, Route>();
  const index = JSON.parse(fs.readFileSync(path.join(TRIPS_DIR, "index.json"), "utf8"));
  let written = 0;
  for (const entry of index) {
    if (!entry.regenEnabled) continue;
    const file = path.join(TRIPS_DIR, `${entry.tripId}.json`);
    const trip: Trip = JSON.parse(fs.readFileSync(file, "utf8"));
    if (trip.coaching && !ALL && !(client && trip.coaching.source === "rules")) continue;
    if (!routes.has(entry.routeId))
      routes.set(entry.routeId, JSON.parse(fs.readFileSync(path.join(ROUTES_DIR, `${entry.routeId}.json`), "utf8")));
    const basedOn = facts(trip, routes.get(entry.routeId)!);
    let tip: CoachingTip = { text: ruleTip(trip), source: "rules", basedOn };
    if (client) {
      try {
        tip = { text: await claudeTip(basedOn), source: "claude", basedOn };
      } catch (err) {
        console.warn(`  ${entry.tripId}: Claude failed (${(err as Error).message}), using a rule-based tip`);
      }
    }
    trip.coaching = tip;
    fs.writeFileSync(file, JSON.stringify(trip));
    entry.hasCoaching = true;
    written++;
    console.log(`  ${entry.tripId}: ${tip.text}`);
  }
  fs.writeFileSync(path.join(TRIPS_DIR, "index.json"), JSON.stringify(index, null, 2));
  console.log(`\nWrote ${written} tips.`);
}

main().catch((err) => {
  console.error("\nSomething went wrong:", err.message);
  process.exit(1);
});
