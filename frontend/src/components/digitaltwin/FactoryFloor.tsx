import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Cylinder, Sphere, Text, Html } from '@react-three/drei';
import * as THREE from 'three';

// ── Conveyor Belt ──────────────────────────────────────────────────────────

export const ConveyorBelt = ({ position, length }: { position: [number, number, number]; length: number }) => {
  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!ref.current) return;
    const time = state.clock.getElapsedTime();
    ref.current.children.forEach((child, i) => {
      if (child instanceof THREE.Mesh && i > 0) {
        const offset = (time * 0.5 + i * 0.5) % length;
        child.position.z = position[2] - length / 2 + offset;
      }
    });
  });

  return (
    <group ref={ref} position={position}>
      <Box args={[1, 0.2, length]} position={[0, 0, 0]}>
        <meshStandardMaterial color="#aaaaaa" />
      </Box>
      {[0, 1, 2, 3, 4].map((i) => (
        <Box key={i} args={[0.6, 0.4, 0.6]} position={[0, 0.4, 0]}>
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.1} />
        </Box>
      ))}
    </group>
  );
};

// ── Robot Arm ──────────────────────────────────────────────────────────────

export const RobotArm = ({ position }: { position: [number, number, number] }) => {
  const armRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!armRef.current) return;
    const time = state.clock.getElapsedTime();
    armRef.current.rotation.y = Math.sin(time * 0.5) * 0.5;
    const arm = armRef.current.children[1] as THREE.Object3D;
    if (arm) arm.rotation.z = Math.sin(time * 0.8) * 0.3;
  });

  return (
    <group ref={armRef} position={position}>
      <Cylinder args={[0.5, 0.6, 0.3, 8]} position={[0, 0.15, 0]}>
        <meshStandardMaterial color="#ffffff" />
      </Cylinder>
      <group position={[0, 1, 0]}>
        <Box args={[0.3, 2, 0.3]} position={[0, 0, 0]}>
          <meshStandardMaterial color="#ffffff" />
        </Box>
        <Box args={[0.5, 0.2, 0.2]} position={[0, 1.2, 0]}>
          <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.3} />
        </Box>
      </group>
    </group>
  );
};

// ── Machine ────────────────────────────────────────────────────────────────

interface MachineData {
  id: string;
  name: string;
  temperature?: number;
  efficiency?: number;
  workerId?: string;
}

const STATUS_COLORS: Record<string, string> = {
  active:      '#10b981',
  idle:        '#f59e0b',
  fault:       '#ef4444',
  maintenance: '#818cf8',
};

