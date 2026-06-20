import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Shield, Eye, Clock } from 'lucide-react';
import type { ActiveAlert } from '@/lib/types';

interface Props {
  alerts: ActiveAlert[];
}

const RISK_STYLES: Record<string, { border: string; bg: string; badge: string; icon: string }> = {
  critical: { border: 'border-red-400', bg: 'bg-red-50', badge: 'bg-red-600 text-white', icon: 'text-red-600' },
  high: { border: 'border-orange-400', bg: 'bg-orange-50', badge: 'bg-orange-500 text-white', icon: 'text-orange-600' },
  moderate: { border: 'border-yellow-400', bg: 'bg-yellow-50', badge: 'bg-yellow-500 text-black', icon: 'text-yellow-600' },
};

export function ActiveAlertsPanel({ alerts }: Props) {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const timeStr = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} IST`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayStr = days[now.getUTCDay()];

  const critical = alerts.filter(a => a.riskLevel === 'critical');
  const high = alerts.filter(a => a.riskLevel === 'high');
  const moderate = alerts.filter(a => a.riskLevel === 'moderate');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <AlertTriangle className="h-6 w-6 text-red-600" />
            {critical.length > 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-600 rounded-full animate-pulse" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-bold">Active Alerts</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> {dayStr} {timeStr} — Based on historical patterns for this time window
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Badge className="bg-red-600 text-white">{critical.length} Critical</Badge>
          <Badge className="bg-orange-500 text-white">{high.length} High</Badge>
          <Badge className="bg-yellow-500 text-black">{moderate.length} Moderate</Badge>
        </div>
      </div>

      {alerts.length === 0 && (
        <Card className="border-green-300 bg-green-50">
          <CardContent className="p-6 text-center">
            <Shield className="h-10 w-10 mx-auto text-green-600 mb-2" />
            <p className="font-semibold text-green-800">All Clear</p>
            <p className="text-sm text-green-600">No high-risk congestion alerts for the current time window.</p>
          </CardContent>
        </Card>
      )}

      {/* Alert cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {alerts.map((alert) => {
          const style = RISK_STYLES[alert.riskLevel];
          return (
            <Card key={alert.id} className={`border-2 ${style.border} ${style.bg}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`h-5 w-5 ${style.icon}`} />
                    <div>
                      <p className="font-bold text-sm">{alert.station}</p>
                      <p className="text-xs text-muted-foreground">{alert.junction}</p>
                    </div>
                  </div>
                  <Badge className={style.badge}>{alert.riskLevel.toUpperCase()}</Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white/60 rounded p-2">
                    <p className="text-lg font-bold">{alert.expectedViolations}</p>
                    <p className="text-[10px] text-muted-foreground">Expected/hr</p>
                  </div>
                  <div className="bg-white/60 rounded p-2">
                    <p className="text-lg font-bold">{alert.congestionScore || '—'}</p>
                    <p className="text-[10px] text-muted-foreground">Cong. Score</p>
                  </div>
                  <div className="bg-white/60 rounded p-2">
                    <p className="text-lg font-bold">{alert.hour}:00</p>
                    <p className="text-[10px] text-muted-foreground">Peak Hour</p>
                  </div>
                </div>

                <div className="flex items-start gap-2 bg-white/60 rounded p-2">
                  <Eye className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <p className="text-xs leading-relaxed">{alert.recommendation}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
