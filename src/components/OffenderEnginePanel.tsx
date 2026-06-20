import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  PieChart, Pie,
} from 'recharts';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Search, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { scoreAllOffenders } from '@/lib/offenderEngine';
import type { OffenderProfile, OffenderRiskScore } from '@/lib/types';

interface Props {
  profiles: OffenderProfile[];
  mlModel?: { model: string; auc: number; precision: number; recall: number; f1: number; featureImportance: Record<string, number>; predictions: any[] } | null;
}

const LEVEL_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#22c55e',
};
const LEVEL_BADGE: Record<string, string> = {
  critical: 'bg-red-600 text-white', high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-black', low: 'bg-green-600 text-white',
};

const FACTOR_LABELS: Record<string, string> = {
  volumeScore: 'Volume',
  frequencyScore: 'Frequency',
  hotspotScore: 'Hotspot',
  escalationScore: 'Escalation',
  recencyScore: 'Recency',
  spreadScore: 'Spread',
};

export function OffenderEnginePanel({ profiles, mlModel }: Props) {
  const [search, setSearch] = useState('');
  const [expandedVehicle, setExpandedVehicle] = useState<string | null>(null);

  // Use ML model predictions when available, fall back to heuristic
  const allScored = useMemo((): OffenderRiskScore[] => {
    if (mlModel?.predictions?.length) {
      // Build a map of ML predictions keyed by vehicle number
      const mlMap = new Map<string, any>();
      for (const p of mlModel.predictions) mlMap.set(p.vehicle, p);

      // Merge ML scores with profile data
      return profiles
        .map(profile => {
          const ml = mlMap.get(profile.vehicle);
          if (ml) {
            return {
              profile,
              score: ml.riskScore,
              level: (ml.riskLevel || 'low') as OffenderRiskScore['level'],
              factors: {
                volumeScore: Math.min(100, Math.round(Math.log(ml.totalViolations + 1) / Math.log(56) * 100)),
                frequencyScore: Math.min(100, Math.round(ml.freqPerMonth / 15 * 100)),
                hotspotScore: Math.round(profile.hotspotRatio * 100),
                escalationScore: Math.min(100, Math.max(0, Math.round((ml.escalation - 0.5) * 40))),
                recencyScore: Math.max(5, Math.round(100 - Math.log(ml.recencyDays + 1) * 15)),
                spreadScore: Math.min(100, ml.stationCount * 20),
              },
            };
          }
          return null;
        })
        .filter((s): s is OffenderRiskScore => s !== null)
        .sort((a, b) => b.score - a.score);
    }
    // Fallback: heuristic scoring
    return scoreAllOffenders(profiles);
  }, [profiles, mlModel]);

  const filtered = useMemo(() => {
    if (!search) return allScored;
    const q = search.toUpperCase();
    return allScored.filter(s =>
      s.profile.vehicle.toUpperCase().includes(q) ||
      s.profile.vehicleType.includes(q)
    );
  }, [allScored, search]);

  // Distribution
  const distribution = useMemo(() => {
    const dist = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const s of allScored) dist[s.level]++;
    return Object.entries(dist).map(([level, count]) => ({
      level, count, color: LEVEL_COLORS[level],
    }));
  }, [allScored]);

  // Score histogram
  const histogram = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}-${i * 10 + 9}`,
      count: 0,
      mid: i * 10 + 5,
    }));
    for (const s of allScored) {
      const bin = Math.min(9, Math.floor(s.score / 10));
      bins[bin].count++;
    }
    return bins;
  }, [allScored]);

  // Top 5 for radar
  const top5 = allScored.slice(0, 5);
  const radarData = Object.keys(FACTOR_LABELS).map(key => {
    const entry: Record<string, string | number> = { factor: FACTOR_LABELS[key] };
    top5.forEach((s, i) => {
      entry[`v${i}`] = s.factors[key as keyof typeof s.factors];
    });
    return entry;
  });
  const RADAR_COLORS = ['#dc2626', '#f97316', '#eab308', '#3b82f6', '#8b5cf6'];

  return (
    <div className="space-y-4">
      {/* ML Model info */}
      {mlModel && (
        <Card className="border-green-200 bg-green-50/30">
          <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge className="bg-green-600 text-white text-[10px]">Trained ML Model</Badge>
              <span className="font-medium">{mlModel.model} — Re-offense Prediction</span>
              <span className="text-muted-foreground">AUC: {mlModel.auc} | Precision: {mlModel.precision} | Recall: {mlModel.recall}</span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {Object.entries(mlModel.featureImportance).sort(([,a],[,b]) => b - a).slice(0, 4).map(([k, v]) => (
                <Badge key={k} variant="outline" className="text-[9px]">{k}: {(v * 100).toFixed(0)}%</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-red-600">{distribution.find(d => d.level === 'critical')?.count || 0}</p>
            <p className="text-[10px] text-red-700">Critical Risk</p>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50/50">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-orange-600">{distribution.find(d => d.level === 'high')?.count || 0}</p>
            <p className="text-[10px] text-orange-700">High Risk</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-yellow-600">{distribution.find(d => d.level === 'medium')?.count || 0}</p>
            <p className="text-[10px] text-muted-foreground">Medium Risk</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{distribution.find(d => d.level === 'low')?.count || 0}</p>
            <p className="text-[10px] text-muted-foreground">Low Risk</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{allScored.length}</p>
            <p className="text-[10px] text-muted-foreground">Repeat Offenders</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Score distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Risk Score Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={histogram}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {histogram.map((h, i) => (
                    <Cell key={i} fill={
                      h.mid >= 75 ? '#dc2626' : h.mid >= 50 ? '#f97316' : h.mid >= 25 ? '#eab308' : '#22c55e'
                    } />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Radar: top 5 factor comparison */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top 5 — Risk Factor Radar</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="factor" tick={{ fontSize: 10 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 8 }} />
                {top5.map((s, i) => (
                  <Radar key={s.profile.vehicle} name={s.profile.vehicle}
                    dataKey={`v${i}`} stroke={RADAR_COLORS[i]} fill={RADAR_COLORS[i]}
                    fillOpacity={0.08} strokeWidth={2} />
                ))}
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 mt-1 justify-center">
              {top5.map((s, i) => (
                <Badge key={s.profile.vehicle} style={{ backgroundColor: RADAR_COLORS[i], color: 'white' }} className="text-[9px]">
                  {s.profile.vehicle}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search + table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base">Offender Risk Profiles</CardTitle>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search vehicle number..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 pr-3 py-2 border rounded-md text-sm bg-background w-64"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="max-h-[600px] overflow-y-auto space-y-1.5">
          {filtered.slice(0, 50).map((s, idx) => {
            const isExpanded = expandedVehicle === s.profile.vehicle;
            return (
              <div key={s.profile.vehicle} className="border rounded-lg overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => setExpandedVehicle(isExpanded ? null : s.profile.vehicle)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted-foreground w-5">
                      {search ? '' : `#${idx + 1}`}
                    </span>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                      style={{ backgroundColor: LEVEL_COLORS[s.level] }}>
                      {s.score}
                    </div>
                    <div>
                      <p className="font-mono text-sm font-bold">{s.profile.vehicle}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {s.profile.vehicleType} • {s.profile.totalViolations} violations • {s.profile.frequencyPerMonth}/month
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] ${LEVEL_BADGE[s.level]}`}>{s.level.toUpperCase()}</Badge>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t p-4 bg-muted/20 space-y-4">
                    {/* Score breakdown bars */}
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(s.factors).map(([key, value]) => (
                        <div key={key} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="font-medium">{FACTOR_LABELS[key]}</span>
                            <span className="font-bold">{value}/100</span>
                          </div>
                          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{
                              width: `${value}%`,
                              backgroundColor: value >= 75 ? '#dc2626' : value >= 50 ? '#f97316' : value >= 25 ? '#eab308' : '#22c55e',
                            }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Key stats */}
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
                      <div className="bg-white rounded p-2 border">
                        <p className="font-bold text-sm">{s.profile.totalViolations}</p>
                        <p className="text-[9px] text-muted-foreground">Total</p>
                      </div>
                      <div className="bg-white rounded p-2 border">
                        <p className="font-bold text-sm">{s.profile.parkingViolations}</p>
                        <p className="text-[9px] text-muted-foreground">Parking</p>
                      </div>
                      <div className="bg-white rounded p-2 border">
                        <p className="font-bold text-sm">{s.profile.frequencyPerMonth}/mo</p>
                        <p className="text-[9px] text-muted-foreground">Frequency</p>
                      </div>
                      <div className="bg-white rounded p-2 border">
                        <p className="font-bold text-sm">{s.profile.escalation}×</p>
                        <p className="text-[9px] text-muted-foreground">Escalation</p>
                      </div>
                      <div className="bg-white rounded p-2 border">
                        <p className="font-bold text-sm">{s.profile.recencyDays}d</p>
                        <p className="text-[9px] text-muted-foreground">Last Seen</p>
                      </div>
                      <div className="bg-white rounded p-2 border">
                        <p className="font-bold text-sm">{s.profile.hotspotRatio * 100}%</p>
                        <p className="text-[9px] text-muted-foreground">In Hotspots</p>
                      </div>
                    </div>

                    {/* Station breakdown */}
                    <div>
                      <p className="text-xs font-medium mb-1">Station History ({s.profile.stationCount} stations, {s.profile.junctionCount} junctions)</p>
                      <div className="flex gap-1 flex-wrap">
                        {s.profile.stations.map(st => (
                          <Badge key={st.station} variant="outline" className="text-[10px]">
                            {st.station} ({st.count})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Scoring methodology */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Scoring Methodology</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
            <div className="p-2 rounded bg-muted/50">
              <p className="font-medium text-foreground">Volume (25%)</p>
              <p>Total violations (log-scaled)</p>
            </div>
            <div className="p-2 rounded bg-muted/50">
              <p className="font-medium text-foreground">Frequency (20%)</p>
              <p>Violations per month rate</p>
            </div>
            <div className="p-2 rounded bg-muted/50">
              <p className="font-medium text-foreground">Hotspot (20%)</p>
              <p>% of violations in critical/high congestion zones</p>
            </div>
            <div className="p-2 rounded bg-muted/50">
              <p className="font-medium text-foreground">Escalation (15%)</p>
              <p>Is violation rate increasing over time?</p>
            </div>
            <div className="p-2 rounded bg-muted/50">
              <p className="font-medium text-foreground">Recency (10%)</p>
              <p>Days since last violation (recent = higher risk)</p>
            </div>
            <div className="p-2 rounded bg-muted/50">
              <p className="font-medium text-foreground">Spread (10%)</p>
              <p>Violations across multiple stations/junctions</p>
            </div>
          </div>
          <div className="flex gap-3 mt-3">
            {(['critical', 'high', 'medium', 'low'] as const).map(l => (
              <div key={l} className="flex items-center gap-1.5 text-xs">
                <div className="w-3 h-3 rounded-full" style={{ background: LEVEL_COLORS[l] }} />
                {l.charAt(0).toUpperCase() + l.slice(1)} ({l === 'critical' ? '75-100' : l === 'high' ? '50-74' : l === 'medium' ? '25-49' : '0-24'})
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
