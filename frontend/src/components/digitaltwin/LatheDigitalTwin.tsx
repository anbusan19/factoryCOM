import { useRef, useEffect, useState, Suspense, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls, PerspectiveCamera, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import {
  X,
  Thermometer,
  Zap,
  Activity,
  AlertTriangle,
  Wifi,
  WifiOff,
  RotateCcw,
  Gauge,
  Droplets,
  Radio,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { socket } from '@/hooks/useSocket';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// How long (ms) after the last ESP32 socket event before we consider it offline
const ESP32_STALE_MS = 90_000;

interface SensorReading {
  id: string;
  name: string;
  status: string;
  temperature: number;
  efficiency: number;
  updatedAt: string;
}

// Shape of items inside the socket sensor_data batch
interface SocketSensorItem {
  machineId: string;
  machineName?: string;
  temperature?: number;
  efficiency?: number;
  status?: string;
  source?: string; // 'esp32' | 'hardware' | 'simulation'
  timestamp?: string;
}

// ── Lathe 3D Model ──────────────────────────────────────────────────────────

function LatheModel({ isRunning, status }: { isRunning: boolean; status: string }) {
  const { scene } = useGLTF('/machinary_lathe_low_poly.glb');
  const groupRef = useRef<THREE.Group>(null);
  const spindleRef = useRef<THREE.Object3D | null>(null);
  const emissiveCurrent = useRef(0);

  const clonedScene = useRef<THREE.Group>(scene.clone(true));

  useEffect(() => {
    // Try to find a rotating part (spindle/chuck) by name
    const candidates: THREE.Object3D[] = [];
    clonedScene.current.traverse((obj) => {
      const n = obj.name.toLowerCase();
      if (n.includes('spindle') || n.includes('chuck') || n.includes('head') || n.includes('rotat')) {
        candidates.push(obj);
      }
    });
    if (candidates.length > 0) spindleRef.current = candidates[0];
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // Spin the spindle/chuck when running
    if (spindleRef.current && isRunning) {
      spindleRef.current.rotation.z += delta * 10;
    }

    // Lerp emissive glow on/off
    const target = isRunning ? 0.07 : 0;
    emissiveCurrent.current = THREE.MathUtils.lerp(emissiveCurrent.current, target, delta * 3);

    const emissiveColor = status === 'fault'
      ? new THREE.Color('#ef4444')
      : status === 'active'
      ? new THREE.Color('#22c55e')
      : new THREE.Color('#000000');

    clonedScene.current.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
        obj.material.emissive = emissiveColor;
        obj.material.emissiveIntensity = emissiveCurrent.current;
      }
    });
  });

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene.current} scale={[1, 1, 1]} position={[0, 0, 0]} />
    </group>
  );
}

useGLTF.preload('/machinary_lathe_low_poly.glb');

// ── Status colours ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  active:      '#22c55e',
  idle:        '#f59e0b',
  fault:       '#ef4444',
  maintenance: '#818cf8',
};

// ── Main component ──────────────────────────────────────────────────────────

interface LatheDigitalTwinProps {
  onClose: () => void;
}

