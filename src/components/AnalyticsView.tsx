import React, { useMemo } from 'react';
import { Lightbulb, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { BusinessSettings, Customer, Expense, Sale } from '../types';
import {
  formatCurrency,
  startOfMonthIso,
  startOfWeekIso,
  startOfYearIso,
  todayIsoDate,
} from '../utils/format';
import { FinancialTrendChart, HorizontalRankChart, TrendPoint } from './Charts';

interface AnalyticsViewProps {
  settings: BusinessSettings;
  sales: Sale[];
  expenses: Expense[];
  customers: Customer[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  settings,
  sales,
  expenses,
  customers,
}) => {
  const currency = settings.currency || 'UGX';

  const analytics = useMemo(() => {
    const today = todayIsoDate();
    const weekStart = startOfWeekIso();
    const monthStart = startOfMonthIso();
    const yearStart = startOfYearIso();

    const now = new Date();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthPrefix = `${prevMonthDate.getFullYear()}-${String(
      prevMonthDate.getMonth() + 1
    ).padStart(2, '0')}`;
    const currMonthPrefix = monthStart.slice(0, 7);

    const dailyRevenue = sales
      .filter((s) => s.sale_date === today)
      .reduce((sum, s) => sum + s.total_amount, 0);
    const weeklyRevenue = sales
      .filter((s) => s.sale_date >= weekStart)
      .reduce((sum, s) => sum + s.total_amount, 0);
    const monthlyRevenue = sales
      .filter((s) => s.sale_date >= monthStart)
      .reduce((sum, s) => sum + s.total_amount, 0);
    const yearlyRevenue = sales
      .filter((s) => s.sale_date >= yearStart)
      .reduce((sum, s) => sum + s.total_amount, 0);

    const monthlyExpenses = expenses
      .filter((e) => e.expense_date >= monthStart)
      .reduce((sum, e) => sum + e.amount, 0);
    const monthlyProfit = monthlyRevenue - monthlyExpenses;

    const prevMonthRevenue = sales
      .filter((s) => s.sale_date.startsWith(prevMonthPrefix))
      .reduce((sum, s) => sum + s.total_amount, 0);
    const prevMonthExpenses = expenses
      .filter((e) => e.expense_date.startsWith(prevMonthPrefix))
      .reduce((sum, e) => sum + e.amount, 0);
    const prevMonthProfit = prevMonthRevenue - prevMonthExpenses;

    // Product & Service profitability
    const serviceStats = new Map<
      string,
      { revenue: number; cost: number; profit: number; units: number }
    >();
    const categoryStats = new Map<string, { revenue: number; profit: number; units: number }>();

    for (const s of sales) {
      for (const item of s.items) {
        const estCost = (item.unit_cost || 0) * item.quantity;
        const profit = item.line_total - estCost;

        const prevP = serviceStats.get(item.product_name) || {
          revenue: 0,
          cost: 0,
          profit: 0,
          units: 0,
        };
        prevP.revenue += item.line_total;
        prevP.cost += estCost;
        prevP.profit += profit;
        prevP.units += item.quantity;
        serviceStats.set(item.product_name, prevP);

        const catName = item.category || 'Other Printing & Branding';
        const prevC = categoryStats.get(catName) || { revenue: 0, profit: 0, units: 0 };
        prevC.revenue += item.line_total;
        prevC.profit += profit;
        prevC.units += item.quantity;
        categoryStats.set(catName, prevC);
      }
    }

    const bestSellingProducts = Array.from(serviceStats.entries())
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 6)
      .map(([label, st]) => ({
        label,
        sublabel: `${st.units} sold · Est. Profit ${formatCurrency(st.profit, currency)}`,
        value: st.revenue,
      }));

    const mostProfitableServices = Array.from(categoryStats.entries())
      .sort((a, b) => b[1].profit - a[1].profit)
      .slice(0, 6)
      .map(([label, st]) => ({
        label,
        sublabel: `Revenue ${formatCurrency(st.revenue, currency)} · ${st.units} units`,
        value: st.profit,
      }));

    // Expense breakdown
    const expCatMap = new Map<string, number>();
    for (const e of expenses) {
      expCatMap.set(e.category, (expCatMap.get(e.category) || 0) + e.amount);
    }
    const totalExpAll = expenses.reduce((sum, e) => sum + e.amount, 0);
    const expenseRank = Array.from(expCatMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, val]) => ({
        label,
        sublabel: totalExpAll > 0 ? `${((val / totalExpAll) * 100).toFixed(1)}% of total spend` : '',
        value: val,
      }));

    // Customer growth
    const newCustomersThisMonth = customers.filter((c) =>
      c.created_at.startsWith(currMonthPrefix)
    ).length;
    const repeatCustomers = customers.filter((c) => (c.sale_count || 0) >= 2).length;
    const topCustomer = [...customers].sort(
      (a, b) => (b.total_spent || 0) - (a.total_spent || 0)
    )[0];

    // Monthly trend (6m)
    const monthlyTrend: TrendPoint[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-UG', { month: 'short' });
      const inc = sales
        .filter((s) => s.sale_date.startsWith(prefix))
        .reduce((sum, s) => sum + s.total_amount, 0);
      const exp = expenses
        .filter((e) => e.expense_date.startsWith(prefix))
        .reduce((sum, e) => sum + e.amount, 0);
      monthlyTrend.push({ label, income: inc, expenses: exp, profit: inc - exp });
    }

    // Live data-driven recommendations
    const recommendations: Array<{ title: string; detail: string; impact: string }> = [];

    if (mostProfitableServices.length > 0) {
      const topSvc = mostProfitableServices[0];
      recommendations.push({
        title: `Scale "${topSvc.label}" — Your Highest-Profit Category`,
        detail: `${topSvc.label} generated ${formatCurrency(topSvc.value, currency)} in estimated gross profit. Feature bundle packages or targeted corporate promos around this line to boost margins.`,
        impact: 'High Profit Driver',
      });
    }

    if (expenseRank.length > 0 && totalExpAll > 0) {
      const topExp = expenseRank[0];
      const pct = ((topExp.value / totalExpAll) * 100).toFixed(1);
      recommendations.push({
        title: `Optimize "${topExp.label}" Spend (${pct}% of Expenses)`,
        detail: `${topExp.label} accounts for ${formatCurrency(topExp.value, currency)} of total expenses. Consider bulk supplier negotiations or monthly pre-purchases to reduce per-job material overhead.`,
        impact: 'Cost Reduction',
      });
    }

    const totalReceivables = sales.reduce((sum, s) => sum + s.balance_due, 0);
    const unpaidCount = sales.filter((s) => s.balance_due > 0).length;
    if (totalReceivables > 0) {
      recommendations.push({
        title: `Collect ${formatCurrency(totalReceivables, currency)} in Pending Customer Balances`,
        detail: `You currently have ${unpaidCount} partially paid or unpaid invoices. Sending WhatsApp receipt reminders before order handover will directly lift your cash flow.`,
        impact: 'Cash Flow Recovery',
      });
    }

    if (prevMonthRevenue > 0) {
      const growthPct = ((monthlyRevenue - prevMonthRevenue) / prevMonthRevenue) * 100;
      recommendations.push({
        title:
          growthPct >= 0
            ? `Month-over-Month Revenue is Up ${growthPct.toFixed(1)}%`
            : `Month-over-Month Revenue is Down ${Math.abs(growthPct).toFixed(1)}%`,
        detail:
          growthPct >= 0
            ? `Current month sales (${formatCurrency(monthlyRevenue, currency)}) are outpacing last month (${formatCurrency(prevMonthRevenue, currency)}). Maintain turnaround speed to convert repeat clients.`
            : `Current month sales (${formatCurrency(monthlyRevenue, currency)}) trail last month (${formatCurrency(prevMonthRevenue, currency)}). Follow up with ${topCustomer ? topCustomer.name : 'past clients'} for repeat print runs.`,
        impact: 'Performance Comparison',
      });
    }

    return {
      dailyRevenue,
      weeklyRevenue,
      monthlyRevenue,
      yearlyRevenue,
      monthlyExpenses,
      monthlyProfit,
      prevMonthRevenue,
      prevMonthExpenses,
      prevMonthProfit,
      bestSellingProducts,
      mostProfitableServices,
      expenseRank,
      newCustomersThisMonth,
      repeatCustomers,
      topCustomer,
      monthlyTrend,
      recommendations,
    };
  }, [sales, expenses, customers, currency]);

  const momDiff = analytics.monthlyRevenue - analytics.prevMonthRevenue;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Business Growth &amp; Analytics</h2>
        <p className="text-sm text-slate-500">
          Revenue velocity, product margins, customer retention, and data-backed recommendations
        </p>
      </div>

      {/* Revenue Velocity Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Daily Revenue (Today)</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrency(analytics.dailyRevenue, currency)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Weekly Revenue (This Week)</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrency(analytics.weeklyRevenue, currency)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Monthly Revenue (This Month)</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrency(analytics.monthlyRevenue, currency)}
          </p>
        </div>
        <div className="bg-[#0B1D3A] text-white rounded-xl p-4">
          <p className="text-xs text-amber-300">Yearly Revenue ({new Date().getFullYear()})</p>
          <p className="text-xl font-bold font-mono tabular-nums mt-1">
            {formatCurrency(analytics.yearlyRevenue, currency)}
          </p>
        </div>
      </div>

      {/* Monthly Performance Comparison & Customer Growth */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">
              Monthly Performance Comparison
            </h3>
            <span
              className={`text-xs font-semibold inline-flex items-center gap-1 ${
                momDiff >= 0 ? 'text-emerald-700' : 'text-rose-600'
              }`}
            >
              {momDiff >= 0 ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              {momDiff >= 0 ? 'Growing' : 'Trailing'} vs Last Month
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm font-mono tabular-nums">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-[11px] font-sans text-slate-500">This Month Income</p>
              <p className="font-bold text-slate-900 mt-1">
                {formatCurrency(analytics.monthlyRevenue, currency)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Prev: {formatCurrency(analytics.prevMonthRevenue, currency)}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-[11px] font-sans text-slate-500">This Month Expenses</p>
              <p className="font-bold text-rose-600 mt-1">
                {formatCurrency(analytics.monthlyExpenses, currency)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Prev: {formatCurrency(analytics.prevMonthExpenses, currency)}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-[11px] font-sans text-slate-500">This Month Net</p>
              <p
                className={`font-bold mt-1 ${
                  analytics.monthlyProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                }`}
              >
                {formatCurrency(analytics.monthlyProfit, currency)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Prev: {formatCurrency(analytics.prevMonthProfit, currency)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">Customer Growth &amp; Retention</h3>
            <Users className="w-4 h-4 text-[#C89B3C]" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-[11px] text-slate-500">Total Customers</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
                {customers.length}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-[11px] text-slate-500">Repeat Clients</p>
              <p className="text-lg font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {analytics.repeatCustomers}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-[11px] text-slate-500">Added This Month</p>
              <p className="text-lg font-bold font-mono tabular-nums text-[#0B1D3A] mt-1">
                +{analytics.newCustomersThisMonth}
              </p>
            </div>
          </div>

          {analytics.topCustomer && (
            <p className="text-xs text-slate-600">
              Top client by lifetime value:{' '}
              <strong className="text-slate-900">{analytics.topCustomer.name}</strong> (
              <span className="font-mono">
                {formatCurrency(analytics.topCustomer.total_spent || 0, currency)}
              </span>
              )
            </p>
          )}
        </div>
      </div>

      {/* 6-Month Sales & Profit Trend Chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-base font-bold text-slate-900 mb-1">6-Month Financial Growth</h3>
        <p className="text-xs text-slate-500 mb-4">
          Comparing monthly revenue, expenditure, and net profit
        </p>
        <FinancialTrendChart data={analytics.monthlyTrend} currency={currency} />
      </div>

      {/* Best-Selling Products & Most Profitable Services */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-base font-bold text-slate-900">Most Profitable Services</h3>
          <p className="text-xs text-slate-500 mb-4">
            Estimated gross profit (Revenue minus production cost)
          </p>
          <HorizontalRankChart
            items={analytics.mostProfitableServices}
            currency={currency}
            barColorClass="bg-emerald-600"
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-base font-bold text-slate-900">Best-Selling Products</h3>
          <p className="text-xs text-slate-500 mb-4">Ranked by total sales revenue</p>
          <HorizontalRankChart
            items={analytics.bestSellingProducts}
            currency={currency}
            barColorClass="bg-[#0B1D3A]"
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-base font-bold text-slate-900">Cost Drivers</h3>
          <p className="text-xs text-slate-500 mb-4">Where business expenses are concentrated</p>
          <HorizontalRankChart
            items={analytics.expenseRank}
            currency={currency}
            barColorClass="bg-rose-500"
          />
        </div>
      </div>

      {/* Data-Driven Business Recommendations */}
      <div className="bg-[#0B1D3A] text-white rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Lightbulb className="w-5 h-5 text-[#C89B3C]" />
          <div>
            <h3 className="text-base font-bold">
              Actionable Business Recommendations
            </h3>
            <p className="text-xs text-slate-300">
              Automatically calculated from your recorded sales, costs, and customer balances
            </p>
          </div>
        </div>

        {analytics.recommendations.length === 0 ? (
          <p className="text-sm text-slate-300">
            Record more sales and expenses to unlock tailored profit and cost recommendations.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {analytics.recommendations.map((rec, idx) => (
              <div
                key={idx}
                className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-1.5"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#C89B3C]">
                  {rec.impact}
                </p>
                <h4 className="text-sm font-bold text-white">{rec.title}</h4>
                <p className="text-xs text-slate-300 leading-relaxed">{rec.detail}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
