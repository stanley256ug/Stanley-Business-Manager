import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FilePlus2,
  Receipt,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { BusinessSettings, Customer, Expense, NavSection, Order, Sale } from '../types';
import { formatCurrency, formatDate, startOfMonthIso, startOfYearIso } from '../utils/format';
import { FinancialTrendChart, HorizontalRankChart, TrendPoint } from './Charts';

interface DashboardViewProps {
  settings: BusinessSettings;
  sales: Sale[];
  expenses: Expense[];
  orders: Order[];
  customers: Customer[];
  onQuickAction: (action: 'sale' | 'expense' | 'customer' | 'order') => void;
  onNavigate: (section: NavSection) => void;
  onViewReceipt: (sale: Sale) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  settings,
  sales,
  expenses,
  orders,
  customers,
  onQuickAction,
  onNavigate,
  onViewReceipt,
}) => {
  const [chartPeriod, setChartPeriod] = useState<'6m' | '12m'>('6m');
  const currency = settings.currency || 'UGX';

  const metrics = useMemo(() => {
    const totalIncome = sales.reduce((sum, s) => sum + s.total_amount, 0);
    const totalCollected = sales.reduce((sum, s) => sum + s.amount_paid, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netProfit = totalIncome - totalExpenses;
    const outstandingPayments = sales.reduce((sum, s) => sum + s.balance_due, 0);

    const completedOrders = orders.filter((o) => o.status === 'Completed' || o.status === 'Delivered').length;
    const pendingOrders = orders.filter(
      (o) => o.status !== 'Completed' && o.status !== 'Delivered' && o.status !== 'Cancelled'
    ).length;

    const monthStart = startOfMonthIso();
    const yearStart = startOfYearIso();

    const monthlyIncome = sales
      .filter((s) => s.sale_date >= monthStart)
      .reduce((sum, s) => sum + s.total_amount, 0);
    const monthlyExpenses = expenses
      .filter((e) => e.expense_date >= monthStart)
      .reduce((sum, e) => sum + e.amount, 0);

    const yearlyIncome = sales
      .filter((s) => s.sale_date >= yearStart)
      .reduce((sum, s) => sum + s.total_amount, 0);
    const yearlyExpenses = expenses
      .filter((e) => e.expense_date >= yearStart)
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      totalIncome,
      totalCollected,
      totalExpenses,
      netProfit,
      outstandingPayments,
      completedOrders,
      pendingOrders,
      monthlyIncome,
      monthlyExpenses,
      monthlyProfit: monthlyIncome - monthlyExpenses,
      yearlyIncome,
      yearlyExpenses,
      yearlyProfit: yearlyIncome - yearlyExpenses,
    };
  }, [sales, expenses, orders]);

  const trendData: TrendPoint[] = useMemo(() => {
    const count = chartPeriod === '6m' ? 6 : 12;
    const now = new Date();
    const points: TrendPoint[] = [];

    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const prefix = `${y}-${m}`;
      const label = d.toLocaleDateString('en-UG', { month: 'short', year: count > 6 ? '2-digit' : undefined });

      const income = sales
        .filter((s) => s.sale_date.startsWith(prefix))
        .reduce((sum, s) => sum + s.total_amount, 0);
      const exp = expenses
        .filter((e) => e.expense_date.startsWith(prefix))
        .reduce((sum, e) => sum + e.amount, 0);

      points.push({
        label,
        income,
        expenses: exp,
        profit: income - exp,
      });
    }
    return points;
  }, [sales, expenses, chartPeriod]);

  const topServices = useMemo(() => {
    const map = new Map<string, { revenue: number; count: number }>();
    for (const s of sales) {
      for (const item of s.items) {
        const prev = map.get(item.product_name) || { revenue: 0, count: 0 };
        prev.revenue += item.line_total;
        prev.count += item.quantity;
        map.set(item.product_name, prev);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([label, stats]) => ({
        label,
        sublabel: `${stats.count} units sold`,
        value: stats.revenue,
      }));
  }, [sales]);

  const recentTransactions = useMemo(() => {
    const saleEntries = sales.map((s) => ({
      id: `sale-${s.id}`,
      type: 'income' as const,
      date: s.sale_date,
      title: `${s.receipt_number} · ${s.customer_name}`,
      subtitle: `${s.items.map((i) => i.product_name).slice(0, 2).join(', ')} · ${s.payment_method}`,
      amount: s.total_amount,
      status: s.payment_status,
      sale: s,
    }));

    const expEntries = expenses.map((e) => ({
      id: `exp-${e.id}`,
      type: 'expense' as const,
      date: e.expense_date,
      title: e.title,
      subtitle: `${e.category} · ${e.payment_method}`,
      amount: e.amount,
      status: 'Expense',
      sale: undefined,
    }));

    return [...saleEntries, ...expEntries]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 8);
  }, [sales, expenses]);

  return (
    <div className="space-y-6">
      {/* Quick Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Welcome back to {settings.business_name}
          </h2>
          <p className="text-sm text-slate-500">
            {customers.length} customers · {orders.length} orders · {sales.length} issued receipts
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onQuickAction('sale')}
            className="h-10 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Receipt className="w-4 h-4 text-[#C89B3C]" />
            Record Sale
          </button>
          <button
            type="button"
            onClick={() => onQuickAction('expense')}
            className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Wallet className="w-4 h-4 text-rose-600" />
            Add Expense
          </button>
          <button
            type="button"
            onClick={() => onQuickAction('customer')}
            className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4 text-[#0B1D3A]" />
            Add Customer
          </button>
          <button
            type="button"
            onClick={() => onQuickAction('order')}
            className="h-10 px-4 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-[#0B1D3A] text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="w-4 h-4 text-amber-700" />
            New Order
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Business Income</span>
            <ArrowUpRight className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatCurrency(metrics.totalIncome, currency)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 font-mono tabular-nums">
            Cash collected: {formatCurrency(metrics.totalCollected, currency)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Expenditures</span>
            <ArrowDownRight className="w-4 h-4 text-rose-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {formatCurrency(metrics.totalExpenses, currency)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Across {expenses.length} recorded expense entries
          </p>
        </div>

        <div className="bg-[#0B1D3A] text-white border border-[#0B1D3A] rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-amber-300">
            <span>Net Business Profit</span>
            <span className="font-mono tabular-nums">
              {metrics.totalIncome > 0
                ? `${((metrics.netProfit / metrics.totalIncome) * 100).toFixed(1)}% margin`
                : '0.0% margin'}
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">
            {formatCurrency(metrics.netProfit, currency)}
          </p>
          <p className="mt-1.5 text-xs text-slate-300">
            Total income minus total expenditures
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Outstanding Customer Payments</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-700 font-mono tabular-nums">
            {formatCurrency(metrics.outstandingPayments, currency)}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('sales')}
            className="mt-1.5 text-xs font-medium text-[#0B1D3A] hover:underline cursor-pointer"
          >
            View unpaid &amp; partial invoices
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Completed Orders</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {metrics.completedOrders}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Delivered or finished production jobs
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Pending &amp; Active Orders</span>
            <Clock className="w-4 h-4 text-[#0B1D3A]" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {metrics.pendingOrders}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('orders')}
            className="mt-1.5 text-xs font-medium text-[#0B1D3A] hover:underline cursor-pointer"
          >
            Manage production queue
          </button>
        </div>
      </div>

      {/* Monthly & Yearly Business Performance Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">This Month Performance</h3>
              <p className="text-xs text-slate-500">
                {new Date().toLocaleDateString('en-UG', { month: 'long', year: 'numeric' })}
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums font-semibold text-[#0B1D3A]">
              Monthly Snapshot
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 font-mono tabular-nums">
            <div>
              <p className="text-xs font-sans text-slate-500">Income</p>
              <p className="text-base font-bold text-slate-900 mt-1">
                {formatCurrency(metrics.monthlyIncome, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs font-sans text-slate-500">Expenses</p>
              <p className="text-base font-bold text-rose-600 mt-1">
                {formatCurrency(metrics.monthlyExpenses, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs font-sans text-slate-500">Net Profit</p>
              <p
                className={`text-base font-bold mt-1 ${
                  metrics.monthlyProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                }`}
              >
                {formatCurrency(metrics.monthlyProfit, currency)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Year-to-Date Performance</h3>
              <p className="text-xs text-slate-500">{new Date().getFullYear()} Cumulative</p>
            </div>
            <span className="text-xs font-mono tabular-nums font-semibold text-[#C89B3C]">
              Annual Snapshot
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 font-mono tabular-nums">
            <div>
              <p className="text-xs font-sans text-slate-500">Income</p>
              <p className="text-base font-bold text-slate-900 mt-1">
                {formatCurrency(metrics.yearlyIncome, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs font-sans text-slate-500">Expenses</p>
              <p className="text-base font-bold text-rose-600 mt-1">
                {formatCurrency(metrics.yearlyExpenses, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs font-sans text-slate-500">Net Profit</p>
              <p
                className={`text-base font-bold mt-1 ${
                  metrics.yearlyProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                }`}
              >
                {formatCurrency(metrics.yearlyProfit, currency)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Sales, Expenditures &amp; Profit Trend
              </h3>
              <p className="text-xs text-slate-500">
                Hover over any period to inspect exact financial totals
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setChartPeriod('6m')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  chartPeriod === '6m'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                6 Months
              </button>
              <button
                type="button"
                onClick={() => setChartPeriod('12m')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  chartPeriod === '12m'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                12 Months
              </button>
            </div>
          </div>

          <FinancialTrendChart data={trendData} currency={currency} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Top Services</h3>
              <p className="text-xs text-slate-500">Highest revenue contributors</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="text-xs font-semibold text-[#0B1D3A] hover:underline cursor-pointer"
            >
              Full analytics
            </button>
          </div>
          <HorizontalRankChart items={topServices} currency={currency} barColorClass="bg-[#C89B3C]" />
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Recent Transactions</h3>
            <p className="text-xs text-slate-500">Latest recorded sales receipts and business expenses</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('sales')}
            className="text-xs font-semibold text-[#0B1D3A] hover:underline cursor-pointer"
          >
            View all ledger entries
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No transactions recorded yet. Click &ldquo;Record Sale&rdquo; or &ldquo;Add Expense&rdquo; above to begin.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentTransactions.map((tx) => (
              <div
                key={tx.id}
                className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/70"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 truncate">{tx.title}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {formatDate(tx.date)} · {tx.subtitle}
                  </p>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right font-mono tabular-nums">
                    <p
                      className={`text-sm font-bold ${
                        tx.type === 'income' ? 'text-emerald-700' : 'text-rose-600'
                      }`}
                    >
                      {tx.type === 'income' ? '+' : '-'}
                      {formatCurrency(tx.amount, currency)}
                    </p>
                    <p className="text-[11px] text-slate-500 font-sans">{tx.status}</p>
                  </div>
                  {tx.sale && (
                    <button
                      type="button"
                      onClick={() => onViewReceipt(tx.sale!)}
                      className="h-8 px-2.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer whitespace-nowrap"
                    >
                      Receipt
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
