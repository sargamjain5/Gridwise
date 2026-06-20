import type {
  RawRecord, DashboardMetrics, RepeatDistribution,
  AnomalyRecord, DeploymentSlot, StationDeploymentProfile, CongestionScoreEntry,
  ForecastEntry, ActiveAlert, CCTVCamera,
} from './types';

function parseViolations(raw: string): string[] {
  if (!raw || raw === 'NULL') return [];
  try {
    const cleaned = raw.replace(/""/g, '"');
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.map((v: string) => v.trim().toUpperCase());
    return [String(parsed).trim().toUpperCase()];
  } catch {
    try {
      const match = raw.match(/\[(.+)\]/);
      if (match) {
        return match[1]
          .split(',')
          .map(s => s.replace(/"/g, '').trim().toUpperCase())
          .filter(Boolean);
      }
    } catch { /* ignore */ }
    return [raw.trim().toUpperCase()];
  }
}

function toIST(utcStr: string): Date | null {
  if (!utcStr || utcStr === 'NULL') return null;
  const d = new Date(utcStr);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
}

function countMap<T>(arr: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const item of arr) {
    m.set(item, (m.get(item) || 0) + 1);
  }
  return m;
}

function sortedEntries(map: Map<string, number>, limit?: number): [string, number][] {
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return limit ? sorted.slice(0, limit) : sorted;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function zScore(value: number, mean: number, sd: number): number {
  if (sd === 0) return 0;
  return (value - mean) / sd;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const RUSH_HOURS = new Set([8, 9, 10, 11, 17, 18, 19]); // IST rush hours

export function processData(records: RawRecord[]): DashboardMetrics {
  const total = records.length;

  // ---------- Core parsing ----------
  const violationLists = records.map(r => parseViolations(r.violation_type));
  const allViolations: string[] = violationLists.flat();
  const isParkingArr = violationLists.map(vl => vl.some(v => v.includes('PARKING')));
  const totalParking = isParkingArr.filter(Boolean).length;

  // Per-record parsed dates
  const istDates = records.map(r => toIST(r.created_datetime));

  const vehicleCounter = countMap(records.map(r => r.vehicle_number));
  const uniqueVehicles = vehicleCounter.size;
  const stationCounter = countMap(records.map(r => r.police_station).filter(Boolean));
  const uniqueStations = stationCounter.size;

  // Date range
  const validDates = istDates.filter((d): d is Date => d !== null);
  validDates.sort((a, b) => a.getTime() - b.getTime());
  const minDate = validDates.length > 0 ? validDates[0] : new Date();
  const maxDate = validDates.length > 0 ? validDates[validDates.length - 1] : new Date();
  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  const dateRange = `${fmtDate(minDate)} – ${fmtDate(maxDate)}`;

  // ---------- Hotspots ----------
  const hotspots = sortedEntries(stationCounter, 12).map(([station, count]) => ({
    station, count, pct: +((count / total) * 100).toFixed(1),
  }));

  // Junction hotspots
  const junctionCounter = countMap(
    records.map(r => r.junction_name).filter(v => v && v !== 'No Junction')
  );
  const parkingJunctionCounter = new Map<string, number>();
  records.forEach((r, i) => {
    if (isParkingArr[i] && r.junction_name && r.junction_name !== 'No Junction') {
      parkingJunctionCounter.set(r.junction_name, (parkingJunctionCounter.get(r.junction_name) || 0) + 1);
    }
  });
  const junctionHotspots = sortedEntries(junctionCounter, 15).map(([junction, count]) => ({
    junction, count, parkingCount: parkingJunctionCounter.get(junction) || 0,
  }));

  // ---------- Violation breakdown ----------
  const violCounter = countMap(allViolations);
  const totalViol = allViolations.length;
  const violationBreakdown = sortedEntries(violCounter, 12).map(([type, count]) => ({
    type: type.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
    count, pct: +((count / totalViol) * 100).toFixed(1),
  }));

  // ---------- Vehicle types ----------
  const vtypeCounter = countMap(
    records.map(r => (r.vehicle_type || '').toUpperCase().trim()).filter(Boolean)
  );
  const vehicleTypes = sortedEntries(vtypeCounter, 15).map(([type, count]) => ({
    type, count, pct: +((count / total) * 100).toFixed(1),
  }));

  // ---------- Temporal ----------
  const hourCounter = new Map<number, number>();
  for (const d of istDates) {
    if (d) {
      const h = d.getUTCHours();
      hourCounter.set(h, (hourCounter.get(h) || 0) + 1);
    }
  }
  const hourlyPattern = Array.from({ length: 24 }, (_, h) => ({
    hour: h, count: hourCounter.get(h) || 0,
    label: `${h.toString().padStart(2, '0')}:00`,
  }));
  const peakHour = hourlyPattern.reduce((max, cur) => cur.count > max.count ? cur : max).hour;

  const dowCounter = new Map<string, number>();
  for (const d of istDates) {
    if (d) {
      const name = DAY_NAMES[d.getUTCDay()];
      dowCounter.set(name, (dowCounter.get(name) || 0) + 1);
    }
  }
  const dayOfWeekPattern = DAY_ORDER.map(day => ({
    day: day.slice(0, 3), count: dowCounter.get(day) || 0,
  }));

  const monthCounter = new Map<string, number>();
  for (const d of istDates) {
    if (d) {
      const key = `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
      monthCounter.set(key, (monthCounter.get(key) || 0) + 1);
    }
  }
  const monthlyTrend = [...monthCounter.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => {
      const [y, m] = month.split('-');
      const label = new Date(+y, +m - 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
      return { month: label, count };
    });

  // ---------- Repeat offenders ----------
  const vehicleSorted = [...vehicleCounter.entries()].sort((a, b) => b[1] - a[1]);
  const vehicleStations = new Map<string, Set<string>>();
  const vehicleTypes2 = new Map<string, string>();
  for (const r of records) {
    if (!vehicleStations.has(r.vehicle_number)) vehicleStations.set(r.vehicle_number, new Set());
    if (r.police_station) vehicleStations.get(r.vehicle_number)!.add(r.police_station);
    if (r.vehicle_type && !vehicleTypes2.has(r.vehicle_number)) {
      vehicleTypes2.set(r.vehicle_number, r.vehicle_type.toUpperCase());
    }
  }
  const topRepeatOffenders = vehicleSorted.slice(0, 20).map(([vehicle, count]) => ({
    vehicle, count,
    stations: [...(vehicleStations.get(vehicle) || [])],
    vehicleType: vehicleTypes2.get(vehicle) || 'UNKNOWN',
  }));

  const repeatBuckets: [string, (n: number) => boolean][] = [
    ['1', n => n === 1], ['2', n => n === 2], ['3', n => n === 3],
    ['4-5', n => n >= 4 && n <= 5], ['6-10', n => n >= 6 && n <= 10],
    ['11-50', n => n >= 11 && n <= 50], ['50+', n => n > 50],
  ];
  const repeatDistribution: RepeatDistribution[] = repeatBuckets.map(([bucket, pred]) => {
    const vehicles = [...vehicleCounter.values()].filter(pred).length;
    return { bucket, vehicles, pct: +((vehicles / uniqueVehicles) * 100).toFixed(1) };
  });
  const repeatOffenderCount = [...vehicleCounter.values()].filter(v => v >= 2).length;
  const repeatOffenderPct = +((repeatOffenderCount / uniqueVehicles) * 100).toFixed(1);

  // ---------- Validation ----------
  const valCounter = countMap(records.map(r => r.validation_status || '').filter(Boolean));
  const validatedTotal = [...valCounter.values()].reduce((s, v) => s + v, 0);
  const validationData = sortedEntries(valCounter).map(([status, count]) => ({
    status, count, pct: +((count / validatedTotal) * 100).toFixed(1),
  }));
  const approvedCount = valCounter.get('approved') || 0;
  const rejectedCount = valCounter.get('rejected') || 0;
  const approvalRate = validatedTotal > 0 ? +((approvedCount / validatedTotal) * 100).toFixed(1) : 0;
  const rejectionRate = validatedTotal > 0 ? +((rejectedCount / validatedTotal) * 100).toFixed(1) : 0;
  const validatedPct = +((validatedTotal / total) * 100).toFixed(1);

  // ---------- Spatial grid ----------
  const gridMap = new Map<string, { lat: number; lon: number; count: number }>();
  for (let i = 0; i < records.length; i++) {
    if (!isParkingArr[i]) continue;
    const lat = +records[i].latitude;
    const lon = +records[i].longitude;
    if (isNaN(lat) || isNaN(lon) || lat < 12.8 || lat > 13.15 || lon < 77.45 || lon > 77.78) continue;
    const gridLat = Math.round(lat * 100) / 100;
    const gridLon = Math.round(lon * 100) / 100;
    const key = `${gridLat},${gridLon}`;
    const existing = gridMap.get(key);
    if (existing) existing.count++;
    else gridMap.set(key, { lat: gridLat, lon: gridLon, count: 1 });
  }
  const gridHotspots = [...gridMap.values()].sort((a, b) => b.count - a.count).slice(0, 30);

  // ================================================================
  //  NEW FEATURE 1: ANOMALY DETECTION
  // ================================================================
  const anomalies = computeAnomalies(records, istDates);

  // ================================================================
  //  NEW FEATURE 2: DEPLOYMENT RECOMMENDATIONS
  // ================================================================
  const { deploymentSlots, stationProfiles } = computeDeployment(records, istDates, isParkingArr);

  // ================================================================
  //  NEW FEATURE 3: CONGESTION IMPACT PROXY
  // ================================================================
  const congestionScores = computeCongestion(records, istDates, violationLists, isParkingArr);

  // ================================================================
  //  NEW FEATURE 4: CONGESTION FORECAST LOOKUP
  // ================================================================
  const forecastLookup = computeForecast(records, istDates);

  // ================================================================
  //  NEW FEATURE 5: ACTIVE ALERTS
  // ================================================================
  const activeAlerts = computeActiveAlerts(forecastLookup, congestionScores, deploymentSlots);

  // ================================================================
  //  NEW FEATURE 6: CCTV CAMERAS + VEHICLE POOL
  // ================================================================
  const { cctvCameras, vehiclePool } = computeCCTV(records, congestionScores, junctionHotspots);

  return {
    totalRecords: total,
    totalParkingRecords: totalParking,
    parkingPct: +((totalParking / total) * 100).toFixed(1),
    uniqueVehicles, uniqueStations, dateRange,
    approvalRate, rejectionRate, validatedPct,
    hotspots, junctionHotspots, violationBreakdown, vehicleTypes,
    hourlyPattern, dayOfWeekPattern, monthlyTrend,
    topRepeatOffenders, repeatDistribution, validationData,
    gridHotspots, peakHour,
    topStation: hotspots[0]?.station || 'N/A',
    repeatOffenderPct,
    anomalies, deploymentSlots, stationProfiles, congestionScores,
    forecastLookup, activeAlerts, cctvCameras, vehiclePool,
  };
}


// ────────────────────────────────────────────
//  ANOMALY DETECTION
// ────────────────────────────────────────────
function computeAnomalies(records: RawRecord[], istDates: (Date | null)[]): AnomalyRecord[] {
  // Build per-officer stats
  interface OfficerStats {
    violations: number;
    days: Set<string>;
    lats: number[];
    lons: number[];
    rejected: number;
    validated: number;
    stations: Map<string, number>;
  }

  const officers = new Map<string, OfficerStats>();
  const devices = new Map<string, OfficerStats>();

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const d = istDates[i];
    const dayKey = d ? `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` : '';
    const lat = +r.latitude;
    const lon = +r.longitude;

    // Officer
    if (r.created_by_id) {
      if (!officers.has(r.created_by_id)) {
        officers.set(r.created_by_id, {
          violations: 0, days: new Set(), lats: [], lons: [],
          rejected: 0, validated: 0, stations: new Map(),
        });
      }
      const o = officers.get(r.created_by_id)!;
      o.violations++;
      if (dayKey) o.days.add(dayKey);
      if (!isNaN(lat)) o.lats.push(lat);
      if (!isNaN(lon)) o.lons.push(lon);
      if (r.validation_status) {
        o.validated++;
        if (r.validation_status === 'rejected') o.rejected++;
      }
      if (r.police_station) o.stations.set(r.police_station, (o.stations.get(r.police_station) || 0) + 1);
    }

    // Device
    if (r.device_id) {
      if (!devices.has(r.device_id)) {
        devices.set(r.device_id, {
          violations: 0, days: new Set(), lats: [], lons: [],
          rejected: 0, validated: 0, stations: new Map(),
        });
      }
      const dv = devices.get(r.device_id)!;
      dv.violations++;
      if (dayKey) dv.days.add(dayKey);
      if (!isNaN(lat)) dv.lats.push(lat);
      if (!isNaN(lon)) dv.lons.push(lon);
      if (r.validation_status) {
        dv.validated++;
        if (r.validation_status === 'rejected') dv.rejected++;
      }
      if (r.police_station) dv.stations.set(r.police_station, (dv.stations.get(r.police_station) || 0) + 1);
    }
  }

  function buildAnomalies(
    statsMap: Map<string, OfficerStats>,
    type: 'officer' | 'device'
  ): AnomalyRecord[] {
    // Only consider entities with meaningful activity (>= 20 violations)
    const entries = [...statsMap.entries()].filter(([, s]) => s.violations >= 20);
    if (entries.length < 5) return [];

    // Compute distribution stats
    const vpds = entries.map(([, s]) => s.violations / Math.max(s.days.size, 1));
    const rejRates = entries.map(([, s]) => s.validated > 0 ? s.rejected / s.validated : 0);
    const geoSpreads = entries.map(([, s]) => {
      const latSD = stdDev(s.lats);
      const lonSD = stdDev(s.lons);
      return Math.sqrt(latSD ** 2 + lonSD ** 2);
    });

    const meanVPD = vpds.reduce((a, b) => a + b, 0) / vpds.length;
    const sdVPD = stdDev(vpds);
    const meanRej = rejRates.reduce((a, b) => a + b, 0) / rejRates.length;
    const sdRej = stdDev(rejRates);
    const meanGeo = geoSpreads.reduce((a, b) => a + b, 0) / geoSpreads.length;
    const sdGeo = stdDev(geoSpreads);

    const results: AnomalyRecord[] = [];
    for (let idx = 0; idx < entries.length; idx++) {
      const [id, s] = entries[idx];
      const activeDays = Math.max(s.days.size, 1);
      const vpd = s.violations / activeDays;
      const rr = s.validated > 0 ? s.rejected / s.validated : 0;
      const geo = geoSpreads[idx];

      const zVPD = Math.abs(zScore(vpd, meanVPD, sdVPD));
      const zRej = Math.abs(zScore(rr, meanRej, sdRej));
      const zGeo = Math.abs(zScore(geo, meanGeo, sdGeo));

      // Composite anomaly score (weighted)
      const anomalyScore = +(0.4 * zVPD + 0.35 * zRej + 0.25 * zGeo).toFixed(2);

      const flags: string[] = [];
      if (zVPD > 2) flags.push(`Unusually ${vpd > meanVPD ? 'high' : 'low'} activity: ${vpd.toFixed(1)}/day (avg ${meanVPD.toFixed(1)})`);
      if (zRej > 2) flags.push(`Rejection rate ${(rr * 100).toFixed(1)}% (avg ${(meanRej * 100).toFixed(1)}%)`);
      if (zGeo > 2) flags.push(`Geographic spread ${geo > meanGeo ? 'unusually wide' : 'unusually narrow'}`);

      // Primary station
      const primaryStation = [...s.stations.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

      results.push({
        id, type,
        totalViolations: s.violations,
        activeDays,
        violationsPerDay: +vpd.toFixed(1),
        rejectionRate: +(rr * 100).toFixed(1),
        geoSpread: +geo.toFixed(4),
        station: primaryStation,
        anomalyScore,
        flags,
      });
    }

    // Sort by anomaly score descending, return top flagged
    return results
      .filter(a => a.flags.length > 0)
      .sort((a, b) => b.anomalyScore - a.anomalyScore)
      .slice(0, 25);
  }

  return [
    ...buildAnomalies(officers, 'officer'),
    ...buildAnomalies(devices, 'device'),
  ].sort((a, b) => b.anomalyScore - a.anomalyScore).slice(0, 30);
}


// ────────────────────────────────────────────
//  DEPLOYMENT RECOMMENDATIONS
// ────────────────────────────────────────────
function computeDeployment(
  records: RawRecord[],
  istDates: (Date | null)[],
  isParkingArr: boolean[],
): { deploymentSlots: DeploymentSlot[]; stationProfiles: StationDeploymentProfile[] } {

  // station -> day -> hour -> { total, parking }
  const cube = new Map<string, Map<string, Map<number, { total: number; parking: number }>>>();
  // station -> { dates set, total }
  const stationMeta = new Map<string, { dates: Set<string>; total: number }>();

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const d = istDates[i];
    if (!d || !r.police_station) continue;

    const station = r.police_station;
    const dayName = DAY_NAMES[d.getUTCDay()];
    const dayShort = dayName.slice(0, 3);
    const hour = d.getUTCHours();
    const dateKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;

    if (!cube.has(station)) cube.set(station, new Map());
    const dayCube = cube.get(station)!;
    if (!dayCube.has(dayShort)) dayCube.set(dayShort, new Map());
    const hourCube = dayCube.get(dayShort)!;
    if (!hourCube.has(hour)) hourCube.set(hour, { total: 0, parking: 0 });
    const cell = hourCube.get(hour)!;
    cell.total++;
    if (isParkingArr[i]) cell.parking++;

    if (!stationMeta.has(station)) stationMeta.set(station, { dates: new Set(), total: 0 });
    const meta = stationMeta.get(station)!;
    meta.dates.add(dateKey);
    meta.total++;
  }

  // Build slot recommendations: for each station, find the top hour-day combos
  const allSlots: DeploymentSlot[] = [];
  for (const [station, dayCube] of cube) {
    for (const [day, hourCube] of dayCube) {
      for (const [hour, cell] of hourCube) {
        allSlots.push({
          station, day, hour,
          expectedViolations: cell.total,
          priority: 'low', // will be set below
          parkingShare: cell.total > 0 ? +((cell.parking / cell.total) * 100).toFixed(1) : 0,
        });
      }
    }
  }

  // Assign priority based on percentile
  allSlots.sort((a, b) => b.expectedViolations - a.expectedViolations);
  const n = allSlots.length;
  allSlots.forEach((slot, i) => {
    const pct = i / n;
    if (pct < 0.05) slot.priority = 'critical';
    else if (pct < 0.15) slot.priority = 'high';
    else if (pct < 0.40) slot.priority = 'medium';
    else slot.priority = 'low';
  });

  // Station-level profiles
  const stationProfiles: StationDeploymentProfile[] = [];
  const maxStationTotal = Math.max(...[...stationMeta.values()].map(m => m.total), 1);

  for (const [station, meta] of stationMeta) {
    const dayCube = cube.get(station)!;
    let peakCount = 0;
    let peakHour = 0;
    let peakDay = 'Mon';

    for (const [day, hourCube] of dayCube) {
      for (const [hour, cell] of hourCube) {
        if (cell.total > peakCount) {
          peakCount = cell.total;
          peakHour = hour;
          peakDay = day;
        }
      }
    }

    stationProfiles.push({
      station,
      totalViolations: meta.total,
      peakHour,
      peakDay,
      avgDailyViolations: +(meta.total / Math.max(meta.dates.size, 1)).toFixed(1),
      priorityScore: +((meta.total / maxStationTotal) * 100).toFixed(1),
    });
  }

  stationProfiles.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    deploymentSlots: allSlots.filter(s => s.priority === 'critical' || s.priority === 'high').slice(0, 50),
    stationProfiles: stationProfiles.slice(0, 20),
  };
}


// ────────────────────────────────────────────
//  CONGESTION IMPACT PROXY
// ────────────────────────────────────────────
function computeCongestion(
  records: RawRecord[],
  istDates: (Date | null)[],
  violationLists: string[][],
  isParkingArr: boolean[],
): CongestionScoreEntry[] {

  // Per junction: parking count, total, multi-violation count, rush-hour count, unique vehicles
  interface JunctionStats {
    station: string;
    total: number;
    parking: number;
    multiViolation: number;  // records with 2+ violations
    rushHour: number;        // violations during peak traffic hours
    vehicles: Set<string>;
  }

  const junctions = new Map<string, JunctionStats>();

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r.junction_name || r.junction_name === 'No Junction') continue;
    const d = istDates[i];

    if (!junctions.has(r.junction_name)) {
      junctions.set(r.junction_name, {
        station: r.police_station || '',
        total: 0, parking: 0, multiViolation: 0, rushHour: 0,
        vehicles: new Set(),
      });
    }
    const j = junctions.get(r.junction_name)!;
    j.total++;
    if (isParkingArr[i]) j.parking++;
    if (violationLists[i].length >= 2) j.multiViolation++;
    if (d && RUSH_HOURS.has(d.getUTCHours())) j.rushHour++;
    if (r.vehicle_number) j.vehicles.add(r.vehicle_number);
    // Use the most frequent station
    if (!j.station && r.police_station) j.station = r.police_station;
  }

  // Only score junctions with >= 50 violations
  const scored: CongestionScoreEntry[] = [];
  const entries = [...junctions.entries()].filter(([, s]) => s.total >= 50);
  if (entries.length === 0) return [];

  // Compute raw scores
  const rawScores: number[] = [];
  for (const [, s] of entries) {
    const multiRatio = s.multiViolation / s.total;
    const peakShare = s.rushHour / s.total;
    // Score formula: parking density × (1 + multi-violation boost) × (1 + rush-hour boost)
    // Weighted: parking count dominates, multi-violation and rush-hour amplify
    const raw = s.parking * (1 + multiRatio) * (1 + peakShare * 0.5);
    rawScores.push(raw);
  }

  const maxRaw = Math.max(...rawScores, 1);

  for (let i = 0; i < entries.length; i++) {
    const [junction, s] = entries[i];
    const score = +((rawScores[i] / maxRaw) * 100).toFixed(1);
    const multiRatio = +(s.multiViolation / s.total).toFixed(3);
    const peakShare = +(s.rushHour / s.total).toFixed(3);

    let riskLevel: CongestionScoreEntry['riskLevel'];
    if (score >= 70) riskLevel = 'critical';
    else if (score >= 40) riskLevel = 'high';
    else if (score >= 15) riskLevel = 'moderate';
    else riskLevel = 'low';

    scored.push({
      junction, station: s.station, score,
      parkingViolations: s.parking,
      totalViolations: s.total,
      multiViolationRatio: multiRatio,
      peakHourShare: peakShare,
      uniqueVehicles: s.vehicles.size,
      riskLevel,
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, 30);
}


// ────────────────────────────────────────────
//  CONGESTION FORECAST (historical lookup)
// ────────────────────────────────────────────
function computeForecast(
  records: RawRecord[],
  istDates: (Date | null)[],
): ForecastEntry[] {
  // Build station × day × hour → count, and track number of weeks to average
  const cube = new Map<string, number>(); // "station|day|hour" → total count
  const weekSet = new Set<string>();

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const d = istDates[i];
    if (!d || !r.police_station) continue;
    const dayShort = DAY_NAMES[d.getUTCDay()].slice(0, 3);
    const hour = d.getUTCHours();
    const key = `${r.police_station}|${dayShort}|${hour}`;
    cube.set(key, (cube.get(key) || 0) + 1);
    // Track unique weeks for averaging
    const wk = `${d.getUTCFullYear()}-W${Math.ceil((d.getUTCDate() + new Date(d.getUTCFullYear(), d.getUTCMonth(), 1).getUTCDay()) / 7)}`;
    weekSet.add(wk);
  }

  const numWeeks = Math.max(weekSet.size, 1);

  // Compute all averages first to find percentile thresholds
  const allAvgs: number[] = [];
  for (const count of cube.values()) {
    allAvgs.push(count / numWeeks);
  }
  allAvgs.sort((a, b) => a - b);
  const p75 = allAvgs[Math.floor(allAvgs.length * 0.75)] || 1;
  const p40 = allAvgs[Math.floor(allAvgs.length * 0.40)] || 0.5;

  const entries: ForecastEntry[] = [];
  for (const [key, count] of cube) {
    const [station, day, hourStr] = key.split('|');
    const avg = +(count / numWeeks).toFixed(1);
    let risk: ForecastEntry['risk'];
    if (avg >= p75) risk = 'high';
    else if (avg >= p40) risk = 'medium';
    else risk = 'low';
    entries.push({ station, day, hour: +hourStr, avgViolations: avg, risk });
  }

  return entries;
}


// ────────────────────────────────────────────
//  ACTIVE ALERTS (current time based)
// ────────────────────────────────────────────
function computeActiveAlerts(
  forecast: ForecastEntry[],
  congestion: CongestionScoreEntry[],
  deployment: DeploymentSlot[],
): ActiveAlert[] {
  // Use the current IST time to generate relevant alerts
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const currentHour = now.getUTCHours();
  const currentDay = DAY_NAMES[now.getUTCDay()].slice(0, 3);

  // Also consider the next 2 hours for upcoming alerts
  const relevantHours = [currentHour, (currentHour + 1) % 24, (currentHour + 2) % 24];

  // Build junction→station map from congestion scores
  const junctionMap = new Map<string, CongestionScoreEntry>();
  for (const c of congestion) {
    junctionMap.set(c.station, c);
  }

  // Find high-risk forecast slots for current time window
  const relevantForecasts = forecast.filter(
    f => f.day === currentDay && relevantHours.includes(f.hour) && f.risk === 'high'
  );

  // Match with deployment slots for violation counts
  const deployMap = new Map<string, DeploymentSlot>();
  for (const d of deployment) {
    deployMap.set(`${d.station}|${d.day}|${d.hour}`, d);
  }

  const alerts: ActiveAlert[] = [];
  const seenStations = new Set<string>();

  for (const f of relevantForecasts) {
    if (seenStations.has(f.station)) continue;
    seenStations.add(f.station);

    const cScore = junctionMap.get(f.station);
    const dSlot = deployMap.get(`${f.station}|${f.day}|${f.hour}`);
    const score = cScore?.score || 0;

    let riskLevel: ActiveAlert['riskLevel'];
    if (score >= 70 || f.avgViolations >= 80) riskLevel = 'critical';
    else if (score >= 40 || f.avgViolations >= 40) riskLevel = 'high';
    else riskLevel = 'moderate';

    // Generate actionable recommendation
    let recommendation: string;
    if (riskLevel === 'critical') {
      const officers = Math.max(3, Math.ceil(f.avgViolations / 30));
      recommendation = `Deploy ${officers} officers immediately. Activate CCTV monitoring. Review towing capacity.`;
    } else if (riskLevel === 'high') {
      const officers = Math.max(2, Math.ceil(f.avgViolations / 40));
      recommendation = `Deploy ${officers} officers. Review CCTV evidence. Consider temporary no-parking signage.`;
    } else {
      recommendation = `Maintain patrol presence. Monitor CCTV feeds for escalation.`;
    }

    alerts.push({
      id: `alert-${f.station}-${f.hour}`,
      station: f.station,
      junction: cScore?.junction || 'Street patrol zone',
      riskLevel,
      congestionScore: score,
      expectedViolations: Math.round(f.avgViolations),
      recommendation,
      hour: f.hour,
      day: f.day,
    });
  }

  return alerts.sort((a, b) => {
    const riskOrder = { critical: 0, high: 1, moderate: 2 };
    return (riskOrder[a.riskLevel] - riskOrder[b.riskLevel]) || (b.expectedViolations - a.expectedViolations);
  }).slice(0, 20);
}


// ────────────────────────────────────────────
//  CCTV SIMULATION DATA
// ────────────────────────────────────────────
function computeCCTV(
  records: RawRecord[],
  congestion: CongestionScoreEntry[],
  junctions: { junction: string; count: number; parkingCount: number }[],
): { cctvCameras: CCTVCamera[]; vehiclePool: { number: string; type: string }[] } {
  // Place cameras at top congestion junctions + top hotspot junctions
  const cameraLocations = new Map<string, { station: string; lat: number; lon: number }>();

  // From congestion scores (these have junctions + stations)
  for (const c of congestion.slice(0, 8)) {
    if (!cameraLocations.has(c.junction)) {
      // Find a record with this junction to get lat/lon
      const rec = records.find(r => r.junction_name === c.junction);
      if (rec) {
        cameraLocations.set(c.junction, {
          station: c.station,
          lat: +rec.latitude,
          lon: +rec.longitude,
        });
      }
    }
  }

  // From junction hotspots
  for (const j of junctions.slice(0, 6)) {
    if (!cameraLocations.has(j.junction)) {
      const rec = records.find(r => r.junction_name === j.junction);
      if (rec) {
        cameraLocations.set(j.junction, {
          station: rec.police_station,
          lat: +rec.latitude,
          lon: +rec.longitude,
        });
      }
    }
  }

  const cctvCameras: CCTVCamera[] = [...cameraLocations.entries()].slice(0, 12).map(([junction, info], i) => ({
    cameraId: `CAM-${String(i + 1).padStart(3, '0')}`,
    station: info.station,
    junction,
    lat: info.lat,
    lon: info.lon,
  }));

  // Build a pool of real vehicle numbers + types from the dataset for realistic simulation
  // Pick vehicles that are repeat offenders (more realistic to flag)
  const vehicleCounter = new Map<string, { count: number; type: string }>();
  for (const r of records) {
    if (!r.vehicle_number) continue;
    const existing = vehicleCounter.get(r.vehicle_number);
    if (existing) {
      existing.count++;
    } else {
      vehicleCounter.set(r.vehicle_number, { count: 1, type: (r.vehicle_type || 'UNKNOWN').toUpperCase() });
    }
  }

  // Take top 200 repeat offenders as the simulation pool
  const vehiclePool = [...vehicleCounter.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 200)
    .map(([number, info]) => ({ number, type: info.type }));

  return { cctvCameras, vehiclePool };
}
