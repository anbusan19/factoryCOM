import { useState, useRef, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useApiStore } from '@/store/useApiStore';
import { useSocket } from '@/hooks/useSocket';
import { sendFactoryMessage } from '@/lib/geminiApi';
import {
  Send, Bot, User, Factory, Users, AlertTriangle,
  Activity, TrendingUp, RefreshCw, Wifi, WifiOff, Zap, ChevronDown, ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'agent';
  content: string;
  timestamp: Date;
  actionsCount?: number;
}

const SUGGESTED_QUERIES = [
  'Give me a full factory status report',
  'Which machines need immediate attention?',
  'Are there any critical safety alerts?',
  "What's the current production efficiency?",
  'Which workers are active right now?',
  'Summarize pending procurement orders',
  'What are the top issues I should address?',
  'Which machines are running above 85°C?',
];

const API_BASE = 'http://localhost:3001/api';

const INITIAL_MESSAGE: Message = {
  id: 'init',
  role: 'assistant',
  content:
    "Good day. I'm the FactoryOS Cognitive Core — your factory intelligence assistant.\n\nI have live access to all machine readings, worker assignments, safety alerts, and production data. The Autonomous AI Agent also runs in the background every 60 seconds, monitoring for anomalies and taking corrective actions automatically.\n\nAsk me anything, or click 'Run Agent Now' to trigger an immediate analysis.",
  timestamp: new Date(),
};