export const LatheDigitalTwin = ({ onClose }: LatheDigitalTwinProps) => {
  const [sensorData, setSensorData] = useState<SensorReading | null>(null);
  // isLive = true only when we have received a socket event with source 'esp32' or 'hardware'
  const [isLive, setIsLive] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [lastSeen, setLastSeen] = useState<Date | null>(null);
  const esp32LastAt = useRef<number>(0);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll REST for display values (temperature, efficiency, name, id)
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/sensors/status`);
      if (!res.ok) return;
      const list: SensorReading[] = await res.json();
      if (list.length === 0) return;
      setSensorData(list[0]);
    } catch {
      // ignore poll errors
    } finally {
      setFetching(false);
    }
  }, []);

  // Marks ESP32 as live and resets the stale timer
  const markEsp32Live = useCallback((ts: Date) => {
    esp32LastAt.current = ts.getTime();
    setIsLive(true);
    setLastSeen(ts);

    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    staleTimerRef.current = setTimeout(() => {
      setIsLive(false);
    }, ESP32_STALE_MS);
  }, []);

  // Listen for socket events; only trust source === 'esp32' or 'hardware'
  useEffect(() => {
    const onSensorData = (batch: SocketSensorItem[]) => {
      const esp32Item = batch.find(
        (item) => item.source === 'esp32' || item.source === 'hardware',
      );
      if (esp32Item) {
        markEsp32Live(new Date());
        // Merge live values into display data immediately
        setSensorData((prev) =>
          prev
            ? {
                ...prev,
                temperature: esp32Item.temperature ?? prev.temperature,
                efficiency: esp32Item.efficiency ?? prev.efficiency,
                status: esp32Item.status ?? prev.status,
              }
            : prev,
        );
      }
    };

    socket.on('sensor_data', onSensorData);
    return () => {
      socket.off('sensor_data', onSensorData);
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    };
  }, [markEsp32Live]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const isRunning = isLive && sensorData?.status === 'active';
  const statusColor = sensorData ? (STATUS_COLOR[sensorData.status] ?? '#888888') : '#888888';

  return (
    <div className="fixed inset-0 z-50 bg-[#f2f2f0] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-black/[0.08] flex-shrink-0 bg-white/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight">
              Lathe Machine — Digital Twin
            </h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Real 3D model · sensor data via ESP32
            </p>
          </div>

          {isLive ? (
            <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/25 rounded-full px-3 py-1 text-green-400 text-xs">
              <Wifi className="w-3 h-3" />
              <span className="font-medium">ESP32 Live</span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-gray-800 border border-white/[0.06] rounded-full px-3 py-1 text-gray-500 text-xs">
              <WifiOff className="w-3 h-3" />
              <span>No ESP32 Signal</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-500 hover:text-gray-900 hover:bg-black/5 gap-1.5 text-xs h-8"
            onClick={fetchStatus}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-gray-500 hover:text-gray-900 hover:bg-black/5 h-8 w-8"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* 3D Viewport */}
        <div className="flex-1 relative">
          <Canvas shadows gl={{ antialias: true }}>
            <PerspectiveCamera makeDefault position={[3.5, 2.5, 4.5]} fov={48} />
            <OrbitControls
              enablePan
              enableZoom
              enableRotate
              minDistance={1.5}
              maxDistance={18}
              maxPolarAngle={Math.PI / 1.9}
            />

            <ambientLight intensity={0.35} />
            <directionalLight
              position={[6, 10, 6]}
              intensity={0.9}
              castShadow
              shadow-mapSize-width={2048}
              shadow-mapSize-height={2048}
              color="#fffaf0"
            />
            <pointLight position={[-5, 6, -4]} intensity={0.4} color="#c0d8ff" />

            {/* Status accent light */}
            {sensorData && (
              <pointLight
                position={[0, 2.5, 0]}
                color={statusColor}
                intensity={isRunning ? 1.2 : 0.25}
                distance={8}
              />
            )}

            <Environment preset="warehouse" />

            <Suspense fallback={null}>
              <LatheModel isRunning={isRunning} status={sensorData?.status ?? 'idle'} />
            </Suspense>

            <ContactShadows position={[0, -0.01, 0]} opacity={0.45} scale={12} blur={2.5} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
              <planeGeometry args={[30, 30]} />
              <meshStandardMaterial color="#efefed" roughness={0.95} />
            </mesh>
            <gridHelper args={[20, 20, '#cccccc', '#cccccc']} position={[0, -0.005, 0]} />
          </Canvas>

          {/* Not Running overlay */}
          {!isRunning && !fetching && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-white/90 rounded-2xl px-8 py-7 text-center backdrop-blur-lg border border-black/[0.08] shadow-lg max-w-sm">
                <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4 border border-gray-200">
                  <Activity className="w-7 h-7 text-gray-400" />
                </div>
                <p className="text-gray-900 font-semibold text-lg tracking-tight">Machine Not Running</p>
                <p className="text-gray-500 text-sm mt-2">
                  {isLive && sensorData
                    ? `Current status: ${sensorData.status.toUpperCase()}`
                    : 'No signal received from ESP32 sensor'}
                </p>
                {lastSeen && (
                  <p className="text-gray-400 text-xs mt-2">
                    Last seen: {lastSeen.toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Status glow bar at bottom */}
          <div
            className="absolute bottom-0 left-0 right-0 h-[3px] transition-all duration-700"
            style={{
              background: isLive ? statusColor : 'transparent',
              boxShadow: isLive ? `0 0 20px ${statusColor}` : 'none',
            }}
          />
        </div>

        {/* Vitals Panel */}
        <aside className="w-[300px] flex-shrink-0 border-l border-black/[0.08] bg-white flex flex-col">
          <div className="px-5 py-4 border-b border-black/[0.08]">
            <p className="text-sm font-semibold text-gray-900">Sensor Vitals</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {isLive ? 'Polling ESP32 · every 3 s' : 'Waiting for live data…'}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">

            {/* Machine identity card */}
            {sensorData ? (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-gray-900 font-medium text-sm">{sensorData.name}</p>
                    <p className="text-gray-400 text-[11px] font-mono mt-0.5">{sensorData.id}</p>
                  </div>
                  <Badge
                    className="text-[10px] font-bold tracking-wide shrink-0"
                    style={{
                      background: statusColor + '1a',
                      color: statusColor,
                      border: `1px solid ${statusColor}40`,
                    }}
                  >
                    {sensorData.status.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      background: statusColor,
                      boxShadow: isLive ? `0 0 8px ${statusColor}` : 'none',
                    }}
                  />
                  <span className="text-xs text-gray-400">
                    {isRunning
                      ? 'Lathe is actively running'
                      : isLive
                      ? `Machine is ${sensorData.status}`
                      : 'Awaiting ESP32 heartbeat'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 text-center">
                <p className="text-gray-500 text-sm">
                  {fetching ? 'Connecting to sensor API…' : 'No machine data found'}
                </p>
              </div>
            )}

            {/* Temperature */}
            <VitalCard
              icon={<Thermometer className="w-3.5 h-3.5 text-amber-400" />}
              label="Temperature"
              value={sensorData?.temperature !== undefined ? `${sensorData.temperature.toFixed(1)}°C` : '—'}
              sub={
                sensorData?.temperature !== undefined
                  ? sensorData.temperature > 85
                    ? 'Critical — check cooling'
                    : sensorData.temperature > 60
                    ? 'Elevated'
                    : 'Normal range'
                  : 'No data'
              }
              barPct={sensorData?.temperature !== undefined ? Math.min(sensorData.temperature / 100, 1) : 0}
              barColor={
                sensorData?.temperature
                  ? sensorData.temperature > 85
                    ? '#ef4444'
                    : sensorData.temperature > 60
                    ? '#f59e0b'
                    : '#22c55e'
                  : '#1f2937'
              }
              dim={!isLive}
            />

            {/* Efficiency */}
            <VitalCard
              icon={<Zap className="w-3.5 h-3.5 text-blue-400" />}
              label="Efficiency"
              value={sensorData?.efficiency !== undefined ? `${sensorData.efficiency.toFixed(0)}%` : '—'}
              sub={
                sensorData?.efficiency !== undefined
                  ? sensorData.efficiency >= 80
                    ? 'Optimal'
                    : sensorData.efficiency >= 50
                    ? 'Reduced output'
                    : 'Low — inspect machine'
                  : 'No data'
              }
              barPct={sensorData?.efficiency !== undefined ? Math.min(sensorData.efficiency / 100, 1) : 0}
              barColor="#3b82f6"
              dim={!isLive}
            />

            {/* Signal */}
            <VitalCard
              icon={<Radio className="w-3.5 h-3.5 text-purple-400" />}
              label="ESP32 Signal"
              value={isLive ? 'CONNECTED' : 'OFFLINE'}
              sub={lastSeen ? `Last heartbeat: ${lastSeen.toLocaleTimeString()}` : 'Never received'}
              barPct={isLive ? 1 : 0}
              barColor={isLive ? '#a855f7' : '#1f2937'}
              dim={!isLive}
            />

            {/* Fault alert */}
            {sensorData?.status === 'fault' && (
              <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3.5 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-px" />
                <div>
                  <p className="text-red-400 text-xs font-semibold">Fault Detected</p>
                  <p className="text-red-300/70 text-[11px] mt-1 leading-relaxed">
                    Immediate inspection required. Check coolant flow, spindle bearings, and vibration sensors.
                  </p>
                </div>
              </div>
            )}

            {/* Maintenance notice */}
            {sensorData?.status === 'maintenance' && (
              <div className="bg-indigo-500/10 border border-indigo-500/25 rounded-xl p-3.5 flex items-start gap-2.5">
                <Gauge className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-px" />
                <div>
                  <p className="text-indigo-400 text-xs font-semibold">Under Maintenance</p>
                  <p className="text-indigo-300/70 text-[11px] mt-1 leading-relaxed">
                    Do not power on until cleared by a technician.
                  </p>
                </div>
              </div>
            )}

            {/* No-data hint */}
            {!isLive && !fetching && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 flex items-start gap-2.5">
                <Droplets className="w-4 h-4 text-gray-400 flex-shrink-0 mt-px" />
                <div>
                  <p className="text-gray-500 text-xs font-medium">No Live Feed</p>
                  <p className="text-gray-400 text-[11px] mt-1 leading-relaxed">
                    Power on the ESP32 and POST sensor data to{' '}
                    <code className="text-gray-400 font-mono">POST /api/sensors</code> to see live vitals.
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

// ── VitalCard ──────────────────────────────────────────────────────────────

const VitalCard = ({
  icon,
  label,
  value,
  sub,
  barPct,
  barColor,
  dim,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  barPct: number;
  barColor: string;
  dim: boolean;
}) => (
  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[11px] text-gray-400 uppercase tracking-widest">{label}</span>
      </div>
      <span className={`text-sm font-bold font-mono ${dim ? 'text-gray-300' : 'text-gray-900'}`}>
        {value}
      </span>
    </div>
    <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${barPct * 100}%`, background: barColor }}
      />
    </div>
    <p className="text-[11px] text-gray-400">{sub}</p>
  </div>
);
