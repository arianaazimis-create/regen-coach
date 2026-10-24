// Every tunable number for the data side (Stream 2) lives here.

export const DATA_CONFIG = {
  resampleSpacingM: 10, // one route point every N meters
  elevationSmoothingPoints: 9, // moving-average window, smooths the 90 m elevation grid
  gradeSpanPoints: 4, // grade is measured over this many points before and after (4 = 80 m run)
  maxGradePct: 15, // clamp: steeper values come from elevation-grid noise, not real roads
  stopSnapDistanceM: 20, // a traffic signal or stop sign this close to the route counts as a stop
  roadSnapDistanceM: 40, // nearest OpenStreetMap road within this distance gives surface and speed limit
  minStopSpacingM: 60, // merge stops closer than this (one intersection often has several signals)
  defaultSpeedLimitMps: 13.4, // 30 mph, used when no speed limit is tagged
  // Speed limit guess by road class when OpenStreetMap has no maxspeed tag (m/s)
  speedByRoadClass: {
    motorway: 29, trunk: 24.6, primary: 17.9, secondary: 15.6, tertiary: 13.4,
    residential: 11.2, unclassified: 11.2, service: 6.7,
  } as Record<string, number>,
  unpavedSurfaces: ["unpaved", "gravel", "dirt", "ground", "earth", "mud", "sand", "compacted", "fine_gravel", "grass"],
  // Pacing for free public APIs
  elevationBatchSize: 100,
  requestDelayMs: 1100,
};

export const CLAUDE_CONFIG = {
  model: "claude-opus-5-5",
  maxTokens: 2000,
};
