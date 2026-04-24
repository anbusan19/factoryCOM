import express from 'express';
import { Mistral } from '@mistralai/mistralai';
import dotenv from 'dotenv';
import Machine from '../models/Machine.js';
import Worker from '../models/Worker.js';
import SafetyAlert from '../models/SafetyAlert.js';
import SystemEvent from '../models/SystemEvent.js';

dotenv.config();

const router = express.Router();

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

// ── Tool definitions (Groq / OpenAI-compatible function calling) ───────────

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'update_machine_status',
      description:
        'Change the operational status of a specific machine. Use when a machine must be taken offline for safety, scheduled for maintenance, or returned to active after recovery.',
      parameters: {
        type: 'object',
        properties: {
          machineId:  { type: 'string', description: 'The machine id field (e.g. M001)' },
          newStatus:  { type: 'string', enum: ['active', 'idle', 'fault', 'maintenance'] },
          reason:     { type: 'string', description: 'Brief, one-sentence reason for the change' },
        },
        required: ['machineId', 'newStatus', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_safety_alert',
      description: 'Raise a safety alert visible to all operators and managers.',
      parameters: {
        type: 'object',
        properties: {
          severity:  { type: 'string', enum: ['warning', 'critical'] },
          message:   { type: 'string' },
          machineId: { type: 'string', description: 'Optional machine ID related to the alert' },
        },
        required: ['severity', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_system_event',
      description: 'Log a system event or recommendation that appears in the factory events feed.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['machine', 'worker', 'procurement', 'quality', 'system'] },
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
          message:  { type: 'string' },
        },
        required: ['category', 'severity', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_maintenance',
      description: 'Immediately schedule a machine for maintenance (sets status to maintenance).',
      parameters: {
        type: 'object',
        properties: {
          machineId: { type: 'string' },
          reason:    { type: 'string' },
        },
        required: ['machineId', 'reason'],
      },
    },
  },
];

// ── Tool executor ──────────────────────────────────────────────────────────

async function executeTool(toolName, args, io) {
  switch (toolName) {
    case 'update_machine_status': {
      const machine = await Machine.findOneAndUpdate(
        { id: args.machineId },
        { status: args.newStatus, updatedAt: new Date() },
        { new: true }
      );
      if (!machine) return { success: false, error: `Machine ${args.machineId} not found` };

      io?.emit('machine_update', {
        machineId: machine.id,
        status:    machine.status,
        timestamp: new Date().toISOString(),
      });
      io?.emit('system_event', {
        id:        `AI-SE-${Date.now()}`,
        type:      'machine',
        severity:  args.newStatus === 'fault' ? 'critical' : 'info',
        message:   `[AI Agent] ${machine.name} → ${args.newStatus}: ${args.reason}`,
        timestamp: new Date().toISOString(),
      });

      return { success: true, machine: machine.name, newStatus: args.newStatus, reason: args.reason };
    }

    case 'schedule_maintenance':
    case 'update_machine_status_maintenance': {
      const machine = await Machine.findOneAndUpdate(
        { id: args.machineId },
        { status: 'maintenance', updatedAt: new Date() },
        { new: true }
      );
      if (!machine) return { success: false, error: `Machine ${args.machineId} not found` };

      io?.emit('machine_update', { machineId: machine.id, status: 'maintenance', timestamp: new Date().toISOString() });
      io?.emit('system_event', {
        id: `AI-SE-${Date.now()}`, type: 'machine', severity: 'warning',
        message: `[AI Agent] ${machine.name} scheduled for maintenance: ${args.reason}`,
        timestamp: new Date().toISOString(),
      });

      return { success: true, machine: machine.name, status: 'maintenance', reason: args.reason };
    }

    case 'create_safety_alert': {
      io?.emit('safety_alert', {
        id:        `AI-SA-${Date.now()}`,
        type:      args.severity,
        severity:  args.severity,
        message:   `[AI Agent] ${args.message}`,
        machineId: args.machineId ?? null,
        timestamp: new Date().toISOString(),
      });

      return { success: true, severity: args.severity, message: args.message };
    }

    case 'log_system_event': {
      io?.emit('system_event', {
        id:        `AI-SE-${Date.now()}`,
        type:      args.category,
        severity:  args.severity,
        message:   `[AI Agent] ${args.message}`,
        timestamp: new Date().toISOString(),
      });

      return { success: true, category: args.category, message: args.message };
    }

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// ── Core agent logic (reusable by route and autonomous loop) ───────────────

export async function runAgentAnalysis({ prompt, autonomous = false, io }) {
  // Fetch compact factory state
  const [machines, workers, alerts] = await Promise.all([
    Machine.find({}, 'id name status temperature efficiency').lean(),
    Worker.find({},  'id name status shift riskIndex').lean(),
    SafetyAlert ? SafetyAlert.find({}).sort({ createdAt: -1 }).limit(10).lean() : Promise.resolve([]),
  ]);

  const hotMachines    = machines.filter(m => (m.temperature ?? 0) > 85);
  const faultMachines  = machines.filter(m => m.status === 'fault');
  const lowEffMachines = machines.filter(m => (m.efficiency ?? 100) < 65 && m.status === 'active');
  const highRiskWorkers = workers.filter(w => (w.riskIndex ?? 0) > 70);

  const factorySnapshot = [
    `Machines (${machines.length}): ${machines.filter(m=>m.status==='active').length} active, ${machines.filter(m=>m.status==='idle').length} idle, ${faultMachines.length} fault, ${machines.filter(m=>m.status==='maintenance').length} maintenance`,
    hotMachines.length    ? `Hot machines (>85°C): ${hotMachines.map(m=>`${m.name} ${m.temperature}°C`).join(', ')}` : '',
    faultMachines.length  ? `Fault machines: ${faultMachines.map(m=>m.name).join(', ')}` : '',
    lowEffMachines.length ? `Low-efficiency machines (<65%): ${lowEffMachines.map(m=>`${m.name} ${m.efficiency}%`).join(', ')}` : '',
    `Workers (${workers.length}): ${workers.filter(w=>w.status==='active').length} active`,
    highRiskWorkers.length ? `High-risk workers: ${highRiskWorkers.map(w=>`${w.name} (risk ${w.riskIndex})`).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const systemPrompt = `You are the FactoryOS Autonomous AI Agent. You monitor factory conditions and take corrective actions using the tools provided.

Current factory snapshot:
${factorySnapshot}

Rules:
- Only take actions when there is a clear, specific reason (temperature thresholds exceeded, machines faulted, etc.)
- Always provide a concise reason for each action
- Machines with temperature > 88°C should be scheduled for maintenance
- Fault machines should have a safety alert raised
- Low efficiency machines (<65%) should get a system log event
- After taking actions, give a brief summary of what you did and why
- If nothing needs action, say so and explain the factory is operating normally`;

  const userMessage = prompt || (autonomous
    ? 'Analyze the current factory state. Identify any machines or workers that need immediate attention and take appropriate actions.'
    : 'Analyze the factory state and take any necessary corrective actions.');

  const messages = [
    { role: 'system',  content: systemPrompt },
    { role: 'user',    content: userMessage },
  ];

  const actions   = [];
  const MAX_LOOPS = 4;

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    const response = await mistral.chat.complete({
      model:       'mistral-large-latest',
      messages,
      tools:       AGENT_TOOLS,
      toolChoice:  'auto',
      temperature: 0.3,
      maxTokens:   600,
    });

    const choice = response.choices[0];
    messages.push(choice.message);

    if (choice.finishReason !== 'tool_calls' || !choice.message.toolCalls?.length) break;

    for (const tc of choice.message.toolCalls) {
      const args   = JSON.parse(tc.function.arguments);
      const result = await executeTool(tc.function.name, args, io);
      actions.push({ tool: tc.function.name, args, result });

      messages.push({
        role:       'tool',
        toolCallId: tc.id,
        content:    JSON.stringify(result),
      });
    }
  }

  const lastMsg = messages[messages.length - 1];
  const summary = typeof lastMsg.content === 'string' ? lastMsg.content : 'Analysis complete.';

  return { summary, actions, actionsCount: actions.length };
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/ai-agent/analyze
 * Manual trigger — manager can call this from the UI.
 * Body: { prompt?: string }
 */
router.post('/analyze', async (req, res) => {
  try {
    const io     = req.app.get('io');
    const result = await runAgentAnalysis({
      prompt:     req.body.prompt,
      autonomous: false,
      io,
    });

    // Broadcast the result so ManagerChat receives it
    io?.emit('ai_action', {
      id:           `AI-${Date.now()}`,
      summary:      result.summary,
      actions:      result.actions,
      actionsCount: result.actionsCount,
      autonomous:   false,
      timestamp:    new Date().toISOString(),
    });

    res.json(result);
  } catch (error) {
    console.error('AI Agent error:', error);
    res.status(500).json({ error: 'AI Agent failed', details: error.message });
  }
});

/**
 * GET /api/ai-agent/status
 * Returns whether the autonomous agent is running + last run time.
 */
router.get('/status', (req, res) => {
  res.json({ autonomous: true, intervalSeconds: 60 });
});

export default router;
