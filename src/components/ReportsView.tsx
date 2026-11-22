import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { BusinessSettings, Customer, Expense, Sale } from '../types';
import {
  formatCurrency,
  formatDate,
  startOfMonthIso,
  startOfWeekIso,
  todayIsoDate,
} from '../utils/format';
import {
  downloadReportExcel,
  downloadReportPdf,
  ReportExportOptions,
} from '../utils/exports';

interface ReportsViewProps {
  settings: BusinessSettings;
  sales: Sale[];
  expenses: Expense[];
  customers: Customer[];
}

type ReportType =
  | 'daily_sales'
  | 'weekly_sales'
  | 'monthly_financial'
  | 'annual_financial'
  | 'expense_report'
  | 'profit_loss'
  | 'customer_report'
  | 'outstanding_payments';

const REPORT_TYPES: Array<{ id: ReportType; label: string; desc: string }> = [
  { id: 'daily_sales', label: 'Daily Sales Report', desc: 'All sales and receipts for a single date' },
  { id: 'weekly_sales', label: 'Weekly Sales Report', desc: '7-day sales ledger starting Monday' },
  { id: 'monthly_financial', label: 'Monthly Financial Report', desc: 'Combined income & expenses for selected month' },
  { id: 'annual_financial', label: 'Annual Financial Report', desc: 'Month-by-month breakdown for full year' },
  { id: 'expense_report', label: 'Expense Report', desc: 'All recorded expenditures by date & category' },
  { id: 'profit_loss', label: 'Profit & Loss Statement', desc: 'Revenue, COGS/costs, operating expenses & net profit' },
  { id: 'customer_report', label: 'Customer Report', desc: 'Client spend, order counts, and contact directory' },
  { id: 'outstanding_payments', label: 'Outstanding Payment Report', desc: 'All unpaid and partially paid customer balances' },
];

