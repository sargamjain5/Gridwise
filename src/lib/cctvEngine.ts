import type { CCTVCamera } from './types';

// ── Types ──

export interface NoParkingZone {
  id: string;
  name: string;
  polygon: [number, number][]; // [lat, lon] vertices
  station: string;
  severity: 'critical' | 'high' | 'moderate';
}

export interface DetectedVehicle {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  lat: number;
  lon: number;
  firstSeen: number;    // epoch ms
  lastSeen: number;
  dwellTimeS: number;   // how long parked
  inZone: NoParkingZone | null;
}

export interface ViolationFlag {
  id: string;
  cameraId: string;
  cameraLat: number;
  cameraLon: number;
  zoneId: string;
  zoneName: string;
  vehicleNumber: string;
  vehicleType: string;
  lat: number;
  lon: number;
  timestamp: number;
  dwellTimeS: number;
  confidence: number;       // 0-100
  status: 'flagged' | 'confirmed' | 'dismissed';
  frameId: string;
  severity: 'critical' | 'high' | 'moderate';
}

export interface FrameProcessingResult {
  frameId: string;
  cameraId: string;
  timestamp: number;
  vehiclesDetected: number;
  vehiclesInZone: number;
  violationsFlagged: number;
  processingTimeMs: number;
}

export interface EngineStats {
  framesProcessed: number;
  totalDetections: number;
  totalViolations: number;
  avgProcessingMs: number;
  activeVehicles: number;
  fps: number;
}

// ── Polygon math ──

