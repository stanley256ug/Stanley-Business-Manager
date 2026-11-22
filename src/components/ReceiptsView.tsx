import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, MessageCircle, Plus, Printer, Search } from 'lucide-react';
import { BusinessSettings, Sale } from '../types';
import { formatCurrency, formatDate } from '../utils/format';
import { buildWhatsAppReceiptUrl, downloadReceiptPdf } from '../utils/exports';
import { ReceiptCard } from './ReceiptViewerModal';

interface ReceiptsViewProps {
  settings: BusinessSettings;
  sales: Sale[];
  onCreateSaleClick: () => void;
}

export const ReceiptsView: React.FC<ReceiptsViewProps> = ({
  settings,
  sales,
  onCreateSaleClick,
}) => {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(sales[0]?.id ?? null);
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter(
      (s) =>
        s.receipt_number.toLowerCase().includes(q) ||
        s.customer_name.toLowerCase().includes(q) ||
        s.customer_phone.toLowerCase().includes(q)
    );
  }, [sales, search]);

  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].id);
    } else if (selectedId && !sales.some((s) => s.id === selectedId)) {
      setSelectedId(sales[0]?.id ?? null);
    }
  }, [sales, filtered, selectedId]);

  const activeSale = sales.find((s) => s.id === selectedId) || filtered[0] || null;
  const currency = settings.currency || 'UGX';

  const handleCopy = async () => {
    if (!activeSale) return;
    const text = [
      `${settings.business_name}`,
      `Receipt: ${activeSale.receipt_number} | Date: ${formatDate(activeSale.sale_date)}`,
      `Customer: ${activeSale.customer_name} (${activeSale.customer_phone || 'N/A'})`,
      ...activeSale.items.map(
        (i) => `- ${i.product_name} x${i.quantity}: ${formatCurrency(i.line_total, currency)}`
      ),
      `Total: ${formatCurrency(activeSale.total_amount, currency)}`,
      `Paid: ${formatCurrency(activeSale.amount_paid, currency)} (${activeSale.payment_method})`,
      `Balance: ${formatCurrency(activeSale.balance_due, currency)}`,
      settings.receipt_thank_you,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Electronic Receipt Generator</h2>
          <p className="text-sm text-slate-500">
            Search, preview, print, download PDF, or share receipts on WhatsApp
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateSaleClick}
          className="h-10 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 text-[#C89B3C]" />
          New Sale &amp; Receipt
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Receipt Archive List */}
        <div className="no-print lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-3.5 border-b border-slate-200">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search receipt #, customer, phone..."
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 text-sm"
              />
            </div>
          </div>

          <div className="max-h-[620px] overflow-y-auto divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No receipts found matching &ldquo;{search}&rdquo;.
              </div>
            ) : (
              filtered.map((s) => {
                const isSelected = activeSale?.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#0B1D3A]/5' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-[#0B1D3A]">
                        {s.receipt_number}
                      </span>
                      <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {formatCurrency(s.total_amount, currency)}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-900 truncate mt-0.5">
                      {s.customer_name}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                      <span>{formatDate(s.sale_date)}</span>
                      <span
                        className={
                          s.payment_status === 'Paid'
                            ? 'text-emerald-700 font-semibold'
                            : s.payment_status === 'Partially Paid'
                            ? 'text-amber-700 font-semibold'
                            : 'text-red-600 font-semibold'
                        }
                      >
                        {s.payment_status}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Receipt Live Preview */}
        <div className="lg:col-span-8 space-y-3">
          {activeSale ? (
            <>
              <div className="no-print bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  Selected: <strong className="text-slate-900 font-mono">{activeSale.receipt_number}</strong>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => downloadReceiptPdf(activeSale, settings)}
                    className="h-9 px-3 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#C89B3C]" />
                    Download PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print Receipt
                  </button>
                  <a
                    href={buildWhatsAppReceiptUrl(activeSale, settings)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Share on WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy Text'}
                  </button>
                </div>
              </div>

              <ReceiptCard sale={activeSale} settings={settings} />
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
              Select a receipt from the list or record a sale to generate an electronic receipt.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
