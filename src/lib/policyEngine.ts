import type { CongestionScoreEntry, GridCell, CCTVCamera } from './types';

// ── Known infrastructure landmarks in Bangalore (proxy data) ──

interface Landmark {
  name: string;
  lat: number;
  lon: number;
  type: 'metro' | 'hospital' | 'commercial' | 'school' | 'bus_stop';
}

const LANDMARKS: Landmark[] = [
  // Metro stations (Purple + Green line)
  { name: 'Majestic Metro', lat: 12.9767, lon: 77.5713, type: 'metro' },
  { name: 'MG Road Metro', lat: 12.9756, lon: 77.6064, type: 'metro' },
  { name: 'Indiranagar Metro', lat: 12.9784, lon: 77.6408, type: 'metro' },
  { name: 'Cubbon Park Metro', lat: 12.9795, lon: 77.5929, type: 'metro' },
  { name: 'Vidhana Soudha Metro', lat: 12.9796, lon: 77.5908, type: 'metro' },
  { name: 'Rajajinagar Metro', lat: 12.9910, lon: 77.5530, type: 'metro' },
  { name: 'Yeshwanthpur Metro', lat: 13.0280, lon: 77.5450, type: 'metro' },
  { name: 'Jayanagar Metro', lat: 12.9253, lon: 77.5838, type: 'metro' },
  { name: 'Chickpete Metro', lat: 12.9700, lon: 77.5770, type: 'metro' },
  { name: 'KR Market Metro', lat: 12.9620, lon: 77.5780, type: 'metro' },
  { name: 'Halasuru Metro', lat: 12.9810, lon: 77.6180, type: 'metro' },
  // Hospitals
  { name: 'Victoria Hospital', lat: 12.9565, lon: 77.5735, type: 'hospital' },
  { name: 'Bowring Hospital', lat: 12.9850, lon: 77.6050, type: 'hospital' },
  { name: 'KC General Hospital', lat: 12.9960, lon: 77.5750, type: 'hospital' },
  { name: 'St. Johns Hospital', lat: 12.9290, lon: 77.6200, type: 'hospital' },
  { name: 'Manipal Hospital HAL', lat: 12.9580, lon: 77.6630, type: 'hospital' },
  { name: 'Nimhans', lat: 12.9416, lon: 77.5960, type: 'hospital' },
  // Commercial areas
  { name: 'MG Road Commercial', lat: 12.9750, lon: 77.6070, type: 'commercial' },
  { name: 'Brigade Road', lat: 12.9716, lon: 77.6070, type: 'commercial' },
  { name: 'Commercial Street', lat: 12.9833, lon: 77.6089, type: 'commercial' },
  { name: 'KR Market', lat: 12.9620, lon: 77.5780, type: 'commercial' },
  { name: 'Chickpet Market', lat: 12.9700, lon: 77.5770, type: 'commercial' },
  { name: 'Jayanagar 4th Block', lat: 12.9253, lon: 77.5838, type: 'commercial' },
  { name: 'Koramangala Forum', lat: 12.9340, lon: 77.6120, type: 'commercial' },
  { name: 'Indiranagar 100ft Road', lat: 12.9784, lon: 77.6408, type: 'commercial' },
  { name: 'Malleshwaram 8th Cross', lat: 12.9960, lon: 77.5710, type: 'commercial' },
  // Schools
  { name: 'Bishop Cotton School', lat: 12.9660, lon: 77.5990, type: 'school' },
  { name: 'National College', lat: 12.9430, lon: 77.5870, type: 'school' },
  { name: 'St Josephs College', lat: 12.9750, lon: 77.6000, type: 'school' },
  // Bus stops
  { name: 'Majestic Bus Stand', lat: 12.9767, lon: 77.5713, type: 'bus_stop' },
  { name: 'Shivajinagar Bus Stand', lat: 12.9870, lon: 77.6050, type: 'bus_stop' },
  { name: 'KR Market Bus Stop', lat: 12.9620, lon: 77.5780, type: 'bus_stop' },
];

// ── Road width proxy: derive from violation density (more violations in narrow roads) ──

function estimateRoadWidth(violationDensity: number, maxDensity: number): 'narrow' | 'medium' | 'wide' {
  const ratio = violationDensity / (maxDensity || 1);
  if (ratio > 0.6) return 'narrow';
  if (ratio > 0.3) return 'medium';
  return 'wide';
}

// ── Haversine ──

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestLandmark(lat: number, lon: number, type: Landmark['type']): { name: string; distM: number } {
  const filtered = LANDMARKS.filter(l => l.type === type);
  let best = { name: 'N/A', distM: Infinity };
  for (const l of filtered) {
    const d = haversineM(lat, lon, l.lat, l.lon);
    if (d < best.distM) best = { name: l.name, distM: Math.round(d) };
  }
  return best;
}

// ── Policy Recommendation ──

export interface PolicyRecommendation {
  type: 'parking_bay' | 'pickup_drop' | 'one_way' | 'timed_parking' | 'no_parking_extend' | 'speed_bump';
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium';
  icon: string;
}

export interface JunctionPolicyAnalysis {
  junction: string;
  station: string;
  lat: number;
  lon: number;
  // Input factors
  hotspotScore: number;
  violationDensity: number;
  nearestMetro: { name: string; distM: number };
  nearestHospital: { name: string; distM: number };
  nearestCommercial: { name: string; distM: number };
  nearestSchool: { name: string; distM: number };
  roadWidth: 'narrow' | 'medium' | 'wide';
  isFootfallZone: boolean;
  // Output
  recommendations: PolicyRecommendation[];
}

