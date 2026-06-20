import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { analyzePolicies, type JunctionPolicyAnalysis } from '@/lib/policyEngine';
import type { DashboardMetrics } from '@/lib/types';
import { ChevronDown, ChevronUp } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

interface Props { metrics: DashboardMetrics; }

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'bg-red-600 text-white', high: 'bg-orange-500 text-white', medium: 'bg-yellow-500 text-black',
};
const TYPE_COLORS: Record<string, string> = {
  parking_bay: '#3b82f6', pickup_drop: '#8b5cf6', one_way: '#f97316',
  timed_parking: '#eab308', no_parking_extend: '#dc2626', speed_bump: '#22c55e',
};

export function PolicyEnginePanel({ metrics }: Props) {
  const analyses = useMemo(() =>
    analyzePolicies(metrics.congestionScores, metrics.gridHotspots, metrics.cctvCameras),
    [metrics]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Count recommendation types
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of analyses) for (const r of a.recommendations) counts[r.type] = (counts[r.type] || 0) + 1;
    return counts;
  }, [analyses]);

  const typeLabels: Record<string, string> = {
    parking_bay: 'Build Parking Bay', pickup_drop: 'Pickup/Drop Lane', one_way: 'One-Way Traffic',
    timed_parking: '15-Min Parking', no_parking_extend: 'Extend No-Parking', speed_bump: 'Traffic Calming',
  };

  return (
    <div className="space-y-4">
      <Card className="border-indigo-200 bg-indigo-50/30">
        <CardContent className="p-4">
          <p className="text-sm text-indigo-800">
            <span className="font-semibold">Proxy Policy Engine:</span> Uses geographic proximity calculations to Bangalore metro stations, hospitals, commercial areas, schools, and inferred road width (from violation density) to generate infrastructure recommendations. No ML required — rule-based geographic analysis.
          </p>
        </CardContent>
      </Card>

      {/* Recommendation type summary */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {Object.entries(typeLabels).map(([type, label]) => (
          <Card key={type}>
            <CardContent className="p-3 text-center">
              <p className="text-xl font-bold" style={{ color: TYPE_COLORS[type] }}>{typeCounts[type] || 0}</p>
              <p className="text-[9px] text-muted-foreground leading-tight">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Map */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Policy Recommendation Map</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-hidden rounded-b-lg">
            <MapContainer center={[12.975, 77.59]} zoom={12} style={{ width: '100%', height: '520px' }} scrollWheelZoom>
              <TileLayer attribution='&copy; OSM' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {analyses.map(a => {
                const topRec = a.recommendations[0];
                const color = TYPE_COLORS[topRec?.type || 'timed_parking'];
                return (
                  <CircleMarker key={a.junction} center={[a.lat, a.lon]} radius={6 + (a.hotspotScore / 100) * 10}
                    pathOptions={{ color: 'white', weight: 2, fillColor: color, fillOpacity: 0.7 }}>
                    <Popup>
                      <div style={{ fontFamily: 'sans-serif', minWidth: 200 }}>
                        <div style={{ fontWeight: 'bold', fontSize: 13 }}>{a.junction}</div>
                        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                          Score: {a.hotspotScore}/100 • Road: {a.roadWidth} • {a.isFootfallZone ? 'Footfall zone' : 'Low footfall'}
                        </div>
                        <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                          Metro: {a.nearestMetro.distM}m • Hospital: {a.nearestHospital.distM}m
                        </div>
                        <div style={{ marginTop: 8 }}>
                          {a.recommendations.map((r, i) => (
                            <div key={i} style={{ fontSize: 11, marginTop: 4 }}>
                              <span>{r.icon} </span><strong>{r.title}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </CardContent>
        </Card>

        {/* Junction list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Junction Analysis ({analyses.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-[520px] overflow-y-auto">
            {analyses.map(a => {
              const isExp = expanded === a.junction;
              return (
                <div key={a.junction} className="border rounded-lg overflow-hidden">
                  <button className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                    onClick={() => setExpanded(isExp ? null : a.junction)}>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{a.junction}</p>
                      <p className="text-[10px] text-muted-foreground">{a.station} • Score {a.hotspotScore}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex gap-0.5">
                        {a.recommendations.slice(0, 3).map((r, i) => (
                          <span key={i} className="text-sm">{r.icon}</span>
                        ))}
                      </div>
                      {isExp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>
                  {isExp && (
                    <div className="border-t p-3 bg-muted/20 space-y-3">
                      {/* Proximity factors */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-white rounded p-2 border">
                          <p className="text-muted-foreground">Nearest Metro</p>
                          <p className="font-semibold">{a.nearestMetro.name} ({a.nearestMetro.distM}m)</p>
                        </div>
                        <div className="bg-white rounded p-2 border">
                          <p className="text-muted-foreground">Nearest Hospital</p>
                          <p className="font-semibold">{a.nearestHospital.name} ({a.nearestHospital.distM}m)</p>
                        </div>
                        <div className="bg-white rounded p-2 border">
                          <p className="text-muted-foreground">Nearest Commercial</p>
                          <p className="font-semibold">{a.nearestCommercial.name} ({a.nearestCommercial.distM}m)</p>
                        </div>
                        <div className="bg-white rounded p-2 border">
                          <p className="text-muted-foreground">Road Width / Footfall</p>
                          <p className="font-semibold capitalize">{a.roadWidth} • {a.isFootfallZone ? 'High footfall' : 'Normal'}</p>
                        </div>
                      </div>
                      {/* Recommendations */}
                      {a.recommendations.map((r, i) => (
                        <div key={i} className="p-2.5 rounded-lg border bg-white space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm">{r.icon} {r.title}</span>
                            <Badge className={`text-[9px] ${PRIORITY_BADGE[r.priority]}`}>{r.priority}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{r.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
