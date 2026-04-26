import { Layout } from '@/components/layout/Layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useNavigate } from 'react-router-dom';
import { useApiStore } from '@/store/useApiStore';
import { useEffect, useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Package, TrendingUp, AlertCircle, Plus, Search, Trash2 } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { useToast } from '@/hooks/use-toast';

const STATUS_OPTIONS = ['pending', 'in-transit', 'delivered', 'cancelled'] as const;

const emptyForm = {
  supplier: '',
  partId: '',
  material: '',
  quantity: 1,
  unitPrice: 0,
  deliveryEta: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
};

const Procurement = () => {
  const { procurementOrders, fetchProcurementOrders, createProcurementOrder, updateProcurementOrder, deleteProcurementOrder, loading } = useApiStore();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProcurementOrders();
  }, [fetchProcurementOrders]);

  const allDelivered = procurementOrders.length > 0 && procurementOrders.every((o) => o.status === 'delivered');

  const filtered = useMemo(
    () =>
      procurementOrders.filter(
        (o) =>
          o.supplier.toLowerCase().includes(search.toLowerCase()) ||
          o.partId.toLowerCase().includes(search.toLowerCase()) ||
          o.material.toLowerCase().includes(search.toLowerCase()) ||
          o.id.toLowerCase().includes(search.toLowerCase()),
      ),
    [procurementOrders, search],
  );

  const qualityData = [
    { name: 'Passed', value: 847 },
    { name: 'Failed', value: 23 },
  ];

  const COLORS = ['hsl(var(--success))', 'hsl(var(--destructive))'];

  const QualityTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    const entry = payload[0];
    return (
      <div className="rounded-md border bg-popover p-3 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <div className="font-medium">{entry?.name ?? label}</div>
          {entry?.percent != null && (
            <div className="text-xs text-muted-foreground">{(entry.percent * 100).toFixed(1)}%</div>
          )}
        </div>
        <div className="text-sm">Count: <span className="font-medium">{entry?.value ?? 0}</span></div>
      </div>
    );
  };

  async function handleAdd() {
    if (!form.supplier.trim() || !form.material.trim() || !form.partId.trim()) return;
    setSaving(true);
    try {
      await createProcurementOrder({
        supplier: form.supplier.trim(),
        partId: form.partId.trim(),
        material: form.material.trim(),
        quantity: Number(form.quantity),
        unitPrice: Number(form.unitPrice),
        totalPrice: Number(form.quantity) * Number(form.unitPrice),
        deliveryEta: new Date(form.deliveryEta),
        status: 'pending',
      } as any);
      toast({ title: 'Order created', description: `Procurement order from ${form.supplier} created.` });
      setShowAdd(false);
      setForm({ ...emptyForm });
    } catch {
      toast({ title: 'Failed to create order', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await updateProcurementOrder(id, { status: status as any });
      toast({ title: 'Status updated', description: `Order status set to ${status}.` });
    } catch {
      toast({ title: 'Failed to update status', variant: 'destructive' });
    }
  }

  async function handleDelete() {
    if (!deletingId) return;
    try {
      await deleteProcurementOrder(deletingId);
      toast({ title: 'Order deleted' });
    } catch {
      toast({ title: 'Failed to delete order', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'delivered': return <Badge variant="default">Delivered</Badge>;
      case 'in-transit': return <Badge variant="secondary">In Transit</Badge>;
      case 'pending': return <Badge variant="outline">Pending</Badge>;
      case 'cancelled': return <Badge variant="destructive">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPaymentBadge = (status: string) => {
    if (status === 'delivered') return <Badge className="bg-success text-success-foreground">Paid</Badge>;
    if (status === 'cancelled') return <Badge variant="destructive">Void</Badge>;
    return <Badge variant="outline">Pending</Badge>;
  };

  return (
    <Layout>
      <div className="container mx-auto px-6 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">Procurement & Quality</h1>
            <p className="text-muted-foreground">Material automation and inspection analytics</p>
          </div>
          <Button onClick={() => setShowAdd(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Order
          </Button>
        </div>

        {allDelivered && (
          <Card className="glass p-4 mb-8 border-success/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-success animate-pulse" />
                <div className="flex items-center gap-2">
                  <Badge className="bg-success text-success-foreground hover:bg-success">Received</Badge>
                  <span className="text-sm text-muted-foreground">All procurement orders have been delivered.</span>
                </div>
              </div>
              <Button onClick={() => navigate('/factory-options')} className="bg-primary text-primary-foreground hover:bg-primary/90">
                Choose Factory
              </Button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card className="glass p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Total Orders</p>
                <h3 className="text-3xl font-bold">{procurementOrders.length}</h3>
              </div>
              <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Package className="w-6 h-6" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {procurementOrders.filter((o) => o.status === 'in-transit').length} in transit
            </p>
          </Card>

          <Card className="glass p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Pass Rate</p>
                <h3 className="text-3xl font-bold">97.4%</h3>
              </div>
              <div className="w-12 h-12 rounded-lg bg-success/10 text-success flex items-center justify-center">
                <TrendingUp className="w-6 h-6" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">+2.3% from last week</p>
          </Card>

          <Card className="glass p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Defects</p>
                <h3 className="text-3xl font-bold">23</h3>
              </div>
              <div className="w-12 h-12 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center">
                <AlertCircle className="w-6 h-6" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">-12 from last week</p>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card className="glass p-6">
            <h3 className="text-lg font-semibold mb-6">Quality Inspection Summary</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={qualityData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                  outerRadius={100}
                  dataKey="value"
                >
                  {qualityData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<QualityTooltip />} wrapperStyle={{ outline: 'none' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card className="glass p-6">
            <h3 className="text-lg font-semibold mb-6">Recent Activity</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-success/5 border-l-4 border-success">
                <TrendingUp className="w-5 h-5 text-success mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Batch #B-4521 passed inspection</p>
                  <p className="text-xs text-muted-foreground">2 minutes ago</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border-l-4 border-primary">
                <Package className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="text-sm font-medium">New order from Steel Corp received</p>
                  <p className="text-xs text-muted-foreground">15 minutes ago</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-warning/5 border-l-4 border-warning">
                <AlertCircle className="w-5 h-5 text-warning mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Minor defect detected in batch #B-4519</p>
                  <p className="text-xs text-muted-foreground">1 hour ago</p>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <Card className="glass p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Procurement Orders</h3>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search supplier, material..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Part ID</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Delivery ETA</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                    {search ? 'No orders match your search.' : 'No procurement orders yet.'}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium font-mono text-xs">{order.id}</TableCell>
                  <TableCell>{order.supplier}</TableCell>
                  <TableCell className="text-muted-foreground">{order.partId}</TableCell>
                  <TableCell>{order.material}</TableCell>
                  <TableCell>{order.quantity}</TableCell>
                  <TableCell>{format(new Date(order.deliveryEta), 'MMM dd, yyyy')}</TableCell>
                  <TableCell>{getPaymentBadge(order.status)}</TableCell>
                  <TableCell>
                    <Select value={order.status} onValueChange={(v) => handleStatusChange(order.id, v)}>
                      <SelectTrigger className="h-7 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeletingId(order.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* New Order Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Procurement Order</DialogTitle>
            <DialogDescription>Enter the details for the new material order.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label>Supplier *</Label>
                <Input placeholder="e.g. Steel Corp India" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Part ID *</Label>
                <Input placeholder="e.g. PART-001" value={form.partId} onChange={(e) => setForm({ ...form, partId: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Material *</Label>
                <Input placeholder="e.g. Steel Rods" value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Unit Price (₹)</Label>
                <Input type="number" min={0} step={0.01} value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Delivery ETA</Label>
                <Input type="date" value={form.deliveryEta} onChange={(e) => setForm({ ...form, deliveryEta: e.target.value })} />
              </div>
            </div>
            {form.quantity > 0 && form.unitPrice > 0 && (
              <div className="rounded-lg bg-muted/40 px-4 py-2 text-sm">
                Total: <span className="font-semibold">₹{(form.quantity * form.unitPrice).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={saving || !form.supplier.trim() || !form.material.trim() || !form.partId.trim()}>
                {saving ? 'Creating...' : 'Create Order'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete order?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this procurement order. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
};

export default Procurement;
