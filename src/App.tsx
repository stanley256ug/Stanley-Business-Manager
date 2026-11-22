import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  BarChart3,
  ClipboardList,
  Cloud,
  FileSpreadsheet,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Settings,
  TrendingUp,
  Users,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AppBootstrapData,
  BusinessSettings,
  Customer,
  Expense,
  NavSection,
  Order,
  PaymentMethod,
  Product,
  Sale,
  UserProfile,
} from './types';
import { apiRequest, getStoredToken, setStoredToken } from './utils/api';
import { auth, googleProvider, testFirestoreConnection } from './firebase';
import {
  enqueueOutbox,
  generateClientSyncId,
  getOutboxItems,
  loadOfflineSnapshot,
  markOutboxRetry,
  removeOutboxItem,
  saveOfflineSnapshot,
} from './utils/offlineDb';
import { pullWorkspaceFromCloud, pushWorkspaceToCloud } from './utils/cloudSync';
import { AuthLogin } from './components/AuthLogin';
import { DashboardView } from './components/DashboardView';
import { SalesView } from './components/SalesView';
import { ExpensesView } from './components/ExpensesView';
import { ReceiptsView } from './components/ReceiptsView';
import { OrdersView } from './components/OrdersView';
import { ProductsView } from './components/ProductsView';
import { CustomersView } from './components/CustomersView';
import { AnalyticsView } from './components/AnalyticsView';
import { ReportsView } from './components/ReportsView';
import { CloudUserInfo, SettingsView } from './components/SettingsView';
import { ReceiptViewerModal } from './components/ReceiptViewerModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { AboutModal } from './components/AboutModal';
import { useOnlineStatus } from './hooks/useOnlineStatus';

const CACHED_USER_KEY = 'sbm_cached_user';
const LAST_SYNC_KEY = 'sbm_last_cloud_sync';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'sales', label: 'Sales & Income', icon: TrendingUp },
  { id: 'expenses', label: 'Expenditures', icon: Wallet },
  { id: 'receipts', label: 'Receipts', icon: Receipt },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'products', label: 'Products & Services', icon: Package },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'analytics', label: 'Growth & Analytics', icon: BarChart3 },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet },
  { id: 'settings', label: 'Settings & Security', icon: Settings },
];

function isNetworkFailure(err: any): boolean {
  if (!navigator.onLine) return true;
  if (!err) return false;
  if (typeof err.status === 'number') return false;
  const msg = String(err.message || err);
  return err instanceof TypeError || /fetch|network|offline|timed out|abort/i.test(msg);
}

function getCachedUser(): UserProfile | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

