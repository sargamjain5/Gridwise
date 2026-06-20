import type { DashboardMetrics, CongestionScoreEntry, ForecastEntry, GridCell, JunctionHotspot } from './types';

// ── Parking Zone ──
export interface ParkingZone {
  id: string;
  name: string;
  station: string;
  lat: number;
  lon: number;
  type: 'no-parking' | 'high-risk' | 'available';
  congestionScore: number;
  riskLevel: 'critical' | 'high' | 'moderate' | 'low';
  // Simulated occupancy based on historical violation density + time of day
  occupancyPct: number;
  availableSpots: number;
  totalSpots: number;
  currentHourRisk: 'high' | 'medium' | 'low';
}

// ── Parking Recommendation ──
export interface ParkingRecommendation {
  zone: ParkingZone;
  walkingDistanceM: number;
  walkingTimeMin: number;
  congestionLevel: 'low' | 'medium' | 'high';
  enforcementRisk: 'low' | 'medium' | 'high';
  score: number; // 0-100, higher = better recommendation
  reason: string;
}

// ── Incentive ──
export interface Incentive {
  id: string;
  title: string;
  description: string;
  pointsCost: number;
  icon: string; // emoji
  category: 'transit' | 'parking' | 'reward';
}

export interface UserReward {
  totalPoints: number;
  level: string;
  streak: number;
  tripsUsingRecommendation: number;
  co2Saved: number; // kg
  availableIncentives: Incentive[];
  history: { date: string; action: string; points: number }[];
}

// ── Build parking zones from metrics ──
export function buildParkingZones(metrics: DashboardMetrics): ParkingZone[] {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const currentHour = now.getUTCHours();
  const currentDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getUTCDay()];

  // Build forecast lookup for current time
  const forecastMap = new Map<string, ForecastEntry>();
  for (const f of metrics.forecastLookup) {
    if (f.day === currentDay && f.hour === currentHour) {
      forecastMap.set(f.station, f);
    }
  }

  const zones: ParkingZone[] = [];

  // From congestion scores (junctions with known high violations = no-parking / high-risk)
  for (const c of metrics.congestionScores) {
    const forecast = forecastMap.get(c.station);
    const currentRisk = forecast?.risk || 'low';

    // Simulate occupancy: high congestion = high occupancy
    const baseOccupancy = Math.min(95, 40 + c.score * 0.55);
    // Time-of-day adjustment
    const hourFactor = currentRisk === 'high' ? 1.15 : currentRisk === 'medium' ? 1.0 : 0.75;
    const occupancy = Math.min(98, Math.round(baseOccupancy * hourFactor));
    const totalSpots = Math.round(20 + Math.random() * 80); // simulated
    const availableSpots = Math.max(0, Math.round(totalSpots * (1 - occupancy / 100)));

    zones.push({
      id: `zone-${c.junction.replace(/\s+/g, '-').toLowerCase()}`,
      name: c.junction,
      station: c.station,
      lat: 0, lon: 0, // will be filled from grid
      type: c.riskLevel === 'critical' ? 'no-parking' : c.riskLevel === 'high' ? 'high-risk' : 'available',
      congestionScore: c.score,
      riskLevel: c.riskLevel,
      occupancyPct: occupancy,
      availableSpots,
      totalSpots,
      currentHourRisk: currentRisk,
    });
  }

  // Assign lat/lon from grid hotspots (approximate)
  const gridByStation = new Map<string, GridCell>();
  // Map stations to their grid cells using hotspot data
  for (const h of metrics.hotspots) {
    const grid = metrics.gridHotspots.find(g => {
      // Find closest grid cell (rough heuristic)
      return !gridByStation.has(h.station);
    });
    if (grid) gridByStation.set(h.station, grid);
  }

  // Use junction lat/lon from CCTV cameras
  const cameraMap = new Map<string, { lat: number; lon: number }>();
  for (const cam of metrics.cctvCameras) {
    cameraMap.set(cam.junction, { lat: cam.lat, lon: cam.lon });
  }

  // Assign coordinates with small random offsets for zones without exact coords
  const baseLat = 12.975;
  const baseLon = 77.585;
  zones.forEach((z, i) => {
    const camCoords = cameraMap.get(z.name);
    if (camCoords) {
      z.lat = camCoords.lat;
      z.lon = camCoords.lon;
    } else {
      // Distribute around central Bangalore
      const angle = (i / zones.length) * Math.PI * 2;
      const radius = 0.02 + Math.random() * 0.04;
      z.lat = baseLat + Math.cos(angle) * radius;
      z.lon = baseLon + Math.sin(angle) * radius;
    }
  });

  return zones;
}