export const ReportsView: React.FC<ReportsViewProps> = ({
  settings,
  sales,
  expenses,
  customers,
}) => {
  const currency = settings.currency || 'UGX';
  const [reportType, setReportType] = useState<ReportType>('monthly_financial');
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());
  const [selectedMonth, setSelectedMonth] = useState(startOfMonthIso().slice(0, 7));
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));

  const reportData: ReportExportOptions = useMemo(() => {
    if (reportType === 'daily_sales') {
      const rows = sales
        .filter((s) => s.sale_date === selectedDate)
        .map((s) => [
          s.receipt_number,
          s.customer_name,
          s.items.map((i) => `${i.product_name} (${i.quantity})`).join(', '),
          s.payment_method,
          formatCurrency(s.total_amount, currency),
          formatCurrency(s.amount_paid, currency),
          formatCurrency(s.balance_due, currency),
        ]);
      const daySales = sales.filter((s) => s.sale_date === selectedDate);
      const total = daySales.reduce((a, b) => a + b.total_amount, 0);
      const paid = daySales.reduce((a, b) => a + b.amount_paid, 0);
      return {
        title: 'Daily Sales Report',
        subtitle: `Date: ${formatDate(selectedDate)}`,
        fileName: `daily-sales-${selectedDate}`,
        columns: ['Receipt #', 'Customer', 'Items', 'Method', 'Total', 'Paid', 'Balance'],
        rows,
        summaryPairs: [
          ['Transactions', String(daySales.length)],
          ['Total Billed', formatCurrency(total, currency)],
          ['Cash Collected', formatCurrency(paid, currency)],
          ['Outstanding', formatCurrency(total - paid, currency)],
        ],
        settings,
      };
    }

    if (reportType === 'weekly_sales') {
      const weekStart = startOfWeekIso(new Date(`${selectedDate}T00:00:00`));
      const endObj = new Date(`${weekStart}T00:00:00`);
      endObj.setDate(endObj.getDate() + 6);
      const weekEnd = `${endObj.getFullYear()}-${String(endObj.getMonth() + 1).padStart(2, '0')}-${String(endObj.getDate()).padStart(2, '0')}`;

      const weekSales = sales.filter((s) => s.sale_date >= weekStart && s.sale_date <= weekEnd);
      const total = weekSales.reduce((a, b) => a + b.total_amount, 0);
      const paid = weekSales.reduce((a, b) => a + b.amount_paid, 0);

      return {
        title: 'Weekly Sales Report',
        subtitle: `Period: ${formatDate(weekStart)} to ${formatDate(weekEnd)}`,
        fileName: `weekly-sales-${weekStart}`,
        columns: ['Date', 'Receipt #', 'Customer', 'Method', 'Total', 'Paid', 'Balance'],
        rows: weekSales.map((s) => [
          formatDate(s.sale_date),
          s.receipt_number,
          s.customer_name,
          s.payment_method,
          formatCurrency(s.total_amount, currency),
          formatCurrency(s.amount_paid, currency),
          formatCurrency(s.balance_due, currency),
        ]),
        summaryPairs: [
          ['Weekly Transactions', String(weekSales.length)],
          ['Weekly Sales Total', formatCurrency(total, currency)],
          ['Collected', formatCurrency(paid, currency)],
          ['Balance Due', formatCurrency(total - paid, currency)],
        ],
        settings,
      };
    }

    if (reportType === 'monthly_financial') {
      const mSales = sales.filter((s) => s.sale_date.startsWith(selectedMonth));
      const mExp = expenses.filter((e) => e.expense_date.startsWith(selectedMonth));
      const totalIn = mSales.reduce((a, b) => a + b.total_amount, 0);
      const totalOut = mExp.reduce((a, b) => a + b.amount, 0);

      const combinedRows = [
        ...mSales.map((s) => ({
          date: s.sale_date,
          type: 'Income',
          ref: s.receipt_number,
          desc: `${s.customer_name} (${s.items.map((i) => i.product_name).join(', ')})`,
          amount: `+ ${formatCurrency(s.total_amount, currency)}`,
        })),
        ...mExp.map((e) => ({
          date: e.expense_date,
          type: 'Expense',
          ref: e.category,
          desc: e.title,
          amount: `- ${formatCurrency(e.amount, currency)}`,
        })),
      ].sort((a, b) => (a.date < b.date ? 1 : -1));

      return {
        title: 'Monthly Financial Report',
        subtitle: `Month: ${selectedMonth}`,
        fileName: `monthly-financial-${selectedMonth}`,
        columns: ['Date', 'Type', 'Reference / Category', 'Description', 'Amount'],
        rows: combinedRows.map((r) => [formatDate(r.date), r.type, r.ref, r.desc, r.amount]),
        summaryPairs: [
          ['Monthly Income', formatCurrency(totalIn, currency)],
          ['Monthly Expenses', formatCurrency(totalOut, currency)],
          ['Monthly Net Profit', formatCurrency(totalIn - totalOut, currency)],
          ['Transactions Count', String(combinedRows.length)],
        ],
        settings,
      };
    }

    if (reportType === 'annual_financial') {
      const months = Array.from({ length: 12 }, (_, idx) => {
        const m = String(idx + 1).padStart(2, '0');
        const prefix = `${selectedYear}-${m}`;
        const label = new Date(Number(selectedYear), idx, 1).toLocaleDateString('en-UG', {
          month: 'long',
        });
        const inc = sales
          .filter((s) => s.sale_date.startsWith(prefix))
          .reduce((a, b) => a + b.total_amount, 0);
        const exp = expenses
          .filter((e) => e.expense_date.startsWith(prefix))
          .reduce((a, b) => a + b.amount, 0);
        return { label, inc, exp, net: inc - exp };
      });
      const yInc = months.reduce((a, b) => a + b.inc, 0);
      const yExp = months.reduce((a, b) => a + b.exp, 0);

      return {
        title: 'Annual Financial Report',
        subtitle: `Fiscal Year: ${selectedYear}`,
        fileName: `annual-financial-${selectedYear}`,
        columns: ['Month', 'Gross Income', 'Total Expenses', 'Net Profit / Loss'],
        rows: months.map((m) => [
          m.label,
          formatCurrency(m.inc, currency),
          formatCurrency(m.exp, currency),
          formatCurrency(m.net, currency),
        ]),
        summaryPairs: [
          ['Annual Revenue', formatCurrency(yInc, currency)],
          ['Annual Expenses', formatCurrency(yExp, currency)],
          ['Annual Net Profit', formatCurrency(yInc - yExp, currency)],
          [
            'Profit Margin',
            yInc > 0 ? `${(((yInc - yExp) / yInc) * 100).toFixed(1)}%` : '0.0%',
          ],
        ],
        settings,
      };
    }

    if (reportType === 'expense_report') {
      const mExp = expenses.filter((e) => e.expense_date.startsWith(selectedMonth));
      const total = mExp.reduce((a, b) => a + b.amount, 0);
      return {
        title: 'Expense Report',
        subtitle: `Month: ${selectedMonth}`,
        fileName: `expense-report-${selectedMonth}`,
        columns: ['Date', 'Description', 'Category', 'Vendor', 'Method', 'Amount'],
        rows: mExp.map((e) => [
          formatDate(e.expense_date),
          e.title,
          e.category,
          e.vendor || '—',
          e.payment_method,
          formatCurrency(e.amount, currency),
        ]),
        summaryPairs: [
          ['Expense Entries', String(mExp.length)],
          ['Total Expenses', formatCurrency(total, currency)],
        ],
        settings,
      };
    }

    if (reportType === 'profit_loss') {
      const mSales = sales.filter((s) => s.sale_date.startsWith(selectedMonth));
      const mExp = expenses.filter((e) => e.expense_date.startsWith(selectedMonth));

      const grossSales = mSales.reduce((a, b) => a + b.subtotal, 0);
      const discounts = mSales.reduce((a, b) => a + b.discount, 0);
      const netSales = mSales.reduce((a, b) => a + b.total_amount, 0);
      const totalOpEx = mExp.reduce((a, b) => a + b.amount, 0);

      const expByCat = new Map<string, number>();
      for (const e of mExp) {
        expByCat.set(e.category, (expByCat.get(e.category) || 0) + e.amount);
      }

      const rows: Array<[string, string, string]> = [
        ['INCOME', 'Gross Sales Revenue', formatCurrency(grossSales, currency)],
        ['INCOME', 'Less: Customer Discounts', `- ${formatCurrency(discounts, currency)}`],
        ['INCOME', 'Net Operating Revenue', formatCurrency(netSales, currency)],
        ...Array.from(expByCat.entries()).map(([cat, amt]): [string, string, string] => [
          'EXPENDITURE',
          cat,
          formatCurrency(amt, currency),
        ]),
        ['SUMMARY', 'Total Operating Expenditures', formatCurrency(totalOpEx, currency)],
        ['SUMMARY', 'NET PROFIT / (LOSS)', formatCurrency(netSales - totalOpEx, currency)],
      ];

      return {
        title: 'Profit & Loss Statement',
        subtitle: `Accounting Period: ${selectedMonth}`,
        fileName: `profit-and-loss-${selectedMonth}`,
        columns: ['Section', 'Line Item', 'Amount'],
        rows,
        summaryPairs: [
          ['Net Revenue', formatCurrency(netSales, currency)],
          ['Total Expenses', formatCurrency(totalOpEx, currency)],
          ['Net Profit', formatCurrency(netSales - totalOpEx, currency)],
          [
            'Net Margin',
            netSales > 0 ? `${(((netSales - totalOpEx) / netSales) * 100).toFixed(1)}%` : '0.0%',
          ],
        ],
        settings,
      };
    }

    if (reportType === 'customer_report') {
      const totalSpentAll = customers.reduce((a, c) => a + (c.total_spent || 0), 0);
      const totalBalAll = customers.reduce((a, c) => a + (c.outstanding_balance || 0), 0);
      return {
        title: 'Customer Report',
        subtitle: `All Registered Clients (${customers.length})`,
        fileName: `customer-report-${todayIsoDate()}`,
        columns: ['Customer Name', 'Phone', 'Location', 'Orders', 'Total Spent', 'Balance Due'],
        rows: customers.map((c) => [
          c.name,
          c.phone || '—',
          c.location || '—',
          String((c.order_count || 0) + (c.sale_count || 0)),
          formatCurrency(c.total_spent || 0, currency),
          formatCurrency(c.outstanding_balance || 0, currency),
        ]),
        summaryPairs: [
          ['Total Customers', String(customers.length)],
          ['Cumulative Client Spend', formatCurrency(totalSpentAll, currency)],
          ['Total Receivables', formatCurrency(totalBalAll, currency)],
        ],
        settings,
      };
    }

    // outstanding_payments
    const unpaidSales = sales.filter((s) => s.balance_due > 0);
    const totalDue = unpaidSales.reduce((a, s) => a + s.balance_due, 0);
    return {
      title: 'Outstanding Payment Report',
      subtitle: `All Unpaid & Partially Paid Invoices as of ${formatDate(todayIsoDate())}`,
      fileName: `outstanding-payments-${todayIsoDate()}`,
      columns: ['Receipt #', 'Date', 'Customer', 'Phone', 'Total', 'Paid', 'Balance Due'],
      rows: unpaidSales.map((s) => [
        s.receipt_number,
        formatDate(s.sale_date),
        s.customer_name,
        s.customer_phone || '—',
        formatCurrency(s.total_amount, currency),
        formatCurrency(s.amount_paid, currency),
        formatCurrency(s.balance_due, currency),
      ]),
      summaryPairs: [
        ['Pending Invoices', String(unpaidSales.length)],
        ['Total Outstanding Receivables', formatCurrency(totalDue, currency)],
      ],
      settings,
    };
  }, [reportType, selectedDate, selectedMonth, selectedYear, sales, expenses, customers, settings, currency]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Financial &amp; Business Reports</h2>
          <p className="text-sm text-slate-500">
            Generate, preview, and export official PDF and Excel reports
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => downloadReportPdf(reportData)}
            className="h-10 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4 text-[#C89B3C]" />
            Download PDF
          </button>
          <button
            type="button"
            onClick={() => downloadReportExcel(reportData)}
            className="h-10 px-4 rounded-lg border border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* Report Selector Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {REPORT_TYPES.map((rt) => {
          const active = reportType === rt.id;
          return (
            <button
              key={rt.id}
              type="button"
              onClick={() => setReportType(rt.id)}
              className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                active
                  ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]'
                  : 'bg-white text-slate-900 border-slate-200 hover:border-slate-300'
              }`}
            >
              <p className={`text-sm font-bold ${active ? 'text-white' : 'text-slate-900'}`}>
                {rt.label}
              </p>
              <p className={`text-xs mt-1 ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                {rt.desc}
              </p>
            </button>
          );
        })}
      </div>

      {/* Report Period Filter */}
      {(reportType === 'daily_sales' ||
        reportType === 'weekly_sales' ||
        reportType === 'monthly_financial' ||
        reportType === 'expense_report' ||
        reportType === 'profit_loss' ||
        reportType === 'annual_financial') && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-4">
          {(reportType === 'daily_sales' || reportType === 'weekly_sales') && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-700">
                {reportType === 'daily_sales' ? 'Select Date:' : 'Any Date in Week:'}
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-9 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
          )}

          {(reportType === 'monthly_financial' ||
            reportType === 'expense_report' ||
            reportType === 'profit_loss') && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-700">Select Month:</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-9 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
          )}

          {reportType === 'annual_financial' && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-700">Select Year:</label>
              <input
                type="number"
                min={2020}
                max={2035}
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="h-9 w-28 px-3 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
          )}
        </div>
      )}

      {/* Report Live Preview */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">{reportData.title}</h3>
            <p className="text-xs text-slate-500">{reportData.subtitle}</p>
          </div>
          <span className="text-xs font-mono text-slate-500">
            {reportData.rows.length} rows
          </span>
        </div>

        {reportData.summaryPairs && reportData.summaryPairs.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5 border-b border-slate-200 bg-white">
            {reportData.summaryPairs.map(([label, val]) => (
              <div key={label}>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-sm font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                  {val}
                </p>
              </div>
            ))}
          </div>
        )}

        {reportData.rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No records found for this report period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="bg-[#0B1D3A] text-white text-xs">
                  {reportData.columns.map((col) => (
                    <th key={col} className="py-2.5 px-4 font-semibold whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reportData.rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/70">
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        className="py-2.5 px-4 text-xs text-slate-800 font-mono tabular-nums"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
