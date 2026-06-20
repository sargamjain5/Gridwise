import { useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ParkingSquare, Clock } from 'lucide-react';
import type { ParkingZone } from '@/lib/publicData';
import 'leaflet/dist/leaflet.css';

interface Props {
  zones: ParkingZone[];
}

const ZONE_STYLES: Record<string, { color: string; label: string; bgClass: string }> = {
  'no-parking': { color: '#dc2626', label: 'No Parking Zone', bgClass: 'bg-red-600 text-white' },
  'high-risk': { color: '#f97316', label: 'High Risk', bgClass: 'bg-orange-500 text-white' },
  'available': { color: '#22c55e', label: 'Available', bgClass: 'bg-green-600 text-white' },
};

export function NoParkingMap({ zones }: Props) {
  const center = useMemo(() => {
    const validZones = zones.filter(z => z.lat !== 0);
    if (validZones.length === 0) return { lat: 12.975, lon: 77.585 };
    const lat = validZones.reduce((s, z) => s + z.lat, 0) / validZones.length;
    const lon = validZones.reduce((s, z) => s + z.lon, 0) / validZones.length;
    return { lat, lon };
  }, [zones]);

  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const timeStr = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} IST`;

  const noParkingCount = zones.filter(z => z.type === 'no-parking').length;
  const highRiskCount = zones.filter(z => z.type === 'high-risk').length;
  const availableCount = zones.filter(z => z.type === 'available').length;
  const totalAvailable = zones.reduce((s, z) => s + z.availableSpots, 0);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-3 text-center">
            <AlertTriangle className="h-5 w-5 text-red-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-red-600">{noParkingCount}</p>
            <p className="text-[10px] text-red-700">No Parking Zones</p>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50/50">
          <CardContent className="p-3 text-center">
            <AlertTriangle className="h-5 w-5 text-orange-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-orange-600">{highRiskCount}</p>
            <p className="text-[10px] text-orange-700">High Risk Areas</p>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="p-3 text-center">
            <ParkingSquare className="h-5 w-5 text-green-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-green-600">{availableCount}</p>
            <p className="text-[10px] text-green-700">Available Zones</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Clock className="h-5 w-5 text-blue-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-blue-600">{totalAvailable}</p>
            <p className="text-[10px] text-muted-foreground">Spots Available Now</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Map */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              Live Parking Map
              <Badge variant="secondary" className="text-[10px]">As of {timeStr}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-hidden rounded-b-lg">
            <MapContainer
              center={[center.lat, center.lon]}
              zoom={13}
              style={{ width: '100%', height: '460px' }}
              scrollWheelZoom={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {zones.filter(z => z.lat !== 0).map(z => {
                const style = ZONE_STYLES[z.type];
                return (
                  <CircleMarker
                    key={z.id}
                    center={[z.lat, z.lon]}
                    radius={z.type === 'no-parking' ? 14 : z.type === 'high-risk' ? 11 : 9}
                    pathOptions={{
                      color: 'white', weight: 2,
                      fillColor: style.color,
                      fillOpacity: 0.7,
                    }}
                  >
                    <Popup>
                      <div style={{ fontFamily: 'sans-serif', minWidth: 180 }}>
                        <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 4 }}>{z.name}</div>
                        <div style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                          fontSize: 11, fontWeight: 'bold', color: 'white', background: style.color,
                        }}>{style.label}</div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
                          <div>Station: {z.station}</div>
                          <div>Occupancy: <strong>{z.occupancyPct}%</strong></div>
                          <div>Available: <strong>{z.availableSpots}/{z.totalSpots}</strong> spots</div>
                          <div>Congestion: <strong>{z.congestionScore}/100</strong></div>
                        </div>
                        <div style={{ marginTop: 6, height: 8, background: '#eee', borderRadius: 4 }}>
                          <div style={{
                            height: '100%', borderRadius: 4,
                            width: `${z.occupancyPct}%`,
                            background: z.occupancyPct > 80 ? '#dc2626' : z.occupancyPct > 50 ? '#f97316' : '#22c55e',
                          }} />
                        </div>
                        <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
                          {z.occupancyPct}% occupied
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </CardContent>
        </Card>

        {/* Zone list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Zone Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[460px] overflow-y-auto">
            {zones.map(z => {
              const style = ZONE_STYLES[z.type];
              return (
                <div key={z.id} className="p-2.5 rounded-lg bg-muted/50 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate max-w-[65%]">{z.name}</span>
                    <Badge className={`text-[10px] ${style.bgClass}`}>{style.label}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${z.occupancyPct}%`,
                          backgroundColor: z.occupancyPct > 80 ? '#dc2626' : z.occupancyPct > 50 ? '#f97316' : '#22c55e',
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-16 text-right">
                      {z.availableSpots}/{z.totalSpots}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{z.station} • {z.occupancyPct}% full</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
