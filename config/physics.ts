// Tunable physics numbers (plan section 6). Approximate starting values, not official Toyota specs.
// Stream 1 owns this file once their model lands; the stand-in model reads it too.

export const VEHICLE = {
  name: "Camry Hybrid",
  massKg: 1650,
  dragCoefficient: 0.28,
  frontalAreaM2: 2.2,
  regenEfficiency: 0.65, // motor and battery round trip
  maxRegenKw: 30,
  drivenAxleWeightShare: 0.6, // front-wheel drive
  regenGripMargin: 0.5, // stability control keeps regen braking well inside the tire grip limit
  batteryUsableKwh: 1.0,
  startSoc: 0.55,
  socFadeStart: 0.8, // above this, the battery accepts less charge (linear fade to zero at 100 %)
  minSoc: 0.4,
  electricAssistShare: 0.2, // share of propulsion power the battery supplies while above minSoc
  coldBatteryFactor: 0.5, // regen power limit multiplier below freezing
};

export const SURFACES = {
  dry: { friction: 0.8, rollingResistance: 0.01 },
  wet: { friction: 0.5, rollingResistance: 0.012 },
  snow: { friction: 0.25, rollingResistance: 0.018 },
  ice: { friction: 0.1, rollingResistance: 0.015 },
  gravel: { friction: 0.5, rollingResistance: 0.02 },
  mud: { friction: 0.25, rollingResistance: 0.04 },
};

// How each condition changes the scenario
export const CONDITIONS = {
  dry: { surface: "dry", speedFactor: 1.0, decelFactor: 1.0, temperatureC: null as number | null },
  wet: { surface: "wet", speedFactor: 0.92, decelFactor: 0.95, temperatureC: null as number | null },
  snow: { surface: "snow", speedFactor: 0.75, decelFactor: 0.85, temperatureC: -3 as number | null },
  mud: { surface: "mud", speedFactor: 0.8, decelFactor: 0.85, temperatureC: null as number | null },
} as const;

export const DRIVERS = {
  smooth: { speedFactor: 0.95, accelMps2: 1.2, decelMps2: 1.3, hardStopEvery: 0 },
  aggressive: { speedFactor: 1.1, accelMps2: 2.8, decelMps2: 4.0, hardStopEvery: 1 },
  mixed: { speedFactor: 1.0, accelMps2: 1.8, decelMps2: 1.6, hardStopEvery: 3 }, // every 3rd stop is a hard stop
};

export const STOPS = {
  signalStopsEvery: 2, // the car catches a red at every 2nd traffic signal
  signalDwellS: 15,
  stopSignDwellS: 2,
};

export const SAVINGS = {
  kwhPerGallon: 33.7,
  engineEfficiency: 0.3,
  gasPriceDollars: 3.0,
  co2KgPerGallon: 8.9,
};

export const GRAVITY = 9.81;
export const AIR_DENSITY_15C = 1.225;