// ── Haversine distance in meters ──
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Generate parking recommendations ──
export function getRecommendations(
  zones: ParkingZone[],
  destLat: number,
  destLon: number,
  maxWalkM: number = 2000,
): ParkingRecommendation[] {
  const recs: ParkingRecommendation[] = [];

  for (const zone of zones) {
    if (zone.lat === 0 && zone.lon === 0) continue;

    const dist = haversineM(zone.lat, zone.lon, destLat, destLon);
    if (dist > maxWalkM) continue;

    const walkTime = Math.round(dist / 80); // ~80m/min walking speed

    // Congestion level from current risk
    const congestionLevel = zone.currentHourRisk;

    // Enforcement risk from zone type
    const enforcementRisk: 'low' | 'medium' | 'high' =
      zone.type === 'no-parking' ? 'high' :
      zone.type === 'high-risk' ? 'medium' : 'low';

    // Score: prefer available spots, low congestion, short walk, low enforcement risk
    let score = 100;
    score -= (dist / maxWalkM) * 30; // walking penalty (0-30)
    score -= zone.occupancyPct * 0.3; // occupancy penalty (0-30)
    score -= (congestionLevel === 'high' ? 25 : congestionLevel === 'medium' ? 12 : 0);
    score -= (enforcementRisk === 'high' ? 20 : enforcementRisk === 'medium' ? 8 : 0);
    score = Math.max(5, Math.round(score));

    let reason = '';
    if (zone.availableSpots > 10 && congestionLevel === 'low') {
      reason = 'Best choice — plenty of spots, low congestion';
    } else if (zone.availableSpots > 5) {
      reason = 'Good availability, moderate area';
    } else if (dist < 500) {
      reason = 'Very close to destination but limited spots';
    } else {
      reason = 'Alternate option — may require patience';
    }

    recs.push({
      zone,
      walkingDistanceM: Math.round(dist),
      walkingTimeMin: walkTime,
      congestionLevel,
      enforcementRisk,
      score,
      reason,
    });
  }

  return recs.sort((a, b) => b.score - a.score);
}

// ── Incentives & Rewards ──
export const INCENTIVES: Incentive[] = [
  { id: 'bus-1', title: 'Free BMTC Bus Ticket', description: 'One-way ride on any BMTC city bus', pointsCost: 50, icon: '🚌', category: 'transit' },
  { id: 'metro-1', title: 'Namma Metro Single Journey', description: 'One-way trip on Bangalore Metro (any distance)', pointsCost: 80, icon: '🚇', category: 'transit' },
  { id: 'metro-pass', title: 'Namma Metro Day Pass', description: 'Unlimited metro rides for one day', pointsCost: 200, icon: '🚇', category: 'transit' },
  { id: 'bus-pass', title: 'BMTC Weekly Pass', description: '7-day unlimited BMTC bus travel', pointsCost: 350, icon: '🚌', category: 'transit' },
  { id: 'parking-disc', title: '50% Parking Discount', description: 'Half-price parking at smart parking lots', pointsCost: 30, icon: '🅿️', category: 'parking' },
  { id: 'parking-free', title: 'Free 2-Hour Parking', description: 'Complimentary 2-hour slot at partner lots', pointsCost: 100, icon: '🅿️', category: 'parking' },
  { id: 'ev-charge', title: 'Free EV Charging Session', description: '30 min charge at BESCOM stations', pointsCost: 120, icon: '⚡', category: 'reward' },
  { id: 'coffee', title: 'Coffee Voucher', description: 'Free coffee at partner cafés', pointsCost: 40, icon: '☕', category: 'reward' },
];

