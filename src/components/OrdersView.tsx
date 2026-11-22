import React, { useMemo, useState } from 'react';
import { CalendarClock, Edit2, Plus, Receipt, Search, Trash2, X } from 'lucide-react';
import { BusinessSettings, Customer, Order, OrderStatus } from '../types';
import { formatCurrency, formatDate, todayIsoDate } from '../utils/format';

interface OrdersViewProps {
  settings: BusinessSettings;
  orders: Order[];
  customers: Customer[];
  isCreateOpen: boolean;
  onOpenCreate: () => void;
  onCloseCreate: () => void;
  onSaveOrder: (payload: Partial<Order>, id?: number) => Promise<void>;
  onDeleteOrder: (id: number) => Promise<void>;
  onConvertOrderToSale: (order: Order) => Promise<void>;
}

const ORDER_STATUSES: OrderStatus[] = [
  'New Order',
  'Awaiting Deposit',
  'In Production',
  'Ready for Collection',
  'Delivered',
  'Completed',
  'Cancelled',
];

function getStatusTextClass(status: OrderStatus): string {
  switch (status) {
    case 'Completed':
    case 'Delivered':
      return 'text-emerald-700';
    case 'Ready for Collection':
      return 'text-[#0B1D3A]';
    case 'In Production':
    case 'Awaiting Deposit':
      return 'text-amber-700';
    case 'Cancelled':
      return 'text-red-600';
    default:
      return 'text-slate-700';
  }
}

