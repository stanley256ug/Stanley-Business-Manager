import React, { useMemo, useState } from 'react';
import { Edit2, Plus, Search, Trash2, X } from 'lucide-react';
import { BusinessSettings, Expense, ExpenseCategory, PaymentMethod, Sale } from '../types';
import { formatCurrency, formatDate, todayIsoDate } from '../utils/format';
import { HorizontalRankChart } from './Charts';

interface ExpensesViewProps {
  settings: BusinessSettings;
  expenses: Expense[];
  sales: Sale[];
  isCreateOpen: boolean;
  onOpenCreate: () => void;
  onCloseCreate: () => void;
  onSaveExpense: (payload: Partial<Expense>, id?: number) => Promise<void>;
  onDeleteExpense: (id: number) => Promise<void>;
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Materials & Printing Costs',
  'Transport',
  'Electricity',
  'Rent',
  'Equipment Purchases',
  'Internet & Subscriptions',
  'Salaries & Wages',
  'Other Business Expenses',
];

const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'Mobile Money', 'Bank Transfer', 'Other'];

export const ExpensesView: React.FC<ExpensesViewProps> = ({
  settings,
  expenses,
  sales,
  isCreateOpen,
  onOpenCreate,
  onCloseCreate,
  onSaveExpense,
  onDeleteExpense,
}) => {
  const currency = settings.currency || 'UGX';

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<'All' | ExpenseCategory>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [editing, setEditing] = useState<Expense | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('Materials & Printing Costs');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Mobile Money');
  const [vendor, setVendor] = useState('');
  const [notes, setNotes] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayIsoDate());
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const openNew = () => {
    setEditing(null);
    setTitle('');
    setCategory('Materials & Printing Costs');
    setAmount('');
    setPaymentMethod(settings.default_payment_method || 'Cash');
    setVendor('');
    setNotes('');
    setExpenseDate(todayIsoDate());
    onOpenCreate();
  };

  const openEdit = (e: Expense) => {
    setEditing(e);
    setTitle(e.title);
    setCategory(e.category);
    setAmount(String(e.amount));
    setPaymentMethod(e.payment_method);
    setVendor(e.vendor);
    setNotes(e.notes);
    setExpenseDate(e.expense_date);
    onOpenCreate();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveExpense(
        {
          title: title.trim(),
          category,
          amount: Number(amount) || 0,
          payment_method: paymentMethod,
          vendor: vendor.trim(),
          notes: notes.trim(),
          expense_date: expenseDate,
        },
        editing?.id
      );
      setEditing(null);
      onCloseCreate();
    } finally {
      setSaving(false);
    }
  };

  const filteredExpenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter((e) => {
      if (catFilter !== 'All' && e.category !== catFilter) return false;
      if (dateFrom && e.expense_date < dateFrom) return false;
      if (dateTo && e.expense_date > dateTo) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        e.vendor.toLowerCase().includes(q) ||
        e.notes.toLowerCase().includes(q)
      );
    });
  }, [expenses, search, catFilter, dateFrom, dateTo]);

  const totalAllIncome = useMemo(() => sales.reduce((s, x) => s + x.total_amount, 0), [sales]);
  const totalAllExpenses = useMemo(() => expenses.reduce((s, x) => s + x.amount, 0), [expenses]);
  const filteredTotal = useMemo(
    () => filteredExpenses.reduce((s, x) => s + x.amount, 0),
    [filteredExpenses]
  );

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filteredExpenses) {
      map.set(e.category, (map.get(e.category) || 0) + e.amount);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({
        label,
        sublabel:
          filteredTotal > 0 ? `${((value / filteredTotal) * 100).toFixed(1)}% of expenses` : undefined,
        value,
      }));
  }, [filteredExpenses, filteredTotal]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Expenditure Management</h2>
          <p className="text-sm text-slate-500">
            Track printing materials, utilities, salaries, and operating costs
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="h-10 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 text-[#C89B3C]" />
          Record Expense
        </button>
      </div>

      {/* Profit Deduction Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total Business Income</p>
          <p className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-1">
            {formatCurrency(totalAllIncome, currency)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total Deducted Expenses</p>
          <p className="text-lg font-bold text-rose-600 font-mono tabular-nums mt-1">
            - {formatCurrency(totalAllExpenses, currency)}
          </p>
        </div>
        <div className="bg-[#0B1D3A] text-white rounded-xl p-4">
          <p className="text-xs text-amber-300">Actual Net Business Profit</p>
          <p className="text-lg font-bold font-mono tabular-nums mt-1">
            {formatCurrency(totalAllIncome - totalAllExpenses, currency)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search description, vendor..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 text-sm"
          />
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value as any)}
          className="h-10 px-3 rounded-lg border border-slate-200 text-sm bg-white"
        >
          <option value="All">All Expense Categories</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-10 px-3 rounded-lg border border-slate-200 text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-10 px-3 rounded-lg border border-slate-200 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Expense Table */}
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filteredExpenses.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No expense entries match your filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Expense &amp; Vendor</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredExpenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {formatDate(exp.expense_date)}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{exp.title}</p>
                        {exp.vendor && <p className="text-xs text-slate-500">{exp.vendor}</p>}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">{exp.category}</td>
                      <td className="py-3 px-4 text-xs text-slate-600">{exp.payment_method}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-rose-600 whitespace-nowrap">
                        {formatCurrency(exp.amount, currency)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(exp)}
                            aria-label="Edit expense"
                            className="h-8 w-8 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-500 inline-flex items-center justify-center cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(exp.id)}
                            aria-label="Delete expense"
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

        {/* Category Breakdown */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-base font-bold text-slate-900">Expense Breakdown</h3>
          <p className="text-xs text-slate-500 mb-4">
            Filtered total: {formatCurrency(filteredTotal, currency)}
          </p>
          <HorizontalRankChart
            items={categoryBreakdown}
            currency={currency}
            barColorClass="bg-rose-500"
          />
        </div>
      </div>

      {/* Create/Edit Expense Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden my-auto"
          >
            <div className="bg-[#0B1D3A] px-5 py-4 text-white flex items-center justify-between">
              <h3 className="text-base font-bold">
                {editing ? 'Edit Expense Entry' : 'Record Business Expense'}
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
                  Expense Description *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Glossy Vinyl Rolls & Ink Bottles"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Amount ({currency}) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="50000"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
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
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier / Payee (Optional)
                </label>
                <input
                  type="text"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="e.g. Kampala Print Supplies"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
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
                  className="h-10 px-5 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold cursor-pointer"
                >
                  {saving ? 'Saving...' : editing ? 'Update Expense' : 'Save Expense'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Delete Expense Record?</h3>
            <p className="text-sm text-slate-600">
              This expense will be removed from expenditure totals and profit reports.
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
                  await onDeleteExpense(confirmDeleteId);
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
