import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Ban,
  CheckCircle2,
  CreditCard,
  Database,
  Download,
  KeyRound,
  LogOut,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  AdminManagedUser,
  AdminOverviewResponse,
  BillingSubscription,
  UserProfile,
} from '../types';
import { apiRequest, getStoredToken } from '../utils/api';

interface AdminMonitorViewProps {
  currentUser: UserProfile;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type MonitorTab = 'logins' | 'users' | 'billing' | 'sessions' | 'system';
type LoginStatusFilter = 'all' | 'success' | 'failed' | 'register' | 'password_reset';
type BillingStatusFilter = 'all' | 'pending_verification' | 'verified' | 'active' | 'rejected';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUptime(seconds: number): string {
  if (!seconds || seconds < 60) return `${seconds || 0}s`;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m ${seconds % 60}s`;
}

function formatUtcTimestamp(ts: string | null | undefined): string {
  if (!ts) return 'Never';
  const normalized = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function summarizeUserAgent(ua: string): string {
  if (!ua) return 'Unknown Client';
  if (/Edg\//i.test(ua)) return 'Microsoft Edge';
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'Google Chrome';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Apple Safari';
  if (/Firefox\//i.test(ua)) return 'Mozilla Firefox';
  if (/Electron/i.test(ua)) return 'Windows Desktop App';
  if (/Android/i.test(ua)) return 'Android Device';
  if (/curl/i.test(ua)) return 'CLI / API Client';
  return ua.slice(0, 38);
}

export const AdminMonitorView: React.FC<AdminMonitorViewProps> = ({
  currentUser,
  onNotify,
}) => {
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<MonitorTab>('logins');
  const [loginFilter, setLoginFilter] = useState<LoginStatusFilter>('all');
  const [billingFilter, setBillingFilter] = useState<BillingStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminManagedUser | null>(null);

  const loadOverview = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      try {
        const res = await apiRequest<AdminOverviewResponse>('/api/admin/overview');
        setOverview(res);
      } catch (err: unknown) {
        onNotify(
          err instanceof Error ? err.message : 'Unable to load administrator system monitor.',
          'error'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onNotify]
  );

  useEffect(() => {
    void loadOverview(false);
  }, [loadOverview]);

  const handleToggleUserStatus = async (target: AdminManagedUser) => {
    const nextStatus = target.status === 'suspended' ? 'active' : 'suspended';
    setBusyAction(`status-${target.id}`);
    try {
      await apiRequest(`/api/admin/users/${target.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      });
      onNotify(
        nextStatus === 'suspended'
          ? `Suspended @${target.username} and closed active sessions.`
          : `Reactivated @${target.username}.`
      );
      await loadOverview(true);
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Could not update user status.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleChangeRole = async (
    target: AdminManagedUser,
    nextRole: 'Administrator' | 'Business Owner' | 'Staff'
  ) => {
    if (target.role === nextRole) return;
    setBusyAction(`role-${target.id}`);
    try {
      await apiRequest(`/api/admin/users/${target.id}/role`, {
        method: 'POST',
        body: JSON.stringify({ role: nextRole }),
      });
      onNotify(`Updated role for @${target.username} to ${nextRole}.`);
      await loadOverview(true);
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Could not update role.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevokeUserSessions = async (target: AdminManagedUser) => {
    setBusyAction(`revoke-user-${target.id}`);
    try {
      const res = await apiRequest<{ ok: boolean; revokedCount: number }>(
        `/api/admin/users/${target.id}/revoke-sessions`,
        { method: 'POST' }
      );
      onNotify(`Closed ${res.revokedCount} active session(s) for @${target.username}.`);
      await loadOverview(true);
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Could not revoke sessions.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevokeSingleSession = async (sessionId: number, username: string) => {
    setBusyAction(`revoke-session-${sessionId}`);
    try {
      await apiRequest(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' });
      onNotify(`Terminated session #${sessionId} for @${username}.`);
      await loadOverview(true);
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Could not terminate session.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deleteTarget) return;
    setBusyAction(`delete-${deleteTarget.id}`);
    try {
      await apiRequest(`/api/admin/users/${deleteTarget.id}`, { method: 'DELETE' });
      onNotify(`Removed @${deleteTarget.username} and associated workspace records.`);
      setDeleteTarget(null);
      await loadOverview(true);
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Could not delete user account.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCleanupExpiredSessions = async () => {
    setBusyAction('cleanup-sessions');
    try {
      const res = await apiRequest<{ ok: boolean; purgedCount: number }>(
        '/api/admin/system/cleanup-sessions',
        { method: 'POST' }
      );
      onNotify(`Purged ${res.purgedCount} expired session(s) and compacted database.`);
      await loadOverview(true);
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'System cleanup failed.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleVerifyBilling = async (
    item: BillingSubscription,
    action: 'verified' | 'rejected'
  ) => {
    setBusyAction(`billing-${action}-${item.id}`);
    try {
      await apiRequest(`/api/admin/billing/${item.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      onNotify(
        action === 'verified'
          ? `Verified ${item.plan_name} payment (${item.transaction_id || item.pass_code}).`
          : `Rejected payment (${item.transaction_id || item.pass_code}).`
      );
      await loadOverview(true);
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'Could not update billing status.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportLoginCsv = async () => {
    setBusyAction('export-csv');
    try {
      const token = getStoredToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/export-logs', {
        credentials: 'include',
        headers,
      });
      if (!res.ok) {
        throw new Error('Could not export login audit log.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stanley-admin-login-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onNotify('Exported system login audit CSV.');
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : 'CSV export failed.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const filteredLoginEvents = useMemo(() => {
    if (!overview) return [];
    const q = searchQuery.trim().toLowerCase();
    return overview.loginEvents.filter((ev) => {
      if (loginFilter !== 'all' && ev.status !== loginFilter) return false;
      if (!q) return true;
      return (
        ev.username.toLowerCase().includes(q) ||
        ev.full_name.toLowerCase().includes(q) ||
        ev.email.toLowerCase().includes(q) ||
        ev.identifier.toLowerCase().includes(q) ||
        ev.ip_address.toLowerCase().includes(q) ||
        ev.auth_method.toLowerCase().includes(q) ||
        ev.failure_reason.toLowerCase().includes(q)
      );
    });
  }, [overview, loginFilter, searchQuery]);

  const filteredUsers = useMemo(() => {
    if (!overview) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return overview.users;
    return overview.users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.business_name.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    );
  }, [overview, searchQuery]);

  const filteredSessions = useMemo(() => {
    if (!overview) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return overview.activeSessions;
    return overview.activeSessions.filter(
      (s) =>
        s.username.toLowerCase().includes(q) ||
        s.full_name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.token_prefix.toLowerCase().includes(q)
    );
  }, [overview, searchQuery]);

  const filteredAuditLogs = useMemo(() => {
    if (!overview) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return overview.auditLogs;
    return overview.auditLogs.filter(
      (a) =>
        a.action.toLowerCase().includes(q) ||
        a.actor_username.toLowerCase().includes(q) ||
        a.details.toLowerCase().includes(q) ||
        a.target_type.toLowerCase().includes(q)
    );
  }, [overview, searchQuery]);

  const filteredBilling = useMemo(() => {
    const list = overview?.billingSubscriptions || [];
    const q = searchQuery.trim().toLowerCase();
    return list.filter((b) => {
      if (billingFilter !== 'all' && b.status !== billingFilter) return false;
      if (!q) return true;
      return (
        b.pass_code.toLowerCase().includes(q) ||
        b.plan_name.toLowerCase().includes(q) ||
        b.payer_phone.toLowerCase().includes(q) ||
        b.payer_name.toLowerCase().includes(q) ||
        b.transaction_id.toLowerCase().includes(q) ||
        b.payment_provider.toLowerCase().includes(q) ||
        (b.username || '').toLowerCase().includes(q)
      );
    });
  }, [overview, billingFilter, searchQuery]);

  if (currentUser.role !== 'Administrator') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
        <ShieldAlert className="w-8 h-8 text-red-600 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900">Administrator Access Restricted</h2>
        <p className="text-sm text-slate-600">
          This monitoring console is available strictly to Administrator accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-[#0B1D3A]">Administrator Console</span>
            <span aria-hidden="true">·</span>
            <span>Signed in as @{currentUser.username}</span>
            {overview && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Synced {formatUtcTimestamp(overview.summary.serverTime)}
                </span>
              </>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            System Monitor &amp; User Access Control
          </h1>
          <p className="text-xs sm:text-sm text-slate-600">
            Monitor all user logins across Local, Google, and iCloud providers, manage business workspaces, and control active sessions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={refreshing || loading}
            onClick={() => void loadOverview(true)}
            className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#0B1D3A] ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Monitor
          </button>

          <button
            type="button"
            disabled={busyAction === 'cleanup-sessions'}
            onClick={handleCleanupExpiredSessions}
            className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Database className="w-3.5 h-3.5 text-[#0B1D3A]" />
            {busyAction === 'cleanup-sessions' ? 'Cleaning...' : 'Purge Expired Sessions'}
          </button>

          <button
            type="button"
            disabled={busyAction === 'export-csv'}
            onClick={handleExportLoginCsv}
            className="h-9 px-3.5 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-[#C89B3C]" />
            {busyAction === 'export-csv' ? 'Exporting...' : 'Export Login Log'}
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      {loading && !overview ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : overview ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Registered Accounts</span>
              <Users className="w-4 h-4 text-[#0B1D3A]" />
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {overview.summary.totalUsers}
            </p>
            <p className="text-xs text-slate-600 font-mono tabular-nums">
              {overview.summary.activeUsers} active · {overview.summary.suspendedUsers} suspended
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>24h Login Activity</span>
              <Activity className="w-4 h-4 text-emerald-700" />
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {overview.summary.logins24h}
            </p>
            <p className="text-xs text-slate-600 font-mono tabular-nums">
              {overview.summary.logins24h} succeeded ·{' '}
              <span className={overview.summary.failedLogins24h > 0 ? 'text-red-700 font-semibold' : ''}>
                {overview.summary.failedLogins24h} failed
              </span>
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Active Sessions</span>
              <KeyRound className="w-4 h-4 text-[#C89B3C]" />
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {overview.summary.activeSessions}
            </p>
            <p className="text-xs text-slate-600 font-mono tabular-nums">
              {overview.summary.expiredSessions} expired awaiting purge
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Mobile Money &amp; Trials</span>
              <CreditCard className="w-4 h-4 text-[#C89B3C]" />
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              UGX {(overview.summary.billingRevenueUgx ?? 0).toLocaleString()}
            </p>
            <p className="text-xs text-slate-600 font-mono tabular-nums">
              {overview.summary.pendingBillingCount ?? 0} pending · {overview.summary.activeTrialsCount ?? 0} active trials
            </p>
          </div>
        </div>
      ) : null}

      {/* Main Monitoring Workspace */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Controls Toolbar */}
        <div className="p-4 sm:px-6 border-b border-slate-200 bg-slate-50/70 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Administrator dashboard sections"
            className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-200/80 border border-slate-200 self-start"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'logins'}
              onClick={() => setActiveTab('logins')}
              className={`h-8 px-3 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'logins'
                  ? 'bg-white text-[#0B1D3A] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Login Monitor ({overview?.loginEvents.length ?? 0})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'users'}
              onClick={() => setActiveTab('users')}
              className={`h-8 px-3 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'users'
                  ? 'bg-white text-[#0B1D3A] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Users &amp; Workspaces ({overview?.users.length ?? 0})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'billing'}
              onClick={() => setActiveTab('billing')}
              className={`h-8 px-3 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'billing'
                  ? 'bg-white text-[#0B1D3A] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Billing &amp; Mobile Money ({overview?.billingSubscriptions?.length ?? 0})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'sessions'}
              onClick={() => setActiveTab('sessions')}
              className={`h-8 px-3 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'sessions'
                  ? 'bg-white text-[#0B1D3A] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Active Sessions ({overview?.activeSessions.length ?? 0})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'system'}
              onClick={() => setActiveTab('system')}
              className={`h-8 px-3 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'system'
                  ? 'bg-white text-[#0B1D3A] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              System &amp; Audit Trail ({overview?.auditLogs.length ?? 0})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'logins' && (
              <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-white border border-slate-200">
                {(
                  [
                    ['all', 'All'],
                    ['success', 'Success'],
                    ['failed', 'Failed'],
                    ['register', 'Sign-ups'],
                    ['password_reset', 'Resets'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setLoginFilter(key)}
                    className={`h-7 px-2.5 rounded text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                      loginFilter === key
                        ? 'bg-[#0B1D3A] text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'billing' && (
              <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-white border border-slate-200">
                {(
                  [
                    ['all', 'All'],
                    ['pending_verification', 'Pending'],
                    ['verified', 'Verified'],
                    ['active', 'Trials'],
                    ['rejected', 'Rejected'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setBillingFilter(key)}
                    className={`h-7 px-2.5 rounded text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                      billingFilter === key
                        ? 'bg-[#0B1D3A] text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by user, tx ID, phone..."
                className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C89B3C]/40"
              />
            </div>
          </div>
        </div>

        {/* Tab 1: Login Monitor */}
        {activeTab === 'logins' && (
          <div className="overflow-x-auto">
            {filteredLoginEvents.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Activity className="w-7 h-7 text-slate-300 mx-auto" />
                <p className="text-sm font-semibold text-slate-800">No login activity recorded yet</p>
                <p className="text-xs text-slate-500">
                  Sign-in attempts across local accounts, Google, and iCloud will appear here in real time.
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-500 font-semibold">
                    <th className="py-3 px-4 whitespace-nowrap">Timestamp</th>
                    <th className="py-3 px-4">User / Identifier</th>
                    <th className="py-3 px-4 whitespace-nowrap">Method</th>
                    <th className="py-3 px-4 whitespace-nowrap">Outcome</th>
                    <th className="py-3 px-4 whitespace-nowrap">IP Address</th>
                    <th className="py-3 px-4">Client / Browser</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLoginEvents.map((ev) => {
                    const outcomeLabel =
                      ev.status === 'success'
                        ? 'Signed In'
                        : ev.status === 'failed'
                        ? 'Failed'
                        : ev.status === 'register'
                        ? 'Registered'
                        : ev.status === 'password_reset'
                        ? 'Password Reset'
                        : 'Signed Out';
                    const outcomeColor =
                      ev.status === 'failed'
                        ? 'text-red-700'
                        : ev.status === 'password_reset'
                        ? 'text-amber-700'
                        : ev.status === 'logout'
                        ? 'text-slate-600'
                        : 'text-emerald-700';

                    return (
                      <tr key={ev.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {formatUtcTimestamp(ev.created_at)}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">
                            {ev.full_name || ev.identifier || 'Unknown'}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {ev.username ? `@${ev.username}` : ev.identifier}
                            {ev.email ? ` · ${ev.email}` : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono uppercase text-slate-700 whitespace-nowrap">
                          {ev.auth_method}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className={`font-semibold whitespace-nowrap ${outcomeColor}`}>
                            {outcomeLabel}
                          </div>
                          {ev.failure_reason && (
                            <div className="text-[11px] text-red-600">{ev.failure_reason}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {ev.ip_address || 'unknown'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600 max-w-xs truncate" title={ev.user_agent}>
                          {summarizeUserAgent(ev.user_agent)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 2: Users & Workspaces */}
        {activeTab === 'users' && (
          <div className="overflow-x-auto">
            {filteredUsers.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Users className="w-7 h-7 text-slate-300 mx-auto" />
                <p className="text-sm font-semibold text-slate-800">No matching users found</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-500 font-semibold">
                    <th className="py-3 px-4">Account</th>
                    <th className="py-3 px-4">Business Workspace</th>
                    <th className="py-3 px-4 whitespace-nowrap">Role</th>
                    <th className="py-3 px-4 whitespace-nowrap">Status</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Records</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Sales Volume</th>
                    <th className="py-3 px-4 whitespace-nowrap">Last Login</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((u) => {
                    const isSelf = u.id === currentUser.id;
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">
                            {u.full_name} {isSelf ? '(You)' : ''}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            @{u.username} · {u.email}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            Auth: {u.auth_provider} · {u.login_count} login(s) · {u.active_sessions_count} active session(s)
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{u.business_name}</div>
                          <div className="text-[11px] text-slate-500">
                            {u.location || 'No location set'} · {u.currency}
                            {!u.profile_completed ? ' · Setup pending' : ''}
                          </div>
                          {u.subscription_plan && u.subscription_plan !== 'legacy' && (
                            <div className="text-[11px] font-mono text-slate-600">
                              Plan: {u.subscription_plan} ({u.subscription_status || 'active'})
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {isSelf ? (
                            <span className="font-semibold text-[#0B1D3A]">{u.role}</span>
                          ) : (
                            <select
                              aria-label={`Role for ${u.username}`}
                              disabled={busyAction === `role-${u.id}`}
                              value={u.role}
                              onChange={(e) =>
                                void handleChangeRole(
                                  u,
                                  e.target.value as 'Administrator' | 'Business Owner' | 'Staff'
                                )
                              }
                              className="h-8 px-2 rounded border border-slate-300 bg-white text-xs text-slate-800 cursor-pointer"
                            >
                              <option value="Business Owner">Business Owner</option>
                              <option value="Staff">Staff</option>
                              <option value="Administrator">Administrator</option>
                            </select>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {u.status === 'suspended' ? (
                            <span className="font-semibold text-red-700 inline-flex items-center gap-1">
                              <Ban className="w-3.5 h-3.5" />
                              Suspended
                            </span>
                          ) : (
                            <span className="font-semibold text-emerald-700 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Active
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          <div>{u.sales_count} sales · {u.orders_count} orders</div>
                          <div className="text-[11px] text-slate-500">
                            {u.customers_count} customers · {u.expenses_count} expenses
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {u.currency} {u.total_sales_amount.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {formatUtcTimestamp(u.last_login_at)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {isSelf ? (
                            <span className="text-[11px] text-slate-400">Protected</span>
                          ) : (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busyAction === `status-${u.id}`}
                                onClick={() => void handleToggleUserStatus(u)}
                                className={`h-8 px-2.5 rounded border text-[11px] font-semibold cursor-pointer whitespace-nowrap ${
                                  u.status === 'suspended'
                                    ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                                    : 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900'
                                }`}
                              >
                                {u.status === 'suspended' ? 'Activate' : 'Suspend'}
                              </button>
                              {u.active_sessions_count > 0 && (
                                <button
                                  type="button"
                                  disabled={busyAction === `revoke-user-${u.id}`}
                                  onClick={() => void handleRevokeUserSessions(u)}
                                  className="h-8 px-2.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                                >
                                  Force Sign-Out
                                </button>
                              )}
                              {u.role !== 'Administrator' && (
                                <button
                                  type="button"
                                  onClick={() => setDeleteTarget(u)}
                                  aria-label={`Delete ${u.username}`}
                                  title="Delete user and workspace"
                                  className="h-8 px-2 rounded border border-red-200 bg-white hover:bg-red-50 text-red-700 inline-flex items-center justify-center cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 3: Billing & Mobile Money */}
        {activeTab === 'billing' && (
          <div className="divide-y divide-slate-200">
            <div className="px-6 py-3.5 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-slate-600">
                  Airtel Money Merchant: <strong className="font-mono text-slate-900">+256708475220</strong>
                </span>
                <span className="text-slate-600">
                  MTN MoMo Merchant: <strong className="font-mono text-slate-900">+256789384426</strong>
                </span>
              </div>
              <span className="font-mono text-slate-600 tabular-nums">
                Showing {filteredBilling.length} subscription(s)
              </span>
            </div>

            <div className="overflow-x-auto">
              {filteredBilling.length === 0 ? (
                <div className="p-10 text-center space-y-2">
                  <CreditCard className="w-7 h-7 text-slate-300 mx-auto" />
                  <p className="text-sm font-semibold text-slate-800">No billing records found</p>
                  <p className="text-xs text-slate-500">
                    24-hour free trials and Airtel/MTN Mobile Money payments will appear here for review.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-500 font-semibold">
                      <th className="py-3 px-4 whitespace-nowrap">Submitted</th>
                      <th className="py-3 px-4">Subscriber / Workspace</th>
                      <th className="py-3 px-4 whitespace-nowrap">Plan &amp; Amount</th>
                      <th className="py-3 px-4 whitespace-nowrap">Mobile Money Account</th>
                      <th className="py-3 px-4 whitespace-nowrap">Transaction ID / Pass</th>
                      <th className="py-3 px-4 whitespace-nowrap">Status</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredBilling.map((b) => {
                      const statusColor =
                        b.status === 'verified' || b.status === 'active'
                          ? 'text-emerald-700'
                          : b.status === 'pending_verification'
                          ? 'text-amber-700'
                          : 'text-red-700';
                      const providerLabel =
                        b.payment_provider === 'airtel'
                          ? 'Airtel Money'
                          : b.payment_provider === 'mtn'
                          ? 'MTN MoMo'
                          : '24h Trial';
                      return (
                        <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {formatUtcTimestamp(b.created_at)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">
                              {b.user_full_name || b.payer_name || 'Unclaimed Subscriber'}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {b.payer_phone || 'No phone'}
                              {b.username ? ` · @${b.username}` : ' · Not registered yet'}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-semibold text-slate-900">{b.plan_name}</div>
                            <div className="text-[11px] font-mono tabular-nums text-slate-600">
                              UGX {Number(b.amount_ugx || 0).toLocaleString()}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-semibold text-slate-800">{providerLabel}</div>
                            {b.recipient_number && (
                              <div className="text-[11px] font-mono tabular-nums text-slate-500">
                                To {b.recipient_number}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono whitespace-nowrap">
                            <div className="font-semibold text-slate-900">
                              {b.transaction_id || 'FREE TRIAL'}
                            </div>
                            <div className="text-[11px] text-slate-500">{b.pass_code}</div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className={`font-semibold capitalize ${statusColor}`}>
                              {b.status.replace('_', ' ')}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-slate-500">
                              Exp: {formatUtcTimestamp(b.expires_at)}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {b.payment_provider === 'trial' ? (
                              <span className="text-[11px] text-slate-400">Auto-active</span>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                {b.status !== 'verified' && (
                                  <button
                                    type="button"
                                    disabled={busyAction === `billing-verified-${b.id}`}
                                    onClick={() => void handleVerifyBilling(b, 'verified')}
                                    className="h-8 px-2.5 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                                  >
                                    Verify
                                  </button>
                                )}
                                {b.status !== 'rejected' && (
                                  <button
                                    type="button"
                                    disabled={busyAction === `billing-rejected-${b.id}`}
                                    onClick={() => void handleVerifyBilling(b, 'rejected')}
                                    className="h-8 px-2.5 rounded border border-red-200 bg-white hover:bg-red-50 text-red-700 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                                  >
                                    Reject
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Active Sessions */}
        {activeTab === 'sessions' && (
          <div className="overflow-x-auto">
            {filteredSessions.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <KeyRound className="w-7 h-7 text-slate-300 mx-auto" />
                <p className="text-sm font-semibold text-slate-800">No active sessions found</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-500 font-semibold">
                    <th className="py-3 px-4 whitespace-nowrap">Session ID</th>
                    <th className="py-3 px-4">Account</th>
                    <th className="py-3 px-4 whitespace-nowrap">Role</th>
                    <th className="py-3 px-4 whitespace-nowrap">Issued At</th>
                    <th className="py-3 px-4 whitespace-nowrap">Expires At</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSessions.map((s) => (
                    <tr key={s.session_id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        #{s.session_id} · {s.token_prefix}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">
                          {s.full_name} {s.is_current ? '(Current Session)' : ''}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          @{s.username} · {s.email}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">{s.role}</td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatUtcTimestamp(s.created_at)}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatUtcTimestamp(s.expires_at)}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {s.is_current ? (
                          <span className="text-[11px] font-semibold text-emerald-700">In Use</span>
                        ) : (
                          <button
                            type="button"
                            disabled={busyAction === `revoke-session-${s.session_id}`}
                            onClick={() => void handleRevokeSingleSession(s.session_id, s.username)}
                            className="h-8 px-3 rounded border border-red-200 bg-white hover:bg-red-50 text-red-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <LogOut className="w-3 h-3" />
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 4: System Health & Audit Trail */}
        {activeTab === 'system' && overview && (
          <div className="divide-y divide-slate-200">
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs bg-white">
              <div className="space-y-1">
                <p className="text-slate-500">Runtime Environment</p>
                <p className="font-mono font-semibold text-slate-900">
                  Node {overview.summary.nodeVersion} · Uptime {formatUptime(overview.summary.uptimeSeconds)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-slate-500">SQLite Database Size</p>
                <p className="font-mono tabular-nums font-semibold text-slate-900">
                  {formatBytes(overview.summary.databaseSizeBytes)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-slate-500">Catalog &amp; CRM Volume</p>
                <p className="font-mono tabular-nums font-semibold text-slate-900">
                  {overview.summary.totalProductsCount} products · {overview.summary.totalCustomersCount} customers
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-slate-500">Ledger &amp; Orders Volume</p>
                <p className="font-mono tabular-nums font-semibold text-slate-900">
                  {overview.summary.totalOrdersCount} orders · {overview.summary.totalExpensesCount} expenses
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              {filteredAuditLogs.length === 0 ? (
                <div className="p-10 text-center space-y-2">
                  <ShieldCheck className="w-7 h-7 text-slate-300 mx-auto" />
                  <p className="text-sm font-semibold text-slate-800">No system audit entries yet</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-500 font-semibold">
                      <th className="py-3 px-4 whitespace-nowrap">Timestamp</th>
                      <th className="py-3 px-4 whitespace-nowrap">Actor</th>
                      <th className="py-3 px-4 whitespace-nowrap">Action</th>
                      <th className="py-3 px-4 whitespace-nowrap">Target</th>
                      <th className="py-3 px-4">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAuditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {formatUtcTimestamp(log.created_at)}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-800 whitespace-nowrap">
                          @{log.actor_username || 'system'}
                        </td>
                        <td className="py-2.5 px-4 font-mono font-semibold text-[#0B1D3A] whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                          {log.target_type} #{log.target_id}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700">{log.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Delete Workspace Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-700 font-bold text-sm">
                <ShieldAlert className="w-4 h-4" />
                Delete User &amp; Workspace
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                aria-label="Cancel deletion"
                className="p-1 rounded hover:bg-slate-100 text-slate-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs text-slate-700">
              <p>
                Permanently remove <strong>{deleteTarget.full_name}</strong> (
                <span className="font-mono">@{deleteTarget.username}</span>) and their workspace{' '}
                <strong>{deleteTarget.business_name}</strong>?
              </p>
              <p className="text-red-700 font-medium">
                This deletes {deleteTarget.sales_count} sales, {deleteTarget.orders_count} orders,{' '}
                {deleteTarget.customers_count} customers, and {deleteTarget.expenses_count} expenses
                from the server database. This action cannot be undone.
              </p>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyAction === `delete-${deleteTarget.id}`}
                onClick={() => void handleConfirmDeleteUser()}
                className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
              >
                {busyAction === `delete-${deleteTarget.id}` ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