function pointInPolygon(lat: number, lon: number, polygon: [number, number][]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (((yi > lon) !== (yj > lon)) && (lat < (xj - xi) * (lon - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Generate no-parking zone polygons from camera locations ──

export function generateNoParkingZones(
  cameras: CCTVCamera[],
  congestionScores: { junction: string; station: string; score: number; riskLevel: string }[],
): NoParkingZone[] {
  const zones: NoParkingZone[] = [];

  // Create zones around cameras (which are placed at high-violation junctions)
  for (const cam of cameras) {
    const cong = congestionScores.find(c => c.junction === cam.junction);
    const severity = cong?.riskLevel === 'critical' ? 'critical' as const
      : cong?.riskLevel === 'high' ? 'high' as const : 'moderate' as const;

    // Create a rectangular no-parking zone around the junction
    // Size varies by severity
    const size = severity === 'critical' ? 0.0015 : severity === 'high' ? 0.0012 : 0.001;

    // Slightly irregular polygon (not perfect rectangle) for realism
    const jitter = () => (Math.random() - 0.5) * 0.0003;
    const polygon: [number, number][] = [
      [cam.lat - size + jitter(), cam.lon - size + jitter()],
      [cam.lat - size + jitter(), cam.lon + size + jitter()],
      [cam.lat + size + jitter(), cam.lon + size + jitter()],
      [cam.lat + size + jitter(), cam.lon - size + jitter()],
    ];

    zones.push({
      id: `zone-${cam.cameraId}`,
      name: `No Parking — ${cam.junction}`,
      polygon,
      station: cam.station,
      severity,
    });
  }

  return zones;
}

// ── CCTV Automation Engine ──

const VEHICLE_TYPES = ['CAR', 'SCOOTER', 'MOTOR CYCLE', 'AUTO', 'SUV', 'VAN', 'BUS'];

export class CCTVAutomationEngine {
  private cameras: CCTVCamera[];
  private zones: NoParkingZone[];
  private vehiclePool: { number: string; type: string }[];
  private activeVehicles: Map<string, DetectedVehicle> = new Map();
  private frameCount = 0;
  private totalProcessingMs = 0;
  private totalDetections = 0;
  private totalViolations = 0;
  private lastFrameTime = 0;
  private frameTimestamps: number[] = [];

  onViolation: ((flag: ViolationFlag) => void) | null = null;
  onFrame: ((result: FrameProcessingResult) => void) | null = null;

  constructor(
    cameras: CCTVCamera[],
    zones: NoParkingZone[],
    vehiclePool: { number: string; type: string }[],
  ) {
    this.cameras = cameras;
    this.zones = zones;
    this.vehiclePool = vehiclePool;
  }

  // Process one "frame" from a random camera
  processFrame(): FrameProcessingResult {
    const startTime = performance.now();
    const camera = this.cameras[Math.floor(Math.random() * this.cameras.length)];
    const now = Date.now();
    this.frameCount++;
    this.frameTimestamps.push(now);
    // Keep only last 30 timestamps for FPS calc
    if (this.frameTimestamps.length > 30) this.frameTimestamps.shift();

    const frameId = `F-${this.frameCount.toString().padStart(6, '0')}`;

    // Simulate vehicle detection: 1-5 vehicles per frame
    const numDetected = 1 + Math.floor(Math.random() * 5);
    let vehiclesInZone = 0;
    let violationsFlagged = 0;

    for (let v = 0; v < numDetected; v++) {
      // Simulate vehicle position near the camera
      const spread = 0.002;
      const vLat = camera.lat + (Math.random() - 0.5) * spread;
      const vLon = camera.lon + (Math.random() - 0.5) * spread;

      // Pick a vehicle from pool (70%) or generate random (30%)
      const poolVehicle = Math.random() < 0.7
        ? this.vehiclePool[Math.floor(Math.random() * this.vehiclePool.length)]
        : { number: `KA${Math.floor(Math.random() * 99).toString().padStart(2, '0')}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(1000 + Math.random() * 9000)}`, type: VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)] };

      const vehicleId = `${camera.cameraId}-${poolVehicle.number}`;

      // Check if vehicle is in any no-parking zone
      let matchedZone: NoParkingZone | null = null;
      for (const zone of this.zones) {
        if (pointInPolygon(vLat, vLon, zone.polygon)) {
          matchedZone = zone;
          break;
        }
      }

      // Track the vehicle
      const existing = this.activeVehicles.get(vehicleId);
      if (existing) {
        existing.lastSeen = now;
        existing.dwellTimeS = Math.round((now - existing.firstSeen) / 1000);
        existing.lat = vLat;
        existing.lon = vLon;
        existing.inZone = matchedZone;
      } else {
        this.activeVehicles.set(vehicleId, {
          id: vehicleId,
          vehicleNumber: poolVehicle.number,
          vehicleType: poolVehicle.type,
          lat: vLat, lon: vLon,
          firstSeen: now, lastSeen: now,
          dwellTimeS: 0,
          inZone: matchedZone,
        });
      }

      if (matchedZone) {
        vehiclesInZone++;
        const vehicle = this.activeVehicles.get(vehicleId)!;

        // Flag violation if vehicle has been in zone for > 30 seconds (simulated)
        // In simulation, we accelerate time: treat each frame as ~10 seconds
        const effectiveDwell = vehicle.dwellTimeS + 10;
        vehicle.dwellTimeS = effectiveDwell;

        if (effectiveDwell >= 30) {
          violationsFlagged++;
          this.totalViolations++;

          // Confidence based on dwell time and zone severity
          const baseConf = matchedZone.severity === 'critical' ? 82 : matchedZone.severity === 'high' ? 75 : 68;
          const dwellBonus = Math.min(15, Math.floor(effectiveDwell / 20));
          const confidence = Math.min(99, baseConf + dwellBonus + Math.floor(Math.random() * 8));

          const flag: ViolationFlag = {
            id: `VIO-${this.totalViolations.toString().padStart(5, '0')}`,
            cameraId: camera.cameraId,
            cameraLat: camera.lat,
            cameraLon: camera.lon,
            zoneId: matchedZone.id,
            zoneName: matchedZone.name,
            vehicleNumber: vehicle.vehicleNumber,
            vehicleType: vehicle.vehicleType,
            lat: vLat, lon: vLon,
            timestamp: now,
            dwellTimeS: effectiveDwell,
            confidence,
            status: 'flagged',
            frameId,
            severity: matchedZone.severity,
          };

          this.onViolation?.(flag);

          // Remove vehicle from active tracking after flagging
          this.activeVehicles.delete(vehicleId);
        }
      }

      this.totalDetections++;
    }

    // Expire old vehicles (not seen for > 60 seconds)
    for (const [id, v] of this.activeVehicles) {
      if (now - v.lastSeen > 60000) {
        this.activeVehicles.delete(id);
      }
    }

    const processingTimeMs = Math.round((performance.now() - startTime) * 100) / 100;
    this.totalProcessingMs += processingTimeMs;

    const result: FrameProcessingResult = {
      frameId, cameraId: camera.cameraId,
      timestamp: now, vehiclesDetected: numDetected,
      vehiclesInZone, violationsFlagged, processingTimeMs,
    };

    this.onFrame?.(result);
    return result;
  }

  getStats(): EngineStats {
    const now = Date.now();
    const recentFrames = this.frameTimestamps.filter(t => now - t < 5000);
    const fps = recentFrames.length > 1
      ? recentFrames.length / ((now - recentFrames[0]) / 1000)
      : 0;

    return {
      framesProcessed: this.frameCount,
      totalDetections: this.totalDetections,
      totalViolations: this.totalViolations,
      avgProcessingMs: this.frameCount > 0 ? Math.round(this.totalProcessingMs / this.frameCount * 100) / 100 : 0,
      activeVehicles: this.activeVehicles.size,
      fps: Math.round(fps * 10) / 10,
    };
  }

  getActiveVehicles(): DetectedVehicle[] {
    return [...this.activeVehicles.values()];
  }

  getZones(): NoParkingZone[] {
    return this.zones;
  }

  reset(): void {
    this.activeVehicles.clear();
    this.frameCount = 0;
    this.totalProcessingMs = 0;
    this.totalDetections = 0;
    this.totalViolations = 0;
    this.frameTimestamps = [];
  }
}
