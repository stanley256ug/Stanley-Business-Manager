import React, { useMemo, useState } from 'react';
import {
  CreditCard,
  Plus,
  Receipt,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  BusinessSettings,
  Customer,
  PaymentMethod,
  PaymentStatus,
  Product,
  Sale,
  SaleItem,
} from '../types';
import { formatCurrency, formatDate, todayIsoDate } from '../utils/format';

interface SalesViewProps {
  settings: BusinessSettings;
  sales: Sale[];
  products: Product[];
  customers: Customer[];
  isCreateOpen: boolean;
  onOpenCreate: () => void;
  onCloseCreate: () => void;
  onCreateSale: (payload: any, openReceipt: boolean) => Promise<void>;
  onRecordPayment: (saleId: number, amount: number, method: PaymentMethod, note: string) => Promise<void>;
  onDeleteSale: (saleId: number) => Promise<void>;
  onViewReceipt: (sale: Sale) => void;
}

const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'Mobile Money', 'Bank Transfer', 'Other'];

export const SalesView: React.FC<SalesViewProps> = ({
  settings,
  sales,
  products,
  customers,
  isCreateOpen,
  onOpenCreate,
  onCloseCreate,
  onCreateSale,
  onRecordPayment,
  onDeleteSale,
  onViewReceipt,
}) => {
  const currency = settings.currency || 'UGX';

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | PaymentStatus>('All');
  const [methodFilter, setMethodFilter] = useState<'All' | PaymentMethod>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Sale Form State
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [saleDate, setSaleDate] = useState(todayIsoDate());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    settings.default_payment_method || 'Mobile Money'
  );
  const [discount, setDiscount] = useState<string>('0');
  const [amountPaid, setAmountPaid] = useState<string>('');
  const [paidInFull, setPaidInFull] = useState(true);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<SaleItem[]>([
    {
      product_id: null,
      product_name: '',
      category: 'Other Printing & Branding',
      quantity: 1,
      unit_price: 0,
      unit_cost: 0,
      line_total: 0,
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Balance payment modal
  const [payingSale, setPayingSale] = useState<Sale | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Mobile Money');
  const [payNote, setPayNote] = useState('Balance settlement');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (statusFilter !== 'All' && s.payment_status !== statusFilter) return false;
      if (methodFilter !== 'All' && s.payment_method !== methodFilter) return false;
      if (dateFrom && s.sale_date < dateFrom) return false;
      if (dateTo && s.sale_date > dateTo) return false;
      if (!q) return true;
      const itemsText = s.items.map((i) => i.product_name.toLowerCase()).join(' ');
      return (
        s.receipt_number.toLowerCase().includes(q) ||
        s.customer_name.toLowerCase().includes(q) ||
        s.customer_phone.toLowerCase().includes(q) ||
        itemsText.includes(q)
      );
    });
  }, [sales, search, statusFilter, methodFilter, dateFrom, dateTo]);

  const summary = useMemo(() => {
    const totalBilled = filteredSales.reduce((sum, s) => sum + s.total_amount, 0);
    const totalPaid = filteredSales.reduce((sum, s) => sum + s.amount_paid, 0);
    const totalBalance = filteredSales.reduce((sum, s) => sum + s.balance_due, 0);
    return { totalBilled, totalPaid, totalBalance };
  }, [filteredSales]);

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const discountNum = Math.min(subtotal, Math.max(0, Number(discount) || 0));
  const totalAmount = Math.max(0, subtotal - discountNum);
  const resolvedAmountPaid = paidInFull
    ? totalAmount
    : Math.min(totalAmount, Math.max(0, Number(amountPaid) || 0));
  const balanceDue = Math.max(0, totalAmount - resolvedAmountPaid);

  const handleSelectCustomer = (custIdStr: string) => {
    setSelectedCustomerId(custIdStr);
    if (!custIdStr) return;
    const cust = customers.find((c) => c.id === Number(custIdStr));
    if (cust) {
      setCustomerName(cust.name);
      setCustomerPhone(cust.phone);
    }
  };

  const handleSelectProduct = (idx: number, prodIdStr: string) => {
    const prod = products.find((p) => p.id === Number(prodIdStr));
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        if (!prod) {
          return { ...item, product_id: null };
        }
        return {
          product_id: prod.id,
          product_name: prod.name,
          category: prod.category,
          quantity: item.quantity || 1,
          unit_price: prod.unit_price,
          unit_cost: prod.production_cost,
          line_total: (item.quantity || 1) * prod.unit_price,
        };
      })
    );
  };

  const updateItemField = (idx: number, field: keyof SaleItem, value: any) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const next = { ...item, [field]: value };
        next.quantity = Math.max(1, Number(next.quantity) || 1);
        next.unit_price = Math.max(0, Number(next.unit_price) || 0);
        next.line_total = next.quantity * next.unit_price;
        return next;
      })
    );
  };

  const addLineItem = () => {
    setItems((prev) => [
      ...prev,
      {
        product_id: null,
        product_name: '',
        category: 'Other Printing & Branding',
        quantity: 1,
        unit_price: 0,
        unit_cost: 0,
        line_total: 0,
      },
    ]);
  };

  const removeLineItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const resetForm = () => {
    setSelectedCustomerId('');
    setCustomerName('');
    setCustomerPhone('');
    setSaleDate(todayIsoDate());
    setPaymentMethod(settings.default_payment_method || 'Mobile Money');
    setDiscount('0');
    setAmountPaid('');
    setPaidInFull(true);
    setNotes('');
    setItems([
      {
        product_id: null,
        product_name: '',
        category: 'Other Printing & Branding',
        quantity: 1,
        unit_price: 0,
        unit_cost: 0,
        line_total: 0,
      },
    ]);
    setFormError('');
  };

  const handleSubmitSale = async (e: React.FormEvent, openReceipt: boolean) => {
    e.preventDefault();
    setFormError('');
    const validItems = items.filter((i) => i.product_name.trim().length > 0);
    if (!customerName.trim()) {
      setFormError('Please enter or select a customer name.');
      return;
    }
    if (validItems.length === 0) {
      setFormError('Please add at least one product or service.');
      return;
    }

    setSubmitting(true);
    try {
      await onCreateSale(
        {
          customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          items: validItems,
          discount: discountNum,
          amount_paid: resolvedAmountPaid,
          payment_method: paymentMethod,
          notes: notes.trim(),
          sale_date: saleDate,
        },
        openReceipt
      );
      resetForm();
      onCloseCreate();
    } catch (err: any) {
      setFormError(err.message || 'Failed to record sale.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenPayModal = (sale: Sale) => {
    setPayingSale(sale);
    setPayAmount(String(sale.balance_due));
    setPayMethod(sale.payment_method);
    setPayNote('Balance payment');
  };

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingSale) return;
    await onRecordPayment(payingSale.id, Number(payAmount) || 0, payMethod, payNote);
    setPayingSale(null);
  };

  return (
    <div className="space-y-5">
      {/* Header Summary & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Income &amp; Sales Management</h2>
          <p className="text-sm text-slate-500">
            Record sales, track deposits &amp; balances, and issue sequential receipts
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenCreate}
          className="h-10 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 text-[#C89B3C]" />
          Record New Sale
        </button>
      </div>

      {/* Filtered Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Filtered Total Billed ({filteredSales.length})</p>
          <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-1">
            {formatCurrency(summary.totalBilled, currency)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Amount Collected</p>
          <p className="text-lg font-bold text-emerald-700 font-mono tabular-nums mt-1">
            {formatCurrency(summary.totalPaid, currency)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Outstanding Balances</p>
          <p className="text-lg font-bold text-amber-700 font-mono tabular-nums mt-1">
            {formatCurrency(summary.totalBalance, currency)}
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="relative lg:col-span-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receipt #, customer, phone, or item..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-[#0B1D3A]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="h-10 px-3 rounded-lg border border-slate-200 text-sm bg-white"
        >
          <option value="All">All Payment Statuses</option>
          <option value="Paid">Paid</option>
          <option value="Partially Paid">Partially Paid</option>
          <option value="Unpaid">Unpaid</option>
        </select>
        <select
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value as any)}
          className="h-10 px-3 rounded-lg border border-slate-200 text-sm bg-white"
        >
          <option value="All">All Payment Methods</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Filter from date"
            className="w-full h-10 px-2 rounded-lg border border-slate-200 text-xs"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Filter to date"
            className="w-full h-10 px-2 rounded-lg border border-slate-200 text-xs"
          />
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredSales.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700">No matching sales records found.</p>
            <p className="text-xs text-slate-500">
              Try adjusting your search filters or record a new sale.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Receipt #</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Products / Services</th>
                  <th className="py-3 px-4 text-right">Total</th>
                  <th className="py-3 px-4 text-right">Paid</th>
                  <th className="py-3 px-4 text-right">Balance</th>
                  <th className="py-3 px-4">Method &amp; Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono tabular-nums font-semibold text-[#0B1D3A] whitespace-nowrap">
                      {sale.receipt_number}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap">
                      {formatDate(sale.sale_date)}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-medium text-slate-900">{sale.customer_name}</p>
                      <p className="text-xs text-slate-500 font-mono">{sale.customer_phone || '—'}</p>
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      <p className="text-slate-700 truncate">
                        {sale.items.map((i) => `${i.product_name} (${i.quantity})`).join(', ')}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      {formatCurrency(sale.total_amount, currency)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                      {formatCurrency(sale.amount_paid, currency)}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                        sale.balance_due > 0 ? 'text-red-600' : 'text-slate-400'
                      }`}
                    >
                      {formatCurrency(sale.balance_due, currency)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <p className="text-xs text-slate-700">{sale.payment_method}</p>
                      <p
                        className={`text-xs font-semibold ${
                          sale.payment_status === 'Paid'
                            ? 'text-emerald-700'
                            : sale.payment_status === 'Partially Paid'
                            ? 'text-amber-700'
                            : 'text-red-600'
                        }`}
                      >
                        {sale.payment_status}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onViewReceipt(sale)}
                          className="h-8 px-2.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Receipt className="w-3.5 h-3.5" />
                          Receipt
                        </button>
                        {sale.balance_due > 0 && (
                          <button
                            type="button"
                            onClick={() => handleOpenPayModal(sale)}
                            className="h-8 px-2.5 rounded-md bg-amber-50 border border-amber-200 hover:bg-amber-100 text-xs font-semibold text-amber-800 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            Pay Balance
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(sale.id)}
                          aria-label="Delete sale"
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

      {/* Create Sale Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="w-full max-w-3xl bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden my-auto">
            <div className="bg-[#0B1D3A] px-5 py-4 flex items-center justify-between text-white">
              <div>
                <h3 className="text-base font-bold">Record New Sale &amp; Issue Receipt</h3>
                <p className="text-xs text-amber-300">
                  Sequential receipt number will be generated automatically
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseCreate}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => handleSubmitSale(e, true)}
              className="p-5 sm:p-6 space-y-5 max-h-[82vh] overflow-y-auto"
            >
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  {formError}
                </div>
              )}

              {/* Customer & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Existing Customer (Optional)
                  </label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => handleSelectCustomer(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">-- New / Walk-in Customer --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.phone || 'No phone'})
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
                    placeholder="e.g. Kigozi Hardware or Walk-in Customer"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Customer Phone
                  </label>
                  <input
                    type="text"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+256 7XX XXX XXX"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              {/* Line Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Products &amp; Services
                  </label>
                  <button
                    type="button"
                    onClick={addLineItem}
                    className="text-xs font-semibold text-[#0B1D3A] hover:underline cursor-pointer"
                  >
                    + Add Another Line Item
                  </button>
                </div>

                <div className="space-y-2.5">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
                    >
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] text-slate-500 mb-1">
                          Catalog Quick Pick
                        </label>
                        <select
                          value={item.product_id || ''}
                          onChange={(e) => handleSelectProduct(idx, e.target.value)}
                          className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs bg-white"
                        >
                          <option value="">Custom Item / Service</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({formatCurrency(p.unit_price, currency)})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] text-slate-500 mb-1">
                          Item / Service Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={item.product_name}
                          onChange={(e) => updateItemField(idx, 'product_name', e.target.value)}
                          placeholder="Service description"
                          className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs bg-white"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] text-slate-500 mb-1">Qty</label>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => updateItemField(idx, 'quantity', e.target.value)}
                          className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs font-mono bg-white"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] text-slate-500 mb-1">
                          Unit Price ({currency})
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={item.unit_price}
                          onChange={(e) => updateItemField(idx, 'unit_price', e.target.value)}
                          className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs font-mono bg-white"
                        />
                      </div>
                      <div className="sm:col-span-1 flex items-center justify-between sm:justify-end gap-1">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLineItem(idx)}
                            className="h-9 w-9 rounded-md border border-slate-200 bg-white hover:bg-red-50 text-slate-400 hover:text-red-600 flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment & Totals */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Sale Date
                      </label>
                      <input
                        type="date"
                        value={saleDate}
                        onChange={(e) => setSaleDate(e.target.value)}
                        className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Payment Method
                      </label>
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                        className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Discount ({currency})
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={discount}
                        onChange={(e) => setDiscount(e.target.value)}
                        className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700">
                          Amount Paid
                        </label>
                        <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={paidInFull}
                            onChange={(e) => setPaidInFull(e.target.checked)}
                          />
                          Paid in full
                        </label>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={totalAmount}
                        disabled={paidInFull}
                        value={paidInFull ? totalAmount : amountPaid}
                        onChange={(e) => setAmountPaid(e.target.value)}
                        placeholder="Deposit / Paid"
                        className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono disabled:bg-slate-100"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Notes (Optional)
                    </label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Print specifications, pickup details..."
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between font-mono tabular-nums">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal</span>
                      <span>{formatCurrency(subtotal, currency)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Discount</span>
                      <span>- {formatCurrency(discountNum, currency)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-[#0B1D3A] pt-2 border-t border-slate-200">
                      <span>Total Due</span>
                      <span>{formatCurrency(totalAmount, currency)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-700 font-semibold">
                      <span>Amount Paid</span>
                      <span>{formatCurrency(resolvedAmountPaid, currency)}</span>
                    </div>
                    <div className="flex justify-between font-bold pt-1 border-t border-slate-200">
                      <span>Balance Remaining</span>
                      <span className={balanceDue > 0 ? 'text-red-600' : 'text-emerald-700'}>
                        {formatCurrency(balanceDue, currency)}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] font-sans text-slate-500 mt-4">
                    Status:{' '}
                    <strong className="text-slate-900">
                      {balanceDue === 0 ? 'Paid' : resolvedAmountPaid > 0 ? 'Partially Paid' : 'Unpaid'}
                    </strong>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={onCloseCreate}
                  className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={(e) => handleSubmitSale(e as any, false)}
                  className="h-10 px-4 rounded-lg border border-[#0B1D3A] text-sm font-semibold text-[#0B1D3A] hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  Save Only
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-10 px-5 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Receipt className="w-4 h-4 text-[#C89B3C]" />
                  {submitting ? 'Saving...' : 'Save & Generate Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay Balance Modal */}
      {payingSale && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmPayment}
            className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden"
          >
            <div className="bg-[#0B1D3A] px-5 py-4 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                Record Balance Payment · {payingSale.receipt_number}
              </h3>
              <button
                type="button"
                onClick={() => setPayingSale(null)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                <p className="font-semibold text-slate-900">{payingSale.customer_name}</p>
                <p className="text-slate-600 font-mono">
                  Remaining Balance: {formatCurrency(payingSale.balance_due, currency)}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Payment Amount ({currency})
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={payingSale.balance_due}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Payment Method
                </label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Note</label>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayingSale(null)}
                  className="h-9 px-4 rounded-lg border border-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-9 px-4 rounded-lg bg-[#0B1D3A] text-white text-xs font-semibold cursor-pointer"
                >
                  Record Payment
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Delete Sale Record?</h3>
            <p className="text-sm text-slate-600">
              This will permanently remove this sale and its receipt from your financial totals.
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
                  await onDeleteSale(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
              >
                Delete Sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
