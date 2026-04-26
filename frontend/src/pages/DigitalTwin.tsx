import { useState, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls, Grid, Environment } from '@react-three/drei';
import {
  Machine,
  ConveyorBelt,
  RobotArm,
  FactoryWall,
  StorageRack,
  ControlPanel,
  FloorZone,
} from '@/components/digitaltwin/FactoryFloor';
import { LatheDigitalTwin } from '@/components/digitaltwin/LatheDigitalTwin';
import { useApiStore } from '@/store/useApiStore';
import { useRealtime } from '@/hooks/useRealtime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Activity,
  AlertTriangle,
  Thermometer,
  Zap,
  RefreshCw,
  ChevronRight,
  X,
  Cog,
} from 'lucide-react';

// Compute a clean grid position for the i-th machine out of total
function gridPosition(i: number, total: number): [number, number, number] {
  const cols   = Math.ceil(Math.sqrt(total));
  const col    = i % cols;
  const row    = Math.floor(i / cols);
  const totalC = Math.min(cols, total);
  const totalR = Math.ceil(total / cols);
  const ox     = ((totalC - 1) * 6) / 2;
  const oz     = ((totalR - 1) * 6) / 2;
  return [col * 6 - ox, 0.75, row * 6 - oz];
}

const STATUS_COLOR: Record<string, string> = {
  active:      '#22c55e',
  idle:        '#f59e0b',
  fault:       '#ef4444',
  maintenance: '#818cf8',
};