function setCachedUser(user: UserProfile | null) {
  try {
    if (user) {
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(CACHED_USER_KEY);
    }
  } catch {
    // ignore storage limits
  }
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [showDefaultHint, setShowDefaultHint] = useState(true);
  const [loginBrand, setLoginBrand] = useState({
    business_name: 'Stanley Print & Branding Studio',
    logo_url: '/src/assets/images/stanley_brand_logo_1795171819618.jpg',
    location: 'Nasser Road, Kampala, Uganda',
  });

  const [data, setData] = useState<AppBootstrapData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Modal triggers across sections
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<Sale | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Offline outbox & Cloud Sync state
  const [outboxCount, setOutboxCount] = useState(0);
  const [cloudUser, setCloudUser] = useState<CloudUserInfo | null>(null);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_SYNC_KEY);
    } catch {
      return null;
    }
  });
  const syncingRef = useRef(false);

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const isOnline = useOnlineStatus();

  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3800);
  }, []);

  const refreshOutboxCount = useCallback(async () => {
    const items = await getOutboxItems();
    setOutboxCount(items.length);
  }, []);

  const updateDataAndCache = useCallback(
    (updater: (prev: AppBootstrapData) => AppBootstrapData) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        void saveOfflineSnapshot(next);
        return next;
      });
    },
    []
  );

  const loadBootstrap = useCallback(async () => {
    setLoadingData(true);
    try {
      const payload = await apiRequest<AppBootstrapData>('/api/bootstrap');
      setData(payload);
      await saveOfflineSnapshot(payload);
    } catch (err: any) {
      if (err.status === 401) {
        setUser(null);
        setStoredToken(null);
        setCachedUser(null);
      } else {
        const cached = await loadOfflineSnapshot();
        if (cached) {
          setData(cached);
          if (isNetworkFailure(err)) {
            notify('Loaded offline cached business records.', 'success');
          }
        } else {
          notify(err.message || 'Failed to load business data.', 'error');
        }
      }
    } finally {
      setLoadingData(false);
    }
  }, [notify]);

  const flushOutbox = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current || !user) return;
    const items = await getOutboxItems();
    if (items.length === 0) {
      setOutboxCount(0);
      return;
    }

    syncingRef.current = true;
    setCloudSyncing(true);
    const tempIdMap = new Map<number, number>();
    let syncedAny = false;

    try {
      for (const item of items) {
        const targetId = item.targetId !== undefined ? (tempIdMap.get(item.targetId) ?? item.targetId) : undefined;
        try {
          if (item.operation === 'create_sale') {
            const payload = { ...item.payload };
            if (payload.customer_id && tempIdMap.has(payload.customer_id)) {
              payload.customer_id = tempIdMap.get(payload.customer_id);
            }
            if (payload.order_id && tempIdMap.has(payload.order_id)) {
              payload.order_id = tempIdMap.get(payload.order_id);
            }
            const res = await apiRequest<{ sale: Sale }>('/api/sales', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            if (item.targetId !== undefined && res.sale?.id) {
              tempIdMap.set(item.targetId, res.sale.id);
            }
          } else if (item.operation === 'record_payment' && targetId) {
            await apiRequest(`/api/sales/${targetId}/payments`, {
              method: 'POST',
              body: JSON.stringify(item.payload),
            });
          } else if (item.operation === 'delete_sale' && targetId && targetId > 0) {
            await apiRequest(`/api/sales/${targetId}`, { method: 'DELETE' });
          } else if (item.operation === 'create_expense') {
            const created = await apiRequest<Expense>('/api/expenses', {
              method: 'POST',
              body: JSON.stringify(item.payload),
            });
            if (item.targetId !== undefined && created?.id) {
              tempIdMap.set(item.targetId, created.id);
            }
          } else if (item.operation === 'update_expense' && targetId) {
            await apiRequest(`/api/expenses/${targetId}`, {
              method: 'PUT',
              body: JSON.stringify(item.payload),
            });
          } else if (item.operation === 'delete_expense' && targetId && targetId > 0) {
            await apiRequest(`/api/expenses/${targetId}`, { method: 'DELETE' });
          } else if (item.operation === 'create_product') {
            const created = await apiRequest<Product>('/api/products', {
              method: 'POST',
              body: JSON.stringify(item.payload),
            });
            if (item.targetId !== undefined && created?.id) {
              tempIdMap.set(item.targetId, created.id);
            }
          } else if (item.operation === 'update_product' && targetId) {
            await apiRequest(`/api/products/${targetId}`, {
              method: 'PUT',
              body: JSON.stringify(item.payload),
            });
          } else if (item.operation === 'delete_product' && targetId && targetId > 0) {
            await apiRequest(`/api/products/${targetId}`, { method: 'DELETE' });
          } else if (item.operation === 'create_customer') {
            const created = await apiRequest<Customer>('/api/customers', {
              method: 'POST',
              body: JSON.stringify(item.payload),
            });
            if (item.targetId !== undefined && created?.id) {
              tempIdMap.set(item.targetId, created.id);
            }
          } else if (item.operation === 'update_customer' && targetId) {
            await apiRequest(`/api/customers/${targetId}`, {
              method: 'PUT',
              body: JSON.stringify(item.payload),
            });
          } else if (item.operation === 'delete_customer' && targetId && targetId > 0) {
            await apiRequest(`/api/customers/${targetId}`, { method: 'DELETE' });
          } else if (item.operation === 'create_order') {
            const payload = { ...item.payload };
            if (payload.customer_id && tempIdMap.has(payload.customer_id)) {
              payload.customer_id = tempIdMap.get(payload.customer_id);
            }
            const created = await apiRequest<Order>('/api/orders', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            if (item.targetId !== undefined && created?.id) {
              tempIdMap.set(item.targetId, created.id);
            }
          } else if (item.operation === 'update_order' && targetId) {
            await apiRequest(`/api/orders/${targetId}`, {
              method: 'PUT',
              body: JSON.stringify(item.payload),
            });
          } else if (item.operation === 'delete_order' && targetId && targetId > 0) {
            await apiRequest(`/api/orders/${targetId}`, { method: 'DELETE' });
          } else if (item.operation === 'update_settings') {
            await apiRequest('/api/settings', {
              method: 'PUT',
              body: JSON.stringify(item.payload),
            });
          }

          await removeOutboxItem(item.id);
          syncedAny = true;
        } catch (err: any) {
          await markOutboxRetry(item, err.message || 'Sync deferred');
          if (isNetworkFailure(err)) {
            break;
          }
        }
      }

      await refreshOutboxCount();
      if (syncedAny) {
        const fresh = await apiRequest<AppBootstrapData>('/api/bootstrap');
        setData(fresh);
        await saveOfflineSnapshot(fresh);
        if (cloudUser) {
          await pushWorkspaceToCloud(cloudUser.uid, fresh);
          const now = new Date().toISOString();
          setLastSyncedAt(now);
          try {
            localStorage.setItem(LAST_SYNC_KEY, now);
          } catch {
            // ignore
          }
        }
        notify('Offline changes synchronized successfully.');
      }
    } catch {
      // keep local data untouched if sync cannot complete yet
    } finally {
      syncingRef.current = false;
      setCloudSyncing(false);
    }
  }, [cloudUser, notify, refreshOutboxCount, user]);

  // Boot auth session + Firestore test + offline fallback
  useEffect(() => {
    let mounted = true;
    void testFirestoreConnection();
    void refreshOutboxCount();

    const unsubscribeAuth = onAuthStateChanged(auth, (fbUser) => {
      if (!mounted) return;
      if (fbUser) {
        setCloudUser({
          uid: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName,
        });
      } else {
        setCloudUser(null);
      }
    });

    (async () => {
      try {
        const session = await apiRequest<{
          authenticated: boolean;
          user: UserProfile | null;
          showDefaultHint: boolean;
          brand: any;
        }>('/api/auth/session');
        if (!mounted) return;
        if (session.brand) setLoginBrand(session.brand);
        setShowDefaultHint(session.showDefaultHint);
        if (session.authenticated && session.user) {
          setUser(session.user);
          setCachedUser(session.user);
        } else {
          setCachedUser(null);
        }
      } catch (err: any) {
        if (!mounted) return;
        const cachedUser = getCachedUser();
        if (isNetworkFailure(err) && getStoredToken() && cachedUser) {
          setUser(cachedUser);
          const cachedSnap = await loadOfflineSnapshot();
          if (cachedSnap) {
            setData(cachedSnap);
            setLoginBrand({
              business_name: cachedSnap.settings.business_name,
              logo_url: cachedSnap.settings.logo_url,
              location: cachedSnap.settings.location,
            });
          }
        }
      } finally {
        if (mounted) setAuthChecked(true);
      }
    })();

    return () => {
      mounted = false;
      unsubscribeAuth();
    };
  }, [refreshOutboxCount]);

  useEffect(() => {
    if (user) {
      loadBootstrap();
    }
  }, [user, loadBootstrap]);

  // Auto-flush outbox whenever connection returns
  useEffect(() => {
    if (isOnline && user && outboxCount > 0) {
      void flushOutbox();
    }
  }, [isOnline, user, outboxCount, flushOutbox]);

  const handleLogout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore offline logout
    }
    setStoredToken(null);
    setCachedUser(null);
    setUser(null);
    setData(null);
  }, []);

  // Configurable inactivity auto-lock timer
  useEffect(() => {
    if (!user) return;
    const minutes = data?.settings?.inactivity_timeout_minutes ?? 15;
    if (!minutes || minutes <= 0) return;

    let timer: ReturnType<typeof setTimeout>;
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void handleLogout();
        notify(`Workspace auto-locked after ${minutes} minutes of inactivity.`);
      }, minutes * 60 * 1000);
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [user, data?.settings?.inactivity_timeout_minutes, handleLogout, notify]);

  // Global keyboard shortcuts (Alt+N, Alt+E, Alt+O, Alt+C, Alt+D, Alt+R, Alt+P)
  useEffect(() => {
    if (!user) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === 'n') {
        e.preventDefault();
        setActiveNav('sales');
        setSaleModalOpen(true);
      } else if (key === 'e') {
        e.preventDefault();
        setActiveNav('expenses');
        setExpenseModalOpen(true);
      } else if (key === 'o') {
        e.preventDefault();
        setActiveNav('orders');
        setOrderModalOpen(true);
      } else if (key === 'c') {
        e.preventDefault();
        setActiveNav('customers');
        setCustomerModalOpen(true);
      } else if (key === 'd') {
        e.preventDefault();
        setActiveNav('dashboard');
      } else if (key === 'r') {
        e.preventDefault();
        setActiveNav('receipts');
      } else if (key === 'p') {
        e.preventDefault();
        if (window.electronAPI?.printCurrent) {
          void window.electronAPI.printCurrent();
        } else {
          window.print();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user]);

  // Cloud Sync Handlers
  const handleCloudSignIn = async () => {
    try {
      const res = await signInWithPopup(auth, googleProvider);
      setCloudUser({
        uid: res.user.uid,
        email: res.user.email,
        displayName: res.user.displayName,
      });
      notify(`Connected to Google Cloud Workspace (${res.user.email}).`);
    } catch (err: any) {
      notify(err.message || 'Google Cloud sign-in cancelled or failed.', 'error');
    }
  };

  const handleCloudSignOut = async () => {
    await signOut(auth);
    setCloudUser(null);
    notify('Disconnected from Google Cloud Sync.');
  };

  const handlePushCloud = async () => {
    if (!cloudUser || !data) return;
    setCloudSyncing(true);
    try {
      if (outboxCount > 0) {
        await flushOutbox();
      }
      const latest = data;
      const { pushedCount } = await pushWorkspaceToCloud(cloudUser.uid, latest);
      const now = new Date().toISOString();
      setLastSyncedAt(now);
      try {
        localStorage.setItem(LAST_SYNC_KEY, now);
      } catch {
        // ignore
      }
      notify(`Cloud backup synced (${pushedCount} records pushed).`);
    } catch (err: any) {
      notify(err.message || 'Cloud push failed. Local data remains safe.', 'error');
    } finally {
      setCloudSyncing(false);
    }
  };

  const handlePullCloud = async () => {
    if (!cloudUser) return;
    setCloudSyncing(true);
    try {
      const cloudData = await pullWorkspaceFromCloud(cloudUser.uid);
      const res = await apiRequest<{ ok: boolean; mergedCount: number }>('/api/sync/merge-cloud', {
        method: 'POST',
        body: JSON.stringify(cloudData),
      });
      await loadBootstrap();
      const now = new Date().toISOString();
      setLastSyncedAt(now);
      try {
        localStorage.setItem(LAST_SYNC_KEY, now);
      } catch {
        // ignore
      }
      notify(`Pulled and merged ${res.mergedCount} records from Cloud.`);
    } catch (err: any) {
      notify(err.message || 'Cloud pull failed. Local data remains safe.', 'error');
    } finally {
      setCloudSyncing(false);
    }
  };

  // Offline-first CRUD Handlers
  const handleCreateSale = async (payload: any, openReceipt: boolean) => {
    const syncId = generateClientSyncId('sale');
    const enrichedPayload = { ...payload, client_sync_id: syncId };

    if (navigator.onLine) {
      try {
        const res = await apiRequest<{ sale: Sale; customers: Customer[]; settings: BusinessSettings }>(
          '/api/sales',
          {
            method: 'POST',
            body: JSON.stringify(enrichedPayload),
          }
        );
        updateDataAndCache((prev) => ({
          ...prev,
          sales: [res.sale, ...prev.sales],
          customers: res.customers,
          settings: res.settings,
        }));
        notify(`Sale ${res.sale.receipt_number} recorded.`);
        if (openReceipt) setActiveReceipt(res.sale);
        return;
      } catch (err: any) {
        if (!isNetworkFailure(err)) throw err;
      }
    }

    // Offline fallback
    if (!data) return;
    const seq = data.settings.next_receipt_seq || 1;
    const prefix = data.settings.receipt_prefix || 'SBM';
    const year = new Date().getFullYear();
    const receiptNumber = `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
    const subtotal = (payload.items || []).reduce((sum: number, i: any) => sum + Number(i.line_total || i.quantity * i.unit_price || 0), 0);
    const discount = Math.min(subtotal, Math.max(0, Number(payload.discount) || 0));
    const totalAmount = Math.max(0, subtotal - discount);
    const paid = Math.min(totalAmount, Math.max(0, Number(payload.amount_paid) || 0));
    const balance = Math.max(0, totalAmount - paid);
    const status = balance === 0 ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Unpaid';
    const tempId = -Date.now();
    const nowIso = new Date().toISOString();

    const offlineSale: Sale = {
      id: tempId,
      receipt_number: receiptNumber,
      order_id: payload.order_id || null,
      customer_id: payload.customer_id || null,
      customer_name: payload.customer_name,
      customer_phone: payload.customer_phone || '',
      items: payload.items,
      subtotal,
      discount,
      total_amount: totalAmount,
      amount_paid: paid,
      balance_due: balance,
      payment_method: payload.payment_method || 'Cash',
      payment_status: status,
      notes: payload.notes || '',
      sale_date: payload.sale_date || nowIso.slice(0, 10),
      client_sync_id: syncId,
      created_at: nowIso,
      updated_at: nowIso,
      payments: paid > 0 ? [{ id: tempId, sale_id: tempId, amount: paid, payment_method: payload.payment_method || 'Cash', note: 'Offline initial payment', paid_at: nowIso }] : [],
    };

    await enqueueOutbox('create_sale', { ...enrichedPayload, receipt_number: receiptNumber }, tempId);
    await refreshOutboxCount();

    updateDataAndCache((prev) => ({
      ...prev,
      sales: [offlineSale, ...prev.sales],
      settings: { ...prev.settings, next_receipt_seq: seq + 1 },
      customers: prev.customers.map((c) =>
        c.id === payload.customer_id
          ? {
              ...c,
              total_spent: (c.total_spent || 0) + totalAmount,
              outstanding_balance: (c.outstanding_balance || 0) + balance,
              sale_count: (c.sale_count || 0) + 1,
            }
          : c
      ),
    }));

    notify(`Receipt ${receiptNumber} saved offline — queued for sync.`);
    if (openReceipt) setActiveReceipt(offlineSale);
  };

  const handleRecordPayment = async (
    saleId: number,
    amount: number,
    payment_method: PaymentMethod,
    note: string
  ) => {
    if (navigator.onLine && saleId > 0) {
      try {
        const res = await apiRequest<{ sale: Sale; customers: Customer[] }>(
          `/api/sales/${saleId}/payments`,
          {
            method: 'POST',
            body: JSON.stringify({ amount, payment_method, note }),
          }
        );
        updateDataAndCache((prev) => ({
          ...prev,
          sales: prev.sales.map((s) => (s.id === saleId ? res.sale : s)),
          customers: res.customers,
        }));
        notify(`Payment recorded for ${res.sale.receipt_number}.`);
        return;
      } catch (err: any) {
        if (!isNetworkFailure(err)) throw err;
      }
    }

    await enqueueOutbox('record_payment', { amount, payment_method, note }, saleId);
    await refreshOutboxCount();

    updateDataAndCache((prev) => {
      const targetSale = prev.sales.find((s) => s.id === saleId);
      if (!targetSale) return prev;
      const newPaid = Math.min(targetSale.total_amount, targetSale.amount_paid + amount);
      const newBalance = Math.max(0, targetSale.total_amount - newPaid);
      const newStatus = newBalance === 0 ? 'Paid' : newPaid > 0 ? 'Partially Paid' : 'Unpaid';
      const nowIso = new Date().toISOString();
      const updatedSale: Sale = {
        ...targetSale,
        amount_paid: newPaid,
        balance_due: newBalance,
        payment_status: newStatus,
        updated_at: nowIso,
        payments: [
          { id: -Date.now(), sale_id: saleId, amount, payment_method, note: note || 'Offline payment', paid_at: nowIso },
          ...(targetSale.payments || []),
        ],
      };
      return {
        ...prev,
        sales: prev.sales.map((s) => (s.id === saleId ? updatedSale : s)),
      };
    });
    notify('Payment saved offline — queued for sync.');
  };

  const handleDeleteSale = async (saleId: number) => {
    if (navigator.onLine && saleId > 0) {
      try {
        const res = await apiRequest<{ ok: boolean; customers: Customer[] }>(`/api/sales/${saleId}`, {
          method: 'DELETE',
        });
        updateDataAndCache((prev) => ({
          ...prev,
          sales: prev.sales.filter((s) => s.id !== saleId),
          customers: res.customers,
        }));
        notify('Sale record deleted.');
        return;
      } catch (err: any) {
        if (!isNetworkFailure(err)) throw err;
      }
    }
    if (saleId > 0) {
      await enqueueOutbox('delete_sale', {}, saleId);
      await refreshOutboxCount();
    }
    updateDataAndCache((prev) => ({
      ...prev,
      sales: prev.sales.filter((s) => s.id !== saleId),
    }));
    notify('Sale removed locally — queued for sync.');
  };

  const handleSaveExpense = async (payload: Partial<Expense>, id?: number) => {
    if (id) {
      if (navigator.onLine && id > 0) {
        try {
          const updated = await apiRequest<Expense>(`/api/expenses/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          updateDataAndCache((prev) => ({
            ...prev,
            expenses: prev.expenses.map((e) => (e.id === id ? updated : e)),
          }));
          notify('Expense updated.');
          return;
        } catch (err: any) {
          if (!isNetworkFailure(err)) throw err;
        }
      }
      await enqueueOutbox('update_expense', payload, id);
      await refreshOutboxCount();
      updateDataAndCache((prev) => ({
        ...prev,
        expenses: prev.expenses.map((e) => (e.id === id ? { ...e, ...payload } : e)),
      }));
      notify('Expense update queued offline.');
    } else {
      const syncId = generateClientSyncId('exp');
      const enriched = { ...payload, client_sync_id: syncId };
      if (navigator.onLine) {
        try {
          const created = await apiRequest<Expense>('/api/expenses', {
            method: 'POST',
            body: JSON.stringify(enriched),
          });
          updateDataAndCache((prev) => ({
            ...prev,
            expenses: [created, ...prev.expenses],
          }));
          notify('Expense recorded.');
          return;
        } catch (err: any) {
          if (!isNetworkFailure(err)) throw err;
        }
      }
      const tempId = -Date.now();
      const offlineExpense: Expense = {
        id: tempId,
        title: String(payload.title || 'Expense'),
        category: payload.category || 'Other Business Expenses',
        amount: Number(payload.amount || 0),
        payment_method: payload.payment_method || 'Cash',
        vendor: payload.vendor || '',
        notes: payload.notes || '',
        expense_date: payload.expense_date || new Date().toISOString().slice(0, 10),
        client_sync_id: syncId,
        created_at: new Date().toISOString(),
      };
      await enqueueOutbox('create_expense', enriched, tempId);
      await refreshOutboxCount();
      updateDataAndCache((prev) => ({
        ...prev,
        expenses: [offlineExpense, ...prev.expenses],
      }));
      notify('Expense saved offline — queued for sync.');
    }
  };

  const handleDeleteExpense = async (id: number) => {
    if (navigator.onLine && id > 0) {
      try {
        await apiRequest(`/api/expenses/${id}`, { method: 'DELETE' });
        updateDataAndCache((prev) => ({
          ...prev,
          expenses: prev.expenses.filter((e) => e.id !== id),
        }));
        notify('Expense deleted.');
        return;
      } catch (err: any) {
        if (!isNetworkFailure(err)) throw err;
      }
    }
    if (id > 0) {
      await enqueueOutbox('delete_expense', {}, id);
      await refreshOutboxCount();
    }
    updateDataAndCache((prev) => ({
      ...prev,
      expenses: prev.expenses.filter((e) => e.id !== id),
    }));
    notify('Expense deleted locally — queued for sync.');
  };

  const handleSaveProduct = async (payload: Partial<Product>, id?: number) => {
    if (id) {
      if (navigator.onLine && id > 0) {
        try {
          const updated = await apiRequest<Product>(`/api/products/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          updateDataAndCache((prev) => ({
            ...prev,
            products: prev.products.map((p) => (p.id === id ? updated : p)),
          }));
          notify('Product updated.');
          return;
        } catch (err: any) {
          if (!isNetworkFailure(err)) throw err;
        }
      }
      await enqueueOutbox('update_product', payload, id);
      await refreshOutboxCount();
      updateDataAndCache((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === id ? { ...p, ...payload } : p)),
      }));
      notify('Product update saved offline.');
    } else {
      const syncId = generateClientSyncId('prod');
      const enriched = { ...payload, client_sync_id: syncId };
      if (navigator.onLine) {
        try {
          const created = await apiRequest<Product>('/api/products', {
            method: 'POST',
            body: JSON.stringify(enriched),
          });
          updateDataAndCache((prev) => ({
            ...prev,
            products: [...prev.products, created],
          }));
          notify('Product added to catalog.');
          return;
        } catch (err: any) {
          if (!isNetworkFailure(err)) throw err;
        }
      }
      const tempId = -Date.now();
      const nowIso = new Date().toISOString();
      const offlineProduct: Product = {
        id: tempId,
        name: String(payload.name || 'Product'),
        category: payload.category || 'Other Printing & Branding',
        description: payload.description || '',
        unit_price: Number(payload.unit_price || 0),
        production_cost: Number(payload.production_cost || 0),
        unit_label: payload.unit_label || 'piece',
        is_active: payload.is_active ?? 1,
        client_sync_id: syncId,
        created_at: nowIso,
        updated_at: nowIso,
      };
      await enqueueOutbox('create_product', enriched, tempId);
      await refreshOutboxCount();
      updateDataAndCache((prev) => ({
        ...prev,
        products: [...prev.products, offlineProduct],
      }));
      notify('Product saved offline — queued for sync.');
    }
  };

  const handleDeleteProduct = async (id: number) => {
    if (navigator.onLine && id > 0) {
      try {
        await apiRequest(`/api/products/${id}`, { method: 'DELETE' });
        updateDataAndCache((prev) => ({
          ...prev,
          products: prev.products.filter((p) => p.id !== id),
        }));
        notify('Product removed.');
        return;
      } catch (err: any) {
        if (!isNetworkFailure(err)) throw err;
      }
    }
    if (id > 0) {
      await enqueueOutbox('delete_product', {}, id);
      await refreshOutboxCount();
    }
    updateDataAndCache((prev) => ({
      ...prev,
      products: prev.products.filter((p) => p.id !== id),
    }));
    notify('Product removed locally — queued for sync.');
  };

  const handleSaveCustomer = async (payload: Partial<Customer>, id?: number) => {
    if (id) {
      if (navigator.onLine && id > 0) {
        try {
          const updated = await apiRequest<Customer>(`/api/customers/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          updateDataAndCache((prev) => ({
            ...prev,
            customers: prev.customers.map((c) => (c.id === id ? updated : c)),
          }));
          notify('Customer details updated.');
          return;
        } catch (err: any) {
          if (!isNetworkFailure(err)) throw err;
        }
      }
      await enqueueOutbox('update_customer', payload, id);
      await refreshOutboxCount();
      updateDataAndCache((prev) => ({
        ...prev,
        customers: prev.customers.map((c) => (c.id === id ? { ...c, ...payload } : c)),
      }));
      notify('Customer update queued offline.');
    } else {
      const syncId = generateClientSyncId('cust');
      const enriched = { ...payload, client_sync_id: syncId };
      if (navigator.onLine) {
        try {
          const created = await apiRequest<Customer>('/api/customers', {
            method: 'POST',
            body: JSON.stringify(enriched),
          });
          updateDataAndCache((prev) => ({
            ...prev,
            customers: [...prev.customers, created],
          }));
          notify('Customer added.');
          return;
        } catch (err: any) {
          if (!isNetworkFailure(err)) throw err;
        }
      }
      const tempId = -Date.now();
      const nowIso = new Date().toISOString();
      const offlineCustomer: Customer = {
        id: tempId,
        name: String(payload.name || 'Customer'),
        phone: payload.phone || '',
        email: payload.email || '',
        location: payload.location || '',
        notes: payload.notes || '',
        client_sync_id: syncId,
        created_at: nowIso,
        updated_at: nowIso,
        total_spent: 0,
        outstanding_balance: 0,
        order_count: 0,
        sale_count: 0,
      };
      await enqueueOutbox('create_customer', enriched, tempId);
      await refreshOutboxCount();
      updateDataAndCache((prev) => ({
        ...prev,
        customers: [...prev.customers, offlineCustomer],
      }));
      notify('Customer saved offline — queued for sync.');
    }
  };

  const handleDeleteCustomer = async (id: number) => {
    if (navigator.onLine && id > 0) {
      try {
        await apiRequest(`/api/customers/${id}`, { method: 'DELETE' });
        updateDataAndCache((prev) => ({
          ...prev,
          customers: prev.customers.filter((c) => c.id !== id),
        }));
        notify('Customer deleted.');
        return;
      } catch (err: any) {
        if (!isNetworkFailure(err)) throw err;
      }
    }
    if (id > 0) {
      await enqueueOutbox('delete_customer', {}, id);
      await refreshOutboxCount();
    }
    updateDataAndCache((prev) => ({
      ...prev,
      customers: prev.customers.filter((c) => c.id !== id),
    }));
    notify('Customer deleted locally — queued for sync.');
  };

  const handleSaveOrder = async (payload: Partial<Order>, id?: number) => {
    if (id) {
      if (navigator.onLine && id > 0) {
        try {
          const updated = await apiRequest<Order>(`/api/orders/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          updateDataAndCache((prev) => ({
            ...prev,
            orders: prev.orders.map((o) => (o.id === id ? updated : o)),
          }));
          notify(`Order ${updated.order_number} updated.`);
          return;
        } catch (err: any) {
          if (!isNetworkFailure(err)) throw err;
        }
      }
      await enqueueOutbox('update_order', payload, id);
      await refreshOutboxCount();
      updateDataAndCache((prev) => ({
        ...prev,
        orders: prev.orders.map((o) => (o.id === id ? { ...o, ...payload } : o)),
      }));
      notify('Order update saved offline.');
    } else {
      const syncId = generateClientSyncId('ord');
      const orderNum = `ORD-${1001 + (data?.orders.length || 0) + Math.floor(Math.random() * 90)}`;
      const enriched = { ...payload, client_sync_id: syncId };
      if (navigator.onLine) {
        try {
          const created = await apiRequest<Order>('/api/orders', {
            method: 'POST',
            body: JSON.stringify(enriched),
          });
          updateDataAndCache((prev) => ({
            ...prev,
            orders: [created, ...prev.orders],
          }));
          notify(`Order ${created.order_number} created.`);
          return;
        } catch (err: any) {
          if (!isNetworkFailure(err)) throw err;
        }
      }
      const tempId = -Date.now();
      const nowIso = new Date().toISOString();
      const offlineOrder: Order = {
        id: tempId,
        order_number: orderNum,
        customer_id: payload.customer_id || null,
        customer_name: String(payload.customer_name || 'Customer'),
        customer_phone: payload.customer_phone || '',
        title: String(payload.title || 'Print Order'),
        items_summary: payload.items_summary || '',
        quantity: Number(payload.quantity || 1),
        total_amount: Number(payload.total_amount || 0),
        deposit_paid: Number(payload.deposit_paid || 0),
        status: payload.status || 'New Order',
        deadline: payload.deadline || '',
        delivery_details: payload.delivery_details || '',
        instructions: payload.instructions || '',
        client_sync_id: syncId,
        created_at: nowIso,
        updated_at: nowIso,
      };
      await enqueueOutbox('create_order', { ...enriched, order_number: orderNum }, tempId);
      await refreshOutboxCount();
      updateDataAndCache((prev) => ({
        ...prev,
        orders: [offlineOrder, ...prev.orders],
      }));
      notify(`Order ${orderNum} saved offline — queued for sync.`);
    }
  };

  const handleDeleteOrder = async (id: number) => {
    if (navigator.onLine && id > 0) {
      try {
        await apiRequest(`/api/orders/${id}`, { method: 'DELETE' });
        updateDataAndCache((prev) => ({
          ...prev,
          orders: prev.orders.filter((o) => o.id !== id),
        }));
        notify('Order removed.');
        return;
      } catch (err: any) {
        if (!isNetworkFailure(err)) throw err;
      }
    }
    if (id > 0) {
      await enqueueOutbox('delete_order', {}, id);
      await refreshOutboxCount();
    }
    updateDataAndCache((prev) => ({
      ...prev,
      orders: prev.orders.filter((o) => o.id !== id),
    }));
    notify('Order removed locally — queued for sync.');
  };

  const handleConvertOrderToSale = async (order: Order) => {
    if (!data) return;
    const unitPrice = order.quantity > 0 ? order.total_amount / order.quantity : order.total_amount;
    await handleCreateSale(
      {
        order_id: order.id,
        customer_id: order.customer_id,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        items: [
          {
            product_id: null,
            product_name: `${order.title}${order.items_summary ? ` (${order.items_summary})` : ''}`,
            category: 'Other Printing & Branding',
            quantity: order.quantity || 1,
            unit_price: unitPrice,
            unit_cost: 0,
            line_total: order.total_amount,
          },
        ],
        discount: 0,
        amount_paid: order.deposit_paid || 0,
        payment_method: data.settings.default_payment_method || 'Mobile Money',
        notes: `Converted from ${order.order_number}`,
        sale_date: new Date().toISOString().slice(0, 10),
      },
      true
    );
    if (navigator.onLine) {
      await loadBootstrap();
    }
  };

  const handleSaveSettings = async (payload: Partial<BusinessSettings>) => {
    if (navigator.onLine) {
      try {
        const updated = await apiRequest<BusinessSettings>('/api/settings', {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        updateDataAndCache((prev) => ({ ...prev, settings: updated }));
        return;
      } catch (err: any) {
        if (!isNetworkFailure(err)) throw err;
      }
    }
    await enqueueOutbox('update_settings', payload);
    await refreshOutboxCount();
    updateDataAndCache((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...payload },
    }));
  };

  const handleQuickAction = (action: 'sale' | 'expense' | 'customer' | 'order') => {
    if (action === 'sale') {
      setActiveNav('sales');
      setSaleModalOpen(true);
    } else if (action === 'expense') {
      setActiveNav('expenses');
      setExpenseModalOpen(true);
    } else if (action === 'customer') {
      setActiveNav('customers');
      setCustomerModalOpen(true);
    } else if (action === 'order') {
      setActiveNav('orders');
      setOrderModalOpen(true);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0B1D3A] flex items-center justify-center text-white text-sm">
        Loading STANLEY BUSINESS MANAGER...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthLogin
        brand={loginBrand}
        showDefaultHint={showDefaultHint}
        onSuccess={(loggedInUser) => {
          setUser(loggedInUser);
          setCachedUser(loggedInUser);
        }}
      />
    );
  }

  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeNav) || NAV_ITEMS[0];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0B1D3A] text-white border-r border-slate-800">
        <div className="px-5 py-5 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden border border-amber-400/30 bg-[#0B1D3A] shrink-0">
            <img
              src={data?.settings.logo_url || loginBrand.logo_url}
              alt="Stanley Logo"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-wider text-[#C89B3C] truncate">
              STANLEY
            </p>
            <p className="text-sm font-bold text-white truncate">Business Manager</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={`w-full h-10 px-3 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#132B52] text-[#C89B3C] font-semibold'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#C89B3C]' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0">
              <p className="font-semibold text-white truncate">{user.full_name}</p>
              <p className="text-slate-400 truncate">{user.role}</p>
            </div>
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              aria-label="About Application"
              title="About & Shortcuts"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
          <PWAInstallButton variant="sidebar" allowPackagingKit />
          <button
            type="button"
            onClick={handleLogout}
            className="w-full h-9 px-3 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 text-[#C89B3C]" />
            Lock &amp; Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-[#0B1D3A] text-white flex flex-col h-full shadow-2xl">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={data?.settings.logo_url || loginBrand.logo_url}
                  alt="Logo"
                  referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-lg object-cover border border-amber-400/30"
                />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-[#C89B3C]">STANLEY</p>
                  <p className="text-sm font-bold truncate">Business Manager</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-slate-300 hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full h-11 px-3 rounded-lg text-sm font-medium flex items-center gap-3 cursor-pointer ${
                      active
                        ? 'bg-[#132B52] text-[#C89B3C] font-semibold'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-4 border-t border-white/10 space-y-2.5">
              <PWAInstallButton variant="sidebar" allowPackagingKit />
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setAboutOpen(true);
                }}
                className="w-full h-9 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Info className="w-3.5 h-3.5 text-[#C89B3C]" />
                About &amp; Shortcuts
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full h-10 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-white flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4 text-[#C89B3C]" />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="no-print sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden h-10 w-10 rounded-lg border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="text-xs text-slate-500 truncate">
                {data?.settings.business_name || 'STANLEY BUSINESS MANAGER'} /{' '}
                <span className="text-slate-900 font-medium">{activeNavMeta.label}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {outboxCount > 0 && (
              <button
                type="button"
                disabled={!isOnline || cloudSyncing}
                onClick={() => void flushOutbox()}
                className="h-9 px-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${cloudSyncing ? 'animate-spin' : ''}`} />
                Sync ({outboxCount})
              </button>
            )}
            {cloudUser && (
              <button
                type="button"
                onClick={() => setActiveNav('settings')}
                title={`Cloud Sync connected: ${cloudUser.email}`}
                className="hidden sm:inline-flex h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Cloud className="w-3.5 h-3.5 text-emerald-600" />
                Cloud Ready
              </button>
            )}
            <PWAInstallButton variant="header" autoOpenOnInstallParam allowPackagingKit />
            <button
              type="button"
              onClick={() => {
                setActiveNav('sales');
                setSaleModalOpen(true);
              }}
              className="h-9 px-3.5 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5 text-[#C89B3C]" />
              New Sale
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {loadingData && !data ? (
            <div className="space-y-4">
              <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
                <div className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
                <div className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
              </div>
            </div>
          ) : data ? (
            <>
              {activeNav === 'dashboard' && (
                <DashboardView
                  settings={data.settings}
                  sales={data.sales}
                  expenses={data.expenses}
                  orders={data.orders}
                  customers={data.customers}
                  onQuickAction={handleQuickAction}
                  onNavigate={setActiveNav}
                  onViewReceipt={(sale) => setActiveReceipt(sale)}
                />
              )}

              {activeNav === 'sales' && (
                <SalesView
                  settings={data.settings}
                  sales={data.sales}
                  products={data.products}
                  customers={data.customers}
                  isCreateOpen={saleModalOpen}
                  onOpenCreate={() => setSaleModalOpen(true)}
                  onCloseCreate={() => setSaleModalOpen(false)}
                  onCreateSale={handleCreateSale}
                  onRecordPayment={handleRecordPayment}
                  onDeleteSale={handleDeleteSale}
                  onViewReceipt={(sale) => setActiveReceipt(sale)}
                />
              )}

              {activeNav === 'expenses' && (
                <ExpensesView
                  settings={data.settings}
                  expenses={data.expenses}
                  sales={data.sales}
                  isCreateOpen={expenseModalOpen}
                  onOpenCreate={() => setExpenseModalOpen(true)}
                  onCloseCreate={() => setExpenseModalOpen(false)}
                  onSaveExpense={handleSaveExpense}
                  onDeleteExpense={handleDeleteExpense}
                />
              )}

              {activeNav === 'receipts' && (
                <ReceiptsView
                  settings={data.settings}
                  sales={data.sales}
                  onCreateSaleClick={() => {
                    setActiveNav('sales');
                    setSaleModalOpen(true);
                  }}
                />
              )}

              {activeNav === 'orders' && (
                <OrdersView
                  settings={data.settings}
                  orders={data.orders}
                  customers={data.customers}
                  isCreateOpen={orderModalOpen}
                  onOpenCreate={() => setOrderModalOpen(true)}
                  onCloseCreate={() => setOrderModalOpen(false)}
                  onSaveOrder={handleSaveOrder}
                  onDeleteOrder={handleDeleteOrder}
                  onConvertOrderToSale={handleConvertOrderToSale}
                />
              )}

              {activeNav === 'products' && (
                <ProductsView
                  settings={data.settings}
                  products={data.products}
                  onSaveProduct={handleSaveProduct}
                  onDeleteProduct={handleDeleteProduct}
                />
              )}

              {activeNav === 'customers' && (
                <CustomersView
                  settings={data.settings}
                  customers={data.customers}
                  orders={data.orders}
                  sales={data.sales}
                  isCreateOpen={customerModalOpen}
                  onOpenCreate={() => setCustomerModalOpen(true)}
                  onCloseCreate={() => setCustomerModalOpen(false)}
                  onSaveCustomer={handleSaveCustomer}
                  onDeleteCustomer={handleDeleteCustomer}
                  onViewReceipt={(sale) => setActiveReceipt(sale)}
                />
              )}

              {activeNav === 'analytics' && (
                <AnalyticsView
                  settings={data.settings}
                  sales={data.sales}
                  expenses={data.expenses}
                  customers={data.customers}
                />
              )}

              {activeNav === 'reports' && (
                <ReportsView
                  settings={data.settings}
                  sales={data.sales}
                  expenses={data.expenses}
                  customers={data.customers}
                />
              )}

              {activeNav === 'settings' && (
                <SettingsView
                  settings={data.settings}
                  user={user}
                  sales={data.sales}
                  expenses={data.expenses}
                  customers={data.customers}
                  orders={data.orders}
                  products={data.products}
                  isOnline={isOnline}
                  outboxCount={outboxCount}
                  cloudUser={cloudUser}
                  cloudSyncing={cloudSyncing}
                  lastSyncedAt={lastSyncedAt}
                  onSaveSettings={handleSaveSettings}
                  onUserUpdated={(updatedUser) => {
                    setUser(updatedUser);
                    setCachedUser(updatedUser);
                  }}
                  onReloadAll={loadBootstrap}
                  onNotify={notify}
                  onCloudSignIn={handleCloudSignIn}
                  onCloudSignOut={handleCloudSignOut}
                  onPushCloud={handlePushCloud}
                  onPullCloud={handlePullCloud}
                  onFlushOutbox={flushOutbox}
                  onOpenAbout={() => setAboutOpen(true)}
                />
              )}
            </>
          ) : null}
        </main>
      </div>

      {/* Global Receipt Modal */}
      {data && activeReceipt && (
        <ReceiptViewerModal
          sale={activeReceipt}
          settings={data.settings}
          onClose={() => setActiveReceipt(null)}
        />
      )}

      {/* About & Shortcuts Modal */}
      {data && (
        <AboutModal
          open={aboutOpen}
          settings={data.settings}
          onClose={() => setAboutOpen(false)}
        />
      )}

      {/* Offline Connectivity Banner */}
      {!isOnline && (
        <div
          role="status"
          className="no-print fixed bottom-5 left-5 z-50 px-3.5 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold shadow-lg inline-flex items-center gap-2"
        >
          <WifiOff className="w-3.5 h-3.5" />
          <span>
            Offline Mode — Recording locally{outboxCount > 0 ? ` (${outboxCount} queued)` : ''}
          </span>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`no-print fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium ${
            toast.type === 'error'
              ? 'bg-red-600 text-white border-red-700'
              : 'bg-[#0B1D3A] text-white border-[#C89B3C]'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
