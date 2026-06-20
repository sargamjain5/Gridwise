import type { PredictionGridCell, HotspotPrediction } from './types';

const EARTH_R = 6371000; // meters

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Gaussian kernel: weight decays with distance
function gaussianKernel(distance: number, bandwidth: number): number {
  const x = distance / bandwidth;
  return Math.exp(-0.5 * x * x);
}

export interface PredictionInput {
  lat: number;
  lon: number;
  hour: number;         // 0-23 IST
  dayOfWeek: number;    // 0=Sun..6=Sat
  parkingOccupancy: number; // 0-100%
  vehicleCount: number;     // estimated nearby vehicles
}

/**
 * Predict hotspot score for a single point.
 * Uses kernel density estimation with temporal weighting.
 */
export function predictHotspot(
  input: PredictionInput,
  grid: PredictionGridCell[],
): HotspotPrediction {
  const BANDWIDTH = 1200; // meters — spatial kernel bandwidth
  const MAX_RANGE = 3000; // only consider cells within 3km

  // ── 1. Spatial score (KDE) ──
  // Inverse-distance-weighted violation density from nearby grid cells
  let weightedSum = 0;
  let kernelSum = 0;
  let nearbyViolations = 0;
  let nearbyVehicles = 0;
  let hourlyWeightedSum = 0;
  let dailyWeightedSum = 0;

  for (const cell of grid) {
    const dist = haversineM(input.lat, input.lon, cell.lat, cell.lon);
    if (dist > MAX_RANGE) continue;

    const w = gaussianKernel(dist, BANDWIDTH);
    weightedSum += cell.totalCount * w;
    kernelSum += w;
    nearbyViolations += cell.totalCount * w;
    nearbyVehicles += cell.uniqueVehicles * w;

    // Temporal weighting: how much does this cell contribute at this hour/day?
    const totalH = cell.hourly.reduce((s, v) => s + v, 0) || 1;
    const hourRatio = cell.hourly[input.hour] / (totalH / 24); // >1 means above average for this hour
    hourlyWeightedSum += hourRatio * w * cell.totalCount;

    const totalD = cell.daily.reduce((s, v) => s + v, 0) || 1;
    const dayRatio = cell.daily[input.dayOfWeek] / (totalD / 7);
    dailyWeightedSum += dayRatio * w * cell.totalCount;
  }

  if (kernelSum === 0) {
    return {
      lat: input.lat, lon: input.lon, score: 0, level: 'low',
      spatialScore: 0, temporalScore: 0, contextualScore: 0,
      nearbyViolations: 0, expectedVehicles: 0,
    };
  }

  // Normalize spatial score to 0-100
  // Use the max possible weighted sum (from the densest cell at distance=0) as reference
  const maxCellCount = Math.max(...grid.map(c => c.totalCount), 1);
  const spatialRaw = weightedSum / kernelSum;
  const spatialScore = Math.min(100, (spatialRaw / maxCellCount) * 100);

  // ── 2. Temporal score ──
  // How much does the current hour/day amplify or dampen the spatial signal?
  const hourlyAvg = hourlyWeightedSum / (weightedSum || 1);
  const dailyAvg = dailyWeightedSum / (weightedSum || 1);
  // Temporal multiplier: 1.0 = average, >1 = hotter, <1 = cooler
  const temporalMultiplier = Math.max(0.2, Math.min(2.5, (hourlyAvg + dailyAvg) / 2));
  const temporalScore = Math.min(100, temporalMultiplier * 50);

  // ── 3. Contextual score (user-provided inputs) ──
  // Higher occupancy → more vehicles fighting for fewer spots → more violations
  const occupancyFactor = 0.4 + (input.parkingOccupancy / 100) * 0.8; // 0.4-1.2
  // Vehicle count: normalize against typical (assume 50 is average)
  const vehicleFactor = 0.5 + Math.min(1.5, (input.vehicleCount / 50) * 0.7); // 0.5-2.0
  const contextualScore = Math.min(100, (occupancyFactor * vehicleFactor) * 50);

  // ── Composite score ──
  // Spatial 45%, Temporal 30%, Contextual 25%
  const composite = spatialScore * 0.45 + temporalScore * 0.30 + contextualScore * 0.25;
  const score = Math.min(100, Math.max(0, Math.round(composite)));

  let level: HotspotPrediction['level'];
  if (score >= 75) level = 'critical';
  else if (score >= 50) level = 'high';
  else if (score >= 25) level = 'medium';
  else level = 'low';

  return {
    lat: input.lat,
    lon: input.lon,
    score,
    level,
    spatialScore: Math.round(spatialScore),
    temporalScore: Math.round(temporalScore),
    contextualScore: Math.round(contextualScore),
    nearbyViolations: Math.round(nearbyViolations / kernelSum),
    expectedVehicles: Math.round(nearbyVehicles / kernelSum),
  };
}

/**
 * Generate a prediction grid across a bounding box.
 * Returns predictions for a mesh of points to visualize on the map.
 */
export function generatePredictionMesh(
  grid: PredictionGridCell[],
  hour: number,
  dayOfWeek: number,
  parkingOccupancy: number,
  vehicleCount: number,
  resolution: number = 0.005, // ~500m grid step
): HotspotPrediction[] {
  // Bounding box of Bangalore with some padding
  const minLat = 12.85, maxLat = 13.10;
  const minLon = 77.48, maxLon = 77.72;

  const predictions: HotspotPrediction[] = [];

  for (let lat = minLat; lat <= maxLat; lat += resolution) {
    for (let lon = minLon; lon <= maxLon; lon += resolution) {
      const pred = predictHotspot(
        { lat, lon, hour, dayOfWeek, parkingOccupancy, vehicleCount },
        grid,
      );
      // Only include if score > 5 (skip empty areas)
      if (pred.score > 5) {
        predictions.push(pred);
      }
    }
  }

  return predictions;
}
