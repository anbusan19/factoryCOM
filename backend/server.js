import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import connectDB from './config/database.js';
import dotenv from 'dotenv';
import Machine from './models/Machine.js';

// Import routes
import machineRoutes from './routes/machines.js';
import workerRoutes from './routes/workers.js';
import orderRoutes from './routes/orders.js';
import alertRoutes from './routes/alerts.js';
import productionRoutes from './routes/production.js';
import qualityControlRoutes from './routes/qualityControl.js';
import aiRoutes from './routes/ai.js';
import sensorRoutes from './routes/sensors.js';
import aiAgentRoutes, { runAgentAnalysis } from './routes/aiAgent.js';
import supplierRoutes from './routes/suppliers.js';
import notificationRoutes from './routes/notifications.js';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:8080", "https://factoryos.vercel.app"],
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/machines', machineRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/quality-control', qualityControlRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/sensors', sensorRoutes);
app.use('/api/ai-agent', aiAgentRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Socket.io connection tracking
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Make io available to routes
app.set('io', io);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ─── Sensor Simulation Loop ────────────────────────────────────────────────
// Runs every 5 seconds after DB connects. Generates realistic drifting sensor
// readings for each machine and emits them via Socket.IO.
// Replace with real hardware data by POSTing to /api/sensors/data instead.

const machineSimState = {};
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between alerts per machine

function startSensorSimulation(io) {
  console.log('Sensor simulation started (5s interval)');

  setInterval(async () => {
    try {
      const machines = await Machine.find({});
      if (!machines.length) return;

      const batch = [];

      for (const machine of machines) {
        // Initialise per-machine in-memory state on first tick
        if (!machineSimState[machine.id]) {
          machineSimState[machine.id] = {
            temp: machine.temperature ?? 65,
            efficiency: machine.efficiency ?? 85,
            lastAlertAt: 0,
          };
        }

        const state = machineSimState[machine.id];

        // Temperature drift — more volatile when active, slow cool-down when idle/fault
        const tempDelta = machine.status === 'active'
          ? (Math.random() - 0.45) * 3  // slight upward bias while running
          : (Math.random() - 0.6) * 1.5; // slow cool-down otherwise
        state.temp = Math.max(45, Math.min(95, state.temp + tempDelta));

        // Efficiency fluctuation
        const effDelta = (Math.random() - 0.5) * 5;
        state.efficiency = Math.max(55, Math.min(100, state.efficiency + effDelta));

        const temperature = parseFloat(state.temp.toFixed(1));
        const efficiency = Math.round(state.efficiency);

        // Auto-fault on thermal overrun — alert at most once per ALERT_COOLDOWN_MS per machine
        let newStatus = machine.status;
        if (temperature > 88 && machine.status === 'active') {
          newStatus = 'fault';
          const now = Date.now();
          if (now - state.lastAlertAt > ALERT_COOLDOWN_MS) {
            state.lastAlertAt = now;
            io.emit('safety_alert', {
              id: `SA-${now}-${machine.id}`,
              type: 'critical',
              severity: 'critical',
              message: `Thermal overrun: ${machine.name} at ${temperature}°C — switched to fault`,
              machineId: machine.id,
              timestamp: new Date().toISOString(),
            });
            io.emit('system_event', {
              id: `SE-${now}-${machine.id}`,
              type: 'machine',
              severity: 'critical',
              message: `${machine.name} auto-faulted due to temperature (${temperature}°C)`,
              timestamp: new Date().toISOString(),
            });
          }
        }

        // Auto-recover once temp drops below safe threshold
        if (temperature < 78 && machine.status === 'fault' && (machine.temperature ?? 0) >= 88) {
          newStatus = 'active';
          io.emit('system_event', {
            id: `SE-REC-${Date.now()}-${machine.id}`,
            type: 'machine',
            severity: 'info',
            message: `${machine.name} temperature normalized (${temperature}°C) — restored to active`,
            timestamp: new Date().toISOString(),
          });
        }

        // Persist to DB
        await Machine.findOneAndUpdate(
          { id: machine.id },
          { temperature, efficiency, status: newStatus, updatedAt: new Date() }
        );

        batch.push({
          machineId: machine.id,
          machineName: machine.name,
          temperature,
          efficiency,
          status: newStatus,
          source: 'simulation',
          timestamp: new Date().toISOString(),
        });
      }

      // Emit all readings in one batch
      io.emit('sensor_data', batch);

    } catch (err) {
      console.error('Sensor simulation error:', err.message);
    }
  }, 5000);
}

// ─── Autonomous AI Agent Loop ──────────────────────────────────────────────
function startAutonomousAgent(io) {
  console.log('Autonomous AI Agent started (60s interval)');

  setInterval(async () => {
    try {
      const result = await runAgentAnalysis({ autonomous: true, io });

      io.emit('ai_action', {
        id:           `AI-AUTO-${Date.now()}`,
        summary:      result.summary,
        actions:      result.actions,
        actionsCount: result.actionsCount,
        autonomous:   true,
        timestamp:    new Date().toISOString(),
      });

      if (result.actionsCount > 0) {
        console.log(`[AI Agent] Autonomous run: ${result.actionsCount} action(s) taken`);
      }
    } catch (err) {
      console.error('[AI Agent] Autonomous run error:', err.message);
    }
  }, 60000); // every 60 seconds
}

// ─── Start Server ──────────────────────────────────────────────────────────
(async () => {
  await connectDB();
  startSensorSimulation(io);
  startAutonomousAgent(io);

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log(`Sensor ingest: POST http://localhost:${PORT}/api/sensors/data`);
  });
})();

export { io };
