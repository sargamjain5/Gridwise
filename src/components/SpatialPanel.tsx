import { useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { GridCell } from '@/lib/types';
import 'leaflet/dist/leaflet.css';

interface Props {
  gridHotspots: GridCell[];
}

function getColor(intensity: number): string {
  const r = Math.round(220 * intensity + 35);
  const g = Math.round(160 * (1 - intensity));
  return `rgb(${r}, ${g}, 40)`;
}

export function SpatialPanel({ gridHotspots }: Props) {
  const maxCount = gridHotspots[0]?.count || 1;

  const center = useMemo(() => {
    if (gridHotspots.length === 0) return { lat: 12.97, lon: 77.59 };
    const lat = gridHotspots.reduce((s, g) => s + g.lat, 0) / gridHotspots.length;
    const lon = gridHotspots.reduce((s, g) => s + g.lon, 0) / gridHotspots.length;
    return { lat, lon };
  }, [gridHotspots]);

  if (gridHotspots.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Parking Violation Density — Bangalore</CardTitle>
        <p className="text-sm text-muted-foreground">
          Click circles for details. Larger/darker = more violations.
        </p>
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-full" style={{ background: getColor(0.1) }} /> Low
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-full" style={{ background: getColor(0.5) }} /> Medium
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-full" style={{ background: getColor(1.0) }} /> High
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-hidden rounded-b-lg">
        <MapContainer
          center={[center.lat, center.lon]}
          zoom={11}
          style={{ width: '100%', height: '600px' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {gridHotspots.map((g, i) => {
            const intensity = g.count / maxCount;
            const color = getColor(intensity);
            const radius = 8 + intensity * 22;

            return (
              <CircleMarker
                key={`${g.lat}-${g.lon}`}
                center={[g.lat, g.lon]}
                radius={radius}
                pathOptions={{
                  color: 'white',
                  weight: 2,
                  fillColor: color,
                  fillOpacity: 0.35 + intensity * 0.45,
                }}
              >
                <Popup>
                  <div style={{ fontFamily: 'sans-serif', minWidth: 150 }}>
                    <div style={{ fontWeight: 'bold', fontSize: 16, color }}>
                      {g.count.toLocaleString('en-IN')} violations
                    </div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                      Rank #{i + 1} hotspot
                    </div>
                    <div style={{
                      marginTop: 8, height: 6, background: '#eee',
                      borderRadius: 3, overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', width: `${intensity * 100}%`,
                        background: color, borderRadius: 3,
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
                      {(intensity * 100).toFixed(0)}% of peak density
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </CardContent>
    </Card>
  );
}
