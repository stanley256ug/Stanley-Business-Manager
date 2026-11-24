import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Cloud,
  CreditCard,
  FileSpreadsheet,
  Info,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Settings,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AppBootstrapData,
  AppNotification,
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
import {
  BrowserNotificationPermission,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  triggerBrowserNotification,
} from './utils/browserNotifications';
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
import { SettingsView, CloudUserInfo } from './components/SettingsView';
import { AdminMonitorView } from './components/AdminMonitorView';
import { ReceiptViewerModal } from './components/ReceiptViewerModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { NotificationCenter } from './components/NotificationCenter';
import { AboutModal } from './components/AboutModal';
import { BusinessProfileSetupModal } from './components/BusinessProfileSetupModal';
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

const PUBLIC_LOGIN_BRAND = {
  business_name: 'STANLEY BUSINESS MANAGER',
  logo_url: '/src/assets/images/stanley_brand_logo_1795171819618.jpg',
  location: 'Business Management, Receipts & Cloud Sync',
};

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loginBrand, setLoginBrand] = useState(PUBLIC_LOGIN_BRAND);

  const [data, setData] = useState<AppBootstrapData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [navStackDepth, setNavStackDepth] = useState(1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [forceSignInTick, setForceSignInTick] = useState(0);
  const [forceBillingTick, setForceBillingTick] = useState(0);
  const [authBillingError, setAuthBillingError] = useState('');
  const [exitWarning, setExitWarning] = useState<string | null>(null);
  const [appExited, setAppExited] = useState(false);

  // Modal triggers across sections
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<Sale | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Notifications state & refs
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [liveAlert, setLiveAlert] = useState<AppNotification | null>(null);
  const [browserPermission, setBrowserPermission] = useState<BrowserNotificationPermission>(() =>
    getBrowserNotificationPermission()
  );
  const seenNotificationIdsRef = useRef<Set<number>>(new Set());
  const liveAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigation & Double-Back-to-Exit refs
  const navStackRef = useRef<NavSection[]>(['dashboard']);
  const activeNavRef = useRef<NavSection>('dashboard');
  const userRef = useRef<UserProfile | null>(null);
  const authModeRef = useRef<'billing' | 'signin' | 'register' | 'forgot'>('billing');
  const overlaysRef = useRef({
    notificationsOpen: false,
    mobileMenuOpen: false,
    activeReceipt: false,
    aboutOpen: false,
    saleModalOpen: false,
    expenseModalOpen: false,
    customerModalOpen: false,
    orderModalOpen: false,
  });
  const lastBackAttemptRef = useRef<number>(0);
  const exitWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoringPopStateRef = useRef<boolean>(false);
  const historyInitializedRef = useRef<boolean>(false);

  userRef.current = user;
  activeNavRef.current = activeNav;
  overlaysRef.current = {
    notificationsOpen,
    mobileMenuOpen,
    activeReceipt: Boolean(activeReceipt),
    aboutOpen,
    saleModalOpen,
    expenseModalOpen,
    customerModalOpen,
    orderModalOpen,
  };

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

  const clearExitWarning = useCallback(() => {
    if (exitWarningTimerRef.current) {
      clearTimeout(exitWarningTimerRef.current);
      exitWarningTimerRef.current = null;
    }
    lastBackAttemptRef.current = 0;
    setExitWarning(null);
  }, []);

  const showExitWarning = useCallback(() => {
    lastBackAttemptRef.current = Date.now();
    setExitWarning('Press Back again to exit STANLEY BUSINESS MANAGER.');
    if (exitWarningTimerRef.current) {
      clearTimeout(exitWarningTimerRef.current);
    }
    exitWarningTimerRef.current = setTimeout(() => {
      lastBackAttemptRef.current = 0;
      setExitWarning(null);
      exitWarningTimerRef.current = null;
    }, 2600);
  }, []);

  const navigateTo = useCallback(
    (next: NavSection) => {
      clearExitWarning();
      if (activeNavRef.current === next) {
        setActiveNav(next);
        return;
      }
      const stack = [...navStackRef.current, next].slice(-50);
      navStackRef.current = stack;
      activeNavRef.current = next;
      setActiveNav(next);
      setNavStackDepth(stack.length);
      try {
        window.history.pushState({ sbmNav: next, sbmIdx: stack.length - 1 }, '');
      } catch {
        // ignore history sandbox errors
      }
    },
    [clearExitWarning]
  );

  const resetNavigationRoot = useCallback(
    (home: NavSection) => {
      clearExitWarning();
      navStackRef.current = [home];
      activeNavRef.current = home;
      setActiveNav(home);
      setNavStackDepth(1);
      setAppExited(false);
      try {
        if (!historyInitializedRef.current) {
          window.history.replaceState({ sbmRoot: true, sbmNav: home, sbmIdx: 0 }, '');
          window.history.pushState({ sbmGuard: true, sbmNav: home, sbmIdx: 0 }, '');
          historyInitializedRef.current = true;
        } else if (window.history.state?.sbmGuard) {
          window.history.replaceState({ sbmGuard: true, sbmNav: home, sbmIdx: 0 }, '');
        } else {
          window.history.pushState({ sbmGuard: true, sbmNav: home, sbmIdx: 0 }, '');
        }
      } catch {
        // ignore
      }
    },
    [clearExitWarning]
  );

  const handleAuthModeChange = useCallback(
    (nextMode: 'billing' | 'signin' | 'register' | 'forgot') => {
      clearExitWarning();
      const prevMode = authModeRef.current;
      authModeRef.current = nextMode;
      if (prevMode === 'billing' && nextMode !== 'billing') {
        try {
          window.history.pushState({ sbmAuthMode: nextMode }, '');
        } catch {
          // ignore
        }
      } else if (prevMode === 'signin' && nextMode === 'forgot') {
        try {
          window.history.pushState({ sbmAuthMode: nextMode }, '');
        } catch {
          // ignore
        }
      }
    },
    [clearExitWarning]
  );

  const closeTopOverlay = useCallback((): boolean => {
    const o = overlaysRef.current;
    if (o.notificationsOpen) {
      setNotificationsOpen(false);
      return true;
    }
    if (o.mobileMenuOpen) {
      setMobileMenuOpen(false);
      return true;
    }
    if (o.activeReceipt) {
      setActiveReceipt(null);
      return true;
    }
    if (o.aboutOpen) {
      setAboutOpen(false);
      return true;
    }
    if (o.saleModalOpen) {
      setSaleModalOpen(false);
      return true;
    }
    if (o.expenseModalOpen) {
      setExpenseModalOpen(false);
      return true;
    }
    if (o.customerModalOpen) {
      setCustomerModalOpen(false);
      return true;
    }
    if (o.orderModalOpen) {
      setOrderModalOpen(false);
      return true;
    }
    return false;
  }, []);

  const performAppExit = useCallback(
    (fromPopState: boolean) => {
      clearExitWarning();
      try {
        const capApp = (window as any).Capacitor?.Plugins?.App;
        if (capApp && typeof capApp.exitApp === 'function') {
          void capApp.exitApp();
        }
      } catch {
        // ignore
      }
      try {
        window.close();
      } catch {
        // ignore
      }
      try {
        ignoringPopStateRef.current = true;
        if (fromPopState) {
          window.history.back();
        } else {
          window.history.go(-2);
        }
      } catch {
        // ignore
      }
      setTimeout(() => {
        ignoringPopStateRef.current = false;
        setAppExited(true);
      }, 180);
    },
    [clearExitWarning]
  );

  const handleBackAction = useCallback(
    (fromPopState: boolean) => {
      if (appExited) return;

      if (closeTopOverlay()) {
        clearExitWarning();
        if (fromPopState) {
          try {
            window.history.pushState(
              navStackRef.current.length > 1
                ? { sbmNav: activeNavRef.current, sbmIdx: navStackRef.current.length - 1 }
                : { sbmGuard: true, sbmNav: activeNavRef.current, sbmIdx: 0 },
              ''
            );
          } catch {
            // ignore
          }
        }
        return;
      }

      if (!userRef.current && authModeRef.current !== 'billing') {
        clearExitWarning();
        if (authModeRef.current === 'forgot') {
          authModeRef.current = 'signin';
          setForceSignInTick((t) => t + 1);
        } else {
          authModeRef.current = 'billing';
          setForceBillingTick((t) => t + 1);
        }
        if (!fromPopState && window.history.state?.sbmAuthMode) {
          try {
            ignoringPopStateRef.current = true;
            window.history.back();
            setTimeout(() => {
              ignoringPopStateRef.current = false;
            }, 120);
          } catch {
            ignoringPopStateRef.current = false;
          }
        }
        return;
      }

      if (userRef.current && navStackRef.current.length > 1) {
        clearExitWarning();
        const nextStack = navStackRef.current.slice(0, -1);
        const prevNav = nextStack[nextStack.length - 1];
        navStackRef.current = nextStack;
        activeNavRef.current = prevNav;
        setActiveNav(prevNav);
        setNavStackDepth(nextStack.length);
        if (!fromPopState && window.history.state?.sbmNav && !window.history.state?.sbmGuard) {
          try {
            ignoringPopStateRef.current = true;
            window.history.back();
            setTimeout(() => {
              ignoringPopStateRef.current = false;
            }, 120);
          } catch {
            ignoringPopStateRef.current = false;
          }
        }
        return;
      }

      const now = Date.now();
      const isDoubleBack =
        lastBackAttemptRef.current > 0 && now - lastBackAttemptRef.current <= 2600;
      if (isDoubleBack) {
        performAppExit(fromPopState);
        return;
      }

      showExitWarning();
      if (fromPopState) {
        try {
          window.history.pushState(
            { sbmGuard: true, sbmNav: activeNavRef.current, sbmIdx: 0 },
            ''
          );
        } catch {
          // ignore
        }
      }
    },
    [appExited, clearExitWarning, closeTopOverlay, performAppExit, showExitWarning]
  );

  const refreshOutboxCount = useCallback(
    async (uid?: number) => {
      const targetId = uid ?? user?.id;
      if (!targetId) {
        setOutboxCount(0);
        return;
      }
      const items = await getOutboxItems(targetId);
      setOutboxCount(items.length);
    },
    [user?.id]
  );

  const updateDataAndCache = useCallback(
    (updater: (prev: AppBootstrapData) => AppBootstrapData) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        if (user?.id) {
          void saveOfflineSnapshot(user.id, next);
        }
        return next;
      });
    },
    [user?.id]
  );

  const loadBootstrap = useCallback(
    async (uid?: number) => {
      const targetId = uid ?? user?.id;
      setLoadingData(true);
      try {
        const payload = await apiRequest<AppBootstrapData>('/api/bootstrap');
        setData(payload);
        if (targetId) {
          await saveOfflineSnapshot(targetId, payload);
        }
      } catch (err: any) {
        if (err.status === 401) {
          setUser(null);
          setStoredToken(null);
          setCachedUser(null);
        } else if (targetId) {
          const cached = await loadOfflineSnapshot(targetId);
          if (cached) {
            setData(cached);
            if (isNetworkFailure(err)) {
              notify('Loaded offline cached business records.', 'success');
            }
          } else {
            notify(err.message || 'Failed to load business data.', 'error');
          }
        } else {
          notify(err.message || 'Failed to load business data.', 'error');
        }
      } finally {
        setLoadingData(false);
      }
    },
    [notify, user?.id]
  );

  const flushOutbox = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current || !user) return;
    const items = await getOutboxItems(user.id);
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

      await refreshOutboxCount(user.id);
      if (syncedAny) {
        const fresh = await apiRequest<AppBootstrapData>('/api/bootstrap');
        setData(fresh);
        await saveOfflineSnapshot(user.id, fresh);
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
          subscriptionRequired?: boolean;
          subscriptionError?: string;
          brand: any;
        }>('/api/auth/session');
        if (!mounted) return;
        if (session.brand) setLoginBrand(session.brand);
        if (session.authenticated && session.user) {
          setAuthBillingError('');
          setUser(session.user);
          setCachedUser(session.user);
          resetNavigationRoot(
            session.user.role === 'Administrator' ? 'admin' : 'dashboard'
          );
          void refreshOutboxCount(session.user.id);
        } else {
          if (session.subscriptionError) {
            setAuthBillingError(session.subscriptionError);
            setStoredToken(null);
          }
          setCachedUser(null);
          resetNavigationRoot('dashboard');
        }
      } catch (err: any) {
        if (!mounted) return;
        const cachedUser = getCachedUser();
        if (isNetworkFailure(err) && getStoredToken() && cachedUser) {
          setUser(cachedUser);
          resetNavigationRoot(
            cachedUser.role === 'Administrator' ? 'admin' : 'dashboard'
          );
          void refreshOutboxCount(cachedUser.id);
          const cachedSnap = await loadOfflineSnapshot(cachedUser.id);
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
  }, [refreshOutboxCount, resetNavigationRoot]);

  // Browser Back (popstate) & Android/Capacitor hardware Back listeners
  useEffect(() => {
    if (!historyInitializedRef.current) {
      try {
        window.history.replaceState({ sbmRoot: true, sbmNav: activeNavRef.current, sbmIdx: 0 }, '');
        window.history.pushState({ sbmGuard: true, sbmNav: activeNavRef.current, sbmIdx: 0 }, '');
        historyInitializedRef.current = true;
      } catch {
        // ignore
      }
    }

    const onPopState = () => {
      if (ignoringPopStateRef.current) {
        ignoringPopStateRef.current = false;
        return;
      }
      handleBackAction(true);
    };

    const onDocumentBackButton = (ev: Event) => {
      ev.preventDefault();
      handleBackAction(false);
    };

    window.addEventListener('popstate', onPopState);
    document.addEventListener('backbutton', onDocumentBackButton, false);

    let capListenerHandle: { remove?: () => Promise<void> | void } | null = null;
    try {
      const capApp = (window as any).Capacitor?.Plugins?.App;
      if (capApp && typeof capApp.addListener === 'function') {
        const maybeHandle = capApp.addListener('backButton', () => {
          handleBackAction(false);
        });
        if (maybeHandle && typeof maybeHandle.then === 'function') {
          void maybeHandle.then((h: any) => {
            capListenerHandle = h;
          });
        } else {
          capListenerHandle = maybeHandle;
        }
      }
    } catch {
      // ignore if not inside Capacitor
    }

    return () => {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('backbutton', onDocumentBackButton, false);
      if (capListenerHandle && typeof capListenerHandle.remove === 'function') {
        void capListenerHandle.remove();
      }
    };
  }, [handleBackAction]);

  useEffect(() => {
    if (user) {
      void loadBootstrap(user.id);
      void refreshOutboxCount(user.id);
    }
  }, [user, loadBootstrap, refreshOutboxCount]);

  // Auto-flush outbox whenever connection returns
  useEffect(() => {
    if (isOnline && user && outboxCount > 0) {
      void flushOutbox();
    }
  }, [isOnline, user, outboxCount, flushOutbox]);

  const showLiveAlert = useCallback((notif: AppNotification) => {
    setLiveAlert(notif);
    if (liveAlertTimerRef.current) {
      clearTimeout(liveAlertTimerRef.current);
    }
    liveAlertTimerRef.current = setTimeout(() => {
      setLiveAlert((prev) => (prev?.id === notif.id ? null : prev));
      liveAlertTimerRef.current = null;
    }, 5500);
  }, []);

  const handleIncomingNotification = useCallback(
    (notif: AppNotification, triggerAlerts = true) => {
      const alreadySeen = seenNotificationIdsRef.current.has(notif.id);
      seenNotificationIdsRef.current.add(notif.id);

      setNotifications((prev) => {
        if (prev.some((p) => p.id === notif.id)) {
          return prev.map((p) => (p.id === notif.id ? notif : p));
        }
        return [notif, ...prev].slice(0, 80);
      });

      if (!alreadySeen && !notif.is_read) {
        setUnreadNotificationsCount((c) => c + 1);
      }

      if (triggerAlerts && !alreadySeen) {
        showLiveAlert(notif);
        void triggerBrowserNotification(notif.title, notif.message, `sbm-notif-${notif.id}`);
      }
    },
    [showLiveAlert]
  );

  const fetchNotifications = useCallback(
    async (announceRecentUnread = false) => {
      if (!userRef.current) return;
      try {
        const res = await apiRequest<{
          notifications: AppNotification[];
          unreadCount: number;
        }>('/api/notifications');
        const list = Array.isArray(res.notifications) ? res.notifications : [];
        const nowMs = Date.now();
        let newestToAnnounce: AppNotification | null = null;

        for (const item of list) {
          const isNewToClient = !seenNotificationIdsRef.current.has(item.id);
          seenNotificationIdsRef.current.add(item.id);
          if (announceRecentUnread && isNewToClient && !item.is_read && !newestToAnnounce) {
            const normalizedTs = item.created_at.includes('T')
              ? item.created_at
              : `${item.created_at.replace(' ', 'T')}Z`;
            const createdMs = new Date(normalizedTs).getTime();
            if (!Number.isNaN(createdMs) && nowMs - createdMs <= 25000) {
              newestToAnnounce = item;
            }
          }
        }

        setNotifications(list);
        setUnreadNotificationsCount(Number(res.unreadCount || 0));

        if (newestToAnnounce) {
          showLiveAlert(newestToAnnounce);
          void triggerBrowserNotification(
            newestToAnnounce.title,
            newestToAnnounce.message,
            `sbm-notif-${newestToAnnounce.id}`
          );
        }
      } catch {
        // Non-fatal if offline
      }
    },
    [showLiveAlert]
  );

  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      setUnreadNotificationsCount(0);
      setNotificationsOpen(false);
      setLiveAlert(null);
      seenNotificationIdsRef.current.clear();
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let activeController: AbortController | null = null;

    void fetchNotifications(true);

    const connectStream = async () => {
      if (cancelled || !navigator.onLine) return;
      activeController = new AbortController();
      const token = getStoredToken();
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      try {
        const resp = await fetch('/api/notifications/stream', {
          method: 'GET',
          headers,
          credentials: 'include',
          signal: activeController.signal,
        });
        if (!resp.ok || !resp.body) {
          throw new Error(`Stream unavailable (${resp.status})`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';
          for (const frame of frames) {
            const dataLines = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim());
            if (dataLines.length === 0) continue;
            try {
              const parsed = JSON.parse(dataLines.join('\n')) as AppNotification;
              if (parsed && typeof parsed.id === 'number') {
                handleIncomingNotification(parsed, true);
              }
            } catch {
              // ignore malformed SSE chunk
            }
          }
        }
      } catch {
        // Reconnect cleanly after brief backoff
      } finally {
        if (!cancelled) {
          reconnectTimer = setTimeout(() => {
            void connectStream();
          }, 4000);
        }
      }
    };

    void connectStream();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (activeController) activeController.abort();
    };
  }, [user?.id, fetchNotifications, handleIncomingNotification]);

  const handleMarkNotificationRead = useCallback(async (id: number) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    setUnreadNotificationsCount((c) => Math.max(0, c - 1));
    if (id > 0 && navigator.onLine) {
      try {
        const res = await apiRequest<{ ok: boolean; unreadCount: number }>(
          `/api/notifications/${id}/read`,
          { method: 'POST' }
        );
        setUnreadNotificationsCount(Number(res.unreadCount || 0));
      } catch {
        // ignore offline read errors
      }
    }
  }, []);

  const handleMarkAllNotificationsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadNotificationsCount(0);
    if (navigator.onLine) {
      try {
        await apiRequest('/api/notifications/read-all', { method: 'POST' });
      } catch {
        // ignore
      }
    }
  }, []);

  const handleClearNotifications = useCallback(async () => {
    setNotifications([]);
    setUnreadNotificationsCount(0);
    if (navigator.onLine) {
      try {
        await apiRequest('/api/notifications', { method: 'DELETE' });
      } catch {
        // ignore
      }
    }
  }, []);

  const handleEnableBrowserAlerts = useCallback(async () => {
    const result = await requestBrowserNotificationPermission();
    setBrowserPermission(result);
    if (result === 'granted') {
      notify('Desktop & browser push alerts enabled for logins and new orders.');
      void triggerBrowserNotification(
        'Alerts Enabled — STANLEY BUSINESS MANAGER',
        'You will be notified whenever someone logs in or a new order is registered.',
        'sbm-alerts-enabled'
      );
    } else if (result === 'denied') {
      notify('Browser notifications are blocked. Allow them in your browser site settings.', 'error');
    }
  }, [notify]);

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
    setNotifications([]);
    setUnreadNotificationsCount(0);
    setNotificationsOpen(false);
    setLiveAlert(null);
    seenNotificationIdsRef.current.clear();
    authModeRef.current = 'billing';
    setAuthBillingError('');
    resetNavigationRoot('dashboard');
    setOutboxCount(0);
    setLoginBrand(PUBLIC_LOGIN_BRAND);
  }, [resetNavigationRoot]);

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

  // Global keyboard shortcuts (Alt+ArrowLeft / BrowserBack, Alt+N/E/O/C/D/R/P)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'BrowserBack' || (e.altKey && e.key === 'ArrowLeft')) {
        e.preventDefault();
        handleBackAction(false);
        return;
      }
      if (!userRef.current) return;
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === 'n') {
        e.preventDefault();
        navigateTo('sales');
        setSaleModalOpen(true);
      } else if (key === 'e') {
        e.preventDefault();
        navigateTo('expenses');
        setExpenseModalOpen(true);
      } else if (key === 'o') {
        e.preventDefault();
        navigateTo('orders');
        setOrderModalOpen(true);
      } else if (key === 'c') {
        e.preventDefault();
        navigateTo('customers');
        setCustomerModalOpen(true);
      } else if (key === 'd') {
        e.preventDefault();
        navigateTo('dashboard');
      } else if (key === 'r') {
        e.preventDefault();
        navigateTo('receipts');
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
  }, [handleBackAction, navigateTo]);

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

    if (user) {
      await enqueueOutbox(user.id, 'create_sale', { ...enrichedPayload, receipt_number: receiptNumber }, tempId);
      await refreshOutboxCount(user.id);
    }

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

    if (user) {
      await enqueueOutbox(user.id, 'record_payment', { amount, payment_method, note }, saleId);
      await refreshOutboxCount(user.id);
    }

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
    if (user && saleId > 0) {
      await enqueueOutbox(user.id, 'delete_sale', {}, saleId);
      await refreshOutboxCount(user.id);
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
      if (user) {
        await enqueueOutbox(user.id, 'update_expense', payload, id);
        await refreshOutboxCount(user.id);
      }
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
      if (user) {
        await enqueueOutbox(user.id, 'create_expense', enriched, tempId);
        await refreshOutboxCount(user.id);
      }
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
    if (user && id > 0) {
      await enqueueOutbox(user.id, 'delete_expense', {}, id);
      await refreshOutboxCount(user.id);
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
      if (user) {
        await enqueueOutbox(user.id, 'update_product', payload, id);
        await refreshOutboxCount(user.id);
      }
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
      if (user) {
        await enqueueOutbox(user.id, 'create_product', enriched, tempId);
        await refreshOutboxCount(user.id);
      }
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
    if (user && id > 0) {
      await enqueueOutbox(user.id, 'delete_product', {}, id);
      await refreshOutboxCount(user.id);
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
      if (user) {
        await enqueueOutbox(user.id, 'update_customer', payload, id);
        await refreshOutboxCount(user.id);
      }
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
      if (user) {
        await enqueueOutbox(user.id, 'create_customer', enriched, tempId);
        await refreshOutboxCount(user.id);
      }
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
    if (user && id > 0) {
      await enqueueOutbox(user.id, 'delete_customer', {}, id);
      await refreshOutboxCount(user.id);
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
      if (user) {
        await enqueueOutbox(user.id, 'update_order', payload, id);
        await refreshOutboxCount(user.id);
      }
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
          void fetchNotifications(true);
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
      if (user) {
        await enqueueOutbox(user.id, 'create_order', { ...enriched, order_number: orderNum }, tempId);
        await refreshOutboxCount(user.id);
      }
      updateDataAndCache((prev) => ({
        ...prev,
        orders: [offlineOrder, ...prev.orders],
      }));
      handleIncomingNotification(
        {
          id: tempId,
          target_user_id: user?.id || 0,
          type: 'order',
          title: 'New Order Registered',
          message: `${orderNum} — ${offlineOrder.title} for ${offlineOrder.customer_name} (${data?.settings.currency || 'UGX'} ${offlineOrder.total_amount.toLocaleString('en-US')})`,
          actor_user_id: user?.id || null,
          actor_name: user?.full_name || offlineOrder.customer_name,
          related_entity_type: 'order',
          related_entity_id: String(tempId),
          is_read: false,
          created_at: nowIso,
        },
        true
      );
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
    if (user && id > 0) {
      await enqueueOutbox(user.id, 'delete_order', {}, id);
      await refreshOutboxCount(user.id);
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
    if (user) {
      await enqueueOutbox(user.id, 'update_settings', payload);
      await refreshOutboxCount(user.id);
    }
    updateDataAndCache((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...payload },
    }));
  };

  const handleQuickAction = (action: 'sale' | 'expense' | 'customer' | 'order') => {
    if (action === 'sale') {
      navigateTo('sales');
      setSaleModalOpen(true);
    } else if (action === 'expense') {
      navigateTo('expenses');
      setExpenseModalOpen(true);
    } else if (action === 'customer') {
      navigateTo('customers');
      setCustomerModalOpen(true);
    } else if (action === 'order') {
      navigateTo('orders');
      setOrderModalOpen(true);
    }
  };

  const exitWarningBanner = exitWarning ? (
    <div
      role="alert"
      aria-live="assertive"
      className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] max-w-[92vw] px-4 py-3 rounded-xl bg-[#0B1D3A] text-white border-2 border-[#C89B3C] shadow-2xl flex items-center gap-3"
    >
      <AlertTriangle className="w-5 h-5 text-[#C89B3C] shrink-0" />
      <p className="text-xs sm:text-sm font-semibold leading-snug">{exitWarning}</p>
    </div>
  ) : null;

  if (appExited) {
    return (
      <div className="min-h-screen bg-[#0B1D3A] flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 shadow-2xl p-6 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-xl overflow-hidden border border-amber-400/30 bg-[#0B1D3A]">
            <img
              src={loginBrand.logo_url}
              alt="STANLEY BUSINESS MANAGER"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-slate-900">Application Closed Safely</h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              You exited <strong>STANLEY BUSINESS MANAGER</strong>. You may close this window or
              re-open your workspace below.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              resetNavigationRoot(
                user?.role === 'Administrator' ? 'admin' : 'dashboard'
              )
            }
            className="w-full h-10 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-semibold cursor-pointer"
          >
            Re-open Application
          </button>
        </div>
      </div>
    );
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0B1D3A] flex items-center justify-center text-white text-sm">
        Loading STANLEY BUSINESS MANAGER...
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <AuthLogin
          brand={loginBrand}
          onModeChange={handleAuthModeChange}
          forceSignInTick={forceSignInTick}
          forceBillingTick={forceBillingTick}
          initialBillingError={authBillingError}
          onRequestBack={() => handleBackAction(false)}
          onSuccess={(loggedInUser) => {
            setAuthBillingError('');
            setUser(loggedInUser);
            setCachedUser(loggedInUser);
            authModeRef.current = 'billing';
            resetNavigationRoot(
              loggedInUser.role === 'Administrator' ? 'admin' : 'dashboard'
            );
          }}
        />
        {exitWarningBanner}
      </>
    );
  }

  const isAdministrator = user.role === 'Administrator';
  const visibleNavItems = isAdministrator
    ? [{ id: 'admin' as NavSection, label: 'Admin Monitor', icon: ShieldAlert }, ...NAV_ITEMS]
    : NAV_ITEMS;
  const effectiveActiveNav: NavSection =
    activeNav === 'admin' && !isAdministrator ? 'dashboard' : activeNav;
  const activeNavMeta = visibleNavItems.find((n) => n.id === effectiveActiveNav) || visibleNavItems[0];

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
            <p className="text-[10px] font-bold tracking-wider text-[#C89B3C] truncate uppercase">
              STANLEY BUSINESS MANAGER
            </p>
            <p className="text-sm font-bold text-white truncate">
              {data?.settings.business_name || 'My Business'}
            </p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = effectiveActiveNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
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
          <PWAInstallButton variant="sidebar" />
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
                  <p className="text-[10px] font-bold text-[#C89B3C] uppercase truncate">
                    STANLEY BUSINESS MANAGER
                  </p>
                  <p className="text-sm font-bold truncate">
                    {data?.settings.business_name || 'My Business'}
                  </p>
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
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = effectiveActiveNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      navigateTo(item.id);
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
              <PWAInstallButton variant="sidebar" />
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
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden h-10 w-10 rounded-lg border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => handleBackAction(false)}
              title={
                navStackDepth > 1 ||
                notificationsOpen ||
                mobileMenuOpen ||
                Boolean(activeReceipt) ||
                aboutOpen ||
                saleModalOpen ||
                expenseModalOpen ||
                customerModalOpen ||
                orderModalOpen
                  ? 'Go back to previous screen'
                  : 'Double-click Back to exit application'
              }
              className={`h-9 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                exitWarning
                  ? 'bg-amber-50 border-amber-400 text-amber-900'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
              <span>Back</span>
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
                onClick={() => navigateTo('settings')}
                title={`Cloud Sync connected: ${cloudUser.email}`}
                className="hidden sm:inline-flex h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Cloud className="w-3.5 h-3.5 text-emerald-600" />
                Cloud Ready
              </button>
            )}
            <NotificationCenter
              notifications={notifications}
              unreadCount={unreadNotificationsCount}
              isOpen={notificationsOpen}
              onToggle={() => setNotificationsOpen((prev) => !prev)}
              onClose={() => setNotificationsOpen(false)}
              onMarkRead={(id) => void handleMarkNotificationRead(id)}
              onMarkAllRead={() => void handleMarkAllNotificationsRead()}
              onClearAll={() => void handleClearNotifications()}
              onNotificationClick={(n) => {
                setNotificationsOpen(false);
                if (n.type === 'order') {
                  navigateTo('orders');
                } else if (n.type === 'billing') {
                  navigateTo(isAdministrator ? 'admin' : 'settings');
                } else if (n.type === 'login' && isAdministrator) {
                  navigateTo('admin');
                }
              }}
              browserPermission={browserPermission}
              onEnableBrowserAlerts={() => void handleEnableBrowserAlerts()}
            />
            <PWAInstallButton variant="header" autoOpenOnInstallParam />
            <button
              type="button"
              onClick={() => {
                navigateTo('sales');
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
          {effectiveActiveNav === 'admin' && isAdministrator ? (
            <AdminMonitorView currentUser={user} onNotify={notify} />
          ) : loadingData && !data ? (
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
              {isAdministrator && user.is_default_password && effectiveActiveNav !== 'settings' && (
                <div className="no-print mb-5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 text-xs text-amber-950">
                    <KeyRound className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      <strong>Admin Security Notice:</strong> You are signed in with the initial
                      administrator password. Update it in Settings &amp; Security to keep your
                      admin workspace private.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateTo('settings')}
                    className="h-8 px-3 rounded-lg bg-[#0B1D3A] text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
                  >
                    Update Password
                  </button>
                </div>
              )}

              {effectiveActiveNav === 'dashboard' && (
                <DashboardView
                  settings={data.settings}
                  sales={data.sales}
                  expenses={data.expenses}
                  orders={data.orders}
                  customers={data.customers}
                  onQuickAction={handleQuickAction}
                  onNavigate={navigateTo}
                  onViewReceipt={(sale) => setActiveReceipt(sale)}
                />
              )}

              {effectiveActiveNav === 'sales' && (
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

              {effectiveActiveNav === 'expenses' && (
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

              {effectiveActiveNav === 'receipts' && (
                <ReceiptsView
                  settings={data.settings}
                  sales={data.sales}
                  onCreateSaleClick={() => {
                    navigateTo('sales');
                    setSaleModalOpen(true);
                  }}
                />
              )}

              {effectiveActiveNav === 'orders' && (
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

              {effectiveActiveNav === 'products' && (
                <ProductsView
                  settings={data.settings}
                  products={data.products}
                  onSaveProduct={handleSaveProduct}
                  onDeleteProduct={handleDeleteProduct}
                />
              )}

              {effectiveActiveNav === 'customers' && (
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

              {effectiveActiveNav === 'analytics' && (
                <AnalyticsView
                  settings={data.settings}
                  sales={data.sales}
                  expenses={data.expenses}
                  customers={data.customers}
                />
              )}

              {effectiveActiveNav === 'reports' && (
                <ReportsView
                  settings={data.settings}
                  sales={data.sales}
                  expenses={data.expenses}
                  customers={data.customers}
                />
              )}

              {effectiveActiveNav === 'settings' && (
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

      {/* First-Time Business Profile Setup Modal (e.g. new Google Sign-In workspaces) */}
      {data && !data.settings.profile_completed && (
        <BusinessProfileSetupModal
          user={user}
          settings={data.settings}
          onSaveSettings={handleSaveSettings}
          onSignOut={() => void handleLogout()}
          onNotify={notify}
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

      {/* Live Login / New Order Alert Pop-up */}
      {liveAlert && (
        <div
          role="status"
          aria-live="polite"
          className="no-print fixed top-20 right-4 sm:right-6 z-50 w-[calc(100vw-32px)] sm:w-96 bg-[#0B1D3A] text-white rounded-xl border border-[#C89B3C] shadow-2xl p-3.5 flex items-start gap-3"
        >
          <div className="w-8 h-8 rounded-lg bg-[#C89B3C]/20 text-[#C89B3C] flex items-center justify-center shrink-0 mt-0.5">
            {liveAlert.type === 'order' ? (
              <ClipboardList className="w-4 h-4" />
            ) : liveAlert.type === 'billing' ? (
              <CreditCard className="w-4 h-4" />
            ) : (
              <ShieldAlert className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-xs font-bold text-[#C89B3C]">{liveAlert.title}</p>
            <p className="text-xs text-slate-100 leading-snug break-words">{liveAlert.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setLiveAlert(null)}
            aria-label="Dismiss notification"
            className="p-1 rounded-md text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
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

      {exitWarningBanner}
    </div>
  );
}
