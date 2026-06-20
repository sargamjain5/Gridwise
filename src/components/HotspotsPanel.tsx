import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { HotspotData, JunctionHotspot } from '@/lib/types';

interface Props {
  hotspots: HotspotData[];
  junctions: JunctionHotspot[];
}

export function HotspotsPanel({ hotspots, junctions }: Props) {
  const maxCount = hotspots[0]?.count || 1;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top Illegal Parking Hotspot Stations</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={380}>
            <BarChart
              data={hotspots.slice(0, 10)}
              layout="vertical"
              margin={{ left: 10, right: 30 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="station" width={120} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: number) => [v.toLocaleString('en-IN'), 'Violations']} />
              <Bar dataKey="count" fill="hsl(262, 60%, 45%)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top Junction Hotspots</CardTitle>
          <p className="text-sm text-muted-foreground">
            Junctions where parking directly chokes carriageways
          </p>
        </CardHeader>
        <CardContent className="space-y-3 max-h-[420px] overflow-y-auto">
          {junctions.slice(0, 12).map((j) => (
            <div key={j.junction} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium truncate max-w-[60%]">{j.junction}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {j.count.toLocaleString('en-IN')}
                  </Badge>
                  <Badge
                    variant="destructive"
                    className="text-xs"
                  >
                    {j.parkingCount.toLocaleString('en-IN')} parking
                  </Badge>
                </div>
              </div>
              <Progress value={(j.count / maxCount) * 100} className="h-1.5" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