export function buildUserReward(): UserReward {
  return {
    totalPoints: 320,
    level: 'Silver Parker',
    streak: 5,
    tripsUsingRecommendation: 23,
    co2Saved: 12.4,
    availableIncentives: INCENTIVES,
    history: [
      { date: 'Today', action: 'Parked at recommended zone near KR Market', points: 15 },
      { date: 'Today', action: 'Walked 600m instead of driving to junction', points: 10 },
      { date: 'Yesterday', action: 'Used public transit after parking', points: 20 },
      { date: 'Yesterday', action: 'Parked at low-congestion area', points: 15 },
      { date: '2 days ago', action: 'Streak bonus (5 days)', points: 50 },
      { date: '2 days ago', action: 'Redeemed: Free BMTC Bus Ticket', points: -50 },
      { date: '3 days ago', action: 'Parked at recommended zone', points: 15 },
      { date: '4 days ago', action: 'Reported illegal parking', points: 25 },
    ],
  };
}

// ── Known destinations for search ──
export interface Destination {
  name: string;
  lat: number;
  lon: number;
  area: string;
}

export function buildDestinations(metrics: DashboardMetrics): Destination[] {
  const dests: Destination[] = [];
  const seen = new Set<string>();

  // From CCTV cameras (have real lat/lon)
  for (const cam of metrics.cctvCameras) {
    if (!seen.has(cam.junction)) {
      seen.add(cam.junction);
      dests.push({ name: cam.junction, lat: cam.lat, lon: cam.lon, area: cam.station });
    }
  }

  // From junction hotspots (approximate coords from nearby grid)
  for (const j of metrics.junctionHotspots) {
    if (!seen.has(j.junction)) {
      seen.add(j.junction);
      // Approximate from congestion scores
      const cong = metrics.congestionScores.find(c => c.junction === j.junction);
      const cam = metrics.cctvCameras.find(c => c.station === (cong?.station || ''));
      if (cam) {
        dests.push({
          name: j.junction,
          lat: cam.lat + (Math.random() - 0.5) * 0.01,
          lon: cam.lon + (Math.random() - 0.5) * 0.01,
          area: cong?.station || '',
        });
      }
    }
  }

  // Add well-known Bangalore landmarks
  const landmarks: Destination[] = [
    { name: 'MG Road', lat: 12.9756, lon: 77.6064, area: 'Central' },
    { name: 'Brigade Road', lat: 12.9716, lon: 77.6070, area: 'Central' },
    { name: 'Commercial Street', lat: 12.9833, lon: 77.6089, area: 'Central' },
    { name: 'Lalbagh Main Gate', lat: 12.9507, lon: 77.5848, area: 'South' },
    { name: 'Cubbon Park', lat: 12.9763, lon: 77.5929, area: 'Central' },
    { name: 'Majestic Bus Stand', lat: 12.9767, lon: 77.5713, area: 'Central' },
    { name: 'Bangalore City Railway Station', lat: 12.9789, lon: 77.5712, area: 'Central' },
    { name: 'Vidhana Soudha', lat: 12.9796, lon: 77.5908, area: 'Central' },
    { name: 'Indiranagar 100 Ft Road', lat: 12.9784, lon: 77.6408, area: 'East' },
    { name: 'Koramangala 80 Ft Road', lat: 12.9352, lon: 77.6245, area: 'South East' },
  ];
  for (const lm of landmarks) {
    if (!seen.has(lm.name)) {
      seen.add(lm.name);
      dests.push(lm);
    }
  }

  return dests;
}