const DigitalTwin = () => {
  useRealtime(); // live Socket.IO updates

  const { machines, fetchMachines, loading } = useApiStore();
  const [selectedMachine, setSelectedMachine] = useState<(typeof machines)[0] | null>(null);
  const [showLathe, setShowLathe] = useState(false);

  useEffect(() => {
    fetchMachines();
  }, [fetchMachines]);

  // Keep selectedMachine in sync with live store updates
  useEffect(() => {
    if (selectedMachine) {
      const updated = machines.find(m => m.id === selectedMachine.id);
      if (updated) setSelectedMachine(updated);
    }
  }, [machines]);

  const active      = machines.filter(m => m.status === 'active').length;
  const idle        = machines.filter(m => m.status === 'idle').length;
  const fault       = machines.filter(m => m.status === 'fault').length;
  const maintenance = machines.filter(m => m.status === 'maintenance').length;
  const avgEff      = machines.length
    ? Math.round(machines.reduce((s, m) => s + (m.efficiency ?? 0), 0) / machines.length)
    : 0;
  const avgTemp = machines.length
    ? (machines.reduce((s, m) => s + (m.temperature ?? 0), 0) / machines.length).toFixed(1)
    : '—';

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-5rem)] overflow-hidden">

        {/* ── Top Bar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-sidebar-border bg-background flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold">Digital Twin — Factory Floor</h1>
            <p className="text-xs text-muted-foreground">Live 3D visualization · data updates every 5 s via WebSocket</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-sm">
              <Dot color="#22c55e" label={`${active} Active`} />
              <Dot color="#f59e0b" label={`${idle} Idle`} />
              <Dot color="#ef4444" label={`${fault} Fault`} />
              <Dot color="#818cf8" label={`${maintenance} Maint.`} />
            </div>
            <Button
              variant={showLathe ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowLathe((v) => !v)}
              className="gap-1.5 text-xs"
            >
              <Cog className={`w-3.5 h-3.5 ${showLathe ? 'animate-spin' : ''}`} />
              {showLathe ? 'Close Lathe Twin' : 'Lathe Digital Twin'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchMachines()}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading.machines ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Main Content ────────────────────────────────────────────────── */}
        {/* Unmount canvas entirely when lathe twin is open to prevent Html portal bleed-through */}
        <div className="flex flex-1 overflow-hidden" style={{ display: showLathe ? 'none' : 'flex' }}>

          {/* 3D Canvas */}
          <div className="flex-1 relative bg-[#f2f2f0]">
            <Canvas shadows>
              <PerspectiveCamera makeDefault position={[18, 14, 18]} fov={55} />
              <OrbitControls
                enablePan
                enableZoom
                enableRotate
                maxPolarAngle={Math.PI / 2.1}
                minDistance={5}
                maxDistance={60}
              />

              {/* Lighting — industrial feel */}
              <ambientLight intensity={0.15} />
              <directionalLight position={[10, 20, 10]} intensity={0.8} castShadow color="#fffaf0" />
              <pointLight position={[-15, 12, -10]} intensity={0.4} color="#ffffff" />
              <pointLight position={[ 15, 12,  10]} intensity={0.3} color="#e0f0ff" />

              {/* Floor grid */}
              <Grid
                args={[60, 60]}
                position={[0, -0.01, 0]}
                cellSize={2}
                cellThickness={0.4}
                cellColor="#cccccc"
                sectionSize={6}
                sectionThickness={0.8}
                sectionColor="#bbbbbb"
                fadeDistance={50}
                fadeStrength={1}
                infiniteGrid={false}
              />

              {/* Floor plane */}
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
                <planeGeometry args={[60, 60]} />
                <meshStandardMaterial color="#efefed" roughness={0.9} />
              </mesh>

              {/* Zone overlays */}
              <FloorZone position={[-10, 0, -5]} size={[14, 14]} color="#22c55e" label="Assembly Line A" />
              <FloorZone position={[ 4,  0, -5]} size={[14, 14]} color="#60a5fa" label="Assembly Line B" />
              <FloorZone position={[ 0,  0,  9]} size={[20, 8]}  color="#f59e0b" label="Packaging / QC" />
              <FloorZone position={[16, 0,  -4]} size={[8, 16]}  color="#818cf8" label="Storage" />

              {/* Walls */}
              <FactoryWall position={[ 0, 3, -18]} size={[50, 6, 0.3]} />
              <FactoryWall position={[-20, 3,  0]} size={[0.3, 6, 40]} />
              <FactoryWall position={[ 22, 3,  0]} size={[0.3, 6, 40]} />

              {/* Conveyors */}
              <ConveyorBelt position={[-10, 0.08, -5]} length={14} />
              <ConveyorBelt position={[  4, 0.08, -5]} length={14} />
              <ConveyorBelt position={[  0, 0.08,  9]} length={18} />

              {/* Robot arms */}
              <RobotArm position={[-8,  0, -8]} />
              <RobotArm position={[ 2,  0, -8]} />
              <RobotArm position={[-5,  0,  9]} />
              <RobotArm position={[ 5,  0,  9]} />

              {/* Storage racks */}
              <StorageRack position={[15, 1.5, -10]} />
              <StorageRack position={[15, 1.5,  -5]} />
              <StorageRack position={[15, 1.5,   0]} />
              <StorageRack position={[15, 1.5,   5]} />

              {/* Control panels */}
              <ControlPanel position={[-18, 1.5, -15]} />
              <ControlPanel position={[ 18, 1.5, -15]} />

              {/* ── Dynamic Machines from DB ─────────────────────────────── */}
              {machines.map((m, i) => (
                <Machine
                  key={m.id}
                  position={gridPosition(i, machines.length)}
                  color="#e8e8e8"
                  status={m.status}
                  machineData={m}
                  isSelected={selectedMachine?.id === m.id}
                  onSelect={(data) => {
                    const full = machines.find(x => x.id === data.id);
                    if (full) setSelectedMachine(full);
                  }}
                />
              ))}
            </Canvas>

            {/* ── Live KPI strip overlaid on canvas ───────────────────── */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-4 px-6 py-3 bg-white/80 backdrop-blur-sm border-t border-black/8">
              <KpiChip icon={<Activity className="w-3.5 h-3.5 text-green-400" />} label="Avg Efficiency" value={`${avgEff}%`} />
              <KpiChip icon={<Thermometer className="w-3.5 h-3.5 text-amber-400" />} label="Avg Temp" value={`${avgTemp}°C`} />
              <KpiChip icon={<AlertTriangle className="w-3.5 h-3.5 text-red-400" />} label="Faults" value={String(fault)} highlight={fault > 0} />
              <KpiChip icon={<Zap className="w-3.5 h-3.5 text-blue-400" />} label="Machines" value={String(machines.length)} />
            </div>

            {/* ── No machines fallback ─────────────────────────────────── */}
            {machines.length === 0 && !loading.machines && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-white/90 rounded-xl px-6 py-4 text-center backdrop-blur-md border border-black/10 shadow-md">
                  <p className="text-gray-900 font-medium">No machines in database</p>
                  <p className="text-gray-500 text-xs mt-1">Run <code className="text-green-600">npm run seed</code> in the backend</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Right Panel ────────────────────────────────────────────── */}
          <aside className="w-72 flex-shrink-0 border-l border-sidebar-border flex flex-col bg-background overflow-hidden">

            {/* Selected machine */}
            {selectedMachine ? (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
                  <span className="text-sm font-semibold">Machine Details</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedMachine(null)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <div className="p-4 space-y-4 overflow-y-auto">
                  <div>
                    <h3 className="font-bold text-lg">{selectedMachine.name}</h3>
                    <Badge
                      className="mt-1 text-xs"
                      style={{
                        background: STATUS_COLOR[selectedMachine.status] + '22',
                        color: STATUS_COLOR[selectedMachine.status],
                        border: `1px solid ${STATUS_COLOR[selectedMachine.status]}55`,
                      }}
                    >
                      {selectedMachine.status.toUpperCase()}
                    </Badge>
                  </div>

                  <Separator />

                  <SensorBar
                    label="Temperature"
                    value={selectedMachine.temperature ?? 0}
                    max={100}
                    unit="°C"
                    color={selectedMachine.temperature && selectedMachine.temperature > 85 ? '#ef4444' : '#f59e0b'}
                    warning={selectedMachine.temperature && selectedMachine.temperature > 85}
                  />
                  <SensorBar
                    label="Efficiency"
                    value={selectedMachine.efficiency ?? 0}
                    max={100}
                    unit="%"
                    color="#22c55e"
                  />

                  <Separator />

                  <div className="space-y-2 text-sm">
                    <InfoRow label="Machine ID" value={selectedMachine.id} />
                    {selectedMachine.workerId && (
                      <InfoRow label="Assigned Worker" value={selectedMachine.workerId} />
                    )}
                  </div>

                  {selectedMachine.status === 'fault' && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-400">
                      <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                      Machine requires immediate attention. Check temperature and run diagnostics.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Machine list */
              <div className="flex flex-col h-full">
                <div className="p-4 border-b border-sidebar-border">
                  <p className="text-sm font-semibold">All Machines</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Click a machine in the 3D view to inspect</p>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-3 space-y-1.5">
                    {machines.map(m => (
                      <button
                        key={m.id}
                        onClick={() => setSelectedMachine(m)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/50 transition-colors text-left"
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: STATUS_COLOR[m.status] ?? '#888', boxShadow: `0 0 6px ${STATUS_COLOR[m.status] ?? '#888'}` }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{m.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {m.temperature ?? '—'}°C · {m.efficiency ?? '—'}%
                          </p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      </button>
                    ))}

                    {machines.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        {loading.machines ? 'Loading machines…' : 'No machines found'}
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </aside>
        </div>
      </div>
      {/* Lathe Digital Twin overlay */}
      {showLathe && <LatheDigitalTwin onClose={() => setShowLathe(false)} />}
    </Layout>
  );
};

// ── Small helper components ────────────────────────────────────────────────

const Dot = ({ color, label }: { color: string; label: string }) => (
  <div className="flex items-center gap-1.5">
    <div className="w-2.5 h-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
    <span className="text-xs text-muted-foreground">{label}</span>
  </div>
);

const KpiChip = ({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) => (
  <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${highlight ? 'bg-red-50 border border-red-200' : 'bg-white border border-gray-200 shadow-sm'}`}>
    {icon}
    <span className="text-[11px] text-gray-500">{label}</span>
    <span className={`text-sm font-bold ${highlight ? 'text-red-600' : 'text-gray-900'}`}>{value}</span>
  </div>
);

const SensorBar = ({
  label,
  value,
  max,
  unit,
  color,
  warning,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  color: string;
  warning?: boolean;
}) => (
  <div>
    <div className="flex justify-between mb-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-bold ${warning ? 'text-red-400' : 'text-foreground'}`}>
        {value}
        {unit}
        {warning && ' ⚠'}
      </span>
    </div>
    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min((value / max) * 100, 100)}%`, background: color }}
      />
    </div>
  </div>
);

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-mono text-xs">{value}</span>
  </div>
);

export default DigitalTwin;
