import express from 'express';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Condense factory context into a compact text summary instead of sending
 * raw JSON arrays. Keeps token usage well under the free-tier TPM limit.
 */
function buildContextSummary(factoryContext) {
  if (!factoryContext) return '';

  const lines = [];

  if (factoryContext.machines?.length) {
    const m = factoryContext.machines;
    const active = m.filter(x => x.status === 'active').length;
    const fault  = m.filter(x => x.status === 'fault').length;
    const idle   = m.filter(x => x.status === 'idle').length;
    const maint  = m.filter(x => x.status === 'maintenance').length;
    const avgTemp = (m.reduce((s, x) => s + (x.temperature ?? 0), 0) / m.length).toFixed(1);
    const avgEff  = Math.round(m.reduce((s, x) => s + (x.efficiency ?? 0), 0) / m.length);

    lines.push(`\nMACHINES (${m.length} total): ${active} active, ${idle} idle, ${fault} fault, ${maint} maintenance | avg temp ${avgTemp}°C | avg efficiency ${avgEff}%`);
    lines.push('Machine details:');
    m.forEach(x => {
      lines.push(`  - ${x.name} (${x.id}): status=${x.status}, temp=${x.temperature ?? '?'}°C, efficiency=${x.efficiency ?? '?'}%, worker=${x.workerId ?? 'unassigned'}`);
    });
  }

  if (factoryContext.workers?.length) {
    const w = factoryContext.workers;
    const active   = w.filter(x => x.status === 'active').length;
    const onBreak  = w.filter(x => x.status === 'on-break').length;
    const reassigned = w.filter(x => x.status === 'reassigned').length;

    lines.push(`\nWORKERS (${w.length} total): ${active} active, ${onBreak} on break, ${reassigned} reassigned`);
    lines.push('Worker details:');
    w.forEach(x => {
      lines.push(`  - ${x.name} (${x.id}): status=${x.status}, shift=${x.shift}, machine=${x.machineId ?? 'unassigned'}, riskIndex=${x.riskIndex}`);
    });
  }

  if (factoryContext.orders?.length) {
    const o = factoryContext.orders;
    const completed = o.filter(x => x.status === 'completed' || x.status === 'delivered').length;
    const pending   = o.filter(x => !['completed', 'delivered', 'cancelled'].includes(x.status)).length;

    lines.push(`\nORDERS (${o.length} total): ${pending} pending/active, ${completed} completed`);
    lines.push('Order details:');
    o.slice(0, 15).forEach(x => {
      const name = x.factoryName || x.supplier || 'Unknown';
      const val  = x.totalPrice != null ? `₹${x.totalPrice}` : (x.quantity ? `qty ${x.quantity}` : '');
      lines.push(`  - ${x.id}: ${name} | status=${x.status} | ${val} | payment=${x.paymentStatus ?? x.status === 'delivered' ? 'paid' : 'pending'}`);
    });
  }

  if (factoryContext.alerts?.length) {
    const a = factoryContext.alerts;
    const critical = a.filter(x => x.type === 'critical' || x.severity === 'critical').length;
    lines.push(`\nSAFETY ALERTS (${a.length} total): ${critical} critical`);
    a.slice(0, 8).forEach(x => {
      lines.push(`  - [${x.type ?? x.severity ?? 'info'}] ${x.message} (machine: ${x.machineId ?? 'N/A'})`);
    });
  }

  return lines.join('\n');
}

/**
 * POST /api/ai/chat
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [], factoryContext } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const contextSummary = buildContextSummary(factoryContext);

    const systemPrompt = [
      'You are the FactoryOS Cognitive Core, an AI assistant for a smart manufacturing system.',
      'Help users manage factory operations, monitor machines, track orders, and analyse production data.',
      'Be concise and professional. Use bullet points for lists. Highlight critical issues first.',
      contextSummary ? `\nCurrent factory snapshot:\n${contextSummary}` : '',
    ].filter(Boolean).join('\n');

    // Keep only the last 6 conversation turns to limit token usage
    const trimmedHistory = conversationHistory.slice(-6);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
      { role: 'user', content: message },
    ];

    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: 'llama-3.1-8b-instant',  // 20k TPM on free tier — much more headroom
      temperature: 0.7,
      max_completion_tokens: 1024,
      top_p: 1,
      stream: false,
    });

    if (!chatCompletion.choices?.length) {
      return res.status(500).json({ error: 'No response from Groq API' });
    }

    const response = chatCompletion.choices[0].message.content || '';
    res.json({ response });

  } catch (error) {
    console.error('Groq API error:', error);
    res.status(500).json({
      error: 'Failed to get AI response',
      details: error.message,
    });
  }
});

export default router;
