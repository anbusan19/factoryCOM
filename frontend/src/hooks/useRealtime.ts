import { useSocket } from './useSocket';

/**
 * useRealtime — enables live data updates from the backend via Socket.IO.
 *
 * Previously used setInterval to fake events on the frontend.
 * Now uses a real WebSocket connection — machine temperatures, safety alerts,
 * and system events all come from the backend simulation (or real hardware via
 * POST /api/sensors/data).
 */
export const useRealtime = () => {
  useSocket();
};
