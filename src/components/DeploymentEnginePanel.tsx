import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  AreaChart, Area, Cell, ComposedChart, Line,
} from 'recharts';
import {
  Shield, Clock, Users, AlertTriangle, Calendar, Zap, ChevronDown, ChevronUp,
} from 'lucide-react';
import { runDeploymentEngine, SPECIAL_EVENTS } from '@/lib/deploymentEngine';
import type { DashboardMetrics } from '@/lib/types';

interface Props {
  metrics: DashboardMetrics;
  mlForecast?: { model: string; stations: number; results: Record<string, { trend: number; mae: number; mape: number; dowFactors: Record<string, number>; forecasts: any[]; history: any[] }> } | null;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const URGENCY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#22c55e',
};
const URGENCY_BADGE: Record<string, string> = {
  critical: 'bg-red-600 text-white', high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-black', low: 'bg-green-600 text-white',
};

export function DeploymentEnginePanel({ metrics, mlForecast }: Props) {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const [day, setDay] = useState(DAYS[now.getUTCDay() === 0 ? 6 : now.getUTCDay() - 1]);
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [specialEvent, setSpecialEvent] = useState('none');
  const [expandedStation, setExpandedStation] = useState<string | null>(null);

  // Enhance forecastLookup with ML model trend when available
  const enhancedForecast = useMemo(() => {
    if (!mlForecast?.results) return metrics.forecastLookup;
    // Adjust raw forecast entries using ML trend data
    return metrics.forecastLookup.map(f => {
      const stationML = mlForecast.results[f.station];
      if (!stationML) return f;
      // Day-of-week factor from trained model
      const dayMap: Record<string, string> = { Mon: '0', Tue: '1', Wed: '2', Thu: '3', Fri: '4', Sat: '5', Sun: '6' };
      const dowFactor = stationML.dowFactors[dayMap[f.day]] || 1.0;
      // Use ML trend × dow factor to adjust avg violations
      const mlPredicted = stationML.trend / 24 * dowFactor; // trend is daily, divide by 24 for hourly
      // Blend: 60% ML, 40% raw historical
      const blended = mlPredicted * 0.6 + f.avgViolations * 0.4;
      return { ...f, avgViolations: Math.round(blended * 10) / 10 };
    });
  }, [metrics.forecastLookup, mlForecast]);

  const result = useMemo(() => runDeploymentEngine(
    day, month, specialEvent,
    enhancedForecast,
    metrics.stationProfiles,
    metrics.congestionScores,
    metrics.predictionGrid,
  ), [day, month, specialEvent, enhancedForecast, metrics]);

  // City-wide hourly chart
  const cityHourly = useMemo(() => {
    const hours = new Array(24).fill(null).map((_, h) => ({
      hour: h,
      violations: 0,
      officers: 0,
    }));
    for (const plan of result.stationPlans) {
      for (const hb of plan.hourlyBreakdown) {
        hours[hb.hour].violations += hb.predictedViolationsPerHour;
        hours[hb.hour].officers += hb.requiredOfficers;
      }
    }
    return hours.map(h => ({
      ...h,
      violations: Math.round(h.violations),
      label: `${h.hour}:00`,
    }));
  }, [result]);

  return (
    <div className="space-y-4">
      {/* ML model info */}
      {mlForecast && (
        <Card className="border-green-200 bg-green-50/30">
          <CardContent className="p-3 flex items-center gap-2 text-sm flex-wrap">
            <Badge className="bg-green-600 text-white text-[10px]">Trained Model</Badge>
            <span className="font-medium">{mlForecast.model}</span>
            <span className="text-muted-foreground">— {mlForecast.stations} stations, blending ML trend (60%) + historical avg (40%)</span>
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-blue-600" /> Day
              </label>
              <div className="flex gap-1 flex-wrap">
                {DAYS.map(d => (
                  <button key={d} onClick={() => setDay(d)}
                    className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                      day === d ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                    }`}>{d}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Month</label>
              <select value={month} onChange={e => setMonth(+e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-orange-600" /> Special Event
              </label>
              <select value={specialEvent} onChange={e => setSpecialEvent(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background">
                {Object.entries(SPECIAL_EVENTS).map(([key, evt]) => (
                  <option key={key} value={key}>
                    {evt.name} {evt.multiplier !== 1 ? `(×${evt.multiplier})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-3 text-center">
            <AlertTriangle className="h-5 w-5 text-red-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-red-600">
              {Math.round(cityHourly.reduce((s, h) => s + h.violations, 0))}
            </p>
            <p className="text-[10px] text-red-700">Predicted Violations/Day</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Clock className="h-5 w-5 text-orange-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-orange-600">{result.peakCityWide.hour}:00</p>
            <p className="text-[10px] text-muted-foreground">Peak Hour (IST)</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-3 text-center">
            <Users className="h-5 w-5 text-blue-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-blue-600">{result.totalOfficersNeeded}</p>
            <p className="text-[10px] text-blue-700">Officers Needed (Peak)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Shield className="h-5 w-5 text-purple-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-purple-600">{result.stationPlans.length}</p>
            <p className="text-[10px] text-muted-foreground">Stations Covered</p>
          </CardContent>
        </Card>
      </div>

      {/* City-wide hourly chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">City-Wide Hourly Prediction — {day}, {MONTHS[month - 1]}</CardTitle>
          <p className="text-xs text-muted-foreground">{result.summary}</p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={cityHourly}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip content={({ payload }) => {
                if (!payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-white border rounded-lg p-2 shadow text-xs">
                    <p className="font-bold">{d.hour}:00 IST</p>
                    <p>Violations: <strong>{d.violations}</strong></p>
                    <p>Officers: <strong>{d.officers}</strong></p>
                  </div>
                );
              }} />
              <Area yAxisId="left" type="monotone" dataKey="violations" fill="#fecaca" stroke="#dc2626"
                strokeWidth={2} fillOpacity={0.3} name="Predicted Violations" />
              <Line yAxisId="right" type="monotone" dataKey="officers" stroke="#2563eb"
                strokeWidth={2.5} dot={{ r: 3 }} name="Officers Required" />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex gap-4 justify-center text-xs text-muted-foreground mt-2">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-600 inline-block" /> Violations</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-600 inline-block" /> Officers</span>
          </div>
        </CardContent>
      </Card>

      {/* Per-station plans */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Station Deployment Plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
          {result.stationPlans.map((plan, idx) => {
            const isExpanded = expandedStation === plan.station;
            const peakEntry = plan.hourlyBreakdown[plan.peakWindow.peakHour];

            return (
              <div key={plan.station} className="border rounded-lg overflow-hidden">
                {/* Station header */}
                <button
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => setExpandedStation(isExpanded ? null : plan.station)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted-foreground w-5">#{idx + 1}</span>
                    <div>
                      <p className="font-semibold text-sm">{plan.station}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Peak: {plan.peakWindow.startHour}:00–{plan.peakWindow.endHour + 1}:00 IST
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-bold">{plan.totalPredictedViolations} viol.</p>
                      <p className="text-[10px] text-muted-foreground">{plan.peakOfficers} officers peak</p>
                    </div>
                    <Badge className={`text-[9px] ${URGENCY_BADGE[peakEntry?.urgency || 'low']}`}>
                      {peakEntry?.urgency || 'low'}
                    </Badge>
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t p-3 bg-muted/20 space-y-3">
                    {/* Shift recommendation */}
                    <div className="p-2.5 rounded bg-blue-50 border border-blue-200">
                      <p className="text-xs font-semibold text-blue-800 flex items-center gap-1">
                        <Shield className="h-3.5 w-3.5" /> Shift Recommendation
                      </p>
                      <p className="text-xs text-blue-700 mt-1">{plan.shiftRecommendation}</p>
                    </div>

                    {/* Multipliers */}
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-white rounded p-2 border">
                        <p className="font-bold">{plan.hourlyBreakdown[plan.peakWindow.peakHour]?.hotspotMultiplier}×</p>
                        <p className="text-[10px] text-muted-foreground">Hotspot</p>
                      </div>
                      <div className="bg-white rounded p-2 border">
                        <p className="font-bold">{SPECIAL_EVENTS[specialEvent]?.multiplier}×</p>
                        <p className="text-[10px] text-muted-foreground">Event</p>
                      </div>
                      <div className="bg-white rounded p-2 border">
                        <p className="font-bold">{(0.7 + month * 0.03).toFixed(2)}×</p>
                        <p className="text-[10px] text-muted-foreground">Season</p>
                      </div>
                    </div>

                    {/* Hourly chart */}
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={plan.hourlyBreakdown}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="hour" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 9 }} />
                        <Tooltip content={({ payload }) => {
                          if (!payload?.[0]) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-white border rounded p-2 shadow text-xs">
                              <p className="font-bold">{d.hour}:00 IST</p>
                              <p>Base: {d.baseViolations} → Predicted: <strong>{d.predictedViolationsPerHour}</strong></p>
                              <p>Officers: <strong>{d.requiredOfficers}</strong></p>
                              <p>Temporal ×{d.temporalMultiplier} • Hotspot ×{d.hotspotMultiplier} • Event ×{d.eventMultiplier}</p>
                            </div>
                          );
                        }} />
                        <Bar dataKey="predictedViolationsPerHour" radius={[2, 2, 0, 0]}>
                          {plan.hourlyBreakdown.map((h, i) => (
                            <Cell key={i} fill={URGENCY_COLORS[h.urgency]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>

                    {/* Officers timeline */}
                    <div className="flex gap-0.5 items-end h-8">
                      {plan.hourlyBreakdown.map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 rounded-t"
                          style={{
                            height: `${Math.max(4, (h.requiredOfficers / Math.max(plan.peakOfficers, 1)) * 100)}%`,
                            backgroundColor: h.requiredOfficers > 0 ? '#2563eb' : '#e5e7eb',
                          }}
                          title={`${h.hour}:00 — ${h.requiredOfficers} officers`}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center">Officer deployment timeline (0:00–23:00)</p>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
