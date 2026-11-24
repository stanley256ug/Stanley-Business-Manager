import React, { useState } from 'react';
import { Building2, LogOut, Save, Upload } from 'lucide-react';
import { BusinessSettings, UserProfile } from '../types';

interface BusinessProfileSetupModalProps {
  user: UserProfile;
  settings: BusinessSettings;
  onSaveSettings: (payload: Partial<BusinessSettings>) => Promise<void>;
  onSignOut: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

function suggestPrefix(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 4)
      .map((w) => w[0].toUpperCase())
      .join('');
  }
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase() || 'BIZ';
  }
  return 'BIZ';
}

export const BusinessProfileSetupModal: React.FC<BusinessProfileSetupModalProps> = ({
  user,
  settings,
  onSaveSettings,
  onSignOut,
  onNotify,
}) => {
  const [businessName, setBusinessName] = useState(
    settings.business_name && settings.business_name !== 'My Business'
      ? settings.business_name
      : ''
  );
  const [tagline, setTagline] = useState(settings.tagline || '');
  const [phonePrimary, setPhonePrimary] = useState(settings.phone_primary || '');
  const [email, setEmail] = useState(settings.email || user.email || '');
  const [location, setLocation] = useState(settings.location || '');
  const [currency, setCurrency] = useState(settings.currency || 'UGX');
  const [receiptPrefix, setReceiptPrefix] = useState(settings.receipt_prefix || 'BIZ');
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [logoUrl, setLogoUrl] = useState(settings.logo_url);
  const [saving, setSaving] = useState(false);

  const handleNameChange = (value: string) => {
    setBusinessName(value);
    if (!prefixTouched) {
      setReceiptPrefix(suggestPrefix(value));
    }
  };

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (businessName.trim().length < 2) {
      onNotify('Please enter your business or studio name.', 'error');
      return;
    }
    setSaving(true);
    try {
      await onSaveSettings({
        business_name: businessName.trim(),
        tagline: tagline.trim() || 'Sales, Services & Operations',
        phone_primary: phonePrimary.trim(),
        email: email.trim(),
        location: location.trim(),
        currency,
        receipt_prefix: receiptPrefix.trim().toUpperCase() || suggestPrefix(businessName),
        logo_url: logoUrl,
        profile_completed: 1,
      });
      onNotify(`Welcome! "${businessName.trim()}" workspace is ready.`);
    } catch (err: any) {
      onNotify(err.message || 'Could not save your business profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0B1D3A]/85 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden my-auto">
        <div className="bg-[#0B1D3A] px-6 py-5 border-b-4 border-[#C89B3C] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-[#132B52] border border-amber-400/30 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-[#C89B3C]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white truncate">
                Set Up Your Business Profile
              </h2>
              <p className="text-xs text-amber-300/90 truncate">
                Signed in as {user.full_name} ({user.email})
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            Personalize your private workspace. Your business name, contact details, currency, and
            logo will appear on your dashboard, electronic receipts, and PDF reports.
          </p>

          <div className="flex items-center gap-4 pb-3 border-b border-slate-100">
            <div className="w-16 h-16 rounded-xl overflow-hidden border border-slate-200 bg-[#0B1D3A] shrink-0">
              <img
                src={logoUrl}
                alt="Business Logo"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-800">Business Logo (Optional)</p>
              <label className="h-8 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                Upload Logo
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Business / Company Name *
              </label>
              <input
                type="text"
                required
                value={businessName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Kampala Creative Prints"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Business Type / Services
              </label>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="e.g. Printing & Branding, Retail Shop, Salon, Photography"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Primary Phone
              </label>
              <input
                type="text"
                value={phonePrimary}
                onChange={(e) => setPhonePrimary(e.target.value)}
                placeholder="+256 7XX XXX XXX"
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
                placeholder="info@yourbusiness.com"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                City / Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Kampala, Uganda"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full h-10 px-2.5 rounded-lg border border-slate-300 text-sm bg-white font-mono"
                >
                  <option value="UGX">UGX</option>
                  <option value="USD">USD</option>
                  <option value="KES">KES</option>
                  <option value="TZS">TZS</option>
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
                  onChange={(e) => {
                    setPrefixTouched(true);
                    setReceiptPrefix(e.target.value.toUpperCase());
                  }}
                  className="w-full h-10 px-2.5 rounded-lg border border-slate-300 text-sm font-mono uppercase"
                />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={onSignOut}
              className="h-10 px-3.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Switch Account
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-10 px-5 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4 text-[#C89B3C]" />
              {saving ? 'Creating Workspace...' : 'Save & Enter Workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
