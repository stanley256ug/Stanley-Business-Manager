import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Copy,
  CreditCard,
  KeyRound,
  Lock,
  Phone,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import {
  BILLING_PLANS,
  BillingPlanCode,
  MOBILE_MONEY_ACCOUNTS,
  MobileMoneyProvider,
} from '../constants/billing';
import { BillingSubscription } from '../types';
import { apiRequest } from '../utils/api';

export const BILLING_PASS_STORAGE_KEY = 'sbm_billing_pass_code';

interface BillingGateProps {
  brand: {
    business_name: string;
    logo_url: string;
    location: string;
  };
  initialMessage?: string;
  renewalMode?: boolean;
  existingPass?: { passCode: string; subscription: BillingSubscription } | null;
  onPlanUnlocked: (
    passCode: string,
    subscription: BillingSubscription,
    nextAuthMode: 'register' | 'signin'
  ) => void;
  onProceedToSignIn: () => void;
  onRequestBack?: () => void;
}

export const BillingGate: React.FC<BillingGateProps> = ({
  brand,
  initialMessage,
  renewalMode = false,
  existingPass,
  onPlanUnlocked,
  onProceedToSignIn,
  onRequestBack,
}) => {
  const [selectedPlan, setSelectedPlan] = useState<BillingPlanCode>(
    renewalMode ? 'monthly_1m' : 'trial_24h'
  );
  const [provider, setProvider] = useState<MobileMoneyProvider>('airtel');
  const [payerPhone, setPayerPhone] = useState('');
  const [payerName, setPayerName] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copiedNumber, setCopiedNumber] = useState<MobileMoneyProvider | null>(null);

  // Resume with an existing pass code
  const [showPassLookup, setShowPassLookup] = useState(false);
  const [lookupCode, setLookupCode] = useState('');
  const [checkingPass, setCheckingPass] = useState(false);

  const activePlan = BILLING_PLANS.find((p) => p.code === selectedPlan) || BILLING_PLANS[0];
  const activeMobileAccount = MOBILE_MONEY_ACCOUNTS[provider];

  const handleCopyNumber = async (key: MobileMoneyProvider) => {
    const phone = MOBILE_MONEY_ACCOUNTS[key].phone;
    try {
      await navigator.clipboard.writeText(phone);
      setCopiedNumber(key);
      setTimeout(() => {
        setCopiedNumber((prev) => (prev === key ? null : prev));
      }, 2200);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handleSelectPlan = (code: BillingPlanCode) => {
    if (renewalMode && code === 'trial_24h') return;
    setSelectedPlan(code);
    setError('');
  };

  const handleSubmitCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload =
        selectedPlan === 'trial_24h'
          ? {
              planCode: 'trial_24h',
              payerPhone: payerPhone.trim(),
              payerName: payerName.trim(),
            }
          : {
              planCode: selectedPlan,
              paymentProvider: provider,
              payerPhone: payerPhone.trim(),
              payerName: payerName.trim(),
              transactionId: transactionId.trim().toUpperCase(),
            };

      const res = await apiRequest<{
        passCode: string;
        subscription: BillingSubscription;
        resumed?: boolean;
      }>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      try {
        localStorage.setItem(BILLING_PASS_STORAGE_KEY, res.passCode);
      } catch {
        // ignore storage restrictions
      }

      onPlanUnlocked(res.passCode, res.subscription, renewalMode ? 'signin' : 'register');
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not complete billing checkout. Please verify your details and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyExistingPass = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = lookupCode.trim().toUpperCase();
    if (!clean) return;
    setError('');
    setCheckingPass(true);
    try {
      const res = await apiRequest<{
        valid: boolean;
        claimed: boolean;
        subscription: BillingSubscription;
      }>(`/api/billing/pass/${encodeURIComponent(clean)}`);

      if (!res.valid) {
        setError('This billing pass has expired or could not be verified. Please start a new plan below.');
        return;
      }
      if (res.claimed && !renewalMode) {
        setError('This billing pass is already linked to a workspace. Sign in using your account credentials.');
        return;
      }

      try {
        localStorage.setItem(BILLING_PASS_STORAGE_KEY, res.subscription.pass_code);
      } catch {
        // ignore
      }
      onPlanUnlocked(
        res.subscription.pass_code,
        res.subscription,
        renewalMode ? 'signin' : 'register'
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Billing pass code was not found.'
      );
    } finally {
      setCheckingPass(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1D3A] flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-4xl bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xl">
        {/* Top Navy Header */}
        <div className="bg-[#0B1D3A] px-5 sm:px-7 py-5 border-b-4 border-[#C89B3C] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            {onRequestBack && (
              <button
                type="button"
                onClick={onRequestBack}
                aria-label="Back"
                title="Double-click Back to exit app"
                className="h-9 px-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-100 text-xs font-medium inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                <span>Back</span>
              </button>
            )}
            <div className="w-12 h-12 rounded-xl overflow-hidden border border-amber-400/30 bg-[#0B1D3A] shrink-0">
              <img
                src={brand.logo_url}
                alt={brand.business_name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white truncate">
                STANLEY BUSINESS MANAGER
              </h1>
              <p className="text-xs text-amber-300/90 font-medium truncate">
                {renewalMode
                  ? 'Renew Subscription via Airtel Money or MTN MoMo'
                  : 'Step 1 of 2 · Choose Plan & Mobile Money Billing Before Account Access'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onProceedToSignIn}
            className="h-9 px-3.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <Lock className="w-3.5 h-3.5 text-[#C89B3C] shrink-0" />
            <span>Already Subscribed or Admin? Sign In</span>
          </button>
        </div>

        <div className="p-5 sm:p-7 space-y-6">
          {/* Active Pass Quick Resume Banner */}
          {existingPass && !renewalMode && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5 text-xs">
                <p className="font-bold text-emerald-900">
                  Active Billing Pass Ready: {existingPass.subscription.plan_name}
                </p>
                <p className="text-emerald-800 font-mono">
                  Pass Code: {existingPass.passCode} · Ready to create your business workspace
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  onPlanUnlocked(existingPass.passCode, existingPass.subscription, 'register')
                }
                className="h-9 px-3.5 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                <span>Continue to Account Form</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#C89B3C]" />
              </button>
            </div>
          )}

          {initialMessage && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 font-medium leading-relaxed">
              {initialMessage}
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
              {error}
            </div>
          )}

          {/* Plan Selection Grid */}
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  {renewalMode
                    ? 'Select a Subscription Plan to Continue'
                    : 'Select Your Subscription Plan'}
                </h2>
                <p className="text-xs text-slate-500">
                  Start with a 24-hour free trial or pay directly with Airtel Money or MTN Mobile Money.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPassLookup((v) => !v)}
                className="text-xs font-semibold text-[#0B1D3A] hover:text-amber-700 inline-flex items-center gap-1 cursor-pointer self-start sm:self-auto whitespace-nowrap"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#C89B3C]" />
                {showPassLookup ? 'Hide Pass Code Input' : 'Have a Billing Pass Code?'}
              </button>
            </div>

            {showPassLookup && (
              <form
                onSubmit={handleVerifyExistingPass}
                className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
              >
                <input
                  type="text"
                  required
                  value={lookupCode}
                  onChange={(e) => setLookupCode(e.target.value.toUpperCase())}
                  placeholder="Enter pass code (e.g. SBM-PAY-XXXX-XXXX)"
                  className="flex-1 h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-mono uppercase text-slate-900"
                />
                <button
                  type="submit"
                  disabled={checkingPass}
                  className="h-9 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  {checkingPass ? 'Checking...' : 'Verify Pass & Continue'}
                </button>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {BILLING_PLANS.map((plan) => {
                const isSelected = selectedPlan === plan.code;
                const isDisabled = renewalMode && plan.code === 'trial_24h';
                return (
                  <button
                    key={plan.code}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => handleSelectPlan(plan.code)}
                    className={`text-left p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                      isDisabled
                        ? 'bg-slate-50 border-slate-200 opacity-50 cursor-not-allowed'
                        : isSelected
                        ? 'bg-amber-50/40 border-[#0B1D3A] ring-2 ring-[#C89B3C]/50 cursor-pointer'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 cursor-pointer'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[#0B1D3A]">{plan.name}</span>
                        <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">
                          {plan.durationLabel}
                        </span>
                      </div>

                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                          {plan.priceLabel}
                        </span>
                        {plan.priceUgx > 0 && (
                          <span className="text-xs text-slate-500">/ {plan.durationLabel}</span>
                        )}
                      </div>

                      <p className="text-xs text-slate-600 leading-relaxed">{plan.summary}</p>
                    </div>

                    <ul className="space-y-1.5 pt-2 border-t border-slate-200/80 text-[11px] text-slate-700">
                      {plan.highlights.map((item) => (
                        <li key={item} className="flex items-start gap-1.5">
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Checkout Form: Trial vs Airtel & MTN Mobile Money */}
          <form
            onSubmit={handleSubmitCheckout}
            className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5 space-y-4"
          >
            {selectedPlan === 'trial_24h' ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#0B1D3A] text-[#C89B3C] flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Activate 24-Hour Free Trial (UGX 0)
                    </h3>
                    <p className="text-xs text-slate-600">
                      Enter your contact details to start your 24-hour trial and immediately open your business registration form.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Full Name or Business Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={payerName}
                      onChange={(e) => setPayerName(e.target.value)}
                      placeholder="e.g. Sarah Nakato / Kampala Prints"
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mobile Phone Number *
                    </label>
                    <input
                      type="tel"
                      required
                      value={payerPhone}
                      onChange={(e) => setPayerPhone(e.target.value)}
                      placeholder="+256 7XX XXX XXX"
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono tabular-nums text-slate-900"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-11 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>
                    {submitting
                      ? 'Activating 24-Hour Free Trial...'
                      : 'Start 24-Hour Free Trial & Access Account Form'}
                  </span>
                  <ArrowRight className="w-4 h-4 text-[#C89B3C]" />
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#0B1D3A] text-[#C89B3C] flex items-center justify-center shrink-0">
                      <CreditCard className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Pay {activePlan.priceLabel} ({activePlan.name}) via Mobile Money
                      </h3>
                      <p className="text-xs text-slate-600">
                        Send {activePlan.priceLabel} to our Airtel Money or MTN MoMo merchant number below, then enter your transaction ID.
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-bold font-mono tabular-nums text-[#0B1D3A] whitespace-nowrap">
                    Total: {activePlan.priceLabel}
                  </span>
                </div>

                {/* Airtel & MTN Recipient Numbers */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(['airtel', 'mtn'] as MobileMoneyProvider[]).map((netKey) => {
                    const acct = MOBILE_MONEY_ACCOUNTS[netKey];
                    const isActiveNet = provider === netKey;
                    return (
                      <div
                        key={netKey}
                        onClick={() => setProvider(netKey)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setProvider(netKey);
                          }
                        }}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer space-y-2 ${
                          isActiveNet
                            ? `${acct.accentBg} ${acct.accentBorder} ring-2 ring-[#0B1D3A]/20`
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Smartphone className={`w-4 h-4 ${acct.accentText}`} />
                            <span className={`text-xs font-bold ${acct.accentText}`}>
                              {acct.name}
                            </span>
                          </div>
                          <span className="text-[11px] font-semibold text-slate-600">
                            {isActiveNet ? 'Selected' : 'Select'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2 bg-white/90 rounded-lg border border-slate-200 px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span className="text-sm font-bold font-mono tabular-nums text-slate-900 select-all truncate">
                              {acct.phone}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void handleCopyNumber(netKey);
                            }}
                            className="h-7 px-2 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer shrink-0"
                          >
                            {copiedNumber === netKey ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            {copiedNumber === netKey ? 'Copied' : 'Copy'}
                          </button>
                        </div>

                        <p className="text-[11px] text-slate-600 leading-snug">{acct.ussdHint}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Payment Confirmation Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Number Used to Pay *
                    </label>
                    <input
                      type="tel"
                      required
                      value={payerPhone}
                      onChange={(e) => setPayerPhone(e.target.value)}
                      placeholder="+256 7XX XXX XXX"
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono tabular-nums text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Registered Name on Mobile Money *
                    </label>
                    <input
                      type="text"
                      required
                      value={payerName}
                      onChange={(e) => setPayerName(e.target.value)}
                      placeholder="Full name on SIM"
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {activeMobileAccount.shortName} Transaction ID *
                    </label>
                    <input
                      type="text"
                      required
                      minLength={6}
                      value={transactionId}
                      onChange={(e) => setTransactionId(e.target.value.toUpperCase())}
                      placeholder="e.g. MP261122.1408.A12345"
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono uppercase text-slate-900"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-11 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>
                    {submitting
                      ? 'Submitting Mobile Money Payment...'
                      : `Submit ${activeMobileAccount.shortName} Payment (${activePlan.priceLabel}) & Continue`}
                  </span>
                  <ArrowRight className="w-4 h-4 text-[#C89B3C]" />
                </button>
              </>
            )}
          </form>

          {/* Footer / Admin & Existing Subscribers Link */}
          <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <div className="inline-flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Airtel Money: <strong className="font-mono text-slate-700">+256708475220</strong> · MTN MoMo:{' '}
                <strong className="font-mono text-slate-700">+256789384426</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={onProceedToSignIn}
              className="font-semibold text-[#0B1D3A] hover:text-amber-700 cursor-pointer whitespace-nowrap"
            >
              Existing Workspace or Administrator? Sign In Here →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