export const OrdersView: React.FC<OrdersViewProps> = ({
  settings,
  orders,
  customers,
  isCreateOpen,
  onOpenCreate,
  onCloseCreate,
  onSaveOrder,
  onDeleteOrder,
  onConvertOrderToSale,
}) => {
  const currency = settings.currency || 'UGX';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | OrderStatus>('All');

  const [editing, setEditing] = useState<Order | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [title, setTitle] = useState('');
  const [itemsSummary, setItemsSummary] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [totalAmount, setTotalAmount] = useState('');
  const [depositPaid, setDepositPaid] = useState('0');
  const [status, setStatus] = useState<OrderStatus>('New Order');
  const [deadline, setDeadline] = useState(todayIsoDate());
  const [deliveryDetails, setDeliveryDetails] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const openNew = () => {
    setEditing(null);
    setCustomerId('');
    setCustomerName('');
    setCustomerPhone('');
    setTitle('');
    setItemsSummary('');
    setQuantity('1');
    setTotalAmount('');
    setDepositPaid('0');
    setStatus('New Order');
    setDeadline(todayIsoDate());
    setDeliveryDetails('');
    setInstructions('');
    onOpenCreate();
  };

  const openEdit = (o: Order) => {
    setEditing(o);
    setCustomerId(o.customer_id ? String(o.customer_id) : '');
    setCustomerName(o.customer_name);
    setCustomerPhone(o.customer_phone);
    setTitle(o.title);
    setItemsSummary(o.items_summary);
    setQuantity(String(o.quantity));
    setTotalAmount(String(o.total_amount));
    setDepositPaid(String(o.deposit_paid));
    setStatus(o.status);
    setDeadline(o.deadline);
    setDeliveryDetails(o.delivery_details);
    setInstructions(o.instructions);
    onOpenCreate();
  };

  const handleSelectCustomer = (idStr: string) => {
    setCustomerId(idStr);
    const c = customers.find((x) => x.id === Number(idStr));
    if (c) {
      setCustomerName(c.name);
      setCustomerPhone(c.phone);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveOrder(
        {
          customer_id: customerId ? Number(customerId) : null,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          title: title.trim(),
          items_summary: itemsSummary.trim(),
          quantity: Number(quantity) || 1,
          total_amount: Number(totalAmount) || 0,
          deposit_paid: Number(depositPaid) || 0,
          status,
          deadline,
          delivery_details: deliveryDetails.trim(),
          instructions: instructions.trim(),
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
    return orders.filter((o) => {
      if (statusFilter !== 'All' && o.status !== statusFilter) return false;
      if (!q) return true;
      return (
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.title.toLowerCase().includes(q) ||
        o.items_summary.toLowerCase().includes(q)
      );
    });
  }, [orders, search, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) {
      counts.set(o.status, (counts.get(o.status) || 0) + 1);
    }
    return counts;
  }, [orders]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Order &amp; Production Tracking</h2>
          <p className="text-sm text-slate-500">
            Monitor job deadlines, production stages, customer instructions, and deliveries
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="h-10 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 text-[#C89B3C]" />
          Create Order
        </button>
      </div>

      {/* Status Filter Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStatusFilter('All')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === 'All'
                ? 'bg-[#0B1D3A] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All ({orders.length})
          </button>
          {ORDER_STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-[#0B1D3A] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {st} ({statusCounts.get(st) || 0})
            </button>
          ))}
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order #, client, job title..."
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 text-sm"
          />
        </div>
      </div>

      {/* Orders List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No orders found in this status.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Order #</th>
                  <th className="py-3 px-4">Job &amp; Instructions</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Deadline &amp; Delivery</th>
                  <th className="py-3 px-4 text-right">Amount / Deposit</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((o) => {
                  const isOverdue =
                    o.deadline &&
                    o.deadline < todayIsoDate() &&
                    o.status !== 'Completed' &&
                    o.status !== 'Delivered' &&
                    o.status !== 'Cancelled';
                  return (
                    <tr key={o.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#0B1D3A] whitespace-nowrap">
                        {o.order_number}
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <p className="font-semibold text-slate-900">{o.title}</p>
                        <p className="text-xs text-slate-600 truncate">
                          Qty {o.quantity} · {o.items_summary || 'Custom print order'}
                        </p>
                        {o.instructions && (
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            Note: {o.instructions}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{o.customer_name}</p>
                        <p className="text-xs font-mono text-slate-500">
                          {o.customer_phone || '—'}
                        </p>
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <p
                          className={`text-xs font-mono inline-flex items-center gap-1 ${
                            isOverdue ? 'text-red-600 font-semibold' : 'text-slate-700'
                          }`}
                        >
                          <CalendarClock className="w-3.5 h-3.5" />
                          {o.deadline ? formatDate(o.deadline) : 'No deadline'}
                          {isOverdue ? ' (Overdue)' : ''}
                        </p>
                        {o.delivery_details && (
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {o.delivery_details}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        <p className="font-semibold text-slate-900">
                          {formatCurrency(o.total_amount, currency)}
                        </p>
                        <p className="text-xs text-emerald-700">
                          Dep: {formatCurrency(o.deposit_paid, currency)}
                        </p>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <select
                          value={o.status}
                          onChange={(e) =>
                            onSaveOrder({ status: e.target.value as OrderStatus }, o.id)
                          }
                          className={`h-8 px-2 rounded-md border border-slate-200 text-xs font-semibold bg-white cursor-pointer ${getStatusTextClass(
                            o.status
                          )}`}
                        >
                          {ORDER_STATUSES.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onConvertOrderToSale(o)}
                            title="Issue sale & electronic receipt from this order"
                            className="h-8 px-2.5 rounded-md bg-amber-50 border border-amber-200 hover:bg-amber-100 text-xs font-semibold text-[#0B1D3A] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Receipt className="w-3.5 h-3.5" />
                            Bill / Receipt
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(o)}
                            aria-label="Edit order"
                            className="h-8 w-8 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-500 inline-flex items-center justify-center cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(o.id)}
                            aria-label="Delete order"
                            className="h-8 w-8 rounded-md border border-slate-200 hover:bg-red-50 hover:border-red-200 text-slate-400 hover:text-red-600 inline-flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Order Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden my-auto"
          >
            <div className="bg-[#0B1D3A] px-5 py-4 text-white flex items-center justify-between">
              <h3 className="text-base font-bold">
                {editing ? `Edit Order · ${editing.order_number}` : 'Create Production Order'}
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

            <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Select Customer
                  </label>
                  <select
                    value={customerId}
                    onChange={(e) => handleSelectCustomer(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">-- New / Custom --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Customer Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Order Title / Job Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Company Tear Drop Banners & Flyers"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Total Quantity
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Items Summary
                </label>
                <input
                  type="text"
                  value={itemsSummary}
                  onChange={(e) => setItemsSummary(e.target.value)}
                  placeholder="e.g. Tear Drop Banner x2, Business Cards (100) x5"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Total Amount ({currency})
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Deposit Paid ({currency})
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={depositPaid}
                    onChange={(e) => setDepositPaid(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Order Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as OrderStatus)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    {ORDER_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Deadline Date
                  </label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Delivery / Collection Details
                </label>
                <input
                  type="text"
                  value={deliveryDetails}
                  onChange={(e) => setDeliveryDetails(e.target.value)}
                  placeholder="e.g. Boda delivery to Bugolobi or Workshop Pickup"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer Design &amp; Print Instructions
                </label>
                <textarea
                  rows={2}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Colors, sizes, finishing, lamination, artwork notes..."
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
                  {saving ? 'Saving...' : editing ? 'Update Order' : 'Save Order'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Delete Order?</h3>
            <p className="text-sm text-slate-600">
              This order will be permanently removed from the production tracker.
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
                  await onDeleteOrder(confirmDeleteId);
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
