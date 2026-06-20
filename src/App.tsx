import { useState, useCallback, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { processData } from '@/lib/processData';
import { computeActiveAlerts } from '@/lib/alerts';
import type { RawRecord, DashboardMetrics, ActiveAlert } from '@/lib/types';
import { Separator } from '@/components/ui/separator';
import { FileUpload } from '@/components/FileUpload';
import { MetricCard } from '@/components/MetricCard';
import { HotspotsPanel } from '@/components/HotspotsPanel';
import { SpatialPanel } from '@/components/SpatialPanel';
import { AnomalyPanel } from '@/components/AnomalyPanel';
import { ActiveAlertsPanel } from '@/components/ActiveAlertsPanel';
import { HotspotPredictionPanel } from '@/components/HotspotPredictionPanel';
import { CCTVAutomationPanel } from '@/components/CCTVAutomationPanel';
import { DeploymentEnginePanel } from '@/components/DeploymentEnginePanel';
import { OffenderEnginePanel } from '@/components/OffenderEnginePanel';
import { PolicyEnginePanel } from '@/components/PolicyEnginePanel';
import { PublicDashboard } from '@/components/public/PublicDashboard';
import {
  MapPin, Car, ShieldAlert, BarChart3,
  AlertTriangle, Shield, Activity, Camera,
  Users, ChevronRight, Crosshair, Cpu,
} from 'lucide-react';

function indianFmt(n: number): string {
  const s = Math.round(n).toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 0) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  return groups.join(',') + ',' + last3;
}

type DashboardMode = 'police' | 'public';

type PolicePage =
  | 'overview'
  | 'prediction'
  | 'cctv-auto'
  | 'deploy-engine'
  | 'offender-engine'
  | 'policy'
  | 'hotspots'
  | 'anomaly'
  | 'spatial';

const POLICE_PAGES: { key: PolicePage; label: string; icon: typeof Camera }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'prediction', label: 'Hotspot Prediction', icon: Crosshair },
  { key: 'cctv-auto', label: 'CCTV Automation', icon: Cpu },
  { key: 'deploy-engine', label: 'Deployment Engine', icon: Users },
  { key: 'offender-engine', label: 'Offender Risk Engine', icon: AlertTriangle },
  { key: 'policy', label: 'Policy Recommendations', icon: Shield },
  { key: 'hotspots', label: 'Hotspots & Congestion', icon: MapPin },
  { key: 'anomaly', label: 'Enforcement Quality Monitor', icon: AlertTriangle },
  { key: 'spatial', label: 'Spatial Map', icon: MapPin },
];

