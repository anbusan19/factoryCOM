import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useApiStore, AiAction } from '@/store/useApiStore';
import { toast } from 'sonner';

const SOCKET_URL = 'http://localhost:3001';

// Singleton socket — created once for the app lifetime so all hooks share
// the same connection regardless of how many components mount/unmount.
const socket: Socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 15,
  reconnectionDelay: 2000,
});

socket.on('connect', () => {
  console.log('[Socket.IO] Connected to backend:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.warn('[Socket.IO] Disconnected:', reason);
});

socket.on('connect_error', (err) => {
  console.warn('[Socket.IO] Connection error:', err.message);
});

/**
 * useSocket — attach real-time event listeners to the shared socket.
 *
 * sensor_data   → array of { machineId, temperature, efficiency, status }
 *                 emitted by the backend every 5 s (simulation or real hardware)
 * safety_alert  → { id, type, severity, message, machineId, timestamp }
 * system_event  → { id, type, severity, message, timestamp }
 * machine_update→ { machineId, ...fields } (manual status overrides from other clients)
 */
export const useSocket = () => {
  useEffect(() => {
    // ── sensor_data ────────────────────────────────────────────────────────
    const onSensorData = (batch: Array<{
      machineId: string;
      temperature: number;
      efficiency: number;
      status: string;
    }>) => {
      const store = useApiStore.getState();
      const updateMap = new Map(batch.map(d => [d.machineId, d]));

      const updatedMachines = store.machines.map(m => {
        const upd = updateMap.get(m.id);
        if (!upd) return m;
        return {
          ...m,
          temperature: upd.temperature,
          efficiency: upd.efficiency,
          status: upd.status as typeof m.status,
        };
      });

      useApiStore.setState({ machines: updatedMachines });
    };

    // ── safety_alert ───────────────────────────────────────────────────────
    const onSafetyAlert = (data: {
      id: string;
      type: 'critical' | 'warning' | 'info';
      severity?: string;
      message: string;
      machineId?: string;
      timestamp: string;
    }) => {
      const { safetyAlerts } = useApiStore.getState();
      useApiStore.setState({
        safetyAlerts: [
          { ...data, type: data.type ?? 'critical', timestamp: new Date(data.timestamp) },
          ...safetyAlerts,
        ].slice(0, 50),
      });
      toast.error('Safety Alert', { description: data.message });
    };

    // ── system_event ───────────────────────────────────────────────────────
    const onSystemEvent = (data: {
      id: string;
      type: 'machine' | 'worker' | 'procurement' | 'quality' | 'system';
      severity: 'info' | 'warning' | 'critical';
      message: string;
      timestamp: string;
    }) => {
      const { systemEvents } = useApiStore.getState();
      useApiStore.setState({
        systemEvents: [
          { ...data, timestamp: new Date(data.timestamp) },
          ...systemEvents,
        ].slice(0, 100),
      });
      if (data.severity === 'critical') {
        toast.error('Critical Event', { description: data.message });
      }
    };

    // ── machine_update (status overrides from AI agent or other clients) ──
    const onMachineUpdate = (data: { machineId: string; [key: string]: unknown }) => {
      const { machines } = useApiStore.getState();
      useApiStore.setState({
        machines: machines.map(m => m.id === data.machineId ? { ...m, ...data } : m),
      });
    };

    // ── ai_action — autonomous agent ran and may have taken actions ────────
    const onAiAction = (data: AiAction) => {
      const { aiActions } = useApiStore.getState();
      useApiStore.setState({
        aiActions: [data, ...aiActions].slice(0, 30),
      });
      if (data.actionsCount > 0) {
        toast.info(`AI Agent: ${data.actionsCount} action${data.actionsCount > 1 ? 's' : ''} taken`, {
          description: data.summary.slice(0, 120),
          duration: 6000,
        });
      }
    };

    socket.on('sensor_data',  onSensorData);
    socket.on('safety_alert', onSafetyAlert);
    socket.on('system_event', onSystemEvent);
    socket.on('machine_update', onMachineUpdate);
    socket.on('ai_action',    onAiAction);

    return () => {
      socket.off('sensor_data',  onSensorData);
      socket.off('safety_alert', onSafetyAlert);
      socket.off('system_event', onSystemEvent);
      socket.off('machine_update', onMachineUpdate);
      socket.off('ai_action',    onAiAction);
    };
  }, []);

  return socket;
};

export { socket };
