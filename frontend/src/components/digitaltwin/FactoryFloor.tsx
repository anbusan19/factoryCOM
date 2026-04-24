import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Cylinder, Sphere, Html, Environment } from '@react-three/drei';
import * as THREE from 'three';

// ── Utility ────────────────────────────────────────────────────────────────

function getTempColor(temp?: number): string {
  if (!temp) return '#60a5fa';
  if (temp < 65) return '#60a5fa';   // blue  — cool
  if (temp < 75) return '#34d399';   // green — normal
  if (temp < 85) return '#fbbf24';   // amber — warm
  return '#f87171';                   // red   — hot
}

const STATUS_COLOR: Record<string, string> = {
  active:      '#22c55e',
  idle:        '#f59e0b',
  fault:       '#ef4444',
  maintenance: '#818cf8',
};

// ── Machine ────────────────────────────────────────────────────────────────

interface MachineData {
  id: string;
  name: string;
  status: string;
  temperature?: number;
  efficiency?: number;
  workerId?: string;
}

interface MachineProps {
  position: [number, number, number];
  machineData: MachineData;
  isSelected: boolean;
  onSelect: (m: MachineData) => void;
}

export const Machine = ({ position, machineData, isSelected, onSelect }: MachineProps) => {
  const bodyRef  = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const [hovered, setHovered] = useState(false);

  const statusColor = STATUS_COLOR[machineData.status] ?? '#ffffff';
  const tempColor   = getTempColor(machineData.temperature);
  const isFault     = machineData.status === 'fault';
  const isActive    = machineData.status === 'active';

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (bodyRef.current && isFault) {
      const s = 1 + Math.sin(t * 5) * 0.03;
      bodyRef.current.scale.set(s, s, s);
    }
    if (lightRef.current) {
      lightRef.current.intensity = isActive
        ? 1.2 + Math.sin(t * 2) * 0.4
        : isFault ? 2 + Math.sin(t * 8) * 1 : 0.3;
    }
  });

  return (
    <group
      position={position}
      onClick={(e) => { e.stopPropagation(); onSelect(machineData); }}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <group ref={bodyRef}>
        {/* Main body */}
        <Box args={[2, 1.4, 2]} position={[0, 0, 0]}>
          <meshStandardMaterial
            color={isSelected ? '#2a2a2a' : '#111111'}
            metalness={0.85}
            roughness={0.25}
            emissive={isSelected ? statusColor : '#000000'}
            emissiveIntensity={isSelected ? 0.08 : 0}
          />
        </Box>

        {/* Temperature-colored top panel */}
        <Box args={[1.7, 0.08, 1.7]} position={[0, 0.74, 0]}>
          <meshStandardMaterial color={tempColor} emissive={tempColor} emissiveIntensity={0.5} />
        </Box>

        {/* Screen face */}
        <Box args={[1.4, 0.7, 0.05]} position={[0, 0.15, 1.03]}>
          <meshStandardMaterial
            color={isActive ? '#0a1628' : '#0a0a0a'}
            emissive={isActive ? statusColor : '#000000'}
            emissiveIntensity={isActive ? 0.15 : 0}
          />
        </Box>

        {/* Status indicator sphere */}
        <Sphere args={[0.16, 16, 16]} position={[0, 1.05, 0]}>
          <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.2} />
        </Sphere>

        {/* Base plate */}
        <Box args={[2.2, 0.08, 2.2]} position={[0, -0.74, 0]}>
          <meshStandardMaterial color="#1a1a1a" metalness={0.6} roughness={0.5} />
        </Box>
      </group>

      {/* Status glow light */}
      <pointLight ref={lightRef} position={[0, 1.5, 0]} color={statusColor} distance={7} />

      {/* Html overlay — tooltip + selected ring */}
      {(hovered || isSelected) && (
        <Html
          position={[0, 2.4, 0]}
          center
          distanceFactor={12}
          style={{ pointerEvents: 'none' }}
          occlude
        >
          <div
            style={{
              background: 'rgba(5,5,5,0.92)',
              border: `1px solid ${statusColor}`,
              borderRadius: 8,
              padding: '8px 14px',
              minWidth: 190,
              backdropFilter: 'blur(12px)',
              fontFamily: 'system-ui, sans-serif',
              boxShadow: `0 0 16px ${statusColor}44`,
            }}
          >
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
              {machineData.name}
            </div>
            <div
              style={{
                display: 'inline-block',
                background: statusColor + '22',
                color: statusColor,
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: 1,
                marginBottom: 6,
              }}
            >
              {machineData.status.toUpperCase()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ color: '#ccc', fontSize: 11 }}>
                <span style={{ color: tempColor }}>●</span>{' '}
                {machineData.temperature ?? '—'}°C
                &nbsp;&nbsp;
                <span style={{ color: '#60a5fa' }}>⚡</span>{' '}
                {machineData.efficiency ?? '—'}% eff
              </div>
              <div style={{ color: '#666', fontSize: 10 }}>ID: {machineData.id}</div>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
};

