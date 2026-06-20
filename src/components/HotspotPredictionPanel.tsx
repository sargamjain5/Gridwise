import { useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents } from 'react-leaflet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Crosshair, Clock, Calendar } from 'lucide-react';
import type { PredictionGridCell } from '@/lib/types';
import 'leaflet/dist/leaflet.css';

interface MLPredictionCell {
  lat: number;
  lon: number;
  hourly: number[];  // 24 values — predicted violations per hour
  daily: number[];   // 7 values — predicted violations per day
  total: number;
}

interface Props {
  predictionGrid: PredictionGridCell[];
  mlModel?: {
    model: string;
    mae: number;
    r2: number;
    featureImportance: Record<string, number>;
    predictions: MLPredictionCell[];
  } | null;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const LEVEL_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: '#dc2626', bg: 'bg-red-600 text-white', label: 'CRITICAL' },
  high: { color: '#f97316', bg: 'bg-orange-500 text-white', label: 'HIGH' },
  medium: { color: '#eab308', bg: 'bg-yellow-500 text-black', label: 'MEDIUM' },
  low: { color: '#22c55e', bg: 'bg-green-600 text-white', label: 'LOW' },
};

function getLevel(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

function MapClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

// Haversine in meters
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface PointPrediction {
  lat: number;
  lon: number;
  score: number;
  level: 'critical' | 'high' | 'medium' | 'low';
  predictedViolations: number;
  nearestCells: number;
}

export function HotspotPredictionPanel({ predictionGrid, mlModel }: Props) {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);

  const [hour, setHour] = useState(now.getUTCHours());
  const [dayOfWeek, setDayOfWeek] = useState(now.getUTCDay());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [clickedPoint, setClickedPoint] = useState<PointPrediction | null>(null);

  // Use ML model predictions if available, otherwise fall back to raw grid data
  const cells = mlModel?.predictions || [];
  const useML = cells.length > 0;

  // Build the mesh for current hour+day from ML predictions
  const mesh = useMemo(() => {
    if (useML) {
      // ML model: each cell has hourly[24] and daily[7] predicted values
      const maxPred = Math.max(...cells.map(c => c.hourly[hour] || 0), 0.01);
      return cells
        .map(c => {
          const predicted = (c.hourly[hour] || 0) * (1 + (c.daily[dayOfWeek] || 0) / (c.total / 7 || 1) * 0.3);
          const score = Math.min(100, Math.round((predicted / maxPred) * 100));
          return { lat: c.lat, lon: c.lon, score, level: getLevel(score), predicted: Math.round(predicted * 10) / 10 };
        })
        .filter(c => c.score > 5);
    } else {
      // Fallback: use raw predictionGrid with temporal weighting
      const maxCount = predictionGrid[0]?.totalCount || 1;
      return predictionGrid
        .map(c => {
          const totalH = c.hourly.reduce((s, v) => s + v, 0) || 1;
          const hourWeight = c.hourly[hour] / (totalH / 24);
          const totalD = c.daily.reduce((s, v) => s + v, 0) || 1;
          const dayWeight = c.daily[dayOfWeek] / (totalD / 7);
          const raw = c.totalCount * hourWeight * dayWeight;
          const score = Math.min(100, Math.round((raw / maxCount) * 100));
          return { lat: c.lat, lon: c.lon, score, level: getLevel(score), predicted: Math.round(raw * 10) / 10 };
        })
        .filter(c => c.score > 5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 200);
    }
  }, [cells, predictionGrid, hour, dayOfWeek, useML]);

  // Point prediction on map click
  const handleMapClick = useCallback((lat: number, lon: number) => {
    const source = useML ? cells : predictionGrid;
    // Find nearby cells within 1.5km, weighted by distance
    let weightedSum = 0;
    let kernelSum = 0;
    let nearCount = 0;

    for (const c of source) {
      const dist = haversineM(lat, lon, c.lat, c.lon);
      if (dist > 2000) continue;
      nearCount++;
      const w = Math.exp(-0.5 * (dist / 800) ** 2);
      const cellValue = useML
        ? ((c as MLPredictionCell).hourly[hour] || 0)
        : ((c as PredictionGridCell).hourly[hour] / (((c as PredictionGridCell).hourly.reduce((s: number, v: number) => s + v, 0) || 1) / 24)) * (c as PredictionGridCell).totalCount / 1000;
      weightedSum += cellValue * w;
      kernelSum += w;
    }

    const predicted = kernelSum > 0 ? weightedSum / kernelSum : 0;
    const maxPred = useML
      ? Math.max(...cells.map(c => c.hourly[hour] || 0), 0.01)
      : Math.max(...predictionGrid.map(c => c.totalCount), 1) / 50;
    const score = Math.min(100, Math.max(0, Math.round((predicted / maxPred) * 100)));

    setClickedPoint({
      lat, lon, score, level: getLevel(score),
      predictedViolations: Math.round(predicted * 10) / 10,
      nearestCells: nearCount,
    });
  }, [cells, predictionGrid, hour, dayOfWeek, useML]);

  const meshStats = useMemo(() => ({
    critical: mesh.filter(p => p.level === 'critical').length,
    high: mesh.filter(p => p.level === 'high').length,
    medium: mesh.filter(p => p.level === 'medium').length,
    low: mesh.filter(p => p.level === 'low').length,
  }), [mesh]);

  return (
    <div className="space-y-4">
      {/* ML model info */}
      {mlModel && (
        <Card className="border-green-200 bg-green-50/30">
          <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge className="bg-green-600 text-white text-[10px]">Trained Model</Badge>
              <span className="font-medium">{mlModel.model}</span>
              <span className="text-muted-foreground">MAE: {mlModel.mae} | R²: {mlModel.r2} | {cells.length} cells</span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {Object.entries(mlModel.featureImportance).sort(([,a],[,b]) => b - a).map(([k, v]) => (
                <Badge key={k} variant="outline" className="text-[9px]">{k}: {(v * 100).toFixed(0)}%</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {!mlModel && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardContent className="p-3 text-sm text-amber-800">
            Using KDE proxy. Run <code className="bg-amber-100 px-1 rounded">cd model && python train_all.py</code> for XGBoost predictions.
          </CardContent>
        </Card>
      )}

      {/* Controls — matching actual model inputs */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Hour */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-blue-600" /> Hour (IST)
              </label>
              <input
                type="range" min={0} max={23} value={hour}
                onChange={e => setHour(+e.target.value)}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>12 AM</span>
                <span className="font-bold text-foreground text-sm">{hour}:00</span>
                <span>11 PM</span>
              </div>
            </div>

            {/* Day */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-purple-600" /> Day of Week
              </label>
              <select
                value={dayOfWeek}
                onChange={e => setDayOfWeek(+e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </div>

            {/* Month */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-orange-600" /> Month
              </label>
              <select
                value={month}
                onChange={e => setMonth(+e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Model inputs: latitude, longitude (from map), hour, day_of_week, month, police_station.
            Click any point on the map for a location-specific prediction.
          </p>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        {(['critical', 'high', 'medium', 'low'] as const).map(level => (
          <Card key={level}>
            <CardContent className="p-3 text-center">
              <div className="flex items-center justify-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: LEVEL_STYLES[level].color }} />
                <span className="text-2xl font-bold">{meshStats[level]}</span>
              </div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{level}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Map */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Hotspot Prediction Map</CardTitle>
              <Badge variant="secondary" className="text-xs">
                {DAY_SHORT[dayOfWeek]} {hour}:00 IST • {MONTHS[month - 1]}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Crosshair className="h-3 w-3" /> Click anywhere for point prediction
            </p>
          </CardHeader>
          <CardContent className="p-0 overflow-hidden rounded-b-lg">
            <MapContainer center={[12.975, 77.59]} zoom={12}
              style={{ width: '100%', height: '560px' }} scrollWheelZoom>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapClickHandler onClick={handleMapClick} />

              {mesh.map((p) => {
                const style = LEVEL_STYLES[p.level];
                const radius = 4 + (p.score / 100) * 8;
                return (
                  <CircleMarker key={`${p.lat}-${p.lon}`} center={[p.lat, p.lon]} radius={radius}
                    pathOptions={{ color: style.color, weight: 0, fillColor: style.color, fillOpacity: 0.15 + (p.score / 100) * 0.45 }}>
                    <Popup>
                      <div style={{ fontFamily: 'sans-serif', minWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: style.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 14 }}>{p.score}</div>
                          <div>
                            <div style={{ fontWeight: 'bold', fontSize: 13, color: style.color }}>{style.label}</div>
                            <div style={{ fontSize: 11, color: '#999' }}>Predicted: {p.predicted} viol/hr</div>
                          </div>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}

              {clickedPoint && (
                <CircleMarker center={[clickedPoint.lat, clickedPoint.lon]} radius={14}
                  pathOptions={{ color: '#1e40af', weight: 3, fillColor: LEVEL_STYLES[clickedPoint.level].color, fillOpacity: 0.8 }}>
                  <Popup>
                    <div style={{ fontFamily: 'sans-serif', minWidth: 180 }}>
                      <div style={{ fontWeight: 'bold', fontSize: 16, color: LEVEL_STYLES[clickedPoint.level].color }}>
                        Score: {clickedPoint.score}/100 — {LEVEL_STYLES[clickedPoint.level].label}
                      </div>
                      <div style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
                        Predicted: {clickedPoint.predictedViolations} violations/hr<br/>
                        Nearby data cells: {clickedPoint.nearestCells}<br/>
                        {clickedPoint.lat.toFixed(4)}°N, {clickedPoint.lon.toFixed(4)}°E
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              )}
            </MapContainer>
          </CardContent>
        </Card>

        {/* Right panel */}
        <div className="space-y-4">
          {clickedPoint ? (
            <Card className={`border-2 ${
              clickedPoint.level === 'critical' ? 'border-red-400 bg-red-50/50' :
              clickedPoint.level === 'high' ? 'border-orange-400 bg-orange-50/50' :
              clickedPoint.level === 'medium' ? 'border-yellow-400 bg-yellow-50/50' :
              'border-green-400 bg-green-50/50'
            }`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Point Prediction</p>
                    <p className="text-3xl font-bold" style={{ color: LEVEL_STYLES[clickedPoint.level].color }}>
                      {clickedPoint.score}<span className="text-lg text-muted-foreground">/100</span>
                    </p>
                  </div>
                  <Badge className={`text-sm ${LEVEL_STYLES[clickedPoint.level].bg}`}>
                    {LEVEL_STYLES[clickedPoint.level].label}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="bg-white/60 rounded p-2">
                    <p className="font-bold text-sm">{clickedPoint.predictedViolations}</p>
                    <p className="text-muted-foreground">Violations/hr</p>
                  </div>
                  <div className="bg-white/60 rounded p-2">
                    <p className="font-bold text-sm">{clickedPoint.nearestCells}</p>
                    <p className="text-muted-foreground">Data cells nearby</p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>Location: {clickedPoint.lat.toFixed(4)}°N, {clickedPoint.lon.toFixed(4)}°E</p>
                  <p>Time: {DAY_SHORT[dayOfWeek]} {hour}:00 IST, {MONTHS[month - 1]}</p>
                  <p>Source: {useML ? 'XGBoost model' : 'KDE interpolation (proxy)'}</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <Crosshair className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">Click on the map</p>
                <p className="text-xs">Get a prediction for any point in Bangalore</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Model Inputs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              {[
                { name: 'grid_lat', desc: 'Latitude of ~500m grid cell', source: 'Map click' },
                { name: 'grid_lon', desc: 'Longitude of ~500m grid cell', source: 'Map click' },
                { name: 'hour', desc: 'Hour of day (IST, 0-23)', source: 'Slider' },
                { name: 'day_of_week', desc: 'Day (0=Mon..6=Sun)', source: 'Dropdown' },
                { name: 'month', desc: 'Month (1-12)', source: 'Dropdown' },
                { name: 'station_enc', desc: 'Encoded police station', source: 'From grid cell' },
              ].map(f => (
                <div key={f.name} className="flex items-center justify-between p-1.5 rounded bg-muted/50">
                  <div>
                    <span className="font-mono font-medium text-foreground">{f.name}</span>
                    <span className="ml-1.5">{f.desc}</span>
                  </div>
                  <Badge variant="outline" className="text-[9px]">{f.source}</Badge>
                </div>
              ))}
              <div className="pt-2 border-t">
                <p className="font-medium text-foreground">Output: predicted violations/hour per grid cell</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {(['critical', 'high', 'medium', 'low'] as const).map(l => (
                    <div key={l} className="flex items-center gap-1">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: LEVEL_STYLES[l].color }} />
                      <span>{LEVEL_STYLES[l].label} ({l === 'critical' ? '75+' : l === 'high' ? '50-74' : l === 'medium' ? '25-49' : '0-24'})</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
