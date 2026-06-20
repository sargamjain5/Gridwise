import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ScatterChart, Scatter,
  ZAxis,
} from 'recharts';
import type { AnomalyRecord } from '@/lib/types';

interface Props {
  anomalies: AnomalyRecord[];
  mlModel?: { model: string; totalAnalyzed: number; anomaliesDetected: number; results: any[] } | null;
}

export function AnomalyPanel({ anomalies, mlModel }: Props) {
  // Use Isolation Forest results when available, otherwise z-score proxy
  const displayData: AnomalyRecord[] = useMemo(() => {
    if (mlModel?.results?.length) {
      return mlModel.results.map((r: any) => ({
        id: r.id,
        type: r.type as 'officer' | 'device',
        totalViolations: r.totalViolations,
        activeDays: r.activeDays,
        violationsPerDay: r.violationsPerDay,
        rejectionRate: r.rejectionRate,
        geoSpread: r.geoSpread,
        station: '',
        anomalyScore: r.anomalyScore,
        flags: r.flags,
      }));
    }
    return anomalies;
  }, [anomalies, mlModel]);

  const officers = displayData.filter(a => a.type === 'officer');
  const devices = displayData.filter(a => a.type === 'device');

  const scatterData = displayData.map(a => ({
    x: a.violationsPerDay,
    y: a.rejectionRate,
    z: a.anomalyScore,
    id: a.id,
    type: a.type,
  }));

  return (
    <div className="space-y-6">
      {mlModel && (
        <Card className="border-green-200 bg-green-50/30">
          <CardContent className="p-3 flex items-center gap-2 text-sm flex-wrap">
            <Badge className="bg-green-600 text-white text-[10px]">Trained ML Model</Badge>
            <span className="font-medium">{mlModel.model}</span>
            <span className="text-muted-foreground">— {mlModel.totalAnalyzed} entities analyzed, {mlModel.anomaliesDetected} anomalies detected (contamination=10%)</span>
          </CardContent>
        </Card>
      )}
      {!mlModel && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardContent className="p-4">
            <p className="text-sm text-amber-800">
              <span className="font-semibold">Methodology:</span> Z-score analysis (proxy). Run model training for Isolation Forest upgrade.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Anomaly Score Distribution</CardTitle>
            <p className="text-sm text-muted-foreground">
              Top flagged entities by composite anomaly score
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart
                data={displayData.slice(0, 15)}
                layout="vertical"
                margin={{ left: 10, right: 30 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 'auto']} />
                <YAxis type="category" dataKey="id" width={110} tick={{ fontSize: 10 }} />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border rounded-lg p-3 shadow-lg text-sm">
                        <p className="font-bold">{d.id}</p>
                        <p>Type: {d.type}</p>
                        <p>Score: {d.anomalyScore}</p>
                        <p>Violations/day: {d.violationsPerDay}</p>
                        <p>Rejection rate: {d.rejectionRate}%</p>
                        <p>Station: {d.station}</p>
                        {d.flags?.map((f: string, i: number) => (
                          <p key={i} className="text-red-600 text-xs mt-1">⚠ {f}</p>
                        ))}
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="anomalyScore"
                  fill="#d97706"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Activity vs Rejection Rate</CardTitle>
            <p className="text-sm text-muted-foreground">
              Bubble size = anomaly score. Outliers in corners warrant investigation.
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={360}>
              <ScatterChart margin={{ bottom: 20, left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" dataKey="x" name="Violations/day" />
                <YAxis type="number" dataKey="y" name="Rejection %" unit="%" />
                <ZAxis type="number" dataKey="z" range={[40, 400]} name="Score" />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border rounded-lg p-2 shadow text-xs">
                        <p className="font-bold">{d.id} ({d.type})</p>
                        <p>Activity: {d.x}/day</p>
                        <p>Rejection: {d.y}%</p>
                        <p>Score: {d.z}</p>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData} fill="#dc2626" fillOpacity={0.6} />
              </ScatterChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Flagged Entities Detail</CardTitle>
          <div className="flex gap-2 mt-1">
            <Badge variant="secondary">{officers.length} officers</Badge>
            <Badge variant="secondary">{devices.length} devices</Badge>
          </div>
        </CardHeader>
        <CardContent className="max-h-[450px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Station</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Per Day</TableHead>
                <TableHead className="text-right">Reject %</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayData.slice(0, 20).map((a) => (
                <TableRow key={`${a.type}-${a.id}`}>
                  <TableCell className="font-mono text-xs">{a.id}</TableCell>
                  <TableCell>
                    <Badge variant={a.type === 'officer' ? 'default' : 'secondary'} className="text-xs">
                      {a.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{a.station}</TableCell>
                  <TableCell className="text-right">{a.totalViolations.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-right font-semibold">{a.violationsPerDay}</TableCell>
                  <TableCell className="text-right">
                    <span className={a.rejectionRate > 50 ? 'text-red-600 font-bold' : ''}>
                      {a.rejectionRate}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-bold text-amber-700">{a.anomalyScore}</TableCell>
                  <TableCell className="text-xs max-w-[250px]">
                    {a.flags.map((f, i) => (
                      <span key={i} className="block text-red-600">⚠ {f}</span>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