export const Machine = ({
  position,
  color = '#e8e8e8',
  status,
  machineData,
  isSelected,
  onSelect,
}: {
  position: [number, number, number];
  color?: string;
  status: string;
  machineData?: MachineData;
  isSelected?: boolean;
  onSelect?: (data: MachineData) => void;
}) => {
  const lightRef = useRef<THREE.PointLight>(null);
  const [hovered, setHovered] = useState(false);

  const statusColor = STATUS_COLORS[status] ?? '#ffffff';

  useFrame((state) => {
    if (lightRef.current && status === 'active') {
      lightRef.current.intensity = 1 + Math.sin(state.clock.getElapsedTime() * 3) * 0.3;
    }
  });

  return (
    <group
      position={position}
      onClick={(e) => { e.stopPropagation(); if (machineData && onSelect) onSelect(machineData); }}
    >
      {/* Machine body */}
      <Box
        args={[2, 1.5, 2]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <meshStandardMaterial
          color={hovered || isSelected ? '#ffffff' : color}
          emissive={hovered || isSelected ? statusColor : '#000000'}
          emissiveIntensity={hovered || isSelected ? 0.2 : 0}
        />
      </Box>

      {/* Top detail panel */}
      <Box args={[1.8, 0.3, 1.8]} position={[0, 0.9, 0]}>
        <meshStandardMaterial color="#d0d0d0" />
      </Box>

      {/* Status indicator */}
      <Sphere args={[0.2, 16, 16]} position={[0, 1.1, 0]}>
        <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={0.8} />
      </Sphere>

      <pointLight
        ref={lightRef}
        position={[0, 1, 0]}
        color={statusColor}
        intensity={status === 'active' ? 1.5 : 0.5}
        distance={5}
      />

      {/* 3D Tooltip on hover */}
      {hovered && machineData && (
        <group position={[0, 3.2, 0]}>
          {/* Border (rendered behind) */}
          <Box args={[4.1, 2.1, 0.11]} position={[0, 0, -0.01]}>
            <meshStandardMaterial color={statusColor} transparent opacity={0.6} />
          </Box>
          {/* Background */}
          <Box args={[4, 2, 0.1]}>
            <meshStandardMaterial color="#000000" transparent opacity={0.85} />
          </Box>

          <Text position={[0,  0.55, 0.1]} fontSize={0.3}  color="#ffffff" anchorX="center" anchorY="middle">
            {machineData.name}
          </Text>
          <Text position={[0,  0.2,  0.1]} fontSize={0.2}  color="#aaaaaa" anchorX="center" anchorY="middle">
            {'ID: ' + machineData.id}
          </Text>
          <Text position={[0, -0.1,  0.1]} fontSize={0.25} color={statusColor} anchorX="center" anchorY="middle">
            {'Status: ' + status.toUpperCase()}
          </Text>
          {machineData.temperature !== undefined && (
            <Text position={[0, -0.4, 0.1]} fontSize={0.2} color="#ffffff" anchorX="center" anchorY="middle">
              {'Temp: ' + machineData.temperature + '°C'}
            </Text>
          )}
          {machineData.efficiency !== undefined && (
            <Text position={[0, -0.7, 0.1]} fontSize={0.2} color="#ffffff" anchorX="center" anchorY="middle">
              {'Efficiency: ' + machineData.efficiency + '%'}
            </Text>
          )}
        </group>
      )}
    </group>
  );
};

// ── Factory Wall ───────────────────────────────────────────────────────────

export const FactoryWall = ({
  position,
  size,
}: {
  position: [number, number, number];
  size: [number, number, number];
}) => (
  <Box args={size} position={position}>
    <meshStandardMaterial color="#c8c8c8" transparent opacity={0.35} side={THREE.DoubleSide} />
  </Box>
);

// ── Storage Rack ───────────────────────────────────────────────────────────

export const StorageRack = ({ position }: { position: [number, number, number] }) => (
  <group position={position}>
    {[0, 1, 2].map((level) => (
      <group key={level} position={[0, level * 1, 0]}>
        <Box args={[3, 0.1, 1]}>
          <meshStandardMaterial color="#b0b0b0" />
        </Box>
        {[0, 1, 2].map((item) => (
          <Box key={item} args={[0.8, 0.8, 0.8]} position={[-1 + item, 0.5, 0]}>
            <meshStandardMaterial color="#e0e0e0" />
          </Box>
        ))}
      </group>
    ))}
    {[-1.5, 1.5].map((x, i) => (
      <Box key={i} args={[0.1, 3, 0.1]} position={[x, 1.5, 0.5]}>
        <meshStandardMaterial color="#999999" />
      </Box>
    ))}
  </group>
);

// ── Control Panel ──────────────────────────────────────────────────────────

export const ControlPanel = ({ position }: { position: [number, number, number] }) => (
  <group position={position}>
    <Box args={[2, 3, 0.2]}>
      <meshStandardMaterial color="#d4d4d4" />
    </Box>
    <Box args={[1.6, 1, 0.15]} position={[0, 0.8, 0.18]}>
      <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.5} />
    </Box>
    <Box args={[1.6, 0.8, 0.15]} position={[0, -0.5, 0.18]}>
      <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={0.5} />
    </Box>
  </group>
);

// ── Floor Zone ─────────────────────────────────────────────────────────────

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
}) => (
  <group position={position}>
    <Box args={[size[0], 0.02, size[1]]} position={[0, -0.01, 0]}>
      <meshStandardMaterial color={color} transparent opacity={0.08} />
    </Box>
    {[
      [[size[0], 0.02, 0.04], [0, 0, -size[1] / 2]],
      [[size[0], 0.02, 0.04], [0, 0,  size[1] / 2]],
      [[0.04, 0.02, size[1]], [-size[0] / 2, 0, 0]],
      [[0.04, 0.02, size[1]], [ size[0] / 2, 0, 0]],
    ].map(([s, p], i) => (
      <Box key={i} args={s as [number, number, number]} position={p as [number, number, number]}>
        <meshStandardMaterial color={color} transparent opacity={0.4} />
      </Box>
    ))}
    <Html position={[0, 0.3, -size[1] / 2 + 0.5]} center style={{ pointerEvents: 'none' }}>
      <div
        style={{
          color,
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
