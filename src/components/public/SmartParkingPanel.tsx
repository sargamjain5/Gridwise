import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Navigation, Footprints, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import type { ParkingZone, ParkingRecommendation, Destination } from '@/lib/publicData';
import { getRecommendations } from '@/lib/publicData';

interface Props {
  zones: ParkingZone[];
  destinations: Destination[];
}

const CONGESTION_BADGE: Record<string, string> = {
  low: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-red-100 text-red-800',
};

export function SmartParkingPanel({ zones, destinations }: Props) {
  const [selectedDest, setSelectedDest] = useState<Destination | null>(null);
  const [maxWalk, setMaxWalk] = useState(1500);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDests = useMemo(() => {
    if (!searchQuery) return destinations.slice(0, 20);
    const q = searchQuery.toLowerCase();
    return destinations.filter(d =>
      d.name.toLowerCase().includes(q) || d.area.toLowerCase().includes(q)
    ).slice(0, 15);
  }, [destinations, searchQuery]);

  const recommendations = useMemo(() => {
    if (!selectedDest) return [];
    return getRecommendations(zones, selectedDest.lat, selectedDest.lon, maxWalk);
  }, [zones, selectedDest, maxWalk]);

  const bestRec = recommendations[0];

  return (
    <div className="space-y-4">
      {/* Search */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 space-y-1">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Navigation className="h-4 w-4 text-blue-600" /> Where are you going?
              </label>
              <input
                type="text"
                placeholder="Search destination... (e.g. MG Road, KR Market)"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setSelectedDest(null); }}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              />
              {searchQuery && !selectedDest && filteredDests.length > 0 && (
                <div className="border rounded-md max-h-48 overflow-y-auto bg-background shadow-lg">
                  {filteredDests.map(d => (
                    <button
                      key={d.name}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between"
                      onClick={() => { setSelectedDest(d); setSearchQuery(d.name); }}
                    >
                      <span className="font-medium">{d.name}</span>
                      <span className="text-xs text-muted-foreground">{d.area}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Footprints className="h-4 w-4 text-orange-600" /> Max walking distance
              </label>
              <div className="flex gap-2">
                {[500, 1000, 1500, 2000].map(d => (
                  <Button
                    key={d}
                    variant={maxWalk === d ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMaxWalk(d)}
                  >
                    {d >= 1000 ? `${d / 1000}km` : `${d}m`}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {selectedDest && (
        <>
          {/* Top recommendation highlight */}
          {bestRec && (
            <Card className="border-2 border-green-400 bg-green-50/50">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span className="font-bold text-green-800">Best Recommendation</span>
                    </div>
                    <p className="text-lg font-bold">{bestRec.zone.name}</p>
                    <p className="text-sm text-muted-foreground">{bestRec.zone.station}</p>
                    <p className="text-sm text-green-700 mt-1">{bestRec.reason}</p>
                  </div>
                  <div className="text-right space-y-1">
                    <div className="text-3xl font-bold text-green-600">{bestRec.score}</div>
                    <div className="text-xs text-muted-foreground">Score / 100</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3 mt-4">
                  <div className="text-center p-2 bg-white/60 rounded">
                    <p className="text-sm font-bold">{bestRec.walkingTimeMin} min</p>
                    <p className="text-[10px] text-muted-foreground">{bestRec.walkingDistanceM}m walk</p>
                  </div>
                  <div className="text-center p-2 bg-white/60 rounded">
                    <p className="text-sm font-bold">{bestRec.zone.availableSpots}</p>
                    <p className="text-[10px] text-muted-foreground">Spots free</p>
                  </div>
                  <div className="text-center p-2 bg-white/60 rounded">
                    <p className="text-sm font-bold">{bestRec.zone.occupancyPct}%</p>
                    <p className="text-[10px] text-muted-foreground">Occupied</p>
                  </div>
                  <div className="text-center p-2 bg-white/60 rounded">
                    <p className="text-sm font-bold capitalize">{bestRec.congestionLevel}</p>
                    <p className="text-[10px] text-muted-foreground">Congestion</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* All recommendations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recommendations.length === 0 && (
              <Card className="md:col-span-2">
                <CardContent className="p-8 text-center text-muted-foreground">
                  <MapPin className="h-10 w-10 mx-auto mb-2 opacity-20" />
                  <p>No parking zones found within {maxWalk >= 1000 ? `${maxWalk / 1000}km` : `${maxWalk}m`}.</p>
                  <p className="text-sm">Try increasing the walking distance.</p>
                </CardContent>
              </Card>
            )}
            {recommendations.slice(1).map((rec, i) => (
              <Card key={rec.zone.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-sm">{rec.zone.name}</p>
                      <p className="text-xs text-muted-foreground">{rec.zone.station}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg font-bold">{rec.score}</span>
                      <span className="text-xs text-muted-foreground">/100</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Footprints className="h-3 w-3" /> {rec.walkingTimeMin} min ({rec.walkingDistanceM}m)
                    </Badge>
                    <Badge className={`text-[10px] ${CONGESTION_BADGE[rec.congestionLevel]}`}>
                      {rec.congestionLevel} congestion
                    </Badge>
                    {rec.enforcementRisk === 'high' && (
                      <Badge variant="destructive" className="text-[10px] gap-1">
                        <AlertTriangle className="h-3 w-3" /> High enforcement
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {rec.zone.availableSpots}/{rec.zone.totalSpots} spots • {rec.zone.occupancyPct}% full
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      <Clock className="h-3 w-3 mr-1" /> {rec.zone.currentHourRisk} risk
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground italic">{rec.reason}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {!selectedDest && (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Navigation className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-semibold">Search for a destination</p>
            <p className="text-sm">We'll recommend the best parking spots near your destination based on availability, congestion, walking distance, and enforcement risk.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
