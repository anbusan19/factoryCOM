import express from 'express';
import Machine from '../models/Machine.js';

const router = express.Router();

// Status values sent by ESP32 ("Active"/"Fault") mapped to DB enum
const STATUS_MAP = {
  Active: 'active', active: 'active',
  Fault: 'fault',   fault: 'fault',
  Idle: 'idle',     idle: 'idle',
  Maintenance: 'maintenance', maintenance: 'maintenance',
};

/**
 * POST /api/sensors
 * ESP32 / DHT11 + SW-420 ingest endpoint.
 * Body: { temperature, humidity, vibration, status, machineId? }
 * machineId can also be passed as ?machineId=M-001 query param.
 * Falls back to the first machine in the DB if machineId is omitted.
 */
router.post('/', async (req, res) => {
  try {
    const { temperature, humidity, vibration, status, machineId: bodyMachineId } = req.body;
    const machineId = bodyMachineId || req.query.machineId;

    const machine = machineId
      ? await Machine.findOne({ id: machineId })
      : await Machine.findOne({});

    if (!machine) {
      return res.status(404).json({
        error: machineId ? `Machine ${machineId} not found` : 'No machines in database',
      });
    }

    const update = { updatedAt: new Date() };
    if (temperature !== undefined && !isNaN(temperature)) {
      update.temperature = parseFloat(temperature);
    }
    const mappedStatus = STATUS_MAP[status];
    if (mappedStatus) update.status = mappedStatus;

    const updated = await Machine.findOneAndUpdate({ id: machine.id }, update, { new: true });

    const io = req.app.get('io');
    if (io) {
      io.emit('sensor_data', [{
        machineId:   updated.id,
        machineName: updated.name,
        temperature: updated.temperature,
        efficiency:  updated.efficiency,
        humidity:    humidity ?? null,
        vibration:   vibration ?? null,
        status:      updated.status,
        source:      'esp32',
        timestamp:   new Date().toISOString(),
      }]);

      if (updated.temperature > 70) {
        io.emit('safety_alert', {
          id:        `SA-ESP32-${Date.now()}`,
          type:      'thermal',
          severity:  updated.temperature > 80 ? 'critical' : 'warning',
          message:   `High temperature on ${updated.name}: ${updated.temperature}°C`,
          machineId: updated.id,
          timestamp: new Date().toISOString(),
        });
      }
    }

    res.json({
      success: true,
      machine: { id: updated.id, name: updated.name, temperature: updated.temperature, status: updated.status },
    });
  } catch (error) {
    console.error('ESP32 ingest error:', error);
    res.status(500).json({ error: 'Failed to process sensor data' });
  }
});

/**
 * POST /api/sensors/data
 * Ingest sensor data from external hardware (Raspberry Pi, Wokwi, MQTT bridge, etc.)
 * Payload: { machineId, temperature, efficiency, status?, vibration? }
 *
 * Compatible simulators:
 *   - Wokwi.com (ESP32/Arduino) → HTTP POST to this endpoint
 *   - Node-RED flows → HTTP request node pointing here
 *   - Raspberry Pi Python script → requests.post() to this endpoint
 *   - MQTT bridge → subscribe and re-POST here
 */
router.post('/data', async (req, res) => {
  try {
    const { machineId, temperature, efficiency, status, vibration } = req.body;

    if (!machineId) {
      return res.status(400).json({ error: 'machineId is required' });
    }

    if (temperature === undefined && efficiency === undefined) {
      return res.status(400).json({ error: 'At least one sensor value (temperature or efficiency) is required' });
    }

    const update = { updatedAt: new Date() };
    if (temperature !== undefined) update.temperature = parseFloat(temperature);
    if (efficiency !== undefined) update.efficiency = parseFloat(efficiency);
    if (status && ['active', 'idle', 'fault', 'maintenance'].includes(status)) {
      update.status = status;
    }

    const machine = await Machine.findOneAndUpdate(
      { id: machineId },
      update,
      { new: true }
    );

    if (!machine) {
      return res.status(404).json({ error: `Machine ${machineId} not found` });
    }

    // Emit via Socket.IO so all connected frontends see it instantly
    const io = req.app.get('io');
    if (io) {
      const payload = [{
        machineId: machine.id,
        machineName: machine.name,
        temperature: machine.temperature,
        efficiency: machine.efficiency,
        status: machine.status,
        vibration: vibration ?? null,
        source: 'hardware',
        timestamp: new Date().toISOString(),
      }];

      io.emit('sensor_data', payload);

      // Auto-raise safety alert on high temperature
      if (machine.temperature > 88 && machine.status !== 'fault') {
        io.emit('safety_alert', {
          id: `SA-HW-${Date.now()}`,
          type: 'critical',
          severity: 'critical',
          message: `Hardware alert: ${machine.name} reported ${machine.temperature}°C — threshold exceeded`,
          machineId: machine.id,
          timestamp: new Date().toISOString(),
        });
      }
    }

    res.json({ success: true, machine: { id: machine.id, name: machine.name, temperature: machine.temperature, efficiency: machine.efficiency, status: machine.status } });
  } catch (error) {
    console.error('Sensor ingest error:', error);
    res.status(500).json({ error: 'Failed to process sensor data' });
  }
});

/**
 * GET /api/sensors/status
 * Returns current sensor readings for all machines (useful for hardware polling)
 */
router.get('/status', async (req, res) => {
  try {
    const machines = await Machine.find({}, 'id name status temperature efficiency updatedAt');
    res.json(machines);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sensor status' });
  }
});

export default router;
