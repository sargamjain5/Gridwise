import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Polygon, CircleMarker, Popup, Marker } from 'react-leaflet';
import L from 'leaflet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Camera, Play, Square, CheckCircle, XCircle, Eye, Cpu, AlertTriangle, Radio, Upload,
} from 'lucide-react';
import {
  CCTVAutomationEngine, generateNoParkingZones,
  type ViolationFlag, type FrameProcessingResult, type EngineStats, type NoParkingZone,
} from '@/lib/cctvEngine';
import type { CCTVCamera, CongestionScoreEntry } from '@/lib/types';
import 'leaflet/dist/leaflet.css';

interface Props {
  cameras: CCTVCamera[];
  congestionScores: CongestionScoreEntry[];
  vehiclePool: { number: string; type: string }[];
  mlValidation?: { model: string; auc: number; vehicleTypePredictions: Record<string, { avgApprovalProb: number }> } | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  moderate: '#eab308',
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  moderate: 'bg-yellow-500 text-black',
};

// Camera icon for leaflet
const cameraIcon = L.divIcon({
  html: `<div style="background:#1e40af;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:14px">📹</div>`,
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

interface ANPRResult {
  id: string;
  fileName: string;
  type: 'image' | 'video';
  status: 'processing' | 'done' | 'error';
  result: any | null;
  timestamp: Date;
}

const ANPR_API = 'http://localhost:8000';

export function CCTVAutomationPanel({ cameras, congestionScores, vehiclePool, mlValidation }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [violations, setViolations] = useState<ViolationFlag[]>([]);
  const [recentFrames, setRecentFrames] = useState<FrameProcessingResult[]>([]);
  const [anprResults, setAnprResults] = useState<ANPRResult[]>([]);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState<EngineStats>({
    framesProcessed: 0, totalDetections: 0, totalViolations: 0,
    avgProcessingMs: 0, activeVehicles: 0, fps: 0,
  });
  const engineRef = useRef<CCTVAutomationEngine | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const zones = useMemo(
    () => generateNoParkingZones(cameras, congestionScores),
    [cameras, congestionScores]
  );

  // Initialize engine
  useEffect(() => {
    engineRef.current = new CCTVAutomationEngine(cameras, zones, vehiclePool);

    engineRef.current.onViolation = (flag) => {
      setViolations(prev => [flag, ...prev].slice(0, 200));
    };

    engineRef.current.onFrame = (result) => {
      setRecentFrames(prev => [result, ...prev].slice(0, 20));
    };

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [cameras, zones, vehiclePool]);

  // Start/stop processing
  useEffect(() => {
    if (isRunning && engineRef.current) {
      intervalRef.current = setInterval(() => {
        engineRef.current!.processFrame();
        setStats(engineRef.current!.getStats());
      }, 500); // ~2 FPS simulation
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning]);

  // Check if ANPR API is running
  useEffect(() => {
    fetch(`${ANPR_API}/health`).then(r => r.json())
      .then(() => setApiAvailable(true))
      .catch(() => setApiAvailable(false));
  }, []);

  const handleANPRUpload = useCallback((file: File) => {
    const isVideo = file.type.startsWith('video/');
    const id = `ANPR-${Date.now()}`;
    const entry: ANPRResult = {
      id, fileName: file.name, type: isVideo ? 'video' : 'image',
      status: 'processing', result: null, timestamp: new Date(),
    };
    setAnprResults(prev => [entry, ...prev]);

    const formData = new FormData();
    formData.append('file', file);

    const endpoint = isVideo ? `${ANPR_API}/detect/video` : `${ANPR_API}/detect/image`;
    fetch(endpoint, { method: 'POST', body: formData })
      .then(r => r.json())
      .then(data => {
        setAnprResults(prev => prev.map(r => r.id === id ? { ...r, status: 'done', result: data } : r));
      })
      .catch(() => {
        setAnprResults(prev => prev.map(r => r.id === id ? { ...r, status: 'error' } : r));
      });
  }, []);

  const handleReview = useCallback((id: string, action: 'confirmed' | 'dismissed') => {
    setViolations(prev =>
      prev.map(v => v.id === id ? { ...v, status: action } : v)
    );
  }, []);

  const pendingViolations = violations.filter(v => v.status === 'flagged');
  const confirmedViolations = violations.filter(v => v.status === 'confirmed');
  const dismissedViolations = violations.filter(v => v.status === 'dismissed');

  const mapCenter = useMemo(() => {
    if (cameras.length === 0) return [12.975, 77.59] as [number, number];
    const lat = cameras.reduce((s, c) => s + c.lat, 0) / cameras.length;
    const lon = cameras.reduce((s, c) => s + c.lon, 0) / cameras.length;
    return [lat, lon] as [number, number];
  }, [cameras]);

  return (
    <div className="space-y-4">
      {/* Engine info banner */}
      <Card className="border-blue-200 bg-blue-50/30">
        <CardContent className="p-4">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Cpu className="h-6 w-6 text-blue-600" />
              <div>
                <p className="font-semibold">Smart CCTV Automation Engine</p>
                <p className="text-xs text-muted-foreground">
                  Inputs: Video stream frames, timestamps, camera GPS, no-parking zone polygons.
                  Detects vehicles via frame analysis → checks polygon intersection → flags violations after 30s dwell time.
                </p>
              </div>
            </div>
            <Button
              onClick={() => setIsRunning(!isRunning)}
              variant={isRunning ? 'destructive' : 'default'}
              className="gap-2"
            >
              {isRunning ? <><Square className="h-4 w-4" /> Stop Engine</> : <><Play className="h-4 w-4" /> Start Engine</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ANPR Real Detection */}
      <Card className="border-green-200 bg-green-50/30">
        <CardContent className="p-4">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Camera className="h-6 w-6 text-green-700" />
              <div>
                <p className="font-semibold flex items-center gap-2">
                  Real ANPR Detection (YOLOv8 + EasyOCR)
                  {apiAvailable === true && <Badge className="bg-green-600 text-white text-[9px]">API Online</Badge>}
                  {apiAvailable === false && <Badge variant="secondary" className="text-[9px]">API Offline — run: cd model && python server.py</Badge>}
                  {apiAvailable === null && <Badge variant="secondary" className="text-[9px]">Checking...</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  Upload an image or video → YOLOv8 detects vehicles → crops plate region → EasyOCR reads number → checks violation zones
                </p>
              </div>
            </div>
            <Button className="gap-2" onClick={() => fileInputRef.current?.click()} disabled={apiAvailable === false}>
              <Upload className="h-4 w-4" /> Upload Image / Video
            </Button>
            <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleANPRUpload(f); e.target.value = ''; }} />
          </div>

          {/* ANPR results */}
          {anprResults.length > 0 && (
            <div className="mt-4 space-y-2 max-h-[300px] overflow-y-auto">
              {anprResults.map(r => (
                <div key={r.id} className={`p-3 rounded-lg border ${
                  r.status === 'processing' ? 'border-blue-200 bg-blue-50/50' :
                  r.status === 'error' ? 'border-red-200 bg-red-50/50' :
                  'border-green-200 bg-white'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{r.fileName}</span>
                    {r.status === 'processing' && <Badge className="bg-blue-500 text-white text-[9px] animate-pulse">Processing...</Badge>}
                    {r.status === 'error' && <Badge variant="destructive" className="text-[9px]">Failed — is the API running?</Badge>}
                    {r.status === 'done' && <Badge className="bg-green-600 text-white text-[9px]">{r.result?.processing_time_ms}ms</Badge>}
                  </div>
                  {r.status === 'done' && r.result && (
                    <div className="space-y-1.5">
                      <div className="flex gap-3 text-xs">
                        <span>Vehicles: <strong>{r.result.total_vehicles}</strong></span>
                        <span>Plates read: <strong>{r.result.plates_read}</strong></span>
                        <span>Violations: <strong>{r.result.violations}</strong></span>
                        {r.result.frame_count > 1 && <span>Frames: <strong>{r.result.frame_count}</strong></span>}
                      </div>
                      {r.result.detections?.map((d: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-muted/50">
                          <Badge variant="secondary" className="text-[9px]">{d.vehicle_type}</Badge>
                          <span>{d.vehicle_confidence}%</span>
                          {d.plate_reading?.text ? (
                            <span className="font-mono font-bold text-green-700">{d.plate_reading.text}</span>
                          ) : (
                            <span className="text-muted-foreground">No plate</span>
                          )}
                          {d.plate_reading?.confidence > 0 && (
                            <span className="text-muted-foreground">OCR: {d.plate_reading.confidence}%</span>
                          )}
                          {d.in_violation_zone && (
                            <Badge variant="destructive" className="text-[9px]">VIOLATION</Badge>
                          )}
                          {d.is_parked && <Badge variant="outline" className="text-[9px]">Parked</Badge>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-blue-600">{stats.framesProcessed}</p>
            <p className="text-[10px] text-muted-foreground">Frames Processed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold">{stats.fps}</p>
            <p className="text-[10px] text-muted-foreground">FPS</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-purple-600">{stats.totalDetections}</p>
            <p className="text-[10px] text-muted-foreground">Vehicles Detected</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-green-600">{stats.activeVehicles}</p>
            <p className="text-[10px] text-muted-foreground">Active Tracking</p>
          </CardContent>
        </Card>
        <Card className={pendingViolations.length > 0 ? 'border-red-300 bg-red-50/50' : ''}>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-red-600">{pendingViolations.length}</p>
            <p className="text-[10px] text-muted-foreground">Pending Review</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold">{stats.avgProcessingMs}ms</p>
            <p className="text-[10px] text-muted-foreground">Avg Frame Time</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Map with cameras, zones, and violations */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4" /> Live Monitoring View
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-hidden rounded-b-lg">
            <MapContainer
              center={mapCenter}
              zoom={13}
              style={{ width: '100%', height: '480px' }}
              scrollWheelZoom={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* No-parking zone polygons */}
              {zones.map(zone => (
                <Polygon
                  key={zone.id}
                  positions={zone.polygon.map(([lat, lon]) => [lat, lon] as [number, number])}
                  pathOptions={{
                    color: SEVERITY_COLORS[zone.severity],
                    weight: 2,
                    fillColor: SEVERITY_COLORS[zone.severity],
                    fillOpacity: 0.15,
                    dashArray: '6 4',
                  }}
                >
                  <Popup>
                    <div style={{ fontFamily: 'sans-serif', minWidth: 160 }}>
                      <div style={{ fontWeight: 'bold', fontSize: 13 }}>{zone.name}</div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                        Station: {zone.station}<br />
                        Severity: <span style={{ color: SEVERITY_COLORS[zone.severity], fontWeight: 'bold' }}>{zone.severity.toUpperCase()}</span>
                      </div>
                    </div>
                  </Popup>
                </Polygon>
              ))}

              {/* Camera markers */}
              {cameras.map(cam => (
                <Marker key={cam.cameraId} position={[cam.lat, cam.lon]} icon={cameraIcon}>
                  <Popup>
                    <div style={{ fontFamily: 'sans-serif' }}>
                      <div style={{ fontWeight: 'bold' }}>{cam.cameraId}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>{cam.junction}</div>
                      <div style={{ fontSize: 10, color: '#999' }}>{cam.station}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}

              {/* Flagged violation markers */}
              {pendingViolations.slice(0, 30).map(v => (
                <CircleMarker
                  key={v.id}
                  center={[v.lat, v.lon]}
                  radius={6}
                  pathOptions={{
                    color: '#dc2626', weight: 2,
                    fillColor: '#dc2626', fillOpacity: 0.8,
                  }}
                >
                  <Popup>
                    <div style={{ fontFamily: 'sans-serif', minWidth: 160 }}>
                      <div style={{ fontWeight: 'bold', color: '#dc2626' }}>{v.vehicleNumber}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        {v.vehicleType} • {v.zoneName}<br />
                        Dwell: {v.dwellTimeS}s • Confidence: {v.confidence}%
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </CardContent>
        </Card>

        {/* Processing pipeline feed */}
        <div className="space-y-4">
          {/* Frame processing log */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Radio className={`h-4 w-4 ${isRunning ? 'text-green-600 animate-pulse' : 'text-gray-400'}`} />
                Frame Processing Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[200px] overflow-y-auto space-y-1">
              {recentFrames.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">Start the engine to see frame processing</p>
              )}
              {recentFrames.map(f => (
                <div key={f.frameId} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground">{f.frameId}</span>
                    <span className="text-muted-foreground">{f.cameraId}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{f.vehiclesDetected} det</span>
                    {f.vehiclesInZone > 0 && (
                      <Badge variant="destructive" className="text-[9px] h-4">{f.vehiclesInZone} in zone</Badge>
                    )}
                    {f.violationsFlagged > 0 && (
                      <Badge className="bg-red-600 text-white text-[9px] h-4">{f.violationsFlagged} flagged</Badge>
                    )}
                    <span className="text-muted-foreground">{f.processingTimeMs}ms</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Violation review queue */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                Violation Queue
                {pendingViolations.length > 0 && (
                  <Badge variant="destructive" className="ml-1">{pendingViolations.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[240px] overflow-y-auto space-y-2">
              {pendingViolations.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No pending violations</p>
              )}
              {pendingViolations.slice(0, 10).map(v => (
                <div key={v.id} className="p-2.5 rounded-lg border border-red-300 bg-red-50/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono text-sm font-bold">{v.vehicleNumber}</span>
                      <Badge variant="secondary" className="text-[9px] ml-2">{v.vehicleType}</Badge>
                    </div>
                    <Badge className={`text-[9px] ${SEVERITY_BADGE[v.severity]}`}>{v.severity}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{v.cameraId} • {v.dwellTimeS}s dwell</span>
                    <div className="flex items-center gap-2">
                      {mlValidation?.vehicleTypePredictions?.[v.vehicleType] && (
                        <Badge variant="outline" className="text-[8px]">
                          Approval: {Math.round(mlValidation.vehicleTypePredictions[v.vehicleType].avgApprovalProb * 100)}%
                        </Badge>
                      )}
                      <span className="font-bold" style={{ color: v.confidence >= 85 ? '#dc2626' : '#f97316' }}>
                        {v.confidence}% conf
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm" variant="outline"
                      className="h-6 text-[10px] flex-1 border-green-400 text-green-700 hover:bg-green-50 gap-1"
                      onClick={() => handleReview(v.id, 'confirmed')}
                    >
                      <CheckCircle className="h-3 w-3" /> Confirm
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-6 text-[10px] flex-1 border-gray-300 text-gray-600 hover:bg-gray-50 gap-1"
                      onClick={() => handleReview(v.id, 'dismissed')}
                    >
                      <XCircle className="h-3 w-3" /> Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirmed violations log */}
      {(confirmedViolations.length > 0 || dismissedViolations.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reviewed Violations</CardTitle>
            <div className="flex gap-2">
              <Badge className="bg-green-600 text-white text-xs">{confirmedViolations.length} confirmed</Badge>
              <Badge variant="secondary" className="text-xs">{dismissedViolations.length} dismissed</Badge>
            </div>
          </CardHeader>
          <CardContent className="max-h-[300px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Camera</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead className="text-right">Dwell</TableHead>
                  <TableHead className="text-right">Conf.</TableHead>
                  <TableHead>Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...confirmedViolations, ...dismissedViolations]
                  .sort((a, b) => b.timestamp - a.timestamp)
                  .slice(0, 25)
                  .map(v => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-xs">{v.id}</TableCell>
                      <TableCell className="font-mono text-xs font-bold">{v.vehicleNumber}</TableCell>
                      <TableCell className="text-xs">{v.cameraId}</TableCell>
                      <TableCell className="text-xs truncate max-w-[120px]">{v.zoneName}</TableCell>
                      <TableCell className="text-right text-xs">{v.dwellTimeS}s</TableCell>
                      <TableCell className="text-right text-xs">{v.confidence}%</TableCell>
                      <TableCell>
                        {v.status === 'confirmed' ? (
                          <Badge className="bg-green-600 text-white text-[9px]">Confirmed</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[9px]">Dismissed</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
