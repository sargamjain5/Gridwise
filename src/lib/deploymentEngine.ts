import type { ForecastEntry, StationDeploymentProfile, CongestionScoreEntry, PredictionGridCell } from './types';

// ── Types ──

export interface SpecialEvent {
  name: string;
  type: 'festival' | 'sports' | 'rally' | 'market' | 'vip';
  multiplier: number; // 1.0 = no effect, 2.0 = double violations expected
}

export interface DeploymentPrediction {
  station: string;
  hour: number;
  predictedViolationsPerHour: number;
  baseViolations: number;
  temporalMultiplier: number;
  hotspotMultiplier: number;
  eventMultiplier: number;
  requiredOfficers: number;
  urgency: 'critical' | 'high' | 'medium' | 'low';
}

export interface StationDeploymentPlan {
  station: string;
  totalPredictedViolations: number;
  peakWindow: { startHour: number; endHour: number; peakHour: number };
  hourlyBreakdown: DeploymentPrediction[];
  totalOfficersNeeded: number;
  peakOfficers: number;
  shiftRecommendation: string;
  hotspotScore: number;
}

export interface DeploymentEngineOutput {
  stationPlans: StationDeploymentPlan[];
  totalOfficersNeeded: number;
  peakCityWide: { hour: number; officers: number };
  summary: string;
}

// ── Special events catalog ──

export const SPECIAL_EVENTS: Record<string, SpecialEvent> = {
  none: { name: 'None', type: 'market', multiplier: 1.0 },
  weekend_market: { name: 'Weekend Market', type: 'market', multiplier: 1.3 },
  festival_small: { name: 'Local Festival', type: 'festival', multiplier: 1.5 },
  festival_major: { name: 'Major Festival (Dasara/Diwali)', type: 'festival', multiplier: 2.0 },
  ipl_match: { name: 'IPL Cricket Match', type: 'sports', multiplier: 1.8 },
  concert: { name: 'Concert / Large Event', type: 'sports', multiplier: 1.6 },
  political_rally: { name: 'Political Rally / Bandh', type: 'rally', multiplier: 1.4 },
  vip_visit: { name: 'VIP / VVIP Movement', type: 'vip', multiplier: 1.3 },
  exam_season: { name: 'Exam Season (School/College)', type: 'market', multiplier: 1.2 },
  rain_heavy: { name: 'Heavy Rain', type: 'market', multiplier: 0.7 },
};

// ── Month seasonality factors (from historical data patterns) ──

const MONTH_FACTORS: Record<number, number> = {
  1: 1.15,  // Jan - post new-year, high enforcement
  2: 1.05,
  3: 1.0,
  4: 0.95,
  5: 0.90,  // summer, slightly lower
  6: 0.85,  // monsoon onset
  7: 0.80,  // peak monsoon
  8: 0.82,
  9: 0.90,
  10: 1.05, // festival season starts
  11: 1.10, // Diwali season
  12: 1.12, // year-end
};

// ── Officer capacity: one officer handles ~15 violations per hour effectively ──
const VIOLATIONS_PER_OFFICER = 15;
const MIN_OFFICERS_PER_STATION = 1;

// ── Engine ──

