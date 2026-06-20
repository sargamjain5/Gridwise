import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Camera, CheckCircle, XCircle, Upload, Gift, Eye, Cpu,
} from 'lucide-react';

const ANPR_API = 'http://localhost:8000';

// ── Types ──

interface ProcessingStep {
  stage: string;
  status: 'success' | 'warning' | 'fail';
  detail: string;
  timeMs: number;
}

interface DetectionResult {
  id: string;
  imageUrl: string;
  timestamp: Date;
  gpsLat: number;
  gpsLon: number;
  nearbyHotspotScore: number;
  // Results
  yoloDetected: boolean;
  yoloConfidence: number;
  yoloVehicleType: string;
  yoloBboxCount: number;
  ocrSuccess: boolean;
  ocrConfidence: number;
  ocrVehicleNumber: string;
  isValid: boolean;
  overallConfidence: number;
  rewardPoints: number;
  processingSteps: ProcessingStep[];
  source: 'api' | 'simulation';
}

// ── Simulation fallback ──

const VEHICLE_TYPES = ['Car', 'Scooter', 'Motorcycle', 'Auto-Rickshaw', 'SUV', 'Van', 'Bus'];
const FAKE_PLATES = [
  'KA01AB1234', 'KA02CD5678', 'KA03EF9012', 'KA04GH3456', 'KA05IJ7890',
  'KA51MN2345', 'KA53PQ6789', 'KA41RS0123', 'KA09TU4567', 'KA50VW8901',
];

function simulateFallback(hotspotScore: number): Omit<DetectionResult, 'id' | 'imageUrl' | 'timestamp' | 'gpsLat' | 'gpsLon' | 'nearbyHotspotScore'> {
  const yoloDetected = Math.random() < 0.80;
  const yoloConfidence = yoloDetected ? Math.round(65 + Math.random() * 34) : Math.round(10 + Math.random() * 30);
  const yoloBboxCount = yoloDetected ? 1 + Math.floor(Math.random() * 3) : 0;
  const yoloVehicleType = yoloDetected ? VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)] : 'None';
  const ocrSuccess = yoloDetected && Math.random() < 0.70;
  const ocrConfidence = ocrSuccess ? Math.round(60 + Math.random() * 39) : Math.round(5 + Math.random() * 25);
  const ocrVehicleNumber = ocrSuccess ? FAKE_PLATES[Math.floor(Math.random() * FAKE_PLATES.length)] : 'UNREADABLE';
  const hotspotBoost = hotspotScore / 100;
  const isParkedIllegally = yoloDetected && Math.random() < (0.5 + hotspotBoost * 0.3);
  const overallConfidence = yoloDetected
    ? Math.round(yoloConfidence * 0.4 + (ocrSuccess ? ocrConfidence * 0.3 : 15) + (isParkedIllegally ? 20 + hotspotBoost * 10 : 5))
    : Math.round(yoloConfidence * 0.3);
  const isValid = yoloDetected && isParkedIllegally && overallConfidence >= 60;
  const rewardPoints = isValid ? 10 + Math.round(hotspotScore / 10) + (ocrSuccess ? 5 : 0) : 0;

  return {
    yoloDetected, yoloConfidence, yoloBboxCount, yoloVehicleType,
    ocrSuccess, ocrConfidence, ocrVehicleNumber,
    isValid, overallConfidence, rewardPoints,
    source: 'simulation',
    processingSteps: [
      { stage: 'YOLO Detection', status: yoloDetected ? 'success' : 'fail', detail: yoloDetected ? `${yoloVehicleType} (${yoloConfidence}%)` : 'No vehicle', timeMs: 120 },
      { stage: 'OCR Extraction', status: ocrSuccess ? 'success' : 'warning', detail: ocrSuccess ? `${ocrVehicleNumber} (${ocrConfidence}%)` : 'Not readable', timeMs: 80 },
      { stage: 'Violation Check', status: isValid ? 'success' : 'fail', detail: isValid ? `Confirmed (hotspot: ${hotspotScore})` : 'Not confirmed', timeMs: 15 },
      { stage: 'Reward', status: isValid ? 'success' : 'fail', detail: isValid ? `+${rewardPoints} points` : 'No reward', timeMs: 5 },
    ],
  };
}

