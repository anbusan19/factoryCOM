import { Layout } from '@/components/layout/Layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApiStore, type Supplier } from '@/store/useApiStore';
import { useEffect, useState, useMemo } from 'react';
import { Building2, Star, Package, Search, Plus, Pencil, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const CATEGORIES = ['Raw Material', 'Components', 'Tools', 'Services', 'Packaging'] as const;

const emptyForm: Omit<Supplier, 'id'> = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  category: 'Raw Material',
  rating: 3,
  address: '',
  status: 'active',
};

function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          className={`transition-colors ${onChange ? 'cursor-pointer hover:scale-110' : 'cursor-default'} ${n <= value ? 'text-yellow-400' : 'text-gray-300'}`}
        >
          <Star className="w-4 h-4 fill-current" />
        </button>
      ))}
    </div>
  );
}

const Suppliers = () => {
  const { suppliers, fetchSuppliers, createSupplier, updateSupplier, deleteSupplier, procurementOrders, fetchProcurementOrders } = useApiStore();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Supplier, 'id'>>({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSuppliers();
    fetchProcurementOrders();
  }, [fetchSuppliers, fetchProcurementOrders]);

  const filtered = useMemo(
    () =>
      suppliers.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.category.toLowerCase().includes(search.toLowerCase()) ||
          s.contactName.toLowerCase().includes(search.toLowerCase()),
      ),
    [suppliers, search],
  );

  const activeCount = suppliers.filter((s) => s.status === 'active').length;
  const avgRating = suppliers.length
    ? (suppliers.reduce((acc, s) => acc + s.rating, 0) / suppliers.length).toFixed(1)
    : '—';

  const categoryBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of suppliers) counts[s.category] = (counts[s.category] || 0) + 1;
    return counts;
  }, [suppliers]);

  function getOrderCount(supplierName: string) {
    return procurementOrders.filter((o) => o.supplier === supplierName).length;
  }

  function openAdd() {
    setForm({ ...emptyForm });
    setShowAdd(true);
  }

  function openEdit(s: Supplier) {
    setEditingSupplier(s);
    setForm({ name: s.name, contactName: s.contactName, email: s.email, phone: s.phone, category: s.category, rating: s.rating, address: s.address, status: s.status });
  }

  async function handleAdd() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await createSupplier({ ...form, name: form.name.trim() });
      toast({ title: 'Supplier added', description: `${form.name} has been added.` });
      setShowAdd(false);
    } catch {
      toast({ title: 'Failed to add supplier', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!editingSupplier || !form.name.trim()) return;
    setSaving(true);
    try {
      await updateSupplier(editingSupplier.id, { ...form, name: form.name.trim() });
      toast({ title: 'Supplier updated' });
      setEditingSupplier(null);
    } catch {
      toast({ title: 'Failed to update supplier', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingId) return;
    try {
      await deleteSupplier(deletingId);
      toast({ title: 'Supplier removed' });
    } catch {
      toast({ title: 'Failed to remove supplier', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  }

  const FormFields = () => (
    <div className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label>Company Name *</Label>
        <Input placeholder="e.g. Steel Corp India" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Contact Person</Label>
          <Input placeholder="e.g. Rahul Sharma" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" placeholder="contact@supplier.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Phone</Label>
          <Input placeholder="+91 98765 43210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Address</Label>
        <Input placeholder="City, State" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Rating</Label>
          <StarRating value={form.rating} onChange={(v) => setForm({ ...form, rating: v })} />
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  return (
    <Layout>
      <div className="container mx-auto px-6 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">Supplier Management</h1>
            <p className="text-muted-foreground">Manage vendor relationships and procurement partners</p>
          </div>
          <Button onClick={openAdd} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Supplier
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="glass p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Total Suppliers</p>
                <h3 className="text-3xl font-bold">{suppliers.length}</h3>
              </div>
              <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Building2 className="w-6 h-6" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{activeCount} active partners</p>
          </Card>

          <Card className="glass p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Avg Rating</p>
                <h3 className="text-3xl font-bold">{avgRating}</h3>
              </div>
              <div className="w-12 h-12 rounded-lg bg-yellow-400/10 text-yellow-500 flex items-center justify-center">
                <Star className="w-6 h-6 fill-current" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Out of 5.0</p>
          </Card>

          <Card className="glass p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Total Orders</p>
                <h3 className="text-3xl font-bold">{procurementOrders.length}</h3>
              </div>
              <div className="w-12 h-12 rounded-lg bg-success/10 text-success flex items-center justify-center">
                <Package className="w-6 h-6" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Across all suppliers</p>
          </Card>

          <Card className="glass p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Categories</p>
                <h3 className="text-3xl font-bold">{Object.keys(categoryBreakdown).length}</h3>
              </div>
              <div className="w-12 h-12 rounded-lg bg-info/10 text-info flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Procurement categories</p>
          </Card>
        </div>

        {Object.keys(categoryBreakdown).length > 0 && (
          <Card className="glass p-6 mb-6">
            <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Category Breakdown</h3>
            <div className="flex flex-wrap gap-3">
              {Object.entries(categoryBreakdown).map(([cat, count]) => (
                <div key={cat} className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2">
                  <span className="text-sm font-medium">{cat}</span>
                  <Badge variant="secondary">{count}</Badge>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="glass p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Supplier Directory</h3>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search suppliers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Building2 className="w-10 h-10 opacity-30" />
              <p className="text-sm">{search ? 'No suppliers match your search.' : 'No suppliers added yet.'}</p>
              {!search && (
                <Button variant="outline" size="sm" onClick={openAdd} className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  Add your first supplier
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{s.name}</p>
                        {s.address && <p className="text-xs text-muted-foreground">{s.address}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        {s.contactName && <p className="text-sm">{s.contactName}</p>}
                        {s.email && <p className="text-xs text-muted-foreground">{s.email}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{s.category}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">{getOrderCount(s.name)}</span>
                    </TableCell>
                    <TableCell>
                      <StarRating value={s.rating} />
                    </TableCell>
                    <TableCell>
                      {s.status === 'active' ? (
                        <div className="flex items-center gap-1.5 text-success text-sm">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Active
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
                          <XCircle className="w-3.5 h-3.5" /> Inactive
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeletingId(s.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      {/* Add Supplier Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Supplier</DialogTitle>
            <DialogDescription>Register a new supplier in the procurement network.</DialogDescription>
          </DialogHeader>
          <FormFields />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving || !form.name.trim()}>
              {saving ? 'Adding...' : 'Add Supplier'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Supplier Dialog */}
      <Dialog open={!!editingSupplier} onOpenChange={(open) => !open && setEditingSupplier(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Supplier</DialogTitle>
            <DialogDescription>Update supplier details for {editingSupplier?.name}.</DialogDescription>
          </DialogHeader>
          <FormFields />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditingSupplier(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the supplier record. Existing procurement orders will not be affected.
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

export default Suppliers;