export function runDeploymentEngine(
  day: string,          // 'Mon', 'Tue', etc.
  month: number,        // 1-12
  specialEvent: string, // key from SPECIAL_EVENTS
  forecast: ForecastEntry[],
  stationProfiles: StationDeploymentProfile[],
  congestionScores: CongestionScoreEntry[],
  predictionGrid: PredictionGridCell[],
  selectedStations?: string[], // if empty, use top stations
): DeploymentEngineOutput {
  const event = SPECIAL_EVENTS[specialEvent] || SPECIAL_EVENTS.none;
  const monthFactor = MONTH_FACTORS[month] || 1.0;

  // Build congestion score lookup
  const congMap = new Map<string, number>();
  for (const c of congestionScores) {
    const existing = congMap.get(c.station) || 0;
    congMap.set(c.station, Math.max(existing, c.score));
  }

  // Pick stations to analyze
  const stations = (selectedStations && selectedStations.length > 0)
    ? selectedStations
    : stationProfiles.slice(0, 12).map(p => p.station);

  const stationPlans: StationDeploymentPlan[] = [];

  // Compute average violations across all forecast entries for normalization
  const allAvgs = forecast.map(f => f.avgViolations);
  const globalMean = allAvgs.reduce((s, v) => s + v, 0) / (allAvgs.length || 1);

  for (const station of stations) {
    const stationForecast = forecast.filter(f => f.station === station && f.day === day);
    if (stationForecast.length === 0) continue;

    const profile = stationProfiles.find(p => p.station === station);
    const hotspotScore = congMap.get(station) || 0;

    // Hotspot multiplier: stations with high congestion scores get more officers
    const hotspotMultiplier = 1.0 + (hotspotScore / 100) * 0.5; // 1.0 to 1.5

    const hourlyBreakdown: DeploymentPrediction[] = [];
    let totalPredicted = 0;
    let peakHour = 0;
    let peakViolations = 0;

    for (let h = 0; h < 24; h++) {
      const entry = stationForecast.find(f => f.hour === h);
      const baseViolations = entry?.avgViolations || 0;

      // Hour-of-day temporal weight: how does this hour compare to station average?
      const stationMean = stationForecast.reduce((s, f) => s + f.avgViolations, 0) / (stationForecast.length || 1);
      const temporalMultiplier = stationMean > 0
        ? 0.5 + (baseViolations / stationMean) * 0.7  // 0.5 to ~1.9
        : 1.0;

      // Final prediction
      const predicted = baseViolations * temporalMultiplier * hotspotMultiplier * event.multiplier * monthFactor;
      const predictedRounded = Math.round(predicted * 10) / 10;

      // Officers needed
      const officers = Math.max(
        predicted > 2 ? MIN_OFFICERS_PER_STATION : 0,
        Math.ceil(predicted / VIOLATIONS_PER_OFFICER)
      );

      let urgency: DeploymentPrediction['urgency'];
      if (predicted >= 80) urgency = 'critical';
      else if (predicted >= 40) urgency = 'high';
      else if (predicted >= 15) urgency = 'medium';
      else urgency = 'low';

      hourlyBreakdown.push({
        station, hour: h,
        predictedViolationsPerHour: predictedRounded,
        baseViolations: Math.round(baseViolations * 10) / 10,
        temporalMultiplier: Math.round(temporalMultiplier * 100) / 100,
        hotspotMultiplier: Math.round(hotspotMultiplier * 100) / 100,
        eventMultiplier: event.multiplier,
        requiredOfficers: officers,
        urgency,
      });

      totalPredicted += predictedRounded;
      if (predictedRounded > peakViolations) {
        peakViolations = predictedRounded;
        peakHour = h;
      }
    }

    // Peak window: contiguous hours above 60% of peak
    const threshold = peakViolations * 0.6;
    let windowStart = peakHour;
    let windowEnd = peakHour;
    for (let h = peakHour - 1; h >= 0; h--) {
      if (hourlyBreakdown[h].predictedViolationsPerHour >= threshold) windowStart = h;
      else break;
    }
    for (let h = peakHour + 1; h < 24; h++) {
      if (hourlyBreakdown[h].predictedViolationsPerHour >= threshold) windowEnd = h;
      else break;
    }

    const peakOfficers = Math.max(...hourlyBreakdown.map(h => h.requiredOfficers));
    const totalOfficersNeeded = peakOfficers; // deploy peak count for the shift

    // Shift recommendation
    let shiftRec: string;
    if (windowEnd - windowStart <= 3) {
      shiftRec = `Single shift: ${windowStart}:00–${windowEnd + 1}:00 IST (${peakOfficers} officers)`;
    } else if (windowEnd - windowStart <= 6) {
      const midShift = Math.floor((windowStart + windowEnd) / 2);
      shiftRec = `Shift A: ${windowStart}:00–${midShift + 1}:00 (${peakOfficers} officers), Shift B: ${midShift + 1}:00–${windowEnd + 1}:00 (${Math.ceil(peakOfficers * 0.7)} officers)`;
    } else {
      shiftRec = `Full-day coverage recommended: ${windowStart}:00–${windowEnd + 1}:00 IST. Deploy ${peakOfficers} officers at peak, scale to ${Math.ceil(peakOfficers * 0.5)} off-peak.`;
    }

    stationPlans.push({
      station,
      totalPredictedViolations: Math.round(totalPredicted),
      peakWindow: { startHour: windowStart, endHour: windowEnd, peakHour },
      hourlyBreakdown,
      totalOfficersNeeded,
      peakOfficers,
      shiftRecommendation: shiftRec,
      hotspotScore,
    });
  }

  stationPlans.sort((a, b) => b.totalPredictedViolations - a.totalPredictedViolations);

  // City-wide peak hour
  const cityHourly = new Array(24).fill(0);
  const cityOfficers = new Array(24).fill(0);
  for (const plan of stationPlans) {
    for (const h of plan.hourlyBreakdown) {
      cityHourly[h.hour] += h.predictedViolationsPerHour;
      cityOfficers[h.hour] += h.requiredOfficers;
    }
  }
  const peakCityHour = cityHourly.indexOf(Math.max(...cityHourly));
  const totalOfficersNeeded = Math.max(...cityOfficers);

  const summary = `For ${day}, Month ${month}${event.name !== 'None' ? ` (${event.name})` : ''}: ` +
    `${stationPlans.length} stations analyzed, ` +
    `${Math.round(cityHourly.reduce((s, v) => s + v, 0))} total violations predicted, ` +
    `peak at ${peakCityHour}:00 IST requiring ${totalOfficersNeeded} officers city-wide.`;

  return {
    stationPlans,
    totalOfficersNeeded,
    peakCityWide: { hour: peakCityHour, officers: totalOfficersNeeded },
    summary,
  };
}
