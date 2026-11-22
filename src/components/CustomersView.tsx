import React, { useMemo, useState } from 'react';
import { Edit2, Mail, MapPin, Phone, Plus, Receipt, Search, Trash2, X } from 'lucide-react';
import { BusinessSettings, Customer, Order, Sale } from '../types';
import { formatCurrency, formatDate } from '../utils/format';

interface CustomersViewProps {
  settings: BusinessSettings;
  customers: Customer[];
  orders: Order[];
  sales: Sale[];
  isCreateOpen: boolean;
  onOpenCreate: () => void;
  onCloseCreate: () => void;
  onSaveCustomer: (payload: Partial<Customer>, id?: number) => Promise<void>;
  onDeleteCustomer: (id: number) => Promise<void>;
  onViewReceipt: (sale: Sale) => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  settings,
  customers,
  orders,
  sales,
  isCreateOpen,
  onOpenCreate,
  onCloseCreate,
  onSaveCustomer,
  onDeleteCustomer,
  onViewReceipt,
}) => {
  const currency = settings.currency || 'UGX';
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const [editing, setEditing] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const openNew = () => {
    setEditing(null);
    setName('');
    setPhone('');
    setEmail('');
    setLocation('');
    setNotes('');
    onOpenCreate();
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setName(c.name);
    setPhone(c.phone);
    setEmail(c.email);
    setLocation(c.location);
    setNotes(c.notes);
    onOpenCreate();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveCustomer(
        {
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          location: location.trim(),
          notes: notes.trim(),
        },
        editing?.id
      );
      setEditing(null);
      onCloseCreate();
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.location.toLowerCase().includes(q)
    );
  }, [customers, search]);

  const customerOrders = useMemo(() => {
    if (!selectedCustomer) return [];
    return orders.filter(
      (o) =>
        o.customer_id === selectedCustomer.id ||
        o.customer_name.toLowerCase() === selectedCustomer.name.toLowerCase()
    );
  }, [orders, selectedCustomer]);

  const customerSales = useMemo(() => {
    if (!selectedCustomer) return [];
    return sales.filter(
      (s) =>
        s.customer_id === selectedCustomer.id ||
        s.customer_name.toLowerCase() === selectedCustomer.name.toLowerCase()
    );
  }, [sales, selectedCustomer]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Customer Database</h2>
          <p className="text-sm text-slate-500">
            Manage client contacts, order history, total spend, and outstanding balances
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="h-10 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 text-[#C89B3C]" />
          Add Customer
        </button>
      </div>

      {/* Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name, phone, email, or location..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 text-sm"
          />
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No customers found. Add your first customer to start tracking history.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4">Phone &amp; Email</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4 text-right">Orders / Sales</th>
                  <th className="py-3 px-4 text-right">Total Spent</th>
                  <th className="py-3 px-4 text-right">Outstanding</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => setSelectedCustomer(c)}
                  >
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{c.name}</p>
                      {c.notes && (
                        <p className="text-xs text-slate-500 truncate max-w-xs">{c.notes}</p>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-xs font-mono text-slate-700">{c.phone || '—'}</p>
                      <p className="text-xs text-slate-500">{c.email || '—'}</p>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">{c.location || '—'}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700">
                      {c.order_count || 0} orders · {c.sale_count || 0} sales
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      {formatCurrency(c.total_spent || 0, currency)}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                        (c.outstanding_balance || 0) > 0 ? 'text-red-600' : 'text-slate-400'
                      }`}
                    >
                      {formatCurrency(c.outstanding_balance || 0, currency)}
                    </td>
                    <td
                      className="py-3 px-4 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedCustomer(c)}
                          className="h-8 px-2.5 rounded-md border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer"
                        >
                          History
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          aria-label="Edit customer"
                          className="h-8 w-8 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-500 inline-flex items-center justify-center cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(c.id)}
                          aria-label="Delete customer"
                          className="h-8 w-8 rounded-md border border-slate-200 hover:bg-red-50 hover:border-red-200 text-slate-400 hover:text-red-600 inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Customer Profile & Order History Drawer */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex justify-end">
          <div className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
            <div className="bg-[#0B1D3A] px-6 py-5 text-white flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">{selectedCustomer.name}</h3>
                <div className="mt-1.5 space-y-1 text-xs text-slate-300">
                  {selectedCustomer.phone && (
                    <p className="flex items-center gap-1.5 font-mono">
                      <Phone className="w-3.5 h-3.5 text-[#C89B3C]" />
                      {selectedCustomer.phone}
                    </p>
                  )}
                  {selectedCustomer.email && (
                    <p className="flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-[#C89B3C]" />
                      {selectedCustomer.email}
                    </p>
                  )}
                  {selectedCustomer.location && (
                    <p className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#C89B3C]" />
                      {selectedCustomer.location}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 flex-1">
              <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs font-sans text-slate-500">Total Amount Spent</p>
                  <p className="text-base font-bold text-slate-900 mt-1">
                    {formatCurrency(selectedCustomer.total_spent || 0, currency)}
                  </p>
                </div>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs font-sans text-slate-500">Outstanding Balance</p>
                  <p
                    className={`text-base font-bold mt-1 ${
                      (selectedCustomer.outstanding_balance || 0) > 0
                        ? 'text-red-600'
                        : 'text-emerald-700'
                    }`}
                  >
                    {formatCurrency(selectedCustomer.outstanding_balance || 0, currency)}
                  </p>
                </div>
              </div>

              {selectedCustomer.notes && (
                <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-lg">
                  <p className="text-xs font-semibold text-slate-800">Customer Notes</p>
                  <p className="text-sm text-slate-700 mt-1">{selectedCustomer.notes}</p>
                </div>
              )}

              <div>
                <h4 className="text-sm font-bold text-slate-900 mb-2.5">
                  Sales &amp; Receipts ({customerSales.length})
                </h4>
                {customerSales.length === 0 ? (
                  <p className="text-xs text-slate-500">No sales recorded for this customer yet.</p>
                ) : (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {customerSales.map((s) => (
                      <div key={s.id} className="p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-mono font-bold text-[#0B1D3A]">
                            {s.receipt_number} · {formatDate(s.sale_date)}
                          </p>
                          <p className="text-xs text-slate-600 truncate mt-0.5">
                            {s.items.map((i) => `${i.product_name} (${i.quantity})`).join(', ')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0">
                          <div className="text-right font-mono tabular-nums text-xs">
                            <p className="font-bold text-slate-900">
                              {formatCurrency(s.total_amount, currency)}
                            </p>
                            {s.balance_due > 0 && (
                              <p className="text-red-600">
                                Bal: {formatCurrency(s.balance_due, currency)}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => onViewReceipt(s)}
                            className="h-8 px-2.5 rounded-md border border-slate-200 hover:bg-slate-50 text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Receipt className="w-3.5 h-3.5" />
                            View
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-900 mb-2.5">
                  Order History ({customerOrders.length})
                </h4>
                {customerOrders.length === 0 ? (
                  <p className="text-xs text-slate-500">No job orders recorded for this customer yet.</p>
                ) : (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {customerOrders.map((o) => (
                      <div key={o.id} className="p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-mono font-bold text-slate-900">
                            {o.order_number} · {o.status}
                          </p>
                          <p className="text-sm font-medium text-slate-800 truncate">{o.title}</p>
                          {o.deadline && (
                            <p className="text-[11px] text-slate-500">
                              Deadline: {formatDate(o.deadline)}
                            </p>
                          )}
                        </div>
                        <div className="text-right font-mono tabular-nums text-xs shrink-0">
                          <p className="font-bold text-slate-900">
                            {formatCurrency(o.total_amount, currency)}
                          </p>
                          <p className="text-slate-500">Qty: {o.quantity}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Customer Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden my-auto"
          >
            <div className="bg-[#0B1D3A] px-5 py-4 text-white flex items-center justify-between">
              <h3 className="text-base font-bold">
                {editing ? 'Edit Customer' : 'Add New Customer'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  onCloseCreate();
                }}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer / Business Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Pearl Roasters Coffee Co."
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+256 7XX XXX XXX"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="client@company.ug"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Kololo, Kampala"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer Notes
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Preferences, payment habits, branding notes..."
                  className="w-full p-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    onCloseCreate();
                  }}
                  className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-10 px-5 rounded-lg bg-[#0B1D3A] text-white text-sm font-semibold cursor-pointer"
                >
                  {saving ? 'Saving...' : editing ? 'Update Customer' : 'Save Customer'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Delete Customer?</h3>
            <p className="text-sm text-slate-600">
              Historical sales receipts will keep the customer name, while the directory profile is deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="h-9 px-4 rounded-lg border border-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onDeleteCustomer(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="h-9 px-4 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