export default function App() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [mlData, setMlData] = useState<any>(null);
  const [allRecords, setAllRecords] = useState<RawRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreloaded, setIsPreloaded] = useState(false);
  const [mode, setMode] = useState<DashboardMode>('police');
  const [policePage, setPolicePage] = useState<PolicePage>('overview');

  useEffect(() => {
    setIsProcessing(true);
    Promise.all([
      fetch('/precomputed.json').then(r => r.json()),
      fetch('/ml_models.json').then(r => r.json()).catch(() => null),
    ]).then(([precomputed, ml]) => {
      setMetrics(precomputed);
      setMlData(ml);
      setIsPreloaded(true);
      setIsProcessing(false);
    }).catch(() => setIsProcessing(false));
  }, []);

  const handleFileLoaded = useCallback((text: string) => {
    setIsProcessing(true);
    setTimeout(() => {
      Papa.parse<RawRecord>(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const newRecords = [...allRecords, ...results.data];
          setAllRecords(newRecords);
          const m = processData(newRecords);
          setMetrics(m);
          setIsPreloaded(false);
          setIsProcessing(false);
        },
        error: () => setIsProcessing(false),
      });
    }, 50);
  }, [allRecords]);

  const displayRecordCount = isPreloaded ? metrics?.totalRecords || 0 : allRecords.length;

  const liveAlerts: ActiveAlert[] = useMemo(() => {
    if (!metrics) return [];
    return computeActiveAlerts(metrics.forecastLookup, metrics.congestionScores);
  }, [metrics]);

  const currentPageDef = POLICE_PAGES.find(p => p.key === policePage);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {mode === 'police' ? (
              <ShieldAlert className="h-7 w-7 text-red-600" />
            ) : (
              <Car className="h-7 w-7 text-blue-600" />
            )}
            <div>
              <h1 className="text-lg font-bold leading-tight">
                {mode === 'police' ? 'Parking Intelligence Dashboard' : 'Smart Parking Bangalore'}
              </h1>
              <p className="text-xs text-muted-foreground">
                {mode === 'police'
                  ? 'Bangalore Police — Illegal Parking Hotspot Detection & Enforcement'
                  : 'Find parking, avoid fines, report violations'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border bg-muted p-0.5">
              <button
                onClick={() => { setMode('police'); setPolicePage('overview'); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'police' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Shield className="h-3.5 w-3.5 inline mr-1" /> Police
              </button>
              <button
                onClick={() => setMode('public')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'public' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Users className="h-3.5 w-3.5 inline mr-1" /> Public
              </button>
            </div>

            {metrics && mode === 'police' && (
              <div className="hidden lg:flex items-center gap-4 text-sm text-muted-foreground">
                <span>{indianFmt(metrics.totalRecords)} records</span>
                <Separator orientation="vertical" className="h-4" />
                <span>{metrics.dateRange}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ═══════ PUBLIC ═══════ */}
      {mode === 'public' && (
        <main className="max-w-7xl mx-auto px-4 py-6">
          {metrics ? <PublicDashboard metrics={metrics} /> : (
            <div className="text-center py-20 text-muted-foreground">
              <Car className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <h2 className="text-xl font-semibold mb-2">Loading parking data...</h2>
            </div>
          )}
        </main>
      )}

      {/* ═══════ POLICE ═══════ */}
      {mode === 'police' && (
        <div className="flex max-w-[1400px] mx-auto">
          <aside className="w-52 shrink-0 border-r min-h-[calc(100vh-57px)] sticky top-[57px] self-start bg-muted/30 hidden md:block">
            <nav className="p-2 space-y-0.5">
              {POLICE_PAGES.map(p => {
                const Icon = p.icon;
                const isActive = policePage === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() => setPolicePage(p.key)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{p.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="md:hidden w-full border-b bg-muted/30 px-2 py-2 overflow-x-auto flex gap-1">
            {POLICE_PAGES.map(p => {
              const Icon = p.icon;
              return (
                <button
                  key={p.key}
                  onClick={() => setPolicePage(p.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors ${
                    policePage === p.key
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {p.label}
                </button>
              );
            })}
          </div>

          <main className="flex-1 p-6 space-y-6 min-w-0">
            {policePage !== 'overview' && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <button onClick={() => setPolicePage('overview')} className="hover:text-foreground transition-colors">
                  Overview
                </button>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="text-foreground font-medium">{currentPageDef?.label}</span>
              </div>
            )}

            <FileUpload
              onFileLoaded={handleFileLoaded}
              isProcessing={isProcessing}
              recordCount={displayRecordCount}
            />

            {!metrics && !isProcessing && (
              <div className="text-center py-20 text-muted-foreground">
                <ShieldAlert className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <h2 className="text-xl font-semibold mb-2">No data loaded</h2>
                <p className="text-sm">Upload a CSV or wait for pre-loaded data</p>
              </div>
            )}

            {metrics && (
              <>
                {policePage === 'overview' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <MetricCard
                        title="Critical Alerts"
                        value={liveAlerts.filter(a => a.riskLevel === 'critical').length}
                        subtitle={`${liveAlerts.length} total active alerts`}
                        icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
                        color="text-red-600"
                      />
                      <MetricCard
                        title="Top Hotspot"
                        value={metrics.topStation}
                        subtitle={`${metrics.hotspots[0]?.pct}% of all violations`}
                        icon={<MapPin className="h-5 w-5 text-indigo-600" />}
                      />
                      <MetricCard
                        title="Critical Junctions"
                        value={metrics.congestionScores.filter(c => c.riskLevel === 'critical').length}
                        subtitle="Congestion score >= 70"
                        icon={<Activity className="h-5 w-5 text-red-600" />}
                        color="text-red-600"
                      />
                      <MetricCard
                        title="CCTV Cameras"
                        value={metrics.cctvCameras.length}
                        subtitle="Monitoring high-violation junctions"
                        icon={<Camera className="h-5 w-5 text-blue-600" />}
                      />
                    </div>

                    {liveAlerts.length > 0 && <ActiveAlertsPanel alerts={liveAlerts} />}

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {POLICE_PAGES.filter(p => p.key !== 'overview').map(p => {
                        const Icon = p.icon;
                        return (
                          <button
                            key={p.key}
                            onClick={() => setPolicePage(p.key)}
                            className="flex items-center gap-3 p-4 rounded-lg border bg-card hover:bg-muted transition-colors text-left"
                          >
                            <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                            <div>
                              <p className="text-sm font-medium">{p.label}</p>
                              <p className="text-[10px] text-muted-foreground">View details</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {policePage === 'prediction' && (
                  <HotspotPredictionPanel predictionGrid={metrics.predictionGrid} mlModel={mlData?.hotspot} />
                )}
                {policePage === 'cctv-auto' && (
                  <CCTVAutomationPanel
                    cameras={metrics.cctvCameras}
                    congestionScores={metrics.congestionScores}
                    vehiclePool={metrics.vehiclePool}
                    mlValidation={mlData?.validation}
                  />
                )}
                {policePage === 'deploy-engine' && (
                  <DeploymentEnginePanel metrics={metrics} mlForecast={mlData?.forecast} />
                )}
                {policePage === 'offender-engine' && (
                  <OffenderEnginePanel profiles={metrics.offenderProfiles} mlModel={mlData?.offender} />
                )}
                {policePage === 'policy' && (
                  <PolicyEnginePanel metrics={metrics} />
                )}
                {policePage === 'hotspots' && (
                  <HotspotsPanel hotspots={metrics.hotspots} junctions={metrics.junctionHotspots} />
                )}
                {policePage === 'anomaly' && (
                  <AnomalyPanel anomalies={metrics.anomalies} mlModel={mlData?.anomaly} />
                )}
                {policePage === 'spatial' && (
                  <SpatialPanel gridHotspots={metrics.gridHotspots} />
                )}
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
