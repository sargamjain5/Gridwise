/**
 * Precompute dashboard metrics from the large CSV and write a compact JSON.
 * Run: node scripts/precompute.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, '../../jan to may police violation_anonymized791b166.csv');
const OUT_PATH = resolve(__dirname, '../public/precomputed.json');

console.log('Reading CSV...');
const raw = readFileSync(CSV_PATH, 'utf-8');

console.log('Parsing CSV...');
const lines = raw.split('\n');
const header = lines[0].split(',');

// Simple CSV parser that handles quoted fields
function parseLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

const records = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const values = parseLine(line);
  const obj = {};
  for (let j = 0; j < header.length; j++) {
    obj[header[j].trim()] = (values[j] || '').trim();
  }
  records.push(obj);
}
console.log(`Parsed ${records.length} records`);

// ---- Inline processing (mirrors processData.ts logic) ----

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const RUSH_HOURS = new Set([8, 9, 10, 11, 17, 18, 19]);

function parseViolations(val) {
  if (!val || val === 'NULL') return [];
  try {
    const cleaned = val.replace(/""/g, '"');
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.map(v => v.trim().toUpperCase());
    return [String(parsed).trim().toUpperCase()];
  } catch {
    try {
      const match = val.match(/\[(.+)\]/);
      if (match) return match[1].split(',').map(s => s.replace(/"/g, '').trim().toUpperCase()).filter(Boolean);
    } catch {}
    return [val.trim().toUpperCase()];
  }
}

function toIST(utcStr) {
  if (!utcStr || utcStr === 'NULL') return null;
  const d = new Date(utcStr);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
}

function countMap(arr) {
  const m = new Map();
  for (const item of arr) m.set(item, (m.get(item) || 0) + 1);
  return m;
}

function sortedEntries(map, limit) {
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return limit ? sorted.slice(0, limit) : sorted;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function zScore(value, mean, sd) {
  return sd === 0 ? 0 : (value - mean) / sd;
}

console.log('Computing metrics...');

const total = records.length;
const violationLists = records.map(r => parseViolations(r.violation_type));
const allViolations = violationLists.flat();
const isParkingArr = violationLists.map(vl => vl.some(v => v.includes('PARKING')));
const totalParking = isParkingArr.filter(Boolean).length;
const istDates = records.map(r => toIST(r.created_datetime));

const vehicleCounter = countMap(records.map(r => r.vehicle_number));
const uniqueVehicles = vehicleCounter.size;
const stationCounter = countMap(records.map(r => r.police_station).filter(Boolean));
const uniqueStations = stationCounter.size;

const validDates = istDates.filter(d => d !== null);
validDates.sort((a, b) => a.getTime() - b.getTime());
const minDate = validDates[0] || new Date();
const maxDate = validDates[validDates.length - 1] || new Date();
const fmtDate = d => d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
const dateRange = `${fmtDate(minDate)} – ${fmtDate(maxDate)}`;

// Hotspots
const hotspots = sortedEntries(stationCounter, 12).map(([station, count]) => ({
  station, count, pct: +((count / total) * 100).toFixed(1)
}));

// Junctions
const junctionCounter = countMap(records.map(r => r.junction_name).filter(v => v && v !== 'No Junction'));
const parkingJunctionCounter = new Map();
records.forEach((r, i) => {
  if (isParkingArr[i] && r.junction_name && r.junction_name !== 'No Junction')
    parkingJunctionCounter.set(r.junction_name, (parkingJunctionCounter.get(r.junction_name) || 0) + 1);
});
const junctionHotspots = sortedEntries(junctionCounter, 15).map(([junction, count]) => ({
  junction, count, parkingCount: parkingJunctionCounter.get(junction) || 0
}));

// Violations
const violCounter = countMap(allViolations);
const totalViol = allViolations.length;
const violationBreakdown = sortedEntries(violCounter, 12).map(([type, count]) => ({
  type: type.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
  count, pct: +((count / totalViol) * 100).toFixed(1)
}));

// Vehicle types
const vtypeCounter = countMap(records.map(r => (r.vehicle_type || '').toUpperCase().trim()).filter(Boolean));
const vehicleTypes = sortedEntries(vtypeCounter, 15).map(([type, count]) => ({
  type, count, pct: +((count / total) * 100).toFixed(1)
}));

// Hourly
const hourCounter = new Map();
for (const d of istDates) { if (d) { const h = d.getUTCHours(); hourCounter.set(h, (hourCounter.get(h) || 0) + 1); } }
const hourlyPattern = Array.from({ length: 24 }, (_, h) => ({
  hour: h, count: hourCounter.get(h) || 0, label: `${h.toString().padStart(2, '0')}:00`
}));
const peakHour = hourlyPattern.reduce((max, cur) => cur.count > max.count ? cur : max).hour;

// Day of week
const dowCounter = new Map();
for (const d of istDates) { if (d) { const name = DAY_NAMES[d.getUTCDay()]; dowCounter.set(name, (dowCounter.get(name) || 0) + 1); } }
const dayOfWeekPattern = DAY_ORDER.map(day => ({ day: day.slice(0, 3), count: dowCounter.get(day) || 0 }));

// Monthly
const monthCounter = new Map();
for (const d of istDates) {
  if (d) {
    const key = `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
    monthCounter.set(key, (monthCounter.get(key) || 0) + 1);
  }
}
const monthlyTrend = [...monthCounter.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => {
  const [y, m] = month.split('-');
  return { month: new Date(+y, +m - 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }), count };
});

// Repeat offenders
const vehicleSorted = [...vehicleCounter.entries()].sort((a, b) => b[1] - a[1]);
const vehicleStations = new Map();
const vehicleTypes2 = new Map();
for (const r of records) {
  if (!vehicleStations.has(r.vehicle_number)) vehicleStations.set(r.vehicle_number, new Set());
  if (r.police_station) vehicleStations.get(r.vehicle_number).add(r.police_station);
  if (r.vehicle_type && !vehicleTypes2.has(r.vehicle_number)) vehicleTypes2.set(r.vehicle_number, r.vehicle_type.toUpperCase());
}
const topRepeatOffenders = vehicleSorted.slice(0, 20).map(([vehicle, count]) => ({
  vehicle, count, stations: [...(vehicleStations.get(vehicle) || [])], vehicleType: vehicleTypes2.get(vehicle) || 'UNKNOWN'
}));

const repeatBuckets = [['1', n => n === 1], ['2', n => n === 2], ['3', n => n === 3],
  ['4-5', n => n >= 4 && n <= 5], ['6-10', n => n >= 6 && n <= 10],
  ['11-50', n => n >= 11 && n <= 50], ['50+', n => n > 50]];
const repeatDistribution = repeatBuckets.map(([bucket, pred]) => {
  const vehicles = [...vehicleCounter.values()].filter(pred).length;
  return { bucket, vehicles, pct: +((vehicles / uniqueVehicles) * 100).toFixed(1) };
});
const repeatOffenderCount = [...vehicleCounter.values()].filter(v => v >= 2).length;
const repeatOffenderPct = +((repeatOffenderCount / uniqueVehicles) * 100).toFixed(1);

// Validation
const valCounter = countMap(records.map(r => r.validation_status || '').filter(Boolean));
const validatedTotal = [...valCounter.values()].reduce((s, v) => s + v, 0);
const validationData = sortedEntries(valCounter).map(([status, count]) => ({
  status, count, pct: +((count / validatedTotal) * 100).toFixed(1)
}));
const approvedCount = valCounter.get('approved') || 0;
const rejectedCount = valCounter.get('rejected') || 0;
const approvalRate = validatedTotal > 0 ? +((approvedCount / validatedTotal) * 100).toFixed(1) : 0;
const rejectionRate = validatedTotal > 0 ? +((rejectedCount / validatedTotal) * 100).toFixed(1) : 0;
const validatedPct = +((validatedTotal / total) * 100).toFixed(1);

// Grid
const gridMap = new Map();
for (let i = 0; i < records.length; i++) {
  if (!isParkingArr[i]) continue;
  const lat = +records[i].latitude; const lon = +records[i].longitude;
  if (isNaN(lat) || isNaN(lon) || lat < 12.8 || lat > 13.15 || lon < 77.45 || lon > 77.78) continue;
  const key = `${Math.round(lat * 100) / 100},${Math.round(lon * 100) / 100}`;
  const existing = gridMap.get(key);
  if (existing) existing.count++;
  else gridMap.set(key, { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, count: 1 });
}
const gridHotspots = [...gridMap.values()].sort((a, b) => b.count - a.count).slice(0, 30);

// ---- ANOMALY DETECTION ----
console.log('Computing anomaly detection...');
function computeAnomaliesForType(records, istDates, field, type) {
  const stats = new Map();
  for (let i = 0; i < records.length; i++) {
    const r = records[i]; const d = istDates[i]; const id = r[field];
    if (!id) continue;
    const dayKey = d ? `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` : '';
    if (!stats.has(id)) stats.set(id, { violations: 0, days: new Set(), lats: [], lons: [], rejected: 0, validated: 0, stations: new Map() });
    const s = stats.get(id);
    s.violations++;
    if (dayKey) s.days.add(dayKey);
    const lat = +r.latitude; const lon = +r.longitude;
    if (!isNaN(lat)) s.lats.push(lat);
    if (!isNaN(lon)) s.lons.push(lon);
    if (r.validation_status) { s.validated++; if (r.validation_status === 'rejected') s.rejected++; }
    if (r.police_station) s.stations.set(r.police_station, (s.stations.get(r.police_station) || 0) + 1);
  }

  const entries = [...stats.entries()].filter(([, s]) => s.violations >= 20);
  if (entries.length < 5) return [];

  const vpds = entries.map(([, s]) => s.violations / Math.max(s.days.size, 1));
  const rejRates = entries.map(([, s]) => s.validated > 0 ? s.rejected / s.validated : 0);
  const geoSpreads = entries.map(([, s]) => Math.sqrt(stdDev(s.lats) ** 2 + stdDev(s.lons) ** 2));

  const meanVPD = vpds.reduce((a, b) => a + b, 0) / vpds.length;
  const sdVPD = stdDev(vpds);
  const meanRej = rejRates.reduce((a, b) => a + b, 0) / rejRates.length;
  const sdRej = stdDev(rejRates);
  const meanGeo = geoSpreads.reduce((a, b) => a + b, 0) / geoSpreads.length;
  const sdGeo = stdDev(geoSpreads);

  const results = [];
  for (let idx = 0; idx < entries.length; idx++) {
    const [id, s] = entries[idx];
    const activeDays = Math.max(s.days.size, 1);
    const vpd = s.violations / activeDays;
    const rr = s.validated > 0 ? s.rejected / s.validated : 0;
    const geo = geoSpreads[idx];
    const zVPD = Math.abs(zScore(vpd, meanVPD, sdVPD));
    const zRej = Math.abs(zScore(rr, meanRej, sdRej));
    const zGeo = Math.abs(zScore(geo, meanGeo, sdGeo));
    const anomalyScore = +(0.4 * zVPD + 0.35 * zRej + 0.25 * zGeo).toFixed(2);
    const flags = [];
    if (zVPD > 2) flags.push(`Unusually ${vpd > meanVPD ? 'high' : 'low'} activity: ${vpd.toFixed(1)}/day (avg ${meanVPD.toFixed(1)})`);
    if (zRej > 2) flags.push(`Rejection rate ${(rr * 100).toFixed(1)}% (avg ${(meanRej * 100).toFixed(1)}%)`);
    if (zGeo > 2) flags.push(`Geographic spread ${geo > meanGeo ? 'unusually wide' : 'unusually narrow'}`);
    const primaryStation = [...s.stations.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
    if (flags.length > 0) results.push({ id, type, totalViolations: s.violations, activeDays, violationsPerDay: +vpd.toFixed(1), rejectionRate: +(rr * 100).toFixed(1), geoSpread: +geo.toFixed(4), station: primaryStation, anomalyScore, flags });
  }
  return results.sort((a, b) => b.anomalyScore - a.anomalyScore).slice(0, 25);
}

const anomalies = [
  ...computeAnomaliesForType(records, istDates, 'created_by_id', 'officer'),
  ...computeAnomaliesForType(records, istDates, 'device_id', 'device'),
].sort((a, b) => b.anomalyScore - a.anomalyScore).slice(0, 30);

// ---- DEPLOYMENT RECOMMENDATIONS ----
console.log('Computing deployment recommendations...');
const cube = new Map();
const stationMeta = new Map();
for (let i = 0; i < records.length; i++) {
  const r = records[i]; const d = istDates[i];
  if (!d || !r.police_station) continue;
  const station = r.police_station;
  const dayShort = DAY_NAMES[d.getUTCDay()].slice(0, 3);
  const hour = d.getUTCHours();
  const dateKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;

  if (!cube.has(station)) cube.set(station, new Map());
  const dc = cube.get(station);
  if (!dc.has(dayShort)) dc.set(dayShort, new Map());
  const hc = dc.get(dayShort);
  if (!hc.has(hour)) hc.set(hour, { total: 0, parking: 0 });
  const cell = hc.get(hour);
  cell.total++; if (isParkingArr[i]) cell.parking++;

  if (!stationMeta.has(station)) stationMeta.set(station, { dates: new Set(), total: 0 });
  const meta = stationMeta.get(station);
  meta.dates.add(dateKey); meta.total++;
}

const allSlots = [];
for (const [station, dc] of cube) {
  for (const [day, hc] of dc) {
    for (const [hour, cell] of hc) {
      allSlots.push({ station, day, hour, expectedViolations: cell.total, priority: 'low', parkingShare: cell.total > 0 ? +((cell.parking / cell.total) * 100).toFixed(1) : 0 });
    }
  }
}
allSlots.sort((a, b) => b.expectedViolations - a.expectedViolations);
const sn = allSlots.length;
allSlots.forEach((slot, i) => {
  const pct = i / sn;
  if (pct < 0.05) slot.priority = 'critical';
  else if (pct < 0.15) slot.priority = 'high';
  else if (pct < 0.40) slot.priority = 'medium';
});
const deploymentSlots = allSlots.filter(s => s.priority === 'critical' || s.priority === 'high').slice(0, 50);

const maxStationTotal = Math.max(...[...stationMeta.values()].map(m => m.total), 1);
const stationProfiles = [];
for (const [station, meta] of stationMeta) {
  const dc = cube.get(station);
  let peakCount = 0, peakHourV = 0, peakDay = 'Mon';
  for (const [day, hc] of dc) for (const [hour, cell] of hc) {
    if (cell.total > peakCount) { peakCount = cell.total; peakHourV = hour; peakDay = day; }
  }
  stationProfiles.push({ station, totalViolations: meta.total, peakHour: peakHourV, peakDay, avgDailyViolations: +(meta.total / Math.max(meta.dates.size, 1)).toFixed(1), priorityScore: +((meta.total / maxStationTotal) * 100).toFixed(1) });
}
stationProfiles.sort((a, b) => b.priorityScore - a.priorityScore);

// ---- CONGESTION IMPACT ----
console.log('Computing congestion impact scores...');
const juncStats = new Map();
for (let i = 0; i < records.length; i++) {
  const r = records[i];
  if (!r.junction_name || r.junction_name === 'No Junction') continue;
  const d = istDates[i];
  if (!juncStats.has(r.junction_name)) juncStats.set(r.junction_name, { station: r.police_station || '', total: 0, parking: 0, multiViolation: 0, rushHour: 0, vehicles: new Set() });
  const j = juncStats.get(r.junction_name);
  j.total++;
  if (isParkingArr[i]) j.parking++;
  if (violationLists[i].length >= 2) j.multiViolation++;
  if (d && RUSH_HOURS.has(d.getUTCHours())) j.rushHour++;
  if (r.vehicle_number) j.vehicles.add(r.vehicle_number);
}

const congEntries = [...juncStats.entries()].filter(([, s]) => s.total >= 50);
const rawScores = congEntries.map(([, s]) => s.parking * (1 + s.multiViolation / s.total) * (1 + (s.rushHour / s.total) * 0.5));
const maxRaw = Math.max(...rawScores, 1);

const congestionScores = congEntries.map(([junction, s], i) => {
  const score = +((rawScores[i] / maxRaw) * 100).toFixed(1);
  let riskLevel = 'low';
  if (score >= 70) riskLevel = 'critical';
  else if (score >= 40) riskLevel = 'high';
  else if (score >= 15) riskLevel = 'moderate';
  return {
    junction, station: s.station, score,
    parkingViolations: s.parking, totalViolations: s.total,
    multiViolationRatio: +(s.multiViolation / s.total).toFixed(3),
    peakHourShare: +(s.rushHour / s.total).toFixed(3),
    uniqueVehicles: s.vehicles.size, riskLevel,
  };
}).sort((a, b) => b.score - a.score).slice(0, 30);

// ---- FORECAST LOOKUP ----
console.log('Computing forecast lookup...');
const forecastCube = new Map();
const forecastWeeks = new Set();
for (let i = 0; i < records.length; i++) {
  const r = records[i]; const d = istDates[i];
  if (!d || !r.police_station) continue;
  const dayShort = DAY_NAMES[d.getUTCDay()].slice(0, 3);
  const hour = d.getUTCHours();
  const key = `${r.police_station}|${dayShort}|${hour}`;
  forecastCube.set(key, (forecastCube.get(key) || 0) + 1);
  const wk = `${d.getUTCFullYear()}-W${Math.ceil((d.getUTCDate() + new Date(d.getUTCFullYear(), d.getUTCMonth(), 1).getUTCDay()) / 7)}`;
  forecastWeeks.add(wk);
}
const numWeeks = Math.max(forecastWeeks.size, 1);
const allAvgs = [...forecastCube.values()].map(c => c / numWeeks).sort((a, b) => a - b);
const p75 = allAvgs[Math.floor(allAvgs.length * 0.75)] || 1;
const p40 = allAvgs[Math.floor(allAvgs.length * 0.40)] || 0.5;
const forecastLookup = [];
for (const [key, count] of forecastCube) {
  const [station, day, hourStr] = key.split('|');
  const avg = +(count / numWeeks).toFixed(1);
  let risk = 'low';
  if (avg >= p75) risk = 'high';
  else if (avg >= p40) risk = 'medium';
  forecastLookup.push({ station, day, hour: +hourStr, avgViolations: avg, risk });
}

// ---- ACTIVE ALERTS ----
console.log('Computing active alerts...');
const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
const currentHourIST = now.getUTCHours();
const currentDayIST = DAY_NAMES[now.getUTCDay()].slice(0, 3);
const relevantHours = [currentHourIST, (currentHourIST + 1) % 24, (currentHourIST + 2) % 24];
const congMap = new Map();
for (const c of congestionScores) congMap.set(c.station, c);
const deployMapAlert = new Map();
for (const d of deploymentSlots) deployMapAlert.set(`${d.station}|${d.day}|${d.hour}`, d);
const seenStationsAlert = new Set();
const activeAlerts = [];
const relevantForecasts = forecastLookup.filter(f => f.day === currentDayIST && relevantHours.includes(f.hour) && f.risk === 'high');
for (const f of relevantForecasts) {
  if (seenStationsAlert.has(f.station)) continue;
  seenStationsAlert.add(f.station);
  const cScore = congMap.get(f.station);
  const score = cScore?.score || 0;
  let riskLevel = 'moderate';
  if (score >= 70 || f.avgViolations >= 80) riskLevel = 'critical';
  else if (score >= 40 || f.avgViolations >= 40) riskLevel = 'high';
  let recommendation;
  if (riskLevel === 'critical') {
    const officers = Math.max(3, Math.ceil(f.avgViolations / 30));
    recommendation = `Deploy ${officers} officers immediately. Activate CCTV monitoring. Review towing capacity.`;
  } else if (riskLevel === 'high') {
    const officers = Math.max(2, Math.ceil(f.avgViolations / 40));
    recommendation = `Deploy ${officers} officers. Review CCTV evidence. Consider temporary no-parking signage.`;
  } else {
    recommendation = `Maintain patrol presence. Monitor CCTV feeds for escalation.`;
  }
  activeAlerts.push({
    id: `alert-${f.station}-${f.hour}`, station: f.station,
    junction: cScore?.junction || 'Street patrol zone', riskLevel,
    congestionScore: score, expectedViolations: Math.round(f.avgViolations),
    recommendation, hour: f.hour, day: f.day,
  });
}
activeAlerts.sort((a, b) => {
  const ro = { critical: 0, high: 1, moderate: 2 };
  return (ro[a.riskLevel] - ro[b.riskLevel]) || (b.expectedViolations - a.expectedViolations);
});

// ---- CCTV CAMERAS + VEHICLE POOL ----
console.log('Computing CCTV camera placements...');
const cameraLocations = new Map();
for (const c of congestionScores.slice(0, 8)) {
  if (!cameraLocations.has(c.junction)) {
    const rec = records.find(r => r.junction_name === c.junction);
    if (rec) cameraLocations.set(c.junction, { station: c.station, lat: +rec.latitude, lon: +rec.longitude });
  }
}
for (const j of junctionHotspots.slice(0, 6)) {
  if (!cameraLocations.has(j.junction)) {
    const rec = records.find(r => r.junction_name === j.junction);
    if (rec) cameraLocations.set(j.junction, { station: rec.police_station, lat: +rec.latitude, lon: +rec.longitude });
  }
}
const cctvCameras = [...cameraLocations.entries()].slice(0, 12).map(([junction, info], i) => ({
  cameraId: `CAM-${String(i + 1).padStart(3, '0')}`,
  station: info.station, junction, lat: info.lat, lon: info.lon,
}));
const vehPoolMap = new Map();
for (const r of records) {
  if (!r.vehicle_number) continue;
  const ex = vehPoolMap.get(r.vehicle_number);
  if (ex) ex.count++;
  else vehPoolMap.set(r.vehicle_number, { count: 1, type: (r.vehicle_type || 'UNKNOWN').toUpperCase() });
}
const vehiclePool = [...vehPoolMap.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 200)
  .map(([number, info]) => ({ number, type: info.type }));

// ---- PREDICTION GRID (fine-grained with temporal breakdown) ----
console.log('Computing prediction grid...');
const predGrid = new Map(); // "lat,lon" -> { totalCount, hourly[24], daily[7], vehicles: Set }
const PRED_RESOLUTION = 200; // round to ~500m grid (lat*200)

for (let i = 0; i < records.length; i++) {
  const r = records[i];
  const d = istDates[i];
  const lat = +r.latitude;
  const lon = +r.longitude;
  if (isNaN(lat) || isNaN(lon) || lat < 12.8 || lat > 13.15 || lon < 77.45 || lon > 77.78) continue;

  const gLat = Math.round(lat * PRED_RESOLUTION) / PRED_RESOLUTION;
  const gLon = Math.round(lon * PRED_RESOLUTION) / PRED_RESOLUTION;
  const key = `${gLat},${gLon}`;

  if (!predGrid.has(key)) {
    predGrid.set(key, {
      lat: gLat, lon: gLon, totalCount: 0,
      hourly: new Array(24).fill(0),
      daily: new Array(7).fill(0),
      vehicles: new Set(),
    });
  }
  const cell = predGrid.get(key);
  cell.totalCount++;
  if (d) {
    cell.hourly[d.getUTCHours()]++;
    cell.daily[d.getUTCDay()]++;
  }
  if (r.vehicle_number) cell.vehicles.add(r.vehicle_number);
}

const predictionGrid = [...predGrid.values()].map(c => ({
  lat: c.lat, lon: c.lon, totalCount: c.totalCount,
  hourly: c.hourly, daily: c.daily,
  uniqueVehicles: c.vehicles.size,
}));
console.log(`Prediction grid: ${predictionGrid.length} cells`);

// ---- REPEAT OFFENDER RISK ENGINE DATA ----
console.log('Computing repeat offender risk profiles...');
const offenderMap = new Map(); // vehicleNumber -> rich profile
for (let i = 0; i < records.length; i++) {
  const r = records[i];
  const d = istDates[i];
  if (!r.vehicle_number) continue;
  if (!offenderMap.has(r.vehicle_number)) {
    offenderMap.set(r.vehicle_number, {
      vehicle: r.vehicle_number,
      type: (r.vehicle_type || 'UNKNOWN').toUpperCase(),
      count: 0,
      stations: new Map(),
      junctions: new Map(),
      violations: new Map(), // violation type -> count
      dates: [],
      rejected: 0,
      validated: 0,
      hotspotHits: 0, // violations in critical/high congestion zones
      parkingViolations: 0,
    });
  }
  const o = offenderMap.get(r.vehicle_number);
  o.count++;
  if (r.police_station) o.stations.set(r.police_station, (o.stations.get(r.police_station) || 0) + 1);
  if (r.junction_name && r.junction_name !== 'No Junction') o.junctions.set(r.junction_name, (o.junctions.get(r.junction_name) || 0) + 1);
  if (d) o.dates.push(d.getTime());
  if (r.validation_status) { o.validated++; if (r.validation_status === 'rejected') o.rejected++; }
  // Check if this is a parking violation
  if (isParkingArr[i]) o.parkingViolations++;
}

// Identify which stations are high-congestion
const highCongStations = new Set(congestionScores.filter(c => c.riskLevel === 'critical' || c.riskLevel === 'high').map(c => c.station));

// Build risk profiles for top 500 offenders (2+ violations)
const offendersSorted = [...offenderMap.values()]
  .filter(o => o.count >= 2)
  .sort((a, b) => b.count - a.count)
  .slice(0, 500);

const maxCount = offendersSorted[0]?.count || 1;

const offenderProfiles = offendersSorted.map(o => {
  // Count hotspot hits
  let hotspotHits = 0;
  for (const [st, cnt] of o.stations) {
    if (highCongStations.has(st)) hotspotHits += cnt;
  }

  // Frequency: violations per month (spread across date range)
  const dates = o.dates.sort((a, b) => a - b);
  const spanDays = dates.length >= 2 ? (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24) : 30;
  const frequencyPerMonth = spanDays > 0 ? (o.count / spanDays) * 30 : o.count;

  // Geographic spread: number of unique stations
  const stationCount = o.stations.size;
  const junctionCount = o.junctions.size;

  // Escalation: are violations increasing over time?
  let escalation = 1.0;
  if (dates.length >= 4) {
    const mid = Math.floor(dates.length / 2);
    const firstHalf = mid;
    const secondHalf = dates.length - mid;
    const firstSpan = dates.length >= 2 ? (dates[mid - 1] - dates[0]) / (1000 * 60 * 60 * 24) || 1 : 1;
    const secondSpan = dates.length >= 2 ? (dates[dates.length - 1] - dates[mid]) / (1000 * 60 * 60 * 24) || 1 : 1;
    const firstRate = firstHalf / firstSpan;
    const secondRate = secondHalf / secondSpan;
    escalation = secondRate / (firstRate || 1);
  }

  // Recency: days since last violation
  const lastViolation = dates.length > 0 ? dates[dates.length - 1] : Date.now();
  const recencyDays = Math.max(1, (Date.now() - lastViolation) / (1000 * 60 * 60 * 24));

  return {
    vehicle: o.vehicle,
    vehicleType: o.type,
    totalViolations: o.count,
    parkingViolations: o.parkingViolations,
    stations: [...o.stations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, c]) => ({ station: s, count: c })),
    stationCount,
    junctionCount,
    frequencyPerMonth: +frequencyPerMonth.toFixed(1),
    hotspotHits,
    hotspotRatio: +(hotspotHits / o.count).toFixed(2),
    escalation: +Math.min(3, escalation).toFixed(2),
    recencyDays: Math.round(recencyDays),
    rejectionRate: o.validated > 0 ? +((1 - o.rejected / o.validated) * 100).toFixed(1) : 0, // approval rate = confirms violations are real
  };
});

console.log(`Offender profiles: ${offenderProfiles.length}`);

// ---- Assemble ----
const metrics = {
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
  anomalies, deploymentSlots, stationProfiles: stationProfiles.slice(0, 20), congestionScores,
  forecastLookup, activeAlerts: activeAlerts.slice(0, 20), cctvCameras, vehiclePool,
  predictionGrid,
  offenderProfiles,
};

console.log('Writing precomputed.json...');
writeFileSync(OUT_PATH, JSON.stringify(metrics));
const sizeMB = (Buffer.byteLength(JSON.stringify(metrics)) / 1e6).toFixed(2);
console.log(`Done! Output: ${OUT_PATH} (${sizeMB} MB)`);