// ── Conveyor Belt ──────────────────────────────────────────────────────────

export const ConveyorBelt = ({ position, length }: { position: [number, number, number]; length: number }) => {
  const itemsRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!itemsRef.current) return;
    const t = state.clock.getElapsedTime();
    itemsRef.current.children.forEach((child, i) => {
      const offset = ((t * 1.5 + i * (length / 5)) % length) - length / 2;
      child.position.z = offset;
    });
  });

  return (
    <group position={position}>
      {/* Belt surface */}
      <Box args={[1, 0.12, length]}>
        <meshStandardMaterial color="#1c1c1c" metalness={0.7} roughness={0.4} />
      </Box>
      {/* Side rails */}
      {[-0.6, 0.6].map((x, i) => (
        <Box key={i} args={[0.06, 0.14, length]} position={[x, 0.01, 0]}>
          <meshStandardMaterial color="#2a2a2a" metalness={0.9} />
        </Box>
      ))}
      {/* Moving boxes */}
      <group ref={itemsRef}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Box key={i} args={[0.55, 0.35, 0.55]} position={[0, 0.24, 0]}>
            <meshStandardMaterial color="#e5e7eb" roughness={0.8} />
          </Box>
        ))}
      </group>
    </group>
  );
};

// ── Robot Arm ──────────────────────────────────────────────────────────────

export const RobotArm = ({ position }: { position: [number, number, number] }) => {
  const baseRef    = useRef<THREE.Group>(null);
  const forearmRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (baseRef.current)    baseRef.current.rotation.y    = Math.sin(t * 0.6) * 0.6;
    if (forearmRef.current) forearmRef.current.rotation.z = Math.sin(t * 0.9) * 0.4 - 0.2;
  });

  return (
    <group position={position}>
      {/* Base */}
      <Cylinder args={[0.45, 0.55, 0.25, 10]} position={[0, 0.12, 0]}>
        <meshStandardMaterial color="#1a1a1a" metalness={0.9} roughness={0.2} />
      </Cylinder>

      <group ref={baseRef}>
        {/* Upper arm */}
        <Box args={[0.25, 1.8, 0.25]} position={[0, 1.1, 0]}>
          <meshStandardMaterial color="#222222" metalness={0.8} roughness={0.3} />
        </Box>

        {/* Forearm */}
        <group ref={forearmRef} position={[0, 2, 0]}>
          <Box args={[0.2, 1.2, 0.2]} position={[0, 0.6, 0]}>
            <meshStandardMaterial color="#2a2a2a" metalness={0.8} roughness={0.3} />
          </Box>
          {/* Gripper */}
          {[-0.2, 0.2].map((x, i) => (
            <Box key={i} args={[0.08, 0.3, 0.08]} position={[x, 1.35, 0]}>
              <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.4} />
            </Box>
          ))}
        </group>
      </group>
    </group>
  );
};

// ── Factory Wall ───────────────────────────────────────────────────────────

