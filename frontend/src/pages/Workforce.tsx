import { Layout } from '@/components/layout/Layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useApiStore, type Worker } from '@/store/useApiStore';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, UserCheck, Coffee, AlertTriangle, Plus, Search, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';

const SHIFTS = ['Morning', 'Afternoon', 'Night'] as const;

const emptyForm = {
  name: '',
  shift: 'Morning' as Worker['shift'],
  department: 'Production',
  experience: 1,
  status: 'active' as Worker['status'],
  machineId: '',
  riskIndex: 25,
};

const Workforce = () => {
  const { workers, machines, fetchWorkers, fetchMachines, createWorker, updateWorker, deleteWorker } = useApiStore();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchWorkers();
    fetchMachines();
  }, [fetchWorkers, fetchMachines]);

  const activeWorkers = workers.filter((w) => w.status === 'active').length;
  const onBreak = workers.filter((w) => w.status === 'on-break').length;
  const avgRisk = workers.length
    ? Math.round(workers.reduce((acc, w) => acc + w.riskIndex, 0) / workers.length)
    : 0;

  const filtered = useMemo(
    () =>
      workers.filter(
        (w) =>
          w.name.toLowerCase().includes(search.toLowerCase()) ||
          w.id.toLowerCase().includes(search.toLowerCase()) ||
          w.shift.toLowerCase().includes(search.toLowerCase()),
      ),
    [workers, search],
  );

  function openAdd() {
    setForm({ ...emptyForm });
    setShowAdd(true);
  }

  function openEdit(worker: Worker) {
    setEditingWorker(worker);
    setForm({
      name: worker.name,
      shift: worker.shift,
      department: (worker as any).department || 'Production',
      experience: (worker as any).experience || 1,
      status: worker.status,
      machineId: worker.machineId || '',
      riskIndex: worker.riskIndex,
    });
  }

  async function handleAdd() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await createWorker({
        name: form.name.trim(),
        shift: form.shift,
        status: 'active',
        machineId: form.machineId || undefined,
        riskIndex: form.riskIndex,
        ...(form.department && { department: form.department }),
        ...(form.experience && { experience: form.experience }),
      } as any);
      toast({ title: 'Worker added', description: `${form.name} has been added to the workforce.` });
      setShowAdd(false);
    } catch {
      toast({ title: 'Failed to add worker', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!editingWorker || !form.name.trim()) return;
    setSaving(true);
    try {
      await updateWorker(editingWorker.id, {
        name: form.name.trim(),
        shift: form.shift,
        status: form.status,
        machineId: form.machineId || undefined,
        riskIndex: form.riskIndex,
      } as any);
      toast({ title: 'Worker updated', description: `${form.name} has been updated.` });
      setEditingWorker(null);
    } catch {
      toast({ title: 'Failed to update worker', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingId) return;
    try {
      await deleteWorker(deletingId);
      toast({ title: 'Worker removed' });
    } catch {
      toast({ title: 'Failed to remove worker', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  }

  const getRiskColor = (risk: number) => {
    if (risk < 30) return 'bg-success';
    if (risk < 60) return 'bg-warning';
    return 'bg-destructive';
  };

  const getRiskLabel = (risk: number) => {
    if (risk < 30) return 'Low';
    if (risk < 60) return 'Medium';
    return 'High';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="default">Active</Badge>;
      case 'on-break': return <Badge variant="secondary">On Break</Badge>;
      case 'reassigned': return <Badge variant="outline">Reassigned</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-6 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">Workforce Management</h1>
            <p className="text-muted-foreground">Worker assignments, safety profiles, and shift management</p>
          </div>
          <Button onClick={openAdd} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Worker
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="glass p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Total Workers</p>
                <h3 className="text-3xl font-bold">{workers.length}</h3>
              </div>
              <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Users className="w-6 h-6" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">All shifts combined</p>
          </Card>

          <Card className="glass p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Active Workers</p>
                <h3 className="text-3xl font-bold">{activeWorkers}</h3>
              </div>
              <div className="w-12 h-12 rounded-lg bg-success/10 text-success flex items-center justify-center">
                <UserCheck className="w-6 h-6" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {workers.length ? ((activeWorkers / workers.length) * 100).toFixed(0) : 0}% utilization
            </p>
          </Card>

          <Card className="glass p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">On Break</p>
                <h3 className="text-3xl font-bold">{onBreak}</h3>
              </div>
              <div className="w-12 h-12 rounded-lg bg-warning/10 text-warning flex items-center justify-center">
                <Coffee className="w-6 h-6" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Scheduled breaks</p>
          </Card>

          <Card className="glass p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Avg Risk Index</p>
                <h3 className="text-3xl font-bold">{avgRisk}</h3>
              </div>
              <div className={`w-12 h-12 rounded-lg ${avgRisk > 50 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'} flex items-center justify-center`}>
                <AlertTriangle className="w-6 h-6" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{getRiskLabel(avgRisk)} overall risk</p>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card className="glass p-6">
            <h3 className="text-lg font-semibold mb-6">Worker Safety Profile</h3>
            <div className="space-y-4">
              {workers.slice(0, 5).map((worker) => (
                <div key={worker.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{worker.name}</p>
                      <p className="text-xs text-muted-foreground">{worker.id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{worker.riskIndex}</span>
                      <Badge variant={worker.riskIndex > 50 ? 'destructive' : 'secondary'}>
                        {getRiskLabel(worker.riskIndex)}
                      </Badge>
                    </div>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full transition-all ${getRiskColor(worker.riskIndex)}`}
                      style={{ width: `${worker.riskIndex}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="glass p-6">
            <h3 className="text-lg font-semibold mb-6">Machine Allocation</h3>
            <div className="space-y-3">
              {machines.slice(0, 5).map((machine) => {
                const worker = workers.find((w) => w.id === machine.workerId);
                return (
                  <div key={machine.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20">
                    <div>
                      <p className="text-sm font-medium">{machine.name}</p>
                      <p className="text-xs text-muted-foreground">{machine.id}</p>
                    </div>
                    <div className="text-right">
                      {worker ? (
                        <>
                          <p className="text-sm font-medium">{worker.name}</p>
                          <p className="text-xs text-muted-foreground">{worker.shift} shift</p>
                        </>
                      ) : (
                        <Badge variant="outline">Unassigned</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <Card className="glass p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Worker List</h3>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead>Risk Index</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    {search ? 'No workers match your search.' : 'No workers found.'}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((worker) => (
                <TableRow key={worker.id}>
                  <TableCell className="font-medium font-mono text-xs">{worker.id}</TableCell>
                  <TableCell>{worker.name}</TableCell>
                  <TableCell>{getStatusBadge(worker.status)}</TableCell>
                  <TableCell className="text-muted-foreground">{worker.machineId || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${getRiskColor(worker.riskIndex)}`} />
                      <span>{worker.riskIndex}</span>
                      <span className="text-xs text-muted-foreground">({getRiskLabel(worker.riskIndex)})</span>
                    </div>
                  </TableCell>
                  <TableCell>{worker.shift}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(worker)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeletingId(worker.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Add Worker Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Worker</DialogTitle>
            <DialogDescription>Fill in the details to onboard a new worker.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Full Name *</Label>
              <Input placeholder="e.g. Rajesh Kumar" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Shift</Label>
                <Select value={form.shift} onValueChange={(v) => setForm({ ...form, shift: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Input placeholder="Production" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Experience (years)</Label>
                <Input type="number" min={0} max={40} value={form.experience} onChange={(e) => setForm({ ...form, experience: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Assign to Machine (optional)</Label>
                <Select value={form.machineId || 'none'} onValueChange={(v) => setForm({ ...form, machineId: v === 'none' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {machines.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Risk Index: {form.riskIndex}</Label>
              <input
                type="range" min={0} max={100} value={form.riskIndex}
                onChange={(e) => setForm({ ...form, riskIndex: Number(e.target.value) })}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Low (0)</span><span>Medium (60)</span><span>High (100)</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={saving || !form.name.trim()}>
                {saving ? 'Adding...' : 'Add Worker'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Worker Dialog */}
      <Dialog open={!!editingWorker} onOpenChange={(open) => !open && setEditingWorker(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Worker</DialogTitle>
            <DialogDescription>Update details for {editingWorker?.name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Full Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="on-break">On Break</SelectItem>
                    <SelectItem value="reassigned">Reassigned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Shift</Label>
                <Select value={form.shift} onValueChange={(v) => setForm({ ...form, shift: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Assigned Machine</Label>
              <Select value={form.machineId || 'none'} onValueChange={(v) => setForm({ ...form, machineId: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {machines.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.status})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Risk Index: {form.riskIndex}</Label>
              <input
                type="range" min={0} max={100} value={form.riskIndex}
                onChange={(e) => setForm({ ...form, riskIndex: Number(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditingWorker(null)}>Cancel</Button>
              <Button onClick={handleEdit} disabled={saving || !form.name.trim()}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove worker?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the worker record. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
};

export default Workforce;
