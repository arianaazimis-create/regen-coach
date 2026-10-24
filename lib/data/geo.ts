// Small geometry helpers. Coordinates are [lon, lat] like GeoJSON.

export type LonLat = [number, number];

const R = 6371000; // Earth radius in meters
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Walk along a line and drop a point every `spacing` meters.
// Returns each point with its distance from the start and the index of the original segment it sits on.
export function resample(line: LonLat[], spacing: number) {
  const out: { lonlat: LonLat; distM: number; segment: number }[] = [{ lonlat: line[0], distM: 0, segment: 0 }];
  let travelled = 0;
  let nextAt = spacing;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = distanceM(a, b);
    while (len > 0 && nextAt <= travelled + len) {
      const f = (nextAt - travelled) / len;
      out.push({ lonlat: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], distM: nextAt, segment: i });
      nextAt += spacing;
    }
    travelled += len;
  }
  const last = line[line.length - 1];
  if (travelled - out[out.length - 1].distM > 1) out.push({ lonlat: last, distM: travelled, segment: line.length - 2 });
  return out;
}

// Distance from point p to the segment a-b, in meters (flat-earth approximation, fine at city scale).
export function pointToSegmentM(p: LonLat, a: LonLat, b: LonLat): number {
  const kx = Math.cos(rad(p[1])) * 111320;
  const ky = 110540;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const x = ax + t * dx, y = ay + t * dy;
  return Math.sqrt(x * x + y * y);
}

export function movingAverage(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      sum += values[j];
      n++;
    }
    return sum / n;
  });
}
