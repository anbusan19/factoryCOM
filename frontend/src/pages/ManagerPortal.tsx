import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  LayoutDashboard, ShoppingCart, Users, AlertTriangle,
  Plus, RefreshCw, Check, ChevronDown, Bell, BellOff,
  Package, Shield, HardDrive, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApiStore, type FactoryOrder, type ProcurementOrder } from '@/store/useApiStore';
import { orderApi, alertApi } from '@/lib/api';

// ── Constants ─────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

const fmtINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const timeAgo = (d: string | Date) => {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

function urlBase64ToUint8Array(base64: string) {
  const pad = base64.length % 4 ? base64 + '='.repeat(4 - (base64.length % 4)) : base64;
  const raw = atob(pad.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Status maps ────────────────────────────────────────────────────────────

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  placed:             { label: 'Placed',           cls: 'bg-gray-100 text-gray-600' },
  'in-production':    { label: 'In Production',    cls: 'bg-blue-100 text-blue-700' },
  'in-transit':       { label: 'In Transit',       cls: 'bg-amber-100 text-amber-700' },
  'out-for-delivery': { label: 'Out for Delivery', cls: 'bg-purple-100 text-purple-700' },
  completed:          { label: 'Completed',        cls: 'bg-green-100 text-green-700' },
  cancelled:          { label: 'Cancelled',        cls: 'bg-red-100 text-red-700' },
  pending:            { label: 'Pending',          cls: 'bg-gray-100 text-gray-600' },
  delivered:          { label: 'Delivered',        cls: 'bg-green-100 text-green-700' },
};

const SEVERITY_CLS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high:     'bg-red-100 text-red-700',
  medium:   'bg-amber-100 text-amber-700',
  low:      'bg-green-100 text-green-700',
};

const MACHINE_DOT: Record<string, string> = {
  active: 'bg-green-500', idle: 'bg-amber-400', fault: 'bg-red-500', maintenance: 'bg-violet-400',
};

const WORKER_STATUS_CLS: Record<string, string> = {
  active:     'bg-green-100 text-green-700',
  'on-break': 'bg-amber-100 text-amber-700',
  reassigned: 'bg-blue-100 text-blue-700',
};

// ── Types ──────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'orders' | 'workforce' | 'alerts';
type OrderTab = 'factory' | 'procurement';

const NAV: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview',  label: 'Overview',  icon: LayoutDashboard },
  { id: 'orders',    label: 'Orders',    icon: ShoppingCart },
  { id: 'workforce', label: 'Workforce', icon: Users },
  { id: 'alerts',    label: 'Alerts',    icon: AlertTriangle },
];

const BLANK_FACTORY = { factoryName: '', area: '', quantity: '', unitPrice: '', leadTimeDays: '30', paymentStatus: 'pending' };
const BLANK_PROC    = { supplier: '', partId: '', material: '', quantity: '', unitPrice: '', deliveryEta: '' };

const FACTORY_STATUSES = ['all', 'placed', 'in-production', 'in-transit', 'out-for-delivery', 'completed', 'cancelled'];
const PROC_STATUSES    = ['all', 'pending', 'in-transit', 'delivered', 'cancelled'];
const SHIFTS           = ['All', 'Morning', 'Afternoon', 'Night'];

// ── Push notification helper ───────────────────────────────────────────────

