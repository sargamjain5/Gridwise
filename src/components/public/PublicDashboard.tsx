import { useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NoParkingMap } from './NoParkingMap';
import { SmartParkingPanel } from './SmartParkingPanel';
import { IncentivesPanel } from './IncentivesPanel';
import { MapPin, Navigation, Camera } from 'lucide-react';
import type { DashboardMetrics } from '@/lib/types';
import { buildParkingZones, buildDestinations } from '@/lib/publicData';

interface Props {
  metrics: DashboardMetrics;
}

export function PublicDashboard({ metrics }: Props) {
  const zones = useMemo(() => buildParkingZones(metrics), [metrics]);
  const destinations = useMemo(() => buildDestinations(metrics), [metrics]);

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-xl p-6">
        <h2 className="text-2xl font-bold">Smart Parking Bangalore</h2>
        <p className="text-blue-100 mt-1 text-sm">
          Find legal parking, avoid fines, and report violations to earn free transit tickets
        </p>
        <div className="flex gap-4 mt-4 text-sm flex-wrap">
          <div className="bg-white/15 rounded-lg px-4 py-2">
            <span className="font-bold text-lg">{zones.filter(z => z.availableSpots > 0).length}</span>
            <span className="text-blue-100 ml-1.5">zones with parking</span>
          </div>
          <div className="bg-white/15 rounded-lg px-4 py-2">
            <span className="font-bold text-lg">{zones.reduce((s, z) => s + z.availableSpots, 0)}</span>
            <span className="text-blue-100 ml-1.5">spots available</span>
          </div>
          <div className="bg-white/15 rounded-lg px-4 py-2">
            <span className="font-bold text-lg">{zones.filter(z => z.type === 'no-parking').length}</span>
            <span className="text-blue-100 ml-1.5">no-parking alerts</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="map" className="w-full">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1 bg-muted p-1">
          <TabsTrigger value="map" className="gap-1.5">
            <MapPin className="h-4 w-4" /> Parking Map & Alerts
          </TabsTrigger>
          <TabsTrigger value="recommend" className="gap-1.5">
            <Navigation className="h-4 w-4" /> Smart Recommendations
          </TabsTrigger>
          <TabsTrigger value="report" className="gap-1.5">
            <Camera className="h-4 w-4" /> Mobility Rewards (YOLO+OCR)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="map" className="mt-6">
          <NoParkingMap zones={zones} />
        </TabsContent>
        <TabsContent value="recommend" className="mt-6">
          <SmartParkingPanel zones={zones} destinations={destinations} />
        </TabsContent>
        <TabsContent value="report" className="mt-6">
          <IncentivesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
