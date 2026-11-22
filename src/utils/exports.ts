import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { BusinessSettings, Sale } from '../types';
import { formatCurrency, formatDate, formatDateTime, normalizeUgPhoneForWhatsApp } from './format';

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:image/')) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function downloadReceiptPdf(sale: Sale, settings: BusinessSettings): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;

  // Navy header band
  doc.setFillColor(11, 29, 58); // #0B1D3A
  doc.rect(0, 0, pageWidth, 128, 'F');

  // Gold accent strip
  doc.setFillColor(200, 155, 60); // #C89B3C
  doc.rect(0, 128, pageWidth, 4, 'F');

  // Optional logo
  const logoData = await loadImageAsDataUrl(settings.logo_url);
  let textStartX = margin;
  if (logoData) {
    try {
      doc.addImage(logoData, 'JPEG', margin, 26, 72, 72);
      textStartX = margin + 88;
    } catch {
      textStartX = margin;
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(settings.business_name.toUpperCase(), textStartX, 48);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(212, 175, 55);
  if (settings.tagline) {
    doc.text(settings.tagline, textStartX, 65);
  }

  doc.setTextColor(226, 232, 240);
  const contactLines = [
    [settings.phone_primary, settings.phone_secondary].filter(Boolean).join('  |  '),
    [settings.email, settings.location].filter(Boolean).join('  |  '),
  ].filter(Boolean);
  contactLines.forEach((line, idx) => {
    doc.text(line, textStartX, 84 + idx * 14);
  });

  // Receipt badge on right
  doc.setTextColor(212, 175, 55);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('OFFICIAL RECEIPT', pageWidth - margin, 44, { align: 'right' });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text(sale.receipt_number, pageWidth - margin, 66, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`Date: ${formatDate(sale.sale_date)}`, pageWidth - margin, 84, { align: 'right' });
  doc.text(`Issued: ${formatDateTime(sale.created_at)}`, pageWidth - margin, 98, { align: 'right' });

  // Customer & payment info block
  const infoY = 160;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, infoY, contentWidth, 74, 4, 4, 'FD');

  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('BILLED TO', margin + 16, infoY + 20);
  doc.text('PAYMENT DETAILS', pageWidth / 2 + 20, infoY + 20);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(sale.customer_name, margin + 16, infoY + 38);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(sale.customer_phone || 'No phone provided', margin + 16, infoY + 55);

  doc.setTextColor(15, 23, 42);
  doc.text(`Method: ${sale.payment_method}`, pageWidth / 2 + 20, infoY + 38);
  doc.setFont('helvetica', 'bold');
  doc.text(`Status: ${sale.payment_status}`, pageWidth / 2 + 20, infoY + 55);

  // Items table
  autoTable(doc, {
    startY: infoY + 94,
    margin: { left: margin, right: margin },
    head: [['#', 'Product / Service Description', 'Qty', 'Unit Price', 'Line Total']],
    body: sale.items.map((item, idx) => [
      String(idx + 1),
      item.product_name,
      String(item.quantity),
      formatCurrency(item.unit_price, settings.currency),
      formatCurrency(item.line_total, settings.currency),
    ]),
    styles: {
      fontSize: 9.5,
      cellPadding: 8,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [11, 29, 58],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 28, halign: 'center' },
      2: { cellWidth: 45, halign: 'right' },
      3: { cellWidth: 105, halign: 'right' },
      4: { cellWidth: 110, halign: 'right' },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || infoY + 180;

  // Totals summary box on right
  const summaryX = pageWidth - margin - 230;
  let summaryY = finalY + 22;

  const summaryRows: Array<[string, string, boolean?]> = [
    ['Subtotal', formatCurrency(sale.subtotal, settings.currency)],
  ];
  if (sale.discount > 0) {
    summaryRows.push(['Discount', `- ${formatCurrency(sale.discount, settings.currency)}`]);
  }
  summaryRows.push(['Total Amount', formatCurrency(sale.total_amount, settings.currency), true]);
  summaryRows.push(['Amount Paid', formatCurrency(sale.amount_paid, settings.currency)]);
  summaryRows.push([
    'Outstanding Balance',
    formatCurrency(sale.balance_due, settings.currency),
    sale.balance_due > 0,
  ]);

  summaryRows.forEach(([label, value, highlight]) => {
    doc.setFont('helvetica', highlight ? 'bold' : 'normal');
    doc.setFontSize(highlight ? 11 : 10);
    doc.setTextColor(highlight ? 11 : 71, highlight ? 29 : 85, highlight ? 58 : 105);
    doc.text(label, summaryX, summaryY);
    doc.text(value, pageWidth - margin, summaryY, { align: 'right' });
    summaryY += 18;
  });

  // Notes & Thank-you footer
  const footerY = Math.max(summaryY + 26, 680);
  doc.setDrawColor(200, 155, 60);
  doc.setLineWidth(1);
  doc.line(margin, footerY, pageWidth - margin, footerY);

  if (sale.notes) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('Notes:', margin, footerY + 18);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(sale.notes, margin + 36, footerY + 18, { maxWidth: contentWidth - 36 });
  }

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.setTextColor(11, 29, 58);
  doc.text(
    settings.receipt_thank_you || 'Thank you for your business!',
    pageWidth / 2,
    footerY + 46,
    { align: 'center', maxWidth: contentWidth }
  );

  doc.save(`${sale.receipt_number}.pdf`);
}

export function buildWhatsAppReceiptUrl(sale: Sale, settings: BusinessSettings): string {
  const lines = [
    `*${settings.business_name.toUpperCase()}*`,
    settings.location ? `${settings.location}` : '',
    settings.phone_primary ? `Tel: ${settings.phone_primary}` : '',
    `--------------------------------`,
    `*OFFICIAL RECEIPT:* ${sale.receipt_number}`,
    `*Date:* ${formatDate(sale.sale_date)}`,
    `*Customer:* ${sale.customer_name}`,
    sale.customer_phone ? `*Phone:* ${sale.customer_phone}` : '',
    `--------------------------------`,
    `*Items Purchased:*`,
    ...sale.items.map(
      (i, idx) =>
        `${idx + 1}. ${i.product_name} (${i.quantity} x ${formatCurrency(i.unit_price, settings.currency)}) = ${formatCurrency(i.line_total, settings.currency)}`
    ),
    `--------------------------------`,
    `Subtotal: ${formatCurrency(sale.subtotal, settings.currency)}`,
    sale.discount > 0 ? `Discount: -${formatCurrency(sale.discount, settings.currency)}` : '',
    `*Total:* ${formatCurrency(sale.total_amount, settings.currency)}`,
    `*Amount Paid:* ${formatCurrency(sale.amount_paid, settings.currency)}`,
    `*Balance Due:* ${formatCurrency(sale.balance_due, settings.currency)}`,
    `*Payment Method:* ${sale.payment_method} (${sale.payment_status})`,
    `--------------------------------`,
    settings.receipt_thank_you || 'Thank you for your business!',
  ]
    .filter(Boolean)
    .join('\n');

  const phoneDigits = normalizeUgPhoneForWhatsApp(sale.customer_phone);
  const encoded = encodeURIComponent(lines);
  return phoneDigits ? `https://wa.me/${phoneDigits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export interface ReportExportOptions {
  title: string;
  subtitle: string;
  fileName: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  summaryPairs?: Array<[string, string]>;
  settings: BusinessSettings;
}

export async function downloadReportPdf(opts: ReportExportOptions): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  doc.setFillColor(11, 29, 58);
  doc.rect(0, 0, pageWidth, 88, 'F');
  doc.setFillColor(200, 155, 60);
  doc.rect(0, 88, pageWidth, 3, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(opts.settings.business_name.toUpperCase(), margin, 36);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(212, 175, 55);
  doc.text(opts.title, margin, 56);

  doc.setTextColor(203, 213, 225);
  doc.text(opts.subtitle, margin, 72);

  doc.text(`Generated: ${formatDateTime(new Date().toISOString())}`, pageWidth - margin, 56, {
    align: 'right',
  });

  let startY = 112;
  if (opts.summaryPairs && opts.summaryPairs.length > 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    const boxHeight = Math.ceil(opts.summaryPairs.length / 2) * 28 + 18;
    doc.roundedRect(margin, startY, pageWidth - margin * 2, boxHeight, 4, 4, 'FD');

    opts.summaryPairs.forEach(([label, val], idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = margin + 14 + col * ((pageWidth - margin * 2) / 2);
      const y = startY + 22 + row * 28;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(label, x, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(val, x, y + 12);
    });
    startY += boxHeight + 18;
  }

  autoTable(doc, {
    startY,
    margin: { left: margin, right: margin },
    head: [opts.columns],
    body: opts.rows.map((r) => r.map((c) => String(c))),
    styles: {
      fontSize: 8.5,
      cellPadding: 6,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [11, 29, 58],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.save(`${opts.fileName}.pdf`);
}

export function downloadReportExcel(opts: ReportExportOptions): void {
  const wb = XLSX.utils.book_new();
  const sheetData: Array<Array<string | number>> = [
    [opts.settings.business_name],
    [opts.title],
    [opts.subtitle],
    [`Generated: ${formatDateTime(new Date().toISOString())}`],
    [],
  ];

  if (opts.summaryPairs && opts.summaryPairs.length > 0) {
    sheetData.push(['Summary Metric', 'Value']);
    opts.summaryPairs.forEach(([k, v]) => sheetData.push([k, v]));
    sheetData.push([]);
  }

  sheetData.push(opts.columns);
  opts.rows.forEach((r) => sheetData.push(r));

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, `${opts.fileName}.xlsx`);
}

export function downloadFullWorkbookExcel(data: {
  settings: BusinessSettings;
  sales: Sale[];
  expenses: any[];
  customers: any[];
  orders: any[];
  products: any[];
}): void {
  const wb = XLSX.utils.book_new();

  const salesSheet = XLSX.utils.json_to_sheet(
    data.sales.map((s) => ({
      Receipt: s.receipt_number,
      Date: s.sale_date,
      Customer: s.customer_name,
      Phone: s.customer_phone,
      Items: s.items.map((i) => `${i.product_name} x${i.quantity}`).join('; '),
      Subtotal: s.subtotal,
      Discount: s.discount,
      Total: s.total_amount,
      Paid: s.amount_paid,
      Balance: s.balance_due,
      Method: s.payment_method,
      Status: s.payment_status,
    }))
  );
  XLSX.utils.book_append_sheet(wb, salesSheet, 'Sales');

  const expSheet = XLSX.utils.json_to_sheet(
    data.expenses.map((e) => ({
      Date: e.expense_date,
      Title: e.title,
      Category: e.category,
      Amount: e.amount,
      Method: e.payment_method,
      Vendor: e.vendor,
      Notes: e.notes,
    }))
  );
  XLSX.utils.book_append_sheet(wb, expSheet, 'Expenses');

  const custSheet = XLSX.utils.json_to_sheet(
    data.customers.map((c) => ({
      Name: c.name,
      Phone: c.phone,
      Email: c.email,
      Location: c.location,
      TotalSpent: c.total_spent || 0,
      OutstandingBalance: c.outstanding_balance || 0,
      Orders: c.order_count || 0,
      Notes: c.notes,
    }))
  );
  XLSX.utils.book_append_sheet(wb, custSheet, 'Customers');

  const ordSheet = XLSX.utils.json_to_sheet(
    data.orders.map((o) => ({
      OrderNo: o.order_number,
      Customer: o.customer_name,
      Phone: o.customer_phone,
      Title: o.title,
      Quantity: o.quantity,
      TotalAmount: o.total_amount,
      DepositPaid: o.deposit_paid,
      Status: o.status,
      Deadline: o.deadline,
      Delivery: o.delivery_details,
    }))
  );
  XLSX.utils.book_append_sheet(wb, ordSheet, 'Orders');

  const prodSheet = XLSX.utils.json_to_sheet(
    data.products.map((p) => ({
      Name: p.name,
      Category: p.category,
      UnitLabel: p.unit_label,
      UnitPrice: p.unit_price,
      ProductionCost: p.production_cost,
      Margin: p.unit_price - p.production_cost,
    }))
  );
  XLSX.utils.book_append_sheet(wb, prodSheet, 'Products');

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `stanley-business-records-${today}.xlsx`);
}
