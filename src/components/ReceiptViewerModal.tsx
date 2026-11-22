import React, { useState } from 'react';
import { Check, Copy, Download, MessageCircle, Printer, X } from 'lucide-react';
import { BusinessSettings, Sale } from '../types';
import { formatCurrency, formatDate, formatDateTime } from '../utils/format';
import { buildWhatsAppReceiptUrl, downloadReceiptPdf } from '../utils/exports';

interface ReceiptCardProps {
  sale: Sale;
  settings: BusinessSettings;
}

export const ReceiptCard: React.FC<ReceiptCardProps> = ({ sale, settings }) => {
  const template = settings.receipt_template || 'executive';

  if (template === 'compact') {
    return (
      <div className="print-surface max-w-md mx-auto bg-white border border-slate-200 rounded-lg p-6 text-slate-900 shadow-xs">
        <div className="text-center border-b border-dashed border-slate-300 pb-4">
          {settings.logo_url && (
            <img
              src={settings.logo_url}
              alt={settings.business_name}
              referrerPolicy="no-referrer"
              className="w-12 h-12 mx-auto mb-2 rounded-lg object-cover border border-slate-200"
            />
          )}
          <h3 className="text-base font-bold uppercase tracking-tight">{settings.business_name}</h3>
          <p className="text-xs text-slate-500">{settings.location}</p>
          <p className="text-xs text-slate-500 font-mono">
            {[settings.phone_primary, settings.phone_secondary].filter(Boolean).join(' / ')}
          </p>
        </div>

        <div className="py-3 border-b border-dashed border-slate-300 text-xs space-y-1 font-mono">
          <div className="flex justify-between">
            <span className="text-slate-500">Receipt No:</span>
            <span className="font-bold">{sale.receipt_number}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Date:</span>
            <span>{formatDate(sale.sale_date)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Customer:</span>
            <span className="font-semibold">{sale.customer_name}</span>
          </div>
          {sale.customer_phone && (
            <div className="flex justify-between">
              <span className="text-slate-500">Phone:</span>
              <span>{sale.customer_phone}</span>
            </div>
          )}
        </div>

        <div className="py-3 border-b border-dashed border-slate-300 space-y-2 text-xs">
          {sale.items.map((item, idx) => (
            <div key={idx} className="flex justify-between gap-2">
              <div>
                <p className="font-medium text-slate-900">{item.product_name}</p>
                <p className="text-slate-500 font-mono tabular-nums">
                  {item.quantity} x {formatCurrency(item.unit_price, settings.currency)}
                </p>
              </div>
              <span className="font-mono tabular-nums font-semibold shrink-0">
                {formatCurrency(item.line_total, settings.currency)}
              </span>
            </div>
          ))}
        </div>

        <div className="py-3 space-y-1.5 text-xs font-mono tabular-nums">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{formatCurrency(sale.subtotal, settings.currency)}</span>
          </div>
          {sale.discount > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Discount</span>
              <span>-{formatCurrency(sale.discount, settings.currency)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold text-[#0B1D3A] pt-1 border-t border-slate-200">
            <span>TOTAL</span>
            <span>{formatCurrency(sale.total_amount, settings.currency)}</span>
          </div>
          <div className="flex justify-between text-emerald-700 font-semibold">
            <span>Paid ({sale.payment_method})</span>
            <span>{formatCurrency(sale.amount_paid, settings.currency)}</span>
          </div>
          <div className="flex justify-between font-bold text-slate-900">
            <span>Balance Due</span>
            <span className={sale.balance_due > 0 ? 'text-red-600' : 'text-emerald-700'}>
              {formatCurrency(sale.balance_due, settings.currency)}
            </span>
          </div>
        </div>

        <div className="pt-4 border-t border-dashed border-slate-300 text-center text-xs text-slate-500">
          <p className="italic">{settings.receipt_thank_you}</p>
        </div>
      </div>
    );
  }

  const isExecutive = template === 'executive';

  return (
    <div className="print-surface bg-white border border-slate-200 rounded-xl overflow-hidden text-slate-900 shadow-xs">
      {/* Header */}
      <div
        className={
          isExecutive
            ? 'bg-[#0B1D3A] text-white px-6 py-6 border-b-4 border-[#C89B3C]'
            : 'bg-slate-50 text-slate-900 px-6 py-6 border-b-2 border-[#0B1D3A]'
        }
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {settings.logo_url && (
              <div className="w-16 h-16 rounded-lg overflow-hidden border border-amber-400/30 bg-[#0B1D3A] shrink-0">
                <img
                  src={settings.logo_url}
                  alt={settings.business_name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div>
              <h3 className="text-lg font-bold tracking-tight uppercase">
                {settings.business_name}
              </h3>
              {settings.tagline && (
                <p className={`text-xs ${isExecutive ? 'text-amber-300' : 'text-[#0B1D3A] font-medium'}`}>
                  {settings.tagline}
                </p>
              )}
              <div
                className={`mt-1.5 text-xs space-y-0.5 ${
                  isExecutive ? 'text-slate-300' : 'text-slate-600'
                }`}
              >
                <p>
                  {[settings.phone_primary, settings.phone_secondary].filter(Boolean).join(' · ')}
                </p>
                <p>{[settings.email, settings.location].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          </div>

          <div className="sm:text-right">
            <p
              className={`text-xs font-semibold uppercase tracking-wider ${
                isExecutive ? 'text-[#C89B3C]' : 'text-[#0B1D3A]'
              }`}
            >
              Official Receipt
            </p>
            <p className="text-xl font-bold font-mono tabular-nums mt-0.5">
              {sale.receipt_number}
            </p>
            <p className={`text-xs mt-1 ${isExecutive ? 'text-slate-300' : 'text-slate-500'}`}>
              Date: {formatDate(sale.sale_date)}
            </p>
            <p className={`text-[11px] ${isExecutive ? 'text-slate-400' : 'text-slate-400'}`}>
              Recorded: {formatDateTime(sale.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Customer & Payment Details */}
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Customer Details
            </p>
            <p className="text-sm font-bold text-slate-900 mt-1">{sale.customer_name}</p>
            <p className="text-xs text-slate-600 font-mono mt-0.5">
              {sale.customer_phone || 'No phone number recorded'}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Payment Summary
            </p>
            <p className="text-sm font-semibold text-slate-900 mt-1">
              Method: {sale.payment_method}
            </p>
            <p
              className={`text-xs font-semibold mt-0.5 ${
                sale.payment_status === 'Paid'
                  ? 'text-emerald-700'
                  : sale.payment_status === 'Partially Paid'
                  ? 'text-amber-700'
                  : 'text-red-600'
              }`}
            >
              Status: {sale.payment_status}
            </p>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="bg-[#0B1D3A] text-white text-xs">
                <th className="py-2.5 px-3 font-semibold">#</th>
                <th className="py-2.5 px-3 font-semibold">Product / Service</th>
                <th className="py-2.5 px-3 font-semibold text-right">Qty</th>
                <th className="py-2.5 px-3 font-semibold text-right">Unit Price</th>
                <th className="py-2.5 px-3 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sale.items.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-3 text-slate-500 font-mono tabular-nums">{idx + 1}</td>
                  <td className="py-2.5 px-3 font-medium text-slate-900">{item.product_name}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                    {item.quantity}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                    {formatCurrency(item.unit_price, settings.currency)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {formatCurrency(item.line_total, settings.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex flex-col sm:flex-row justify-between gap-6 pt-2">
          <div className="flex-1 text-xs text-slate-600 space-y-2">
            {sale.notes && (
              <div>
                <p className="font-semibold text-slate-800">Order / Sale Notes</p>
                <p className="mt-0.5">{sale.notes}</p>
              </div>
            )}
            {sale.payments && sale.payments.length > 0 && (
              <div>
                <p className="font-semibold text-slate-800">Payment Log</p>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-500">
                  {sale.payments.map((p) => (
                    <li key={p.id}>
                      {formatDate(p.paid_at)} · {p.payment_method} ·{' '}
                      {formatCurrency(p.amount, settings.currency)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="w-full sm:w-72 space-y-2 text-sm font-mono tabular-nums">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{formatCurrency(sale.subtotal, settings.currency)}</span>
            </div>
            {sale.discount > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Discount</span>
                <span>- {formatCurrency(sale.discount, settings.currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-[#0B1D3A] pt-2 border-t border-slate-200">
              <span>Total Amount</span>
              <span>{formatCurrency(sale.total_amount, settings.currency)}</span>
            </div>
            <div className="flex justify-between text-emerald-700 font-semibold">
              <span>Amount Paid</span>
              <span>{formatCurrency(sale.amount_paid, settings.currency)}</span>
            </div>
            <div className="flex justify-between font-bold pt-1 border-t border-slate-200">
              <span>Outstanding Balance</span>
              <span className={sale.balance_due > 0 ? 'text-red-600' : 'text-emerald-700'}>
                {formatCurrency(sale.balance_due, settings.currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Thank You Footer */}
        <div className="pt-4 border-t border-amber-300/60 text-center">
          <p className="text-xs italic text-slate-600">{settings.receipt_thank_you}</p>
        </div>
      </div>
    </div>
  );
};

interface ReceiptViewerModalProps {
  sale: Sale | null;
  settings: BusinessSettings;
  onClose: () => void;
}

export const ReceiptViewerModal: React.FC<ReceiptViewerModalProps> = ({
  sale,
  settings,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!sale) return null;

  const whatsappUrl = buildWhatsAppReceiptUrl(sale, settings);

  const handleCopyText = async () => {
    const text = [
      `${settings.business_name}`,
      `Receipt: ${sale.receipt_number} | Date: ${formatDate(sale.sale_date)}`,
      `Customer: ${sale.customer_name} (${sale.customer_phone || 'N/A'})`,
      ...sale.items.map(
        (i) => `- ${i.product_name} x${i.quantity}: ${formatCurrency(i.line_total, settings.currency)}`
      ),
      `Total: ${formatCurrency(sale.total_amount, settings.currency)}`,
      `Paid: ${formatCurrency(sale.amount_paid, settings.currency)} (${sale.payment_method})`,
      `Balance: ${formatCurrency(sale.balance_due, settings.currency)}`,
      settings.receipt_thank_you,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard restrictions
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-3xl bg-slate-50 rounded-xl border border-slate-200 shadow-2xl overflow-hidden my-auto">
        <div className="no-print bg-white px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Electronic Receipt · {sale.receipt_number}
            </h3>
            <p className="text-xs text-slate-500">
              {sale.customer_name} · {formatDate(sale.sale_date)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => downloadReceiptPdf(sale, settings)}
              className="h-9 px-3 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-[#C89B3C]" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.electronAPI?.printCurrent) {
                  void window.electronAPI.printCurrent();
                } else {
                  window.print();
                }
              }}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              WhatsApp
            </a>
            <button
              type="button"
              onClick={handleCopyText}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close receipt viewer"
              className="h-9 w-9 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 max-h-[82vh] overflow-y-auto">
          <ReceiptCard sale={sale} settings={settings} />
        </div>
      </div>
    </div>
  );
};