export const FactoryWall = ({ position, size }: { position: [number, number, number]; size: [number, number, number] }) => (
  <Box args={size} position={position}>
    <meshStandardMaterial color="#111111" metalness={0.3} roughness={0.8} transparent opacity={0.6} side={THREE.DoubleSide} />
  </Box>
);

// ── Storage Rack ───────────────────────────────────────────────────────────

export const StorageRack = ({ position }: { position: [number, number, number] }) => (
  <group position={position}>
    {/* Posts */}
    {[-1.4, 1.4].map((x, i) => (
      <Box key={i} args={[0.08, 3.2, 0.08]} position={[x, 1.6, 0.5]}>
        <meshStandardMaterial color="#1a1a1a" metalness={0.9} />
      </Box>
    ))}
    {/* Shelves */}
    {[0, 1.1, 2.2].map((y) => (
      <group key={y} position={[0, y, 0]}>
        <Box args={[3, 0.06, 1]}>
          <meshStandardMaterial color="#222" metalness={0.7} roughness={0.4} />
        </Box>
        {[-0.9, 0, 0.9].map((x, j) => (
          <Box key={j} args={[0.7, 0.65, 0.7]} position={[x, 0.36, 0]}>
            <meshStandardMaterial color="#e5e7eb" roughness={0.9} />
          </Box>
        ))}
      </group>
    ))}
  </group>
);

// ── Control Panel ──────────────────────────────────────────────────────────

export const ControlPanel = ({ position }: { position: [number, number, number] }) => (
  <group position={position}>
    <Box args={[1.8, 2.8, 0.18]}>
      <meshStandardMaterial color="#0d0d0d" metalness={0.8} roughness={0.3} />
    </Box>
    {/* Main screen */}
    <Box args={[1.4, 0.9, 0.12]} position={[0, 0.7, 0.16]}>
      <meshStandardMaterial color="#001a0d" emissive="#00ff88" emissiveIntensity={0.25} />
    </Box>
    {/* Sub screen */}
    <Box args={[1.4, 0.7, 0.12]} position={[0, -0.5, 0.16]}>
      <meshStandardMaterial color="#00080d" emissive="#0088ff" emissiveIntensity={0.2} />
    </Box>
    {/* Buttons row */}
    {[-0.4, -0.1, 0.2, 0.5].map((x, i) => (
      <Sphere key={i} args={[0.06, 8, 8]} position={[x, -1.1, 0.12]}>
        <meshStandardMaterial color={['#ef4444', '#f59e0b', '#22c55e', '#60a5fa'][i]} emissiveIntensity={0.6} emissive={['#ef4444', '#f59e0b', '#22c55e', '#60a5fa'][i]} />
      </Sphere>
    ))}
  </group>
);

// ── Floor Zones ────────────────────────────────────────────────────────────

export const FloorZone = ({
  position,
  size,
  color,
  label,
}: {
  position: [number, number, number];
  size: [number, number];
  color: string;
  label: string;
}) => {
  return (
    <group position={position}>
      <Box args={[size[0], 0.02, size[1]]} position={[0, -0.01, 0]}>
        <meshStandardMaterial color={color} transparent opacity={0.08} />
      </Box>
      {/* Zone border lines */}
      {[
        [[size[0], 0.02, 0.04], [0, 0, -size[1] / 2]],
        [[size[0], 0.02, 0.04], [0, 0,  size[1] / 2]],
        [[0.04, 0.02, size[1]], [-size[0] / 2, 0, 0]],
        [[0.04, 0.02, size[1]], [ size[0] / 2, 0, 0]],
      ].map(([s, p], i) => (
        <Box key={i} args={s as [number,number,number]} position={p as [number,number,number]}>
          <meshStandardMaterial color={color} transparent opacity={0.4} />
        </Box>
      ))}
      <Html position={[0, 0.3, -size[1] / 2 + 0.5]} center style={{ pointerEvents: 'none' }}>
        <div
          style={{
            color: color,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 1.5,
            opacity: 0.7,
            textTransform: 'uppercase',
            fontFamily: 'system-ui, sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  );
};
