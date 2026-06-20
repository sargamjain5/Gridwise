export interface RawRecord {
  id: string;
  latitude: number;
  longitude: number;
  location: string;
  vehicle_number: string;
  vehicle_type: string;
  description: string;
  violation_type: string;
  offence_code: string;
  created_datetime: string;
  closed_datetime: string;
  modified_datetime: string;
  device_id: string;
  created_by_id: string;
  center_code: string;
  police_station: string;
  data_sent_to_scita: string;
  junction_name: string;
  action_taken_timestamp: string;
  data_sent_to_scita_timestamp: string;
  updated_vehicle_number: string;
  updated_vehicle_type: string;
  validation_status: string;
  validation_timestamp: string;
}

export interface HotspotData {
  station: string;
  count: number;
  pct: number;
}

export interface JunctionHotspot {
  junction: string;
  count: number;
  parkingCount: number;
}

export interface ViolationBreakdown {
  type: string;
  count: number;
  pct: number;
}

export interface VehicleTypeData {
  type: string;
  count: number;
  pct: number;
}

export interface HourlyData {
  hour: number;
  count: number;
  label: string;
}

export interface DayOfWeekData {
  day: string;
  count: number;
}

export interface MonthlyData {
  month: string;
  count: number;
}

export interface RepeatOffender {
  vehicle: string;
  count: number;
  stations: string[];
  vehicleType: string;
}

export interface RepeatDistribution {
  bucket: string;
  vehicles: number;
  pct: number;
}

export interface ValidationData {
  status: string;
  count: number;
  pct: number;
}

export interface GridCell {
  lat: number;
  lon: number;
  count: number;
}

export interface AnomalyRecord {
  id: string;
  type: 'officer' | 'device';
  totalViolations: number;
  activeDays: number;
  violationsPerDay: number;
  rejectionRate: number;
  geoSpread: number;
  station: string;
  anomalyScore: number;
  flags: string[];
}

export interface DeploymentSlot {
  station: string;
  day: string;
  hour: number;
  expectedViolations: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  parkingShare: number;
}

export interface StationDeploymentProfile {
  station: string;
  totalViolations: number;
  peakHour: number;
  peakDay: string;
  avgDailyViolations: number;
  priorityScore: number;
}

export interface CongestionScoreEntry {
  junction: string;
  station: string;
  score: number;
  parkingViolations: number;
  totalViolations: number;
  multiViolationRatio: number;
  peakHourShare: number;
  uniqueVehicles: number;
  riskLevel: 'critical' | 'high' | 'moderate' | 'low';
}

// --- Congestion Forecast lookup ---
export interface ForecastEntry {
  station: string;
  day: string;       // Mon, Tue, ...
  hour: number;
  avgViolations: number;
  risk: 'high' | 'medium' | 'low';
}

// --- Active Alert ---
export interface ActiveAlert {
  id: string;
  station: string;
  junction: string;
  riskLevel: 'critical' | 'high' | 'moderate';
  congestionScore: number;
  expectedViolations: number;
  recommendation: string;
  hour: number;
  day: string;
}

// --- CCTV Simulation ---
export interface CCTVCamera {
  cameraId: string;
  station: string;
  junction: string;
  lat: number;
  lon: number;
}

export interface CCTVDetection {
  id: string;
  cameraId: string;
  station: string;
  junction: string;
  vehicleNumber: string;
  vehicleType: string;
  violationType: string;
  timestamp: number;       // epoch ms
  confidence: number;      // 0-100
  status: 'pending' | 'approved' | 'dismissed';
}

// --- Hotspot Prediction Engine ---
export interface PredictionGridCell {
  lat: number;
  lon: number;
  totalCount: number;
  // Violation counts per hour (0-23)
  hourly: number[];
  // Violation counts per day (0=Sun..6=Sat)
  daily: number[];
  // Unique vehicles seen
  uniqueVehicles: number;
}

export interface HotspotPrediction {
  lat: number;
  lon: number;
  score: number;       // 0-100
  level: 'critical' | 'high' | 'medium' | 'low';
  spatialScore: number;
  temporalScore: number;
  contextualScore: number;
  nearbyViolations: number;
  expectedVehicles: number;
}

// --- Repeat Offender Risk Engine ---
export interface OffenderProfile {
  vehicle: string;
  vehicleType: string;
  totalViolations: number;
  parkingViolations: number;
  stations: { station: string; count: number }[];
  stationCount: number;
  junctionCount: number;
  frequencyPerMonth: number;
  hotspotHits: number;
  hotspotRatio: number;      // fraction of violations in critical/high zones
  escalation: number;        // >1 = violations increasing over time
  recencyDays: number;       // days since last violation
  rejectionRate: number;     // approval rate (higher = confirmed violations)
}

export interface OffenderRiskScore {
  profile: OffenderProfile;
  score: number;             // 0-100
  level: 'critical' | 'high' | 'medium' | 'low';
  factors: {
    volumeScore: number;
    frequencyScore: number;
    hotspotScore: number;
    escalationScore: number;
    recencyScore: number;
    spreadScore: number;
  };
}

export interface DashboardMetrics {
  totalRecords: number;
  totalParkingRecords: number;
  parkingPct: number;
  uniqueVehicles: number;
  uniqueStations: number;
  dateRange: string;
  approvalRate: number;
  rejectionRate: number;
  validatedPct: number;

  hotspots: HotspotData[];
  junctionHotspots: JunctionHotspot[];
  violationBreakdown: ViolationBreakdown[];
  vehicleTypes: VehicleTypeData[];
  hourlyPattern: HourlyData[];
  dayOfWeekPattern: DayOfWeekData[];
  monthlyTrend: MonthlyData[];
  topRepeatOffenders: RepeatOffender[];
  repeatDistribution: RepeatDistribution[];
  validationData: ValidationData[];
  gridHotspots: GridCell[];
  peakHour: number;
  topStation: string;
  repeatOffenderPct: number;

  anomalies: AnomalyRecord[];
  deploymentSlots: DeploymentSlot[];
  stationProfiles: StationDeploymentProfile[];
  congestionScores: CongestionScoreEntry[];

  // New
  forecastLookup: ForecastEntry[];
  activeAlerts: ActiveAlert[];
  cctvCameras: CCTVCamera[];
  vehiclePool: { number: string; type: string }[];
  // Prediction engine training data
  predictionGrid: PredictionGridCell[];
  offenderProfiles: OffenderProfile[];
}
