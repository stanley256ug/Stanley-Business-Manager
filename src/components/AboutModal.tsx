import React from 'react';
import { Cloud, Database, Info, Keyboard, Monitor, ShieldCheck, Smartphone, X } from 'lucide-react';
import { BusinessSettings } from '../types';

interface AboutModalProps {
  open: boolean;
  settings: BusinessSettings;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: 'Alt + N', desc: 'Record New Sale & Receipt' },
  { keys: 'Alt + E', desc: 'Record Business Expense' },
  { keys: 'Alt + O', desc: 'Create Production Order' },
  { keys: 'Alt + C', desc: 'Add New Customer' },
  { keys: 'Alt + D', desc: 'Go to Dashboard' },
  { keys: 'Alt + R', desc: 'Go to Receipts' },
  { keys: 'Alt + P', desc: 'Print Active Receipt / Screen' },
];

export const AboutModal: React.FC<AboutModalProps> = ({ open, settings, onClose }) => {
  if (!open) return null;

  const isElectron = Boolean(window.electronAPI?.isElectron);
  const platformLabel = isElectron
    ? `Windows Desktop (${window.electronAPI?.platform || 'win32'})`
    : /android/i.test(navigator.userAgent)
    ? 'Android App / Mobile PWA'
    : 'Standalone Web / Desktop PWA';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden my-auto">
        <div className="bg-[#0B1D3A] px-6 py-5 border-b-4 border-[#C89B3C] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-xl overflow-hidden border border-amber-400/30 bg-[#0B1D3A] shrink-0">
              <img
                src={settings.logo_url || '/src/assets/images/stanley_brand_logo_1795171819618.jpg'}
                alt="Stanley Logo"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white truncate">STANLEY BUSINESS MANAGER</h3>
              <p className="text-xs text-amber-300 font-medium">
                Version 1.0.0 · {settings.business_name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close about dialog"
            className="p-1.5 rounded-lg text-slate-300 hover:bg-white/10 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                {isElectron ? <Monitor className="w-3.5 h-3.5 text-[#0B1D3A]" /> : <Smartphone className="w-3.5 h-3.5 text-[#0B1D3A]" />}
                Active Runtime
              </p>
              <p className="text-xs font-semibold text-slate-900 mt-1">{platformLabel}</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-[#0B1D3A]" />
                Business Studio
              </p>
              <p className="text-xs font-semibold text-slate-900 mt-1 truncate">{settings.email}</p>
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex items-start gap-2.5">
              <Database className="w-4 h-4 text-[#0B1D3A] shrink-0 mt-0.5" />
              <p>
                <strong className="text-slate-900">Offline-First Local Engine:</strong> Persistent SQLite
                storage + browser IndexedDB outbox queue lets you record sales, expenses, customers, orders,
                and print PDF receipts with zero internet connection.
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <Cloud className="w-4 h-4 text-[#0B1D3A] shrink-0 mt-0.5" />
              <p>
                <strong className="text-slate-900">Cloud Synchronization:</strong> Sign in with Google in
                Settings &amp; Security to sync your workspace across Windows and Android with duplicate-safe
                IDs.
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p>
                <strong className="text-slate-900">Session Protection:</strong> Configurable inactivity
                auto-lock timer and password-protected administrator access.
              </p>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5 mb-2.5">
              <Keyboard className="w-4 h-4 text-[#C89B3C]" />
              Desktop Keyboard Shortcuts
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SHORTCUTS.map((s) => (
                <div
                  key={s.keys}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                >
                  <span className="text-slate-600 truncate">{s.desc}</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-300 font-mono text-[11px] font-semibold text-slate-800 shrink-0">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-semibold cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