// ── Parse real ANPR API response into our format ──

function parseAPIResponse(apiResult: any, hotspotScore: number): Omit<DetectionResult, 'id' | 'imageUrl' | 'timestamp' | 'gpsLat' | 'gpsLon' | 'nearbyHotspotScore'> {
  const det = apiResult.detections?.[0]; // primary detection
  const yoloDetected = apiResult.total_vehicles > 0;
  const yoloConfidence = det ? det.vehicle_confidence : 0;
  const yoloVehicleType = det ? det.vehicle_type : 'None';
  const yoloBboxCount = apiResult.total_vehicles;

  const ocrSuccess = det?.plate_reading?.text?.length > 3;
  const ocrConfidence = det?.plate_reading?.confidence || 0;
  const ocrVehicleNumber = ocrSuccess ? det.plate_reading.text : 'UNREADABLE';

  const inViolation = det?.in_violation_zone || false;
  const overallConfidence = yoloDetected
    ? Math.round(yoloConfidence * 0.4 + (ocrSuccess ? ocrConfidence * 0.3 : 10) + (inViolation ? 25 : 5) + (hotspotScore / 100) * 10)
    : 0;

  const isValid = yoloDetected && overallConfidence >= 55;
  const rewardPoints = isValid ? 10 + Math.round(hotspotScore / 10) + (ocrSuccess ? 5 : 0) : 0;

  const steps: ProcessingStep[] = [
    { stage: 'Image Upload', status: 'success', detail: `Sent to ANPR API`, timeMs: Math.round(apiResult.processing_time_ms * 0.1) },
    { stage: 'YOLOv8 Detection', status: yoloDetected ? 'success' : 'fail', detail: yoloDetected ? `${yoloBboxCount} vehicle(s): ${yoloVehicleType} (${yoloConfidence}%)` : 'No vehicle detected', timeMs: Math.round(apiResult.processing_time_ms * 0.5) },
    { stage: 'EasyOCR Plate Read', status: ocrSuccess ? 'success' : yoloDetected ? 'warning' : 'fail', detail: ocrSuccess ? `${ocrVehicleNumber} (${ocrConfidence}%)` : yoloDetected ? 'Plate not readable' : 'Skipped', timeMs: Math.round(apiResult.processing_time_ms * 0.35) },
    { stage: 'Violation Verification', status: isValid ? 'success' : 'warning', detail: isValid ? `Confirmed (confidence: ${overallConfidence}%, hotspot: ${hotspotScore})` : `Not confirmed (confidence: ${overallConfidence}%)`, timeMs: Math.round(apiResult.processing_time_ms * 0.05) },
    { stage: 'Reward Calculation', status: isValid ? 'success' : 'fail', detail: isValid ? `+${rewardPoints} points awarded` : 'No reward', timeMs: 1 },
  ];

  return {
    yoloDetected, yoloConfidence, yoloBboxCount, yoloVehicleType,
    ocrSuccess, ocrConfidence, ocrVehicleNumber,
    isValid, overallConfidence, rewardPoints,
    source: 'api',
    processingSteps: steps,
  };
}

// ── Component ──

