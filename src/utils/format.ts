export function formatCurrency(amount: number, currency = 'UGX'): string {
  const num = Number.isFinite(amount) ? Math.round(amount) : 0;
  const formatted = new Intl.NumberFormat('en-UG', {
    maximumFractionDigits: 0,
  }).format(num);
  return `${currency} ${formatted}`;
}

export function formatCompactCurrency(amount: number, currency = 'UGX'): string {
  const num = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    return `${sign}${currency} ${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${currency} ${(abs / 1_000).toFixed(0)}K`;
  }
  return `${sign}${currency} ${Math.round(abs)}`;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-UG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('en-UG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeUgPhoneForWhatsApp(phone: string): string {
  const digits = (phone || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('256')) return digits;
  if (digits.startsWith('0') && digits.length >= 10) return `256${digits.slice(1)}`;
  if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('3'))) {
    return `256${digits}`;
  }
  return digits;
}

export function startOfWeekIso(date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function startOfMonthIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function startOfYearIso(date = new Date()): string {
  return `${date.getFullYear()}-01-01`;
}
