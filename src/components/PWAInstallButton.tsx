import React, { useEffect, useState } from 'react';
import {
  Download,
  Monitor,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar' | 'login' | 'card';
  autoOpenOnInstallParam?: boolean;
  showWhenInstalled?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'header',
  autoOpenOnInstallParam = false,
  showWhenInstalled = false,
}) => {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    hasInstallParam,
    clearInstallParam,
    install,
  } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (autoOpenOnInstallParam && hasInstallParam && !isInstalled) {
      setShowGuide(true);
      clearInstallParam();
    }
  }, [autoOpenOnInstallParam, hasInstallParam, isInstalled, clearInstallParam]);

  if (isInstalled && !showWhenInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (!isInstalled && isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    setShowGuide(true);
  };

  const buttonNode = (() => {
    if (variant === 'sidebar') {
      return (
        <button
          type="button"
          onClick={handleClick}
          className="w-full h-9 px-3 rounded-lg bg-[#C89B3C] hover:bg-[#b88d32] text-[#0B1D3A] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Install App
        </button>
      );
    }

    if (variant === 'login') {
      return (
        <button
          type="button"
          onClick={handleClick}
          className="w-full h-10 px-4 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <Download className="w-4 h-4 text-[#0B1D3A]" />
          Install App on Phone or PC
        </button>
      );
    }

    if (variant === 'card') {
      return (
        <button
          type="button"
          onClick={handleClick}
          className="w-full h-11 px-4 rounded-lg bg-[#C89B3C] hover:bg-[#b88d32] text-[#0B1D3A] text-sm font-bold flex items-center justify-between cursor-pointer transition-colors"
        >
          <span className="inline-flex items-center gap-2">
            <Download className="w-4 h-4" />
            {isInstalled ? 'Standalone App Installed' : 'Install Standalone App'}
          </span>
          <span className="text-xs font-semibold">Phone &amp; PC</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={handleClick}
        className="h-9 px-3 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-[#0B1D3A] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
      >
        <Download className="w-3.5 h-3.5 text-[#0B1D3A]" />
        Install App
      </button>
    );
  })();

  return (
    <>
      {buttonNode}

      {showGuide && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden text-slate-900 my-auto">
            <div className="bg-[#0B1D3A] px-5 py-4 text-white flex items-center justify-between border-b-2 border-[#C89B3C]">
              <div>
                <h3 className="text-base font-bold">Install Standalone App</h3>
                <p className="text-xs text-amber-300">
                  Run STANLEY BUSINESS MANAGER as a standalone app on Android &amp; Windows
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install guide"
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-sm">
              {!isInstalled && isInstallable && (
                <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-emerald-950">Ready for One-Tap Install</p>
                    <p className="text-xs text-emerald-800">
                      Install directly onto this device with offline support and desktop/home-screen icon.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void install()}
                    className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Install Now
                  </button>
                </div>
              )}

              {isIOS ? (
                <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <p className="font-bold text-slate-900 inline-flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-[#0B1D3A]" />
                    Install on iPhone or iPad (Safari)
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700">
                    <li>
                      Open this app in <strong>Safari</strong> and tap <strong>Share</strong>.
                    </li>
                    <li>
                      Scroll down and tap <strong>Add to Home Screen</strong>.
                    </li>
                    <li>
                      Tap <strong>Add</strong> in the top-right corner to install.
                    </li>
                  </ol>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                    <p className="text-xs font-bold text-slate-900 inline-flex items-center gap-1.5">
                      <Smartphone className="w-4 h-4 text-[#0B1D3A]" />
                      Android (Chrome)
                    </p>
                    <p className="text-xs text-slate-600">
                      Open in Chrome, tap <strong>Install Now</strong> or the browser menu (⋮)
                      &rarr; <strong>Install app</strong>.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                    <p className="text-xs font-bold text-slate-900 inline-flex items-center gap-1.5">
                      <Monitor className="w-4 h-4 text-[#0B1D3A]" />
                      Windows 10/11 (Edge / Chrome)
                    </p>
                    <p className="text-xs text-slate-600">
                      Open in Edge or Chrome and click the <strong>Install</strong> icon in the
                      address bar to pin to Desktop &amp; Taskbar.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="h-9 px-4 rounded-lg bg-[#0B1D3A] text-white text-xs font-semibold cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
