import React, { useRef, useState } from 'react';
import {
  Check,
  Cloud,
  CloudDownload,
  CloudUpload,
  Copy,
  DatabaseBackup,
  Download,
  FileSpreadsheet,
  HelpCircle,
  Info,
  KeyRound,
  LogOut,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Timer,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  BusinessSettings,
  Customer,
  Expense,
  Order,
  PaymentMethod,
  Product,
  ReceiptTemplate,
  Sale,
  UserProfile,
} from '../types';
import { apiRequest } from '../utils/api';
import { downloadFullWorkbookExcel } from '../utils/exports';
import { PWAInstallButton } from './PWAInstallButton';

const DEFAULT_LOGO = '/src/assets/images/stanley_brand_logo_1795171819618.jpg';

export interface CloudUserInfo {
  uid: string;
  email: string | null;
  displayName: string | null;
}

interface SettingsViewProps {
  settings: BusinessSettings;
  user: UserProfile;
  sales: Sale[];
  expenses: Expense[];
  customers: Customer[];
  orders: Order[];
  products: Product[];
  isOnline: boolean;
  outboxCount: number;
  cloudUser: CloudUserInfo | null;
  cloudSyncing: boolean;
  lastSyncedAt: string | null;
  onSaveSettings: (payload: Partial<BusinessSettings>) => Promise<void>;
  onUserUpdated: (user: UserProfile) => void;
  onReloadAll: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onCloudSignIn: () => Promise<void>;
  onCloudSignOut: () => Promise<void>;
  onPushCloud: () => Promise<void>;
  onPullCloud: () => Promise<void>;
  onFlushOutbox: () => Promise<void>;
  onOpenAbout: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  user,
  sales,
  expenses,
  customers,
  orders,
  products,
  isOnline,
  outboxCount,
  cloudUser,
  cloudSyncing,
  lastSyncedAt,
  onSaveSettings,
  onUserUpdated,
  onReloadAll,
  onNotify,
  onCloudSignIn,
  onCloudSignOut,
  onPushCloud,
  onPullCloud,
  onFlushOutbox,
  onOpenAbout,
}) => {
  // Business Settings Form
  const [businessName, setBusinessName] = useState(settings.business_name);
  const [tagline, setTagline] = useState(settings.tagline);
  const [logoUrl, setLogoUrl] = useState(settings.logo_url || DEFAULT_LOGO);
  const [phonePrimary, setPhonePrimary] = useState(settings.phone_primary);
  const [phoneSecondary, setPhoneSecondary] = useState(settings.phone_secondary);
  const [email, setEmail] = useState(settings.email);
  const [location, setLocation] = useState(settings.location);
  const [currency, setCurrency] = useState(settings.currency || 'UGX');
  const [defaultMethod, setDefaultMethod] = useState<PaymentMethod>(
    settings.default_payment_method || 'Mobile Money'
  );
  const [receiptTemplate, setReceiptTemplate] = useState<ReceiptTemplate>(
    settings.receipt_template || 'executive'
  );
  const [receiptPrefix, setReceiptPrefix] = useState(settings.receipt_prefix || 'SBM');
  const [thankYou, setThankYou] = useState(settings.receipt_thank_you);
  const [inactivityMinutes, setInactivityMinutes] = useState<number>(
    settings.inactivity_timeout_minutes ?? 15
  );
  const [savingSettings, setSavingSettings] = useState(false);

  // Admin Account & Password Form
  const [fullName, setFullName] = useState(user.full_name);
  const [username, setUsername] = useState(user.username);
  const [userEmail, setUserEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingSecurity, setSavingSecurity] = useState(false);

  // Account Recovery Setup
  const [secQuestion, setSecQuestion] = useState(
    user.security_question || 'What is the name of your first primary school?'
  );
  const [secAnswer, setSecAnswer] = useState('');
  const [savingRecovery, setSavingRecovery] = useState(false);
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Backup / Restore
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingBackupData, setPendingBackupData] = useState<any | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      onNotify('Logo image must be smaller than 2 MB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await onSaveSettings({
        business_name: businessName.trim(),
        tagline: tagline.trim(),
        logo_url: logoUrl,
        phone_primary: phonePrimary.trim(),
        phone_secondary: phoneSecondary.trim(),
        email: email.trim(),
        location: location.trim(),
        currency,
        default_payment_method: defaultMethod,
        receipt_template: receiptTemplate,
        receipt_prefix: receiptPrefix.trim().toUpperCase() || 'SBM',
        receipt_thank_you: thankYou.trim(),
        inactivity_timeout_minutes: inactivityMinutes,
      });
      onNotify('Business settings saved successfully.');
    } catch (err: any) {
      onNotify(err.message || 'Failed to save settings.', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleInactivityChange = async (minutes: number) => {
    setInactivityMinutes(minutes);
    try {
      await onSaveSettings({ inactivity_timeout_minutes: minutes });
      onNotify(
        minutes === 0
          ? 'Inactivity auto-lock disabled.'
          : `Auto-lock timer updated to ${minutes} minutes.`
      );
    } catch (err: any) {
      onNotify(err.message || 'Failed to save auto-lock timer.', 'error');
    }
  };

  const handleSecuritySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword && newPassword !== confirmPassword) {
      onNotify('New password and confirmation do not match.', 'error');
      return;
    }
    setSavingSecurity(true);
    try {
      const res = await apiRequest<{ user: UserProfile }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword: newPassword || undefined,
          fullName: fullName.trim(),
          username: username.trim(),
          email: userEmail.trim(),
        }),
      });
      onUserUpdated(res.user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onNotify('Administrator security profile updated.');
    } catch (err: any) {
      onNotify(err.message || 'Failed to update security profile.', 'error');
    } finally {
      setSavingSecurity(false);
    }
  };

  const handleDownloadBackup = async () => {
    try {
      let payload: any;
      if (isOnline) {
        try {
          payload = await apiRequest('/api/backup/export');
        } catch {
          payload = null;
        }
      }
      if (!payload) {
        payload = {
          app: 'STANLEY BUSINESS MANAGER',
          version: 1,
          exported_at: new Date().toISOString(),
          data: {
            business_settings: [settings],
            products,
            customers,
            orders,
            sales,
            sale_payments: [],
            expenses,
          },
        };
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stanley-business-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onNotify('Full database backup downloaded.');
    } catch (err: any) {
      onNotify(err.message || 'Backup export failed.', 'error');
    }
  };

  const handleSelectRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || parsed.app !== 'STANLEY BUSINESS MANAGER' || !parsed.data) {
          onNotify('Invalid backup file format.', 'error');
          return;
        }
        setPendingBackupData(parsed);
      } catch {
        onNotify('Could not parse backup JSON file.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmRestore = async () => {
    if (!pendingBackupData) return;
    try {
      await apiRequest('/api/backup/restore', {
        method: 'POST',
        body: JSON.stringify(pendingBackupData),
      });
      setPendingBackupData(null);
      await onReloadAll();
      onNotify('Database restored successfully from backup.');
    } catch (err: any) {
      onNotify(err.message || 'Restore failed.', 'error');
    }
  };

  const handleClearTransactions = async () => {
    try {
      await apiRequest('/api/backup/clear-transactions', { method: 'POST' });
      setConfirmClearOpen(false);
      await onReloadAll();
      onNotify('Sample sales, expenses, orders, and customers cleared.');
    } catch (err: any) {
      onNotify(err.message || 'Failed to clear records.', 'error');
    }
  };

  const handleCheckDesktopUpdate = async () => {
    if (window.electronAPI?.checkForUpdates) {
      const res = await window.electronAPI.checkForUpdates();
      onNotify(res.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Business Settings, Cloud Sync &amp; Security
          </h2>
          <p className="text-sm text-slate-500">
            Customize your studio profile, receipt design, cloud sync across Windows &amp; Android, auto-lock, and backups
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenAbout}
          className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Info className="w-3.5 h-3.5 text-[#0B1D3A]" />
          About &amp; Shortcuts (v1.0.0)
        </button>
      </div>

      {/* Cloud Synchronization & Offline Outbox */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Cloud className="w-5 h-5 text-[#0B1D3A]" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Cloud Synchronization &amp; Offline Queue
              </h3>
              <p className="text-xs text-slate-500">
                Keep your sales, receipts, expenses, customers, and orders synced between Windows PC and Android
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className={isOnline ? 'text-emerald-700' : 'text-amber-700'}>
              {isOnline ? 'Online' : 'Offline Mode'}
            </span>
            <span className="text-slate-300">|</span>
            <span className="font-mono tabular-nums text-slate-700">
              Pending Sync: {outboxCount}
            </span>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {cloudUser ? (
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Connected to Cloud Workspace
                </p>
                <p className="text-sm font-bold text-slate-900">
                  {cloudUser.displayName || 'Workspace Owner'} ·{' '}
                  <span className="font-mono font-normal text-slate-600">{cloudUser.email}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {lastSyncedAt
                    ? `Last synced: ${new Date(lastSyncedAt).toLocaleString()}`
                    : 'Ready to push or merge records across your devices.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {outboxCount > 0 && (
                  <button
                    type="button"
                    disabled={!isOnline || cloudSyncing}
                    onClick={onFlushOutbox}
                    className="h-9 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${cloudSyncing ? 'animate-spin' : ''}`} />
                    Sync Queued ({outboxCount})
                  </button>
                )}
                <button
                  type="button"
                  disabled={!isOnline || cloudSyncing}
                  onClick={onPushCloud}
                  className="h-9 px-3.5 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <CloudUpload className="w-3.5 h-3.5 text-[#C89B3C]" />
                  {cloudSyncing ? 'Syncing...' : 'Push to Cloud'}
                </button>
                <button
                  type="button"
                  disabled={!isOnline || cloudSyncing}
                  onClick={onPullCloud}
                  className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <CloudDownload className="w-3.5 h-3.5 text-[#0B1D3A]" />
                  Pull &amp; Merge
                </button>
                <button
                  type="button"
                  onClick={onCloudSignOut}
                  className="h-9 px-3 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900">
                  Enable Cloud Sync &amp; Automatic Cross-Device Backup
                </p>
                <p className="text-xs text-slate-600">
                  Sign in with Google to synchronize your local SQLite records securely to Cloud Firestore
                  and share live business data between your Windows computer and Android phone.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {outboxCount > 0 && isOnline && (
                  <button
                    type="button"
                    disabled={cloudSyncing}
                    onClick={onFlushOutbox}
                    className="h-10 px-3.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Flush Local Queue ({outboxCount})
                  </button>
                )}
                <button
                  type="button"
                  disabled={!isOnline}
                  onClick={onCloudSignIn}
                  className="h-10 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Cloud className="w-4 h-4 text-[#C89B3C]" />
                  Connect Google Account
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 1: Business Profile & Receipt Design */}
      <form
        onSubmit={handleSettingsSubmit}
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Company Profile &amp; Receipt Customization
            </h3>
            <p className="text-xs text-slate-500">
              These details appear on your electronic receipts, PDF reports, and dashboard
            </p>
          </div>
          <button
            type="submit"
            disabled={savingSettings}
            className="h-9 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5 text-[#C89B3C]" />
            {savingSettings ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Logo Upload */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-5 border-b border-slate-100">
            <div className="w-20 h-20 rounded-xl overflow-hidden border border-slate-200 bg-[#0B1D3A] shrink-0">
              <img
                src={logoUrl}
                alt="Business Logo"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">Business Logo</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  Upload Logo
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setLogoUrl(DEFAULT_LOGO)}
                  className="h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Use Stanley Default Logo
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                PNG or JPG up to 2 MB. Embedded automatically on PDF &amp; electronic receipts.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Business Name *
              </label>
              <input
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Business Tagline / Services
              </label>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Primary Telephone Number
              </label>
              <input
                type="text"
                value={phonePrimary}
                onChange={(e) => setPhonePrimary(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Secondary Telephone Number
              </label>
              <input
                type="text"
                value={phoneSecondary}
                onChange={(e) => setPhoneSecondary(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Business Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Business Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Default Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white font-mono"
              >
                <option value="UGX">UGX (Uganda Shilling)</option>
                <option value="USD">USD (US Dollar)</option>
                <option value="KES">KES (Kenya Shilling)</option>
                <option value="TZS">TZS (Tanzania Shilling)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Default Payment Method
              </label>
              <select
                value={defaultMethod}
                onChange={(e) => setDefaultMethod(e.target.value as PaymentMethod)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="Mobile Money">Mobile Money</option>
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Receipt Design Style
              </label>
              <select
                value={receiptTemplate}
                onChange={(e) => setReceiptTemplate(e.target.value as ReceiptTemplate)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="executive">Executive Navy &amp; Gold</option>
                <option value="classic">Classic Clean Ledger</option>
                <option value="compact">Compact Thermal Style</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Receipt Prefix
              </label>
              <input
                type="text"
                maxLength={8}
                value={receiptPrefix}
                onChange={(e) => setReceiptPrefix(e.target.value.toUpperCase())}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono uppercase"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Receipt Thank-You Message
            </label>
            <textarea
              rows={2}
              value={thankYou}
              onChange={(e) => setThankYou(e.target.value)}
              className="w-full p-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>
        </div>
      </form>

      {/* Section 2: Security & Database Backup */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Admin Account, Password & Auto-Lock */}
        <form
          onSubmit={handleSecuritySubmit}
          className="bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#0B1D3A]" />
            <h3 className="text-base font-bold text-slate-900">
              Administrator Security &amp; Auto-Lock
            </h3>
          </div>
          <div className="p-6 space-y-4">
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Timer className="w-4 h-4 text-[#0B1D3A] mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-slate-900">Inactivity Auto-Lock Timer</p>
                  <p className="text-[11px] text-slate-500">
                    Automatically locks the workspace when unattended
                  </p>
                </div>
              </div>
              <select
                value={inactivityMinutes}
                onChange={(e) => handleInactivityChange(Number(e.target.value))}
                className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 shrink-0"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={0}>Disabled</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Admin Username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Admin Email
              </label>
              <input
                type="email"
                required
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>

            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {user.auth_provider === 'google'
                    ? 'Current Local Password (optional for Google-linked accounts)'
                    : 'Current Password * (required to save changes)'}
                </label>
                <input
                  type="password"
                  required={user.auth_provider !== 'google'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    New Password (optional)
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingSecurity}
              className="h-10 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <KeyRound className="w-4 h-4 text-[#C89B3C]" />
              {savingSecurity ? 'Updating...' : 'Update Security Credentials'}
            </button>

            {/* Account Recovery Question & Personal Recovery Key */}
            <div className="pt-4 mt-2 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-[#0B1D3A]" />
                  Forgot-Password Recovery Setup
                </p>
                <span className="text-[11px] text-slate-500">
                  {user.has_recovery_key ? 'Recovery Key Active' : 'No Recovery Key Yet'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={secQuestion}
                  onChange={(e) => setSecQuestion(e.target.value)}
                  placeholder="Security question"
                  className="h-9 px-3 rounded-lg border border-slate-300 text-xs"
                />
                <input
                  type="text"
                  value={secAnswer}
                  onChange={(e) => setSecAnswer(e.target.value)}
                  placeholder="Enter new security answer"
                  className="h-9 px-3 rounded-lg border border-slate-300 text-xs"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={savingRecovery}
                  onClick={async () => {
                    if (!secQuestion.trim() || secAnswer.trim().length < 2) {
                      onNotify('Enter a security question and answer (at least 2 characters).', 'error');
                      return;
                    }
                    setSavingRecovery(true);
                    try {
                      const res = await apiRequest<{ user: UserProfile }>('/api/auth/recovery-settings', {
                        method: 'POST',
                        body: JSON.stringify({
                          securityQuestion: secQuestion.trim(),
                          securityAnswer: secAnswer.trim(),
                        }),
                      });
                      onUserUpdated(res.user);
                      setSecAnswer('');
                      onNotify('Security recovery question saved.');
                    } catch (err: any) {
                      onNotify(err.message || 'Failed to save security question.', 'error');
                    } finally {
                      setSavingRecovery(false);
                    }
                  }}
                  className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Save Security Question
                </button>
                <button
                  type="button"
                  disabled={savingRecovery}
                  onClick={async () => {
                    setSavingRecovery(true);
                    try {
                      const res = await apiRequest<{ user: UserProfile; recoveryKey?: string }>(
                        '/api/auth/recovery-settings',
                        {
                          method: 'POST',
                          body: JSON.stringify({ regenerateKey: true }),
                        }
                      );
                      onUserUpdated(res.user);
                      if (res.recoveryKey) {
                        setGeneratedRecoveryKey(res.recoveryKey);
                      }
                      onNotify('New personal recovery key generated.');
                    } catch (err: any) {
                      onNotify(err.message || 'Failed to generate recovery key.', 'error');
                    } finally {
                      setSavingRecovery(false);
                    }
                  }}
                  className="h-9 px-3 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0B1D3A] cursor-pointer"
                >
                  {user.has_recovery_key ? 'Regenerate Recovery Key' : 'Generate Recovery Key'}
                </button>
              </div>
              {generatedRecoveryKey && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold text-amber-900">
                      Save this Personal Recovery Key:
                    </p>
                    <p className="text-sm font-bold font-mono text-[#0B1D3A] select-all">
                      {generatedRecoveryKey}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(generatedRecoveryKey);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                    className="h-8 px-2.5 rounded-md bg-white border border-amber-300 text-xs font-semibold text-slate-800 inline-flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </form>

        {/* Data Backup & Restoration */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <DatabaseBackup className="w-4 h-4 text-[#0B1D3A]" />
            <h3 className="text-base font-bold text-slate-900">
              Database Backup, Restoration &amp; Export
            </h3>
          </div>
          <div className="p-6 space-y-5 flex-1">
            <p className="text-xs text-slate-600 leading-relaxed">
              Every sale, receipt, expense, customer, product, and order is saved automatically to
              your persistent SQLite database and offline browser storage. Create regular backup
              files or export all business records to Excel.
            </p>

            <div className="space-y-3">
              <PWAInstallButton variant="card" showWhenInstalled allowPackagingKit />

              {window.electronAPI?.checkForUpdates && (
                <button
                  type="button"
                  onClick={handleCheckDesktopUpdate}
                  className="w-full h-11 px-4 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-sm font-semibold flex items-center justify-between cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-[#0B1D3A]" />
                    Check for Windows Desktop Updates
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    v{window.electronAPI.appVersion || '1.0.0'}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={handleDownloadBackup}
                className="w-full h-11 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold flex items-center justify-between cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  <Download className="w-4 h-4 text-[#C89B3C]" />
                  Download Complete Database Backup (.json)
                </span>
                <span className="text-xs text-slate-300 font-mono">Full Snapshot</span>
              </button>

              <button
                type="button"
                onClick={() => restoreInputRef.current?.click()}
                className="w-full h-11 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold flex items-center justify-between cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  <Upload className="w-4 h-4 text-[#0B1D3A]" />
                  Restore Database from Backup File
                </span>
                <span className="text-xs text-slate-500">JSON File</span>
              </button>
              <input
                ref={restoreInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleSelectRestoreFile}
                className="hidden"
              />

              <button
                type="button"
                onClick={() =>
                  downloadFullWorkbookExcel({
                    settings,
                    sales,
                    expenses,
                    customers,
                    orders,
                    products,
                  })
                }
                className="w-full h-11 px-4 rounded-lg border border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold flex items-center justify-between cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  Export All Business Records (.xlsx)
                </span>
                <span className="text-xs text-emerald-100">5 Worksheets</span>
              </button>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(true)}
                className="text-xs font-semibold text-red-600 hover:text-red-700 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear all transactions &amp; reset receipt counter (keep catalog &amp; settings)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm Restore Modal */}
      {pendingBackupData && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Restore Database Backup?</h3>
            <p className="text-sm text-slate-600">
              This will replace current sales, expenses, orders, customers, and products with the
              snapshot exported on{' '}
              <strong className="text-slate-900">
                {pendingBackupData.exported_at
                  ? new Date(pendingBackupData.exported_at).toLocaleString()
                  : 'selected file'}
              </strong>
              .
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingBackupData(null)}
                className="h-9 px-4 rounded-lg border border-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                className="h-9 px-4 rounded-lg bg-[#0B1D3A] text-white text-xs font-semibold cursor-pointer"
              >
                Confirm Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Clear Modal */}
      {confirmClearOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Clear All Transaction Records?</h3>
            <p className="text-sm text-slate-600">
              This removes all sales, receipts, expenses, orders, and customers so you can start
              with a clean ledger. Your business settings and product catalog will stay intact.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="h-9 px-4 rounded-lg border border-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearTransactions}
                className="h-9 px-4 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer"
              >
                Clear Transactions
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