async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  await fetch(`${API_BASE}/notifications/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  });
  return sub;
}

async function unsubscribeFromPush(sub: PushSubscription) {
  await fetch(`${API_BASE}/notifications/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function ManagerPortal() {
  const {
    machines, workers, safetyAlerts, systemEvents,
    factoryOrders, procurementOrders, suppliers,
    fetchAll, updateFactoryOrder, updateProcurementOrder, createProcurementOrder,
  } = useApiStore();

  useEffect(() => {
    fetchAll();
    // Register service worker once
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, [fetchAll]);

  const [tab,          setTab]          = useState<Tab>('overview');
  const [orderTab,     setOrderTab]     = useState<OrderTab>('factory');
  const [orderFilter,  setOrderFilter]  = useState('all');
  const [alertFilter,  setAlertFilter]  = useState<'all' | 'unresolved' | 'critical'>('all');
  const [shiftFilter,  setShiftFilter]  = useState('All');
  const [showCreate,   setShowCreate]   = useState(false);
  const [createType,   setCreateType]   = useState<OrderTab>('factory');
  const [factoryForm,  setFactoryForm]  = useState({ ...BLANK_FACTORY });
  const [procForm,     setProcForm]     = useState({ ...BLANK_PROC });
  const [submitting,   setSubmitting]   = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [pushSub,      setPushSub]      = useState<PushSubscription | null>(null);
  const [pushPending,  setPushPending]  = useState(false);

  // Check existing push subscription on mount
  useEffect(() => {
    navigator.serviceWorker?.ready.then(reg =>
      reg.pushManager.getSubscription().then(s => setPushSub(s))
    ).catch(() => {});
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────

  const activeMachines   = machines.filter(m => m.status === 'active').length;
  const faultMachines    = machines.filter(m => m.status === 'fault').length;
  const activeWorkers    = workers.filter(w => w.status === 'active').length;
  const openOrders       = factoryOrders.filter(o => !['completed', 'cancelled'].includes(o.status)).length;
  const unresolvedAlerts = (safetyAlerts as any[]).filter(a => !a.resolved).length;
  const avgEfficiency    = machines.length
    ? Math.round(machines.reduce((s, m) => s + (m.efficiency ?? 85), 0) / machines.length) : 0;

  const filteredFactoryOrders = useMemo(() =>
    factoryOrders.filter(o => orderFilter === 'all' || o.status === orderFilter),
    [factoryOrders, orderFilter]);

  const filteredProcOrders = useMemo(() =>
    procurementOrders.filter(o => orderFilter === 'all' || o.status === orderFilter),
    [procurementOrders, orderFilter]);

  const filteredWorkers = useMemo(() =>
    workers.filter(w => shiftFilter === 'All' || (w as any).shift === shiftFilter),
    [workers, shiftFilter]);

  const filteredAlerts = useMemo(() =>
    (safetyAlerts as any[]).filter(a => {
      if (alertFilter === 'unresolved') return !a.resolved;
      if (alertFilter === 'critical')   return a.type === 'critical' || a.severity === 'critical';
      return true;
    }),
    [safetyAlerts, alertFilter]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const resolveAlert = useCallback(async (id: string) => {
    await alertApi.updateSafetyAlert(id, { resolved: true });
    await fetchAll();
  }, [fetchAll]);

  const submitOrder = useCallback(async () => {
    setSubmitting(true);
    try {
      if (createType === 'factory') {
        const { factoryName, area, quantity, unitPrice, leadTimeDays, paymentStatus } = factoryForm;
        const qty = Number(quantity), up = Number(unitPrice);
        await orderApi.createFactoryOrder({
          factoryName, area, quantity: qty, unitPrice: up,
          totalPrice: qty * up, leadTimeDays: Number(leadTimeDays),
          paymentStatus, status: 'placed', factoryId: `F-${Date.now()}`,
        });
      } else {
        const { supplier, partId, material, quantity, unitPrice, deliveryEta } = procForm;
        await createProcurementOrder({
          supplier, partId, material,
          quantity: Number(quantity), unitPrice: Number(unitPrice),
          totalPrice: Number(quantity) * Number(unitPrice),
          deliveryEta: new Date(deliveryEta),
          status: 'pending', qualityScore: 95,
        } as Omit<ProcurementOrder, 'id'>);
      }
      setShowCreate(false);
      setFactoryForm({ ...BLANK_FACTORY });
      setProcForm({ ...BLANK_PROC });
      await fetchAll();
    } finally {
      setSubmitting(false);
    }
  }, [createType, factoryForm, procForm, createProcurementOrder, fetchAll]);

  const togglePush = useCallback(async () => {
    if (!VAPID_PUBLIC_KEY) return;
    setPushPending(true);
    try {
      if (pushSub) {
        await unsubscribeFromPush(pushSub);
        setPushSub(null);
      } else {
        const sub = await subscribeToPush();
        setPushSub(sub);
      }
    } finally {
      setPushPending(false);
    }
  }, [pushSub]);

  // ── Layout ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-gray-200 shrink-0">
        <div className="px-4 py-4 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-900">Manager Portal</p>
          <p className="text-xs text-gray-500 mt-0.5">Factory Operations</p>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                tab === id
                  ? 'bg-blue-50 text-blue-700 font-medium border-l-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
              {id === 'alerts' && unresolvedAlerts > 0 && (
                <span className="ml-auto text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {unresolvedAlerts}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-2 py-3 border-t border-gray-200 space-y-1">
          {VAPID_PUBLIC_KEY && (
            <button onClick={togglePush} disabled={pushPending}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {pushSub ? <Bell className="w-4 h-4 text-blue-600 shrink-0" /> : <BellOff className="w-4 h-4 shrink-0" />}
              {pushPending ? 'Working…' : pushSub ? 'Notifications on' : 'Enable notifications'}
            </button>
          )}
          <button onClick={refresh}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 shrink-0 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh data
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-4 lg:px-6 h-14 flex items-center justify-between shrink-0">
          <h1 className="text-base font-semibold text-gray-900 capitalize">
            {NAV.find(n => n.id === tab)?.label ?? 'Overview'}
          </h1>
          <div className="flex items-center gap-2">
            {tab === 'orders' && (
              <Button size="sm" onClick={() => setShowCreate(true)}
                className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> New Order
              </Button>
            )}
            {VAPID_PUBLIC_KEY && (
              <button onClick={togglePush} disabled={pushPending}
                className={`p-2 rounded-md transition-colors ${pushSub ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-100'}`}
                title={pushSub ? 'Disable notifications' : 'Enable notifications'}
              >
                {pushSub ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              </button>
            )}
            <button onClick={refresh} className="p-2 rounded-md text-gray-400 hover:bg-gray-100 transition-colors">
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        {/* Scrollable body */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          {tab === 'overview'  && <OverviewTab activeMachines={activeMachines} faultMachines={faultMachines} activeWorkers={activeWorkers} totalWorkers={workers.length} openOrders={openOrders} totalOrders={factoryOrders.length} unresolvedAlerts={unresolvedAlerts} avgEfficiency={avgEfficiency} machines={machines} systemEvents={systemEvents as any[]} />}
          {tab === 'orders'    && <OrdersTab orderTab={orderTab} setOrderTab={setOrderTab} orderFilter={orderFilter} setOrderFilter={setOrderFilter} factoryOrders={filteredFactoryOrders} procOrders={filteredProcOrders} updateFactory={updateFactoryOrder} updateProc={updateProcurementOrder} onRefresh={fetchAll} />}
          {tab === 'workforce' && <WorkforceTab workers={filteredWorkers} machines={machines} shiftFilter={shiftFilter} setShiftFilter={setShiftFilter} />}
          {tab === 'alerts'    && <AlertsTab alerts={filteredAlerts} filter={alertFilter} setFilter={setAlertFilter} onResolve={resolveAlert} />}
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 flex z-50">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 flex flex-col items-center py-2 gap-1 text-[10px] font-medium transition-colors relative ${
                tab === id ? 'text-blue-600' : 'text-gray-400'
              }`}
            >
              {id === 'alerts' && unresolvedAlerts > 0 && (
                <span className="absolute top-1 right-[22%] w-2 h-2 bg-red-500 rounded-full" />
              )}
              <Icon className="w-5 h-5" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Create Order Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)] rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">New Order</DialogTitle>
          </DialogHeader>

          <div className="flex rounded-md border border-gray-200 overflow-hidden text-sm mb-2">
            {(['factory', 'procurement'] as OrderTab[]).map(t => (
              <button key={t} onClick={() => setCreateType(t)}
                className={`flex-1 py-2 font-medium transition-colors ${createType === t ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                {t === 'factory' ? 'Factory Order' : 'Procurement'}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {createType === 'factory' ? (
              <>
                <FormField label="Factory Name"     value={factoryForm.factoryName} onChange={v => setFactoryForm(p => ({ ...p, factoryName: v }))} placeholder="Steel Works Ltd" />
                <FormField label="Area / Location"  value={factoryForm.area}        onChange={v => setFactoryForm(p => ({ ...p, area: v }))}        placeholder="Pune, Maharashtra" />
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Quantity"        type="number" value={factoryForm.quantity}    onChange={v => setFactoryForm(p => ({ ...p, quantity: v }))}    placeholder="100" />
                  <FormField label="Unit Price (₹)"  type="number" value={factoryForm.unitPrice}   onChange={v => setFactoryForm(p => ({ ...p, unitPrice: v }))}   placeholder="500" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Lead Time (days)" type="number" value={factoryForm.leadTimeDays} onChange={v => setFactoryForm(p => ({ ...p, leadTimeDays: v }))} placeholder="30" />
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">Payment</label>
                    <Select value={factoryForm.paymentStatus} onValueChange={v => setFactoryForm(p => ({ ...p, paymentStatus: v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="not-paid">Not Paid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {factoryForm.quantity && factoryForm.unitPrice && (
                  <p className="text-sm font-medium text-gray-700 bg-gray-50 rounded px-3 py-2">
                    Total: {fmtINR(Number(factoryForm.quantity) * Number(factoryForm.unitPrice))}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">Supplier</label>
                  <Select value={procForm.supplier} onValueChange={v => setProcForm(p => ({ ...p, supplier: v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      {suppliers.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                      <SelectItem value="__other__">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {procForm.supplier === '__other__' && (
                    <input className={INPUT_CLS} placeholder="Supplier name" onChange={e => setProcForm(p => ({ ...p, supplier: e.target.value }))} />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Part ID"   value={procForm.partId}   onChange={v => setProcForm(p => ({ ...p, partId: v }))}   placeholder="P-001" />
                  <FormField label="Material"  value={procForm.material} onChange={v => setProcForm(p => ({ ...p, material: v }))} placeholder="Steel" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Quantity"       type="number" value={procForm.quantity}  onChange={v => setProcForm(p => ({ ...p, quantity: v }))}  placeholder="50" />
                  <FormField label="Unit Price (₹)" type="number" value={procForm.unitPrice} onChange={v => setProcForm(p => ({ ...p, unitPrice: v }))} placeholder="200" />
                </div>
                <FormField label="Delivery ETA" type="date" value={procForm.deliveryEta} onChange={v => setProcForm(p => ({ ...p, deliveryEta: v }))} />
                {procForm.quantity && procForm.unitPrice && (
                  <p className="text-sm font-medium text-gray-700 bg-gray-50 rounded px-3 py-2">
                    Total: {fmtINR(Number(procForm.quantity) * Number(procForm.unitPrice))}
                  </p>
                )}
              </>
            )}
            <Button onClick={submitOrder} disabled={submitting} className="w-full h-9 bg-blue-600 hover:bg-blue-700 text-white">
              {submitting ? 'Creating…' : 'Create Order'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Shared input style ─────────────────────────────────────────────────────

const INPUT_CLS = 'w-full h-9 px-3 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white';

function FormField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <input className={INPUT_CLS} type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = ORDER_STATUS[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded ${cfg.cls}`}>{cfg.label}</span>;
}

// ── Overview Tab ───────────────────────────────────────────────────────────

function OverviewTab({ activeMachines, faultMachines, activeWorkers, totalWorkers, openOrders, totalOrders, unresolvedAlerts, avgEfficiency, machines, systemEvents }: any) {
  const machineBreakdown = ['active', 'idle', 'fault', 'maintenance'].map(s => ({
    s, count: machines.filter((m: any) => m.status === s).length,
  }));

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Machines Active',    value: activeMachines,   sub: `${faultMachines} fault`,   icon: HardDrive, warn: faultMachines > 0 },
          { label: 'Workers Active',     value: activeWorkers,    sub: `of ${totalWorkers} total`,  icon: Users,     warn: false },
          { label: 'Open Orders',        value: openOrders,       sub: `of ${totalOrders} total`,   icon: ShoppingCart, warn: false },
          { label: 'Unresolved Alerts',  value: unresolvedAlerts, sub: unresolvedAlerts > 0 ? 'Action required' : 'All clear', icon: Shield, warn: unresolvedAlerts > 0 },
        ].map(({ label, value, sub, icon: Icon, warn }) => (
          <div key={label} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <Icon className="w-4 h-4 text-gray-400" />
              {warn && <span className="text-xs font-medium text-red-600">{sub}</span>}
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{warn ? label : sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Machine health */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Machine Health</h2>
            <span className="text-sm font-semibold text-gray-900 flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-blue-500" />{avgEfficiency}% efficiency
            </span>
          </div>
          <div className="space-y-2">
            {machineBreakdown.map(({ s, count }) => (
              <div key={s} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${MACHINE_DOT[s]}`} />
                <span className="text-sm text-gray-600 capitalize w-24">{s}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${MACHINE_DOT[s]}`}
                    style={{ width: machines.length ? `${(count / machines.length) * 100}%` : '0%' }} />
                </div>
                <span className="text-sm font-medium text-gray-900 w-5 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent Activity</h2>
          {systemEvents.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No recent events</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {systemEvents.slice(0, 6).map((e: any) => (
                <div key={e.id} className="py-2 flex items-start gap-2.5">
                  <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                    e.severity === 'critical' ? 'bg-red-500' : e.severity === 'warning' ? 'bg-amber-400' : 'bg-blue-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 leading-snug">{e.message}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{timeAgo(e.timestamp)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Orders Tab ─────────────────────────────────────────────────────────────

function OrdersTab({ orderTab, setOrderTab, orderFilter, setOrderFilter, factoryOrders, procOrders, updateFactory, updateProc, onRefresh }: any) {
  const statuses = orderTab === 'factory' ? FACTORY_STATUSES : PROC_STATUSES;
  const list     = orderTab === 'factory' ? factoryOrders : procOrders;

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Sub-tabs */}
      <div className="flex border-b border-gray-200">
        {(['factory', 'procurement'] as OrderTab[]).map(t => (
          <button key={t} onClick={() => { setOrderTab(t); setOrderFilter('all'); }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              orderTab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            {t === 'factory' ? 'Factory Orders' : 'Procurement'}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 lg:mx-0 lg:px-0 lg:flex-wrap">
        {statuses.map(s => {
          const cfg = ORDER_STATUS[s];
          return (
            <button key={s} onClick={() => setOrderFilter(s)}
              className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
                orderFilter === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : `${cfg?.cls ?? 'bg-gray-100 text-gray-600'} border-transparent`
              }`}
            >
              {s === 'all' ? 'All' : (cfg?.label ?? s)}
            </button>
          );
        })}
      </div>

      {/* List */}
      {list.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center">
          <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No orders match this filter</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {list.map((o: any) =>
            orderTab === 'factory'
              ? <FactoryOrderRow key={o.id} order={o} onUpdate={async (u: any) => { await updateFactory(o.id, u); await onRefresh(); }} />
              : <ProcOrderRow    key={o.id} order={o} onUpdate={async (u: any) => { await updateProc(o.id, u); await onRefresh(); }} />
          )}
        </div>
      )}
    </div>
  );
}

function FactoryOrderRow({ order, onUpdate }: { order: FactoryOrder; onUpdate: (u: any) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left" onClick={() => setOpen(v => !v)}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{order.factoryName}</p>
          <p className="text-xs text-gray-500 mt-0.5">{order.area} · Qty {order.quantity} · {fmtINR(order.totalPrice)}</p>
        </div>
        <StatusBadge status={order.status} />
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 bg-gray-50 border-t border-gray-100">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs mb-3">
            <InfoPair label="Order ID"    value={order.id} />
            <InfoPair label="Lead Time"   value={`${order.leadTimeDays} days`} />
            <InfoPair label="Unit Price"  value={fmtINR(order.unitPrice)} />
            <InfoPair label="Payment"     value={order.paymentStatus ?? 'pending'} />
            <InfoPair label="Created"     value={fmtDate(order.createdAt)} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 shrink-0">Change status:</span>
            <Select value={order.status} onValueChange={v => onUpdate({ status: v })}>
              <SelectTrigger className="h-7 text-xs w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FACTORY_STATUSES.slice(1).map(s => <SelectItem key={s} value={s} className="text-xs">{ORDER_STATUS[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </>
  );
}

function ProcOrderRow({ order, onUpdate }: { order: ProcurementOrder; onUpdate: (u: any) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left" onClick={() => setOpen(v => !v)}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{order.supplier}</p>
          <p className="text-xs text-gray-500 mt-0.5">{order.material} · Part {order.partId} · Qty {order.quantity}</p>
        </div>
        <StatusBadge status={order.status} />
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 bg-gray-50 border-t border-gray-100">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs mb-3">
            <InfoPair label="Order ID"   value={order.id} />
            <InfoPair label="Unit Price" value={fmtINR((order as any).unitPrice ?? 0)} />
            <InfoPair label="Total"      value={fmtINR((order as any).totalPrice ?? 0)} />
            <InfoPair label="ETA"        value={fmtDate(order.deliveryEta)} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 shrink-0">Change status:</span>
            <Select value={order.status} onValueChange={v => onUpdate({ status: v })}>
              <SelectTrigger className="h-7 text-xs w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROC_STATUSES.slice(1).map(s => <SelectItem key={s} value={s} className="text-xs">{ORDER_STATUS[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </>
  );
}

// ── Workforce Tab ──────────────────────────────────────────────────────────

function WorkforceTab({ workers, machines, shiftFilter, setShiftFilter }: any) {
  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Shift summary */}
      <div className="grid grid-cols-3 gap-3">
        {SHIFTS.slice(1).map(s => {
          const count = workers.filter((w: any) => (w as any).shift === s).length;
          return (
            <div key={s} className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <p className="text-xl font-bold text-gray-900">{count}</p>
              <p className="text-xs text-gray-500">{s} shift</p>
            </div>
          );
        })}
      </div>

      {/* Filter */}
      <div className="flex gap-1.5">
        {SHIFTS.map(s => (
          <button key={s} onClick={() => setShiftFilter(s)}
            className={`px-3 py-1.5 rounded border text-xs font-medium transition-colors ${
              shiftFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Worker list */}
      {workers.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center">
          <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No workers found</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {workers.map((w: any) => {
            const machine = machines.find((m: any) => m.id === w.machineId);
            const riskColor = w.riskIndex >= 70 ? 'text-red-600' : w.riskIndex >= 40 ? 'text-amber-600' : 'text-green-600';
            return (
              <div key={w.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-sm font-semibold text-gray-600">
                  {w.name?.charAt(0) ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{w.name}</p>
                  <p className="text-xs text-gray-500">{w.shift} · {machine?.name ?? 'Unassigned'}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${WORKER_STATUS_CLS[w.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {w.status?.replace('-', ' ') ?? 'active'}
                </span>
                <div className="text-right shrink-0 w-12">
                  <p className={`text-sm font-bold ${riskColor}`}>{w.riskIndex}%</p>
                  <p className="text-xs text-gray-400">risk</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Alerts Tab ─────────────────────────────────────────────────────────────

function AlertsTab({ alerts, filter, setFilter, onResolve }: any) {
  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex gap-1.5">
        {(['all', 'unresolved', 'critical'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded border text-xs font-medium capitalize transition-colors ${
              filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {alerts.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center">
          <Shield className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No alerts</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {alerts.map((a: any) => {
            const sev = a.severity ?? a.type ?? 'low';
            return (
              <div key={a.id} className={`flex items-start gap-3 px-4 py-3 ${a.resolved ? 'opacity-50' : ''}`}>
                <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${sev === 'critical' || sev === 'high' ? 'text-red-500' : sev === 'medium' ? 'text-amber-500' : 'text-green-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${SEVERITY_CLS[sev] ?? 'bg-gray-100 text-gray-600'}`}>
                      {sev.toUpperCase()}
                    </span>
                    {a.resolved && (
                      <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                        <Check className="w-3 h-3" /> Resolved
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-800">{a.message}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {a.machineId && `${a.machineId} · `}{timeAgo(a.timestamp)}
                  </p>
                </div>
                {!a.resolved && (
                  <Button size="sm" variant="outline" onClick={() => onResolve(a.id)}
                    className="shrink-0 h-7 text-xs text-green-700 border-green-200 hover:bg-green-50"
                  >
                    Resolve
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Shared ─────────────────────────────────────────────────────────────────

function InfoPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-gray-400 text-[10px] uppercase tracking-wide">{label}</p>
      <p className="text-gray-700 font-medium truncate">{value}</p>
    </div>
  );
}