export function IncentivesPanel() {
  const [results, setResults] = useState<DetectionResult[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [totalPoints, setTotalPoints] = useState(0);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check API on mount
  useEffect(() => {
    fetch(`${ANPR_API}/health`).then(r => r.json())
      .then(() => setApiAvailable(true))
      .catch(() => setApiAvailable(false));
  }, []);

  const handleUpload = useCallback((file: File) => {
    const imageUrl = URL.createObjectURL(file);
    const id = `MRN-${String(results.length + 1).padStart(4, '0')}`;
    const gpsLat = 12.93 + Math.random() * 0.08;
    const gpsLon = 77.55 + Math.random() * 0.08;
    const nearbyHotspotScore = Math.round(20 + Math.random() * 75);

    // Placeholder while processing
    const placeholder: DetectionResult = {
      id, imageUrl, timestamp: new Date(), gpsLat, gpsLon, nearbyHotspotScore,
      yoloDetected: false, yoloConfidence: 0, yoloBboxCount: 0, yoloVehicleType: '',
      ocrSuccess: false, ocrConfidence: 0, ocrVehicleNumber: '',
      isValid: false, overallConfidence: 0, rewardPoints: 0,
      source: 'simulation',
      processingSteps: [{ stage: 'Processing...', status: 'warning', detail: 'Running detection pipeline', timeMs: 0 }],
    };
    setResults(prev => [placeholder, ...prev]);

    if (apiAvailable) {
      // Real ANPR API call
      const formData = new FormData();
      formData.append('file', file);

      fetch(`${ANPR_API}/detect/image`, { method: 'POST', body: formData })
        .then(r => r.json())
        .then(apiResult => {
          const detection = parseAPIResponse(apiResult, nearbyHotspotScore);
          setResults(prev => prev.map(r => r.id === id ? { ...placeholder, ...detection } : r));
          if (detection.rewardPoints > 0) setTotalPoints(p => p + detection.rewardPoints);
        })
        .catch(() => {
          // API failed — fall back to simulation
          const detection = simulateFallback(nearbyHotspotScore);
          setResults(prev => prev.map(r => r.id === id ? { ...placeholder, ...detection } : r));
          if (detection.rewardPoints > 0) setTotalPoints(p => p + detection.rewardPoints);
        });
    } else {
      // Simulation fallback
      setTimeout(() => {
        const detection = simulateFallback(nearbyHotspotScore);
        setResults(prev => prev.map(r => r.id === id ? { ...placeholder, ...detection } : r));
        if (detection.rewardPoints > 0) setTotalPoints(p => p + detection.rewardPoints);
      }, 2000 + Math.random() * 1500);
    }
  }, [results.length, apiAvailable]);

  const validCount = results.filter(r => r.isValid).length;
  const totalProcessed = results.filter(r => r.processingSteps.length > 1).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-purple-200 bg-purple-50/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Cpu className="h-6 w-6 text-purple-600" />
            <div>
              <p className="font-semibold flex items-center gap-2">
                Mobility Rewards Network
                {apiAvailable === true && <Badge className="bg-green-600 text-white text-[9px]">ANPR API Online — Real Detection</Badge>}
                {apiAvailable === false && <Badge variant="secondary" className="text-[9px]">API Offline — Simulation Mode (run: cd model && python server.py)</Badge>}
                {apiAvailable === null && <Badge variant="secondary" className="text-[9px]">Checking API...</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                {apiAvailable
                  ? 'Upload a photo → YOLOv8 detects vehicles → EasyOCR reads plate → violation verified → rewards issued'
                  : 'Upload a photo → simulated YOLO+OCR pipeline → rewards issued'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upload */}
      <Card className="border-2 border-dashed border-blue-300 bg-blue-50/20">
        <CardContent className="p-6 text-center space-y-3">
          <Camera className="h-10 w-10 mx-auto text-blue-600" />
          <div>
            <p className="font-bold">Report a Parking Violation</p>
            <p className="text-xs text-muted-foreground">
              {apiAvailable ? 'Real YOLOv8 + EasyOCR detection' : 'Simulated detection pipeline'}
            </p>
          </div>
          <Button className="gap-2" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" /> Upload Photo
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }} />
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-blue-600">{results.length}</p>
            <p className="text-[10px] text-muted-foreground">Submitted</p>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-green-600">{validCount}</p>
            <p className="text-[10px] text-green-700">Confirmed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-purple-600">{totalPoints}</p>
            <p className="text-[10px] text-muted-foreground">Reward Points</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold">{totalProcessed > 0 ? Math.round(validCount / totalProcessed * 100) : 0}%</p>
            <p className="text-[10px] text-muted-foreground">Validation Rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Results */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4" /> Detection Results
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 max-h-[600px] overflow-y-auto">
          {results.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <Camera className="h-10 w-10 mx-auto mb-2 opacity-20" />
              <p className="text-sm">Upload a photo to start</p>
            </div>
          )}
          {results.map(r => {
            const isExp = expandedId === r.id;
            const isProcessing = r.processingSteps.length <= 1;
            return (
              <div key={r.id} className={`rounded-lg border overflow-hidden ${
                isProcessing ? 'border-blue-200 bg-blue-50/20' :
                r.isValid ? 'border-green-300 bg-green-50/20' : 'border-gray-200'
              }`}>
                <button className="w-full flex gap-3 p-3 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(isExp ? null : r.id)}>
                  <img src={r.imageUrl} alt="Report" className="w-16 h-16 object-cover rounded flex-shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
                        <Badge variant="outline" className="text-[8px]">{r.source === 'api' ? 'Real ANPR' : 'Simulated'}</Badge>
                      </div>
                      {isProcessing ? (
                        <Badge className="bg-blue-500 text-white text-[9px] animate-pulse">Processing...</Badge>
                      ) : r.isValid ? (
                        <Badge className="bg-green-600 text-white text-[9px] gap-1"><CheckCircle className="h-3 w-3" /> +{r.rewardPoints} pts</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[9px] gap-1"><XCircle className="h-3 w-3" /> Invalid</Badge>
                      )}
                    </div>
                    {!isProcessing && (
                      <div className="flex items-center gap-3 text-xs">
                        <span className={r.yoloDetected ? 'text-green-700' : 'text-red-500'}>
                          YOLO: {r.yoloDetected ? `${r.yoloVehicleType} (${r.yoloConfidence}%)` : 'No vehicle'}
                        </span>
                        <span className={r.ocrSuccess ? 'text-green-700' : 'text-muted-foreground'}>
                          Plate: {r.ocrSuccess ? r.ocrVehicleNumber : 'N/A'}
                        </span>
                      </div>
                    )}
                  </div>
                </button>

                {isExp && !isProcessing && (
                  <div className="border-t p-3 bg-muted/20 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div className="bg-white rounded p-2 border">
                        <p className="text-muted-foreground">GPS</p>
                        <p className="font-mono font-semibold">{r.gpsLat.toFixed(4)}, {r.gpsLon.toFixed(4)}</p>
                      </div>
                      <div className="bg-white rounded p-2 border">
                        <p className="text-muted-foreground">Hotspot Score</p>
                        <p className="font-bold" style={{ color: r.nearbyHotspotScore >= 60 ? '#dc2626' : r.nearbyHotspotScore >= 30 ? '#f97316' : '#22c55e' }}>
                          {r.nearbyHotspotScore}/100
                        </p>
                      </div>
                      <div className="bg-white rounded p-2 border">
                        <p className="text-muted-foreground">Vehicle</p>
                        <p className="font-semibold">{r.ocrSuccess ? r.ocrVehicleNumber : '—'}</p>
                      </div>
                      <div className="bg-white rounded p-2 border">
                        <p className="text-muted-foreground">Overall</p>
                        <p className="font-bold">{r.overallConfidence}%</p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold flex items-center gap-1">
                        <Cpu className="h-3.5 w-3.5" /> Pipeline ({r.source === 'api' ? 'Real ANPR API' : 'Simulation'})
                      </p>
                      {r.processingSteps.map((step, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-white border">
                          {step.status === 'success' ? <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" /> :
                           step.status === 'warning' ? <Eye className="h-3.5 w-3.5 text-yellow-600 shrink-0" /> :
                           <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{step.stage}</span>
                            <span className="text-muted-foreground ml-1.5">{step.detail}</span>
                          </div>
                          <span className="text-muted-foreground shrink-0">{step.timeMs}ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Rewards */}
      {totalPoints > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="h-4 w-4 text-purple-600" /> Redeem Points ({totalPoints} available)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { icon: '🚌', name: 'BMTC Bus Ticket', cost: 15 },
              { icon: '🚇', name: 'Metro Journey', cost: 25 },
              { icon: '🚇', name: 'Metro Day Pass', cost: 60 },
              { icon: '🅿️', name: 'Free 2-Hr Parking', cost: 30 },
            ].map(reward => (
              <div key={reward.name} className={`p-3 rounded-lg border text-center ${
                totalPoints >= reward.cost ? 'bg-white hover:bg-muted/50 cursor-pointer' : 'opacity-40'
              }`}>
                <span className="text-2xl">{reward.icon}</span>
                <p className="text-xs font-semibold mt-1">{reward.name}</p>
                <p className="text-[10px] text-muted-foreground">{reward.cost} points</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
