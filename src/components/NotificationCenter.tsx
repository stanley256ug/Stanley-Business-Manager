import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  CheckCheck,
  ClipboardList,
  CreditCard,
  LogIn,
  Trash2,
  X,
} from 'lucide-react';
import { AppNotification } from '../types';
import { BrowserNotificationPermission } from '../utils/browserNotifications';

interface NotificationCenterProps {
  notifications: AppNotification[];
  unreadCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onNotificationClick: (notification: AppNotification) => void;
  browserPermission: BrowserNotificationPermission;
  onEnableBrowserAlerts: () => void;
}

type FilterType = 'all' | 'login' | 'order' | 'billing';

function formatNotificationTime(ts: string): string {
  if (!ts) return '';
  const normalized = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return ts;

  const diffSeconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSeconds < 10) return 'Just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMins = Math.floor(diffSeconds / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  unreadCount,
  isOpen,
  onToggle,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
  onNotificationClick,
  browserPermission,
  onEnableBrowserAlerts,
}) => {
  const [filter, setFilter] = useState<FilterType>('all');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, onClose]);

  const filtered = useMemo(() => {
    if (filter === 'all') return notifications;
    return notifications.filter((n) => n.type === filter);
  }, [notifications, filter]);

  const loginCount = useMemo(
    () => notifications.filter((n) => n.type === 'login' && !n.is_read).length,
    [notifications]
  );
  const orderCount = useMemo(
    () => notifications.filter((n) => n.type === 'order' && !n.is_read).length,
    [notifications]
  );
  const billingCount = useMemo(
    () => notifications.filter((n) => n.type === 'billing' && !n.is_read).length,
    [notifications]
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        title="Login & Order Notifications"
        className={`relative h-9 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
          isOpen
            ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]'
            : unreadCount > 0
            ? 'bg-amber-50 border-amber-300 text-[#0B1D3A] hover:bg-amber-100'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
        }`}
      >
        <Bell className={`w-4 h-4 shrink-0 ${isOpen ? 'text-[#C89B3C]' : unreadCount > 0 ? 'text-amber-700' : 'text-slate-600'}`} />
        <span className="hidden sm:inline">Alerts</span>
        {unreadCount > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#C89B3C] text-[#0B1D3A] text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed sm:absolute right-3 sm:right-0 top-16 sm:top-11 w-[calc(100vw-24px)] sm:w-[400px] bg-white rounded-xl border border-slate-200 shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-[#0B1D3A] text-white flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                <BellRing className="w-4 h-4 text-[#C89B3C] shrink-0" />
                <span>Notifications</span>
                {unreadCount > 0 && (
                  <span className="text-[11px] font-semibold text-amber-300">
                    ({unreadCount} unread)
                  </span>
                )}
              </h2>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  title="Mark all as read"
                  className="h-7 px-2 rounded-md bg-white/10 hover:bg-white/20 text-[11px] font-medium text-white inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <CheckCheck className="w-3.5 h-3.5 text-[#C89B3C]" />
                  Mark read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={onClearAll}
                  title="Clear all notifications"
                  className="h-7 w-7 rounded-md bg-white/10 hover:bg-white/20 text-slate-200 inline-flex items-center justify-center cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close notifications"
                className="h-7 w-7 rounded-md bg-white/10 hover:bg-white/20 text-slate-200 inline-flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Desktop Notification Permission Bar */}
          {browserPermission !== 'unsupported' && (
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 text-xs">
              {browserPermission === 'granted' ? (
                <span className="text-emerald-700 font-medium inline-flex items-center gap-1.5">
                  <BellRing className="w-3.5 h-3.5 shrink-0" />
                  Desktop &amp; browser push alerts enabled
                </span>
              ) : browserPermission === 'denied' ? (
                <span className="text-slate-500 inline-flex items-center gap-1.5">
                  <BellOff className="w-3.5 h-3.5 shrink-0" />
                  Browser alerts blocked in site settings
                </span>
              ) : (
                <>
                  <span className="text-slate-600">Get instant desktop alerts for logins &amp; orders</span>
                  <button
                    type="button"
                    onClick={onEnableBrowserAlerts}
                    className="h-7 px-2.5 rounded-md bg-[#0B1D3A] hover:bg-[#132B52] text-white text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Enable
                  </button>
                </>
              )}
            </div>
          )}

          {/* Filter Tabs */}
          <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-1.5 bg-white">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`h-7 px-2.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
                filter === 'all'
                  ? 'bg-[#0B1D3A] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('login')}
              className={`h-7 px-2.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
                filter === 'login'
                  ? 'bg-[#0B1D3A] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Logins{loginCount > 0 ? ` (${loginCount})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setFilter('order')}
              className={`h-7 px-2.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
                filter === 'order'
                  ? 'bg-[#0B1D3A] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              New Orders{orderCount > 0 ? ` (${orderCount})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setFilter('billing')}
              className={`h-7 px-2.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
                filter === 'billing'
                  ? 'bg-[#0B1D3A] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Billing{billingCount > 0 ? ` (${billingCount})` : ''}
            </button>
          </div>

          {/* Notification List */}
          <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <div className="px-6 py-10 text-center space-y-1.5">
                <Bell className="w-7 h-7 text-slate-300 mx-auto" />
                <p className="text-xs font-semibold text-slate-700">No notifications yet</p>
                <p className="text-[11px] text-slate-500">
                  Alerts appear automatically for logins, new orders, and Mobile Money billing updates.
                </p>
              </div>
            ) : (
              filtered.map((n) => {
                const isOrder = n.type === 'order';
                const isBilling = n.type === 'billing';
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      if (!n.is_read) onMarkRead(n.id);
                      onNotificationClick(n);
                    }}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer ${
                      n.is_read
                        ? 'bg-white hover:bg-slate-50'
                        : 'bg-amber-50/45 hover:bg-amber-50/80'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        isOrder
                          ? 'bg-amber-100 text-amber-800'
                          : isBilling
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-[#0B1D3A]/10 text-[#0B1D3A]'
                      }`}
                    >
                      {isOrder ? (
                        <ClipboardList className="w-4 h-4" />
                      ) : isBilling ? (
                        <CreditCard className="w-4 h-4" />
                      ) : (
                        <LogIn className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-slate-900 truncate">{n.title}</p>
                        <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                          {formatNotificationTime(n.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed break-words">
                        {n.message}
                      </p>
                    </div>
                    {!n.is_read && (
                      <span
                        aria-label="Unread"
                        className="w-2 h-2 rounded-full bg-[#C89B3C] shrink-0 mt-2"
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