export function analyzePolicies(
  congestionScores: CongestionScoreEntry[],
  gridHotspots: GridCell[],
  cameras: CCTVCamera[],
): JunctionPolicyAnalysis[] {
  const maxDensity = gridHotspots[0]?.count || 1;
  const results: JunctionPolicyAnalysis[] = [];

  // Map cameras to junctions for lat/lon
  const camMap = new Map<string, CCTVCamera>();
  for (const c of cameras) camMap.set(c.junction, c);

  for (const cs of congestionScores) {
    const cam = camMap.get(cs.junction);
    const lat = cam?.lat || 12.975 + (Math.random() - 0.5) * 0.04;
    const lon = cam?.lon || 77.585 + (Math.random() - 0.5) * 0.04;

    const metro = nearestLandmark(lat, lon, 'metro');
    const hospital = nearestLandmark(lat, lon, 'hospital');
    const commercial = nearestLandmark(lat, lon, 'commercial');
    const school = nearestLandmark(lat, lon, 'school');

    const roadWidth = estimateRoadWidth(cs.totalViolations, congestionScores[0]?.totalViolations || 1);
    const isFootfallZone = commercial.distM < 500 || metro.distM < 300 || school.distM < 300;

    const recommendations: PolicyRecommendation[] = [];

    // ── Rule-based policy recommendations ──

    // 1. Build parking bay — if high violations + near commercial area + medium/wide road
    if (cs.score >= 30 && commercial.distM < 800 && roadWidth !== 'narrow') {
      recommendations.push({
        type: 'parking_bay',
        title: 'Build Designated Parking Bay',
        description: `High parking demand near ${commercial.name} (${commercial.distM}m). ${roadWidth === 'wide' ? 'Wide road can accommodate on-street bays.' : 'Consider multi-level parking structure.'}`,
        priority: cs.score >= 70 ? 'critical' : 'high',
        icon: '🅿️',
      });
    }

    // 2. Add pickup/drop lane — if near hospital/school/metro + high footfall
    if ((hospital.distM < 400 || school.distM < 400 || metro.distM < 300) && cs.parkingViolations > 100) {
      const nearWhat = hospital.distM < 400 ? `${hospital.name} (${hospital.distM}m)` :
        school.distM < 400 ? `${school.name} (${school.distM}m)` :
        `${metro.name} (${metro.distM}m)`;
      recommendations.push({
        type: 'pickup_drop',
        title: 'Add Pickup/Drop-off Lane',
        description: `Near ${nearWhat}. ${cs.parkingViolations} parking violations indicate vehicles stopping for drop-off/pickup. Dedicated lane reduces road blockage.`,
        priority: hospital.distM < 400 ? 'critical' : 'high',
        icon: '🚗',
      });
    }

    // 3. One-way traffic — if narrow road + high violation density + congestion score > 50
    if (roadWidth === 'narrow' && cs.score >= 50) {
      recommendations.push({
        type: 'one_way',
        title: 'Convert to One-Way Traffic',
        description: `Narrow road with congestion score ${cs.score}/100. One-way conversion frees one lane for legal parking or wider carriageway. Reduces head-on congestion from double-parked vehicles.`,
        priority: cs.score >= 70 ? 'critical' : 'high',
        icon: '➡️',
      });
    }

    // 4. 15-min timed parking — if commercial area + moderate violations + footfall zone
    if (isFootfallZone && cs.score >= 20 && cs.score < 70 && commercial.distM < 600) {
      recommendations.push({
        type: 'timed_parking',
        title: 'Implement 15-Minute Parking Zone',
        description: `High footfall commercial area near ${commercial.name}. Timed parking ensures turnover — reduces long-term illegal parking while allowing quick stops for shopping/errands.`,
        priority: 'medium',
        icon: '⏱️',
      });
    }

    // 5. Extend no-parking zone — if near hospital and critical violations
    if (hospital.distM < 500 && cs.score >= 60) {
      recommendations.push({
        type: 'no_parking_extend',
        title: 'Extend No-Parking Zone',
        description: `Critical violation density near ${hospital.name} (${hospital.distM}m). Extend no-parking zone by 200m to ensure emergency vehicle access is never blocked.`,
        priority: 'critical',
        icon: '🚫',
      });
    }

    // 6. Speed bump / traffic calming — if school zone + violations
    if (school.distM < 400 && cs.parkingViolations > 50) {
      recommendations.push({
        type: 'speed_bump',
        title: 'Install Traffic Calming Measures',
        description: `School zone near ${school.name} (${school.distM}m). Speed bumps + raised crosswalks reduce parking-related safety hazards for pedestrians.`,
        priority: 'high',
        icon: '🔶',
      });
    }

    // Fallback: if no specific recommendation, at least suggest enforcement
    if (recommendations.length === 0 && cs.score >= 15) {
      recommendations.push({
        type: 'timed_parking',
        title: 'Increase Enforcement Frequency',
        description: `Moderate violation density. Regular patrol presence will deter illegal parking. Consider smart signage with real-time availability.`,
        priority: 'medium',
        icon: '👮',
      });
    }

    if (recommendations.length > 0) {
      results.push({
        junction: cs.junction,
        station: cs.station,
        lat, lon,
        hotspotScore: cs.score,
        violationDensity: cs.totalViolations,
        nearestMetro: metro,
        nearestHospital: hospital,
        nearestCommercial: commercial,
        nearestSchool: school,
        roadWidth,
        isFootfallZone,
        recommendations,
      });
    }
  }

  return results.sort((a, b) => b.hotspotScore - a.hotspotScore);
}