const ManagerChat = () => {
  const socket = useSocket();
  const {
    machines, workers, safetyAlerts, systemEvents,
    factoryOrders, procurementOrders, aiActions, fetchAll,
  } = useApiStore();

  const [messages, setMessages]       = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput]             = useState('');
  const [isTyping, setIsTyping]       = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [agentPanelOpen, setAgentPanelOpen] = useState(true);
  const messagesEndRef                = useRef<HTMLDivElement>(null);
  const inputRef                      = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const onConnect    = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    socket.on('connect',    onConnect);
    socket.on('disconnect', onDisconnect);
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); };
  }, [socket]);

  // When autonomous AI agent acts, show it in the chat thread
  useEffect(() => {
    if (!aiActions.length) return;
    const latest = aiActions[0];
    if (latest.actionsCount === 0) return;

    const agentMsg: Message = {
      id:           `agent-${latest.id}`,
      role:         'agent',
      content:      latest.summary,
      timestamp:    new Date(latest.timestamp),
      actionsCount: latest.actionsCount,
    };

    setMessages(prev => {
      if (prev.find(m => m.id === agentMsg.id)) return prev;
      return [...prev, agentMsg];
    });
  }, [aiActions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Derived stats
  const activeMachines  = machines.filter(m => m.status === 'active').length;
  const faultMachines   = machines.filter(m => m.status === 'fault').length;
  const idleMachines    = machines.filter(m => m.status === 'idle').length;
  const maintMachines   = machines.filter(m => m.status === 'maintenance').length;
  const activeWorkers   = workers.filter(w => w.status === 'active').length;
  const criticalAlerts  = safetyAlerts.filter(a => a.type === 'critical').length;
  const avgEff          = machines.length
    ? Math.round(machines.reduce((s, m) => s + (m.efficiency ?? 0), 0) / machines.length) : 0;
  const avgTemp = machines.length
    ? (machines.reduce((s, m) => s + (m.temperature ?? 0), 0) / machines.length).toFixed(1) : '—';
  const pendingOrders = procurementOrders.filter(o => o.status !== 'delivered').length;

  const sendMessage = async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || isTyping) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: userText, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const history = messages.filter(m => m.id !== 'init' && m.role !== 'agent')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const response = await sendFactoryMessage(userText, history, {
        machines, workers,
        orders: [...factoryOrders, ...procurementOrders],
        alerts: safetyAlerts,
      });

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: response, timestamp: new Date(),
      }]);
    } catch {
      toast.error('Failed to reach AI backend');
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: 'Error reaching backend. Please check server connection.', timestamp: new Date(),
      }]);
    } finally {
      setIsTyping(false);
      inputRef.current?.focus();
    }
  };

  const triggerAgent = async () => {
    if (agentRunning) return;
    setAgentRunning(true);
    try {
      const res = await fetch(`${API_BASE}/ai-agent/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const agentMsg: Message = {
        id:           `agent-manual-${Date.now()}`,
        role:         'agent',
        content:      data.summary,
        timestamp:    new Date(),
        actionsCount: data.actionsCount,
      };
      setMessages(prev => [...prev, agentMsg]);
      toast.success(`AI Agent completed: ${data.actionsCount} action(s) taken`);
    } catch (err: unknown) {
      toast.error('Agent run failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setAgentRunning(false);
    }
  };

  return (
    <Layout>
      <div className="flex h-[calc(100vh-5rem)] overflow-hidden">

        {/* ── Left Panel: Live Status ─────────────────────────────────────── */}
        <aside className="w-72 flex-shrink-0 border-r border-sidebar-border flex flex-col overflow-y-auto bg-muted/30">
          <div className="p-4 border-b border-sidebar-border">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Live Factory Status</h2>
              <div className="flex items-center gap-1.5">
                {isConnected
                  ? <><Wifi className="w-3.5 h-3.5 text-green-600" /><span className="text-xs text-green-600">Live</span></>
                  : <><WifiOff className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">Offline</span></>}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Updates every 5 seconds</p>
          </div>

          <div className="p-4 space-y-4">
            {/* Machines */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Factory className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Machines</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <StatBox label="Active"  value={activeMachines} color="text-green-700" />
                <StatBox label="Idle"    value={idleMachines}   color="text-muted-foreground" />
                <StatBox label="Fault"   value={faultMachines}  color="text-red-600" />
                <StatBox label="Maint."  value={maintMachines}  color="text-violet-500" />
              </div>
              <div className="mt-2 space-y-1">
                <InfoRow label="Avg efficiency" value={`${avgEff}%`} />
                <InfoRow label="Avg temperature" value={`${avgTemp}°C`} />
              </div>
            </div>

            <Separator />

            {/* Workers */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workforce</span>
              </div>
              <InfoRow label="Total workers" value={String(workers.length)} />
              <InfoRow label="On shift" value={String(activeWorkers)} highlight />
            </div>

            <Separator />

            {/* Alerts */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alerts</span>
              </div>
              {criticalAlerts > 0 && (
                <Badge variant="destructive" className="text-xs mb-2">{criticalAlerts} critical</Badge>
              )}
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {safetyAlerts.slice(0, 5).map((a, i) => (
                  <div key={i} className="text-xs text-muted-foreground border-l-2 border-red-400 pl-2 py-0.5 truncate">
                    {a.message}
                  </div>
                ))}
                {!safetyAlerts.length && <p className="text-xs text-muted-foreground italic">No active alerts</p>}
              </div>
            </div>

            <Separator />

            {/* Procurement */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Procurement</span>
              </div>
              <InfoRow label="Pending orders" value={String(pendingOrders)} />
              <InfoRow label="Total orders"   value={String(procurementOrders.length)} />
            </div>

            <Separator />

            {/* AI Agent Activity */}
            <div>
              <button
                className="flex items-center justify-between w-full"
                onClick={() => setAgentPanelOpen(p => !p)}
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-violet-500" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Agent</span>
                </div>
                {agentPanelOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>

              {agentPanelOpen && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                    Auto-monitoring · 60s interval
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {aiActions.length} action{aiActions.length !== 1 ? 's' : ''} taken this session
                  </div>
                  {aiActions.slice(0, 3).map((a, i) => (
                    <div key={i} className="text-xs text-muted-foreground border-l-2 border-violet-400 pl-2 py-0.5 truncate">
                      {a.actionsCount > 0 ? `✓ ${a.actionsCount} action${a.actionsCount > 1 ? 's' : ''}` : '✓ No issues'} ·{' '}
                      {formatDistanceToNow(new Date(a.timestamp), { addSuffix: true })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ── Right Panel: Chat ───────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-sidebar-border bg-background">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
                <Bot className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="font-semibold text-sm">Cognitive Core — Manager Console</h1>
                <p className="text-xs text-muted-foreground">Chat + Autonomous AI Agent</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={triggerAgent}
                disabled={agentRunning}
                size="sm"
                className="gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white"
              >
                <Zap className={`w-3.5 h-3.5 ${agentRunning ? 'animate-pulse' : ''}`} />
                {agentRunning ? 'Agent running…' : 'Run Agent Now'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => fetchAll()} className="gap-1.5 text-xs">
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={() => setMessages([INITIAL_MESSAGE])} className="text-xs">
                Clear
              </Button>
            </div>
          </div>

          {/* Suggested queries */}
          <div className="px-6 py-3 border-b border-sidebar-border bg-muted/20">
            <p className="text-xs text-muted-foreground mb-2">Quick queries:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_QUERIES.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  disabled={isTyping}
                  className="text-xs px-3 py-1 rounded-full border border-border hover:bg-sidebar-accent hover:border-primary/30 transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 px-6 py-4">
            <div className="space-y-5 max-w-3xl mx-auto">
              {messages.map(msg => {
                if (msg.role === 'agent') {
                  return (
                    <div key={msg.id} className="flex gap-3 justify-start">
                      <div className="w-7 h-7 rounded-full bg-violet-600 flex-shrink-0 flex items-center justify-center mt-0.5">
                        <Zap className="w-4 h-4 text-white" />
                      </div>
                      <div className="max-w-[75%] rounded-2xl rounded-bl-sm px-4 py-3 bg-violet-500/10 border border-violet-500/20">
                        {msg.actionsCount !== undefined && msg.actionsCount > 0 && (
                          <div className="flex items-center gap-1.5 mb-2">
                            <Badge className="text-[10px] bg-violet-600 text-white border-0 px-1.5 py-0">
                              AI Agent · {msg.actionsCount} action{msg.actionsCount > 1 ? 's' : ''}
                            </Badge>
                          </div>
                        )}
                        <p className="text-sm whitespace-pre-wrap text-foreground leading-relaxed">{msg.content}</p>
                        <p className="text-[10px] mt-1.5 text-muted-foreground">
                          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · autonomous
                        </p>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && (
                      <div className="w-7 h-7 rounded-full bg-primary flex-shrink-0 flex items-center justify-center mt-0.5">
                        <Bot className="w-4 h-4 text-primary-foreground" />
                      </div>
                    )}
                    <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'bg-muted rounded-bl-sm'
                    }`}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <p className={`text-[10px] mt-1.5 ${msg.role === 'user' ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {msg.role === 'user' && (
                      <div className="w-7 h-7 rounded-full bg-secondary border border-border flex-shrink-0 flex items-center justify-center mt-0.5">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                );
              })}

              {isTyping && (
                <div className="flex gap-3 justify-start">
                  <div className="w-7 h-7 rounded-full bg-primary flex-shrink-0 flex items-center justify-center mt-0.5">
                    <Bot className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                    <div className="flex gap-1 items-center h-4">
                      {[0, 150, 300].map(delay => (
                        <span key={delay} className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="px-6 py-4 border-t border-sidebar-border bg-background">
            <div className="max-w-3xl mx-auto flex gap-3">
              <Input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="Ask anything about your factory…"
                className="flex-1"
                disabled={isTyping}
              />
              <Button onClick={() => sendMessage()} disabled={isTyping || !input.trim()} size="icon">
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">
              AI has live access to machine readings, worker data, alerts, and production metrics.
              &nbsp;Autonomous agent monitors every 60 s.
            </p>
          </div>
        </main>
      </div>
    </Layout>
  );
};

// Helpers
const StatBox = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <div className="bg-background rounded-lg p-2 text-center border border-border">
    <p className={`text-lg font-bold ${color}`}>{value}</p>
    <p className="text-[10px] text-muted-foreground">{label}</p>
  </div>
);

const InfoRow = ({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) => (
  <div className="flex justify-between text-xs mt-1">
    <span className="text-muted-foreground">{label}</span>
    <span className={`font-medium ${highlight ? 'text-green-700' : 'text-foreground'}`}>{value}</span>
  </div>
);

export default ManagerChat;
