import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Lock,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { auth, googleProvider } from '../firebase';
import { UserProfile } from '../types';
import { apiRequest, setStoredToken } from '../utils/api';
import { PWAInstallButton } from './PWAInstallButton';

interface AuthLoginProps {
  brand: {
    business_name: string;
    logo_url: string;
    location: string;
  };
  showDefaultHint: boolean;
  onSuccess: (user: UserProfile) => void;
}

type AuthMode = 'signin' | 'register' | 'forgot';
type ResetMethod = 'google' | 'security_question' | 'recovery_key';

interface LookupResult {
  found: boolean;
  maskedEmail: string;
  hasSecurityQuestion: boolean;
  securityQuestion: string | null;
  hasRecoveryKey: boolean;
  canVerifyWithGoogle: boolean;
}

const SECURITY_QUESTIONS = [
  'What is the name of your first primary school?',
  'In what city or town were you born?',
  'What is your favorite printing or studio equipment?',
  "What is your mother's maiden name?",
  'What was the name of your first business client?',
];

const GoogleLogoIcon = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
    />
  </svg>
);

export const AuthLogin: React.FC<AuthLoginProps> = ({
  brand,
  showDefaultHint,
  onSuccess,
}) => {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Sign In State
  const [identifier, setIdentifier] = useState(showDefaultHint ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Register State
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regQuestion, setRegQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [regAnswer, setRegAnswer] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Recovery key confirmation after register or recovery-key reset
  const [pendingSessionUser, setPendingSessionUser] = useState<UserProfile | null>(null);
  const [issuedRecoveryKey, setIssuedRecoveryKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Forgot Password State
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [resetMethod, setResetMethod] = useState<ResetMethod>('google');
  const [securityAnswerInput, setSecurityAnswerInput] = useState('');
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    setSuccessMsg('');
    if (next !== 'forgot') {
      setLookupResult(null);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setSuccessMsg('');
    setGoogleLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const idToken = await cred.user.getIdToken();
      const res = await apiRequest<{ token: string; user: UserProfile }>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      });
      setStoredToken(res.token);
      onSuccess(res.user);
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        setError('Google Sign-In window was closed before completing.');
      } else if (err?.code === 'auth/popup-blocked') {
        setError('Pop-up was blocked by your browser. Please allow pop-ups and try again.');
      } else {
        setError(err.message || 'Google Sign-In failed. Please try again.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: UserProfile }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      setStoredToken(res.token);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Sign in failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (regPassword !== regConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (regPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<{
        token: string;
        user: UserProfile;
        recoveryKey: string;
      }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          full_name: regName.trim(),
          username: regUsername.trim(),
          email: regEmail.trim(),
          password: regPassword,
          security_question: regQuestion,
          security_answer: regAnswer.trim(),
        }),
      });
      setStoredToken(res.token);
      setPendingSessionUser(res.user);
      setIssuedRecoveryKey(res.recoveryKey);
    } catch (err: any) {
      setError(err.message || 'Could not create account.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const res = await apiRequest<LookupResult>('/api/auth/forgot-password/lookup', {
        method: 'POST',
        body: JSON.stringify({ identifier: forgotIdentifier.trim() }),
      });
      setLookupResult(res);
      if (res.hasSecurityQuestion) {
        setResetMethod('security_question');
      } else if (res.canVerifyWithGoogle) {
        setResetMethod('google');
      } else if (res.hasRecoveryKey) {
        setResetMethod('recovery_key');
      }
    } catch (err: any) {
      setError(err.message || 'Could not find that account.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (resetNewPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setLoading(true);
    try {
      let idToken: string | undefined;
      if (resetMethod === 'google') {
        const cred = await signInWithPopup(auth, googleProvider);
        idToken = await cred.user.getIdToken();
      }

      const res = await apiRequest<{
        token: string;
        user: UserProfile;
        newRecoveryKey?: string;
      }>('/api/auth/forgot-password/reset', {
        method: 'POST',
        body: JSON.stringify({
          identifier: forgotIdentifier.trim(),
          method: resetMethod,
          idToken,
          securityAnswer: resetMethod === 'security_question' ? securityAnswerInput : undefined,
          recoveryKey: resetMethod === 'recovery_key' ? recoveryKeyInput : undefined,
          newPassword: resetNewPassword,
        }),
      });

      setStoredToken(res.token);
      if (res.newRecoveryKey) {
        setPendingSessionUser(res.user);
        setIssuedRecoveryKey(res.newRecoveryKey);
        setSuccessMsg('Password reset successfully. Save your new recovery key below.');
      } else {
        onSuccess(res.user);
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        setError('Google verification was cancelled.');
      } else {
        setError(err.message || 'Password reset failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopyRecoveryKey = async () => {
    if (!issuedRecoveryKey) return;
    try {
      await navigator.clipboard.writeText(issuedRecoveryKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadRecoveryKey = () => {
    if (!issuedRecoveryKey || !pendingSessionUser) return;
    const text = [
      'STANLEY BUSINESS MANAGER — PERSONAL RECOVERY KEY',
      '==================================================',
      `Account: ${pendingSessionUser.full_name} (@${pendingSessionUser.username})`,
      `Email: ${pendingSessionUser.email}`,
      `Recovery Key: ${issuedRecoveryKey}`,
      `Generated: ${new Date().toLocaleString()}`,
      '',
      'Keep this recovery key in a safe place. You can use it in Forgot Password',
      'to reset your password even when working offline.',
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stanley-recovery-key-${pendingSessionUser.username}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const fillDemoCredentials = () => {
    setIdentifier('admin');
    setPassword('stanley2026');
    setError('');
  };

  return (
    <div className="min-h-screen bg-[#0B1D3A] flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xl">
        <div className="bg-[#0B1D3A] px-6 py-6 text-center border-b-4 border-[#C89B3C]">
          <div className="w-16 h-16 mx-auto mb-3 rounded-xl overflow-hidden border border-amber-400/30 bg-[#0B1D3A] flex items-center justify-center">
            <img
              src={brand.logo_url}
              alt={brand.business_name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            STANLEY BUSINESS MANAGER
          </h1>
          <p className="mt-1 text-xs text-amber-300/90 font-medium">
            {brand.business_name} · {brand.location || 'Uganda'}
          </p>
        </div>

        {/* Recovery Key Issuance Screen (after Create Account or Recovery Key Reset) */}
        {pendingSessionUser && issuedRecoveryKey ? (
          <div className="p-6 sm:p-8 space-y-5">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <ShieldCheck className="w-4 h-4" />
                Account Ready
              </div>
              <h2 className="text-lg font-bold text-slate-900">Save Your Personal Recovery Key</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Keep this key somewhere safe. If you ever forget your password, you can use it to
                regain access to <strong>@{pendingSessionUser.username}</strong>—even offline.
              </p>
            </div>

            {successMsg && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                {successMsg}
              </div>
            )}

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Personal Recovery Key
              </p>
              <p className="text-lg font-bold font-mono tracking-wider text-[#0B1D3A] select-all">
                {issuedRecoveryKey}
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyRecoveryKey}
                  className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedKey ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedKey ? 'Copied' : 'Copy Key'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadRecoveryKey}
                  className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download .txt
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onSuccess(pendingSessionUser)}
              className="w-full h-11 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              Continue to Workspace
            </button>
          </div>
        ) : (
          <div className="p-6 sm:p-7 space-y-5">
            {/* Mode Switcher Tabs (Sign In / Create Account) */}
            {mode !== 'forgot' ? (
              <div className="grid grid-cols-2 p-1 rounded-lg bg-slate-100 border border-slate-200">
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className={`h-9 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    mode === 'signin'
                      ? 'bg-white text-[#0B1D3A] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className={`h-9 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    mode === 'register'
                      ? 'bg-white text-[#0B1D3A] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Create Account
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B1D3A] hover:text-amber-700 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Sign In
              </button>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}

            {successMsg && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
                {successMsg}
              </div>
            )}

            {/* SIGN IN MODE */}
            {mode === 'signin' && (
              <form onSubmit={handleSignInSubmit} className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Sign In to Workspace</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Access your studio sales, receipts, orders, and cloud backups.
                  </p>
                </div>

                {/* Continue with Google */}
                <button
                  type="button"
                  disabled={googleLoading || loading}
                  onClick={handleGoogleSignIn}
                  className="w-full h-11 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  <GoogleLogoIcon />
                  <span>{googleLoading ? 'Connecting to Google...' : 'Continue with Google'}</span>
                </button>

                <div className="relative flex items-center py-0.5">
                  <div className="flex-grow border-t border-slate-200" />
                  <span className="shrink mx-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                    or use credentials
                  </span>
                  <div className="flex-grow border-t border-slate-200" />
                </div>

                {showDefaultHint && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-slate-700 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">Initial Studio Admin</span>
                      <button
                        type="button"
                        onClick={fillDemoCredentials}
                        className="text-xs font-semibold text-[#0B1D3A] underline hover:text-amber-700 cursor-pointer"
                      >
                        Auto-fill
                      </button>
                    </div>
                    <p className="font-mono text-slate-600">
                      User: <strong className="text-slate-900">admin</strong> · Pass:{' '}
                      <strong className="text-slate-900">stanley2026</strong>
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Username or Email
                  </label>
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="admin or mpangastanley04@gmail.com"
                    className="w-full h-10 px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C89B3C]/40 focus:border-[#0B1D3A]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700">Password</label>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotIdentifier(identifier);
                        switchMode('forgot');
                      }}
                      className="text-xs font-semibold text-[#0B1D3A] hover:text-amber-700 cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      className="w-full h-10 pl-3.5 pr-11 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C89B3C]/40 focus:border-[#0B1D3A]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="w-full h-11 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  <Lock className="w-4 h-4 text-[#C89B3C]" />
                  <span>{loading ? 'Verifying Access...' : 'Sign In to Workspace'}</span>
                </button>
              </form>
            )}

            {/* CREATE ACCOUNT MODE */}
            {mode === 'register' && (
              <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Create Account</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Register a team member account or connect instantly with Google.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={googleLoading || loading}
                  onClick={handleGoogleSignIn}
                  className="w-full h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  <GoogleLogoIcon />
                  <span>{googleLoading ? 'Connecting to Google...' : 'Sign up with Google'}</span>
                </button>

                <div className="relative flex items-center py-0.5">
                  <div className="flex-grow border-t border-slate-200" />
                  <span className="shrink mx-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                    or create local account
                  </span>
                  <div className="flex-grow border-t border-slate-200" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="e.g. Sarah Nakato"
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Username *
                    </label>
                    <input
                      type="text"
                      required
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value)}
                      placeholder="e.g. sarah.studio"
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Password *
                    </label>
                    <div className="relative">
                      <input
                        type={showRegPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="Min. 6 chars"
                        className="w-full h-9 pl-3 pr-9 rounded-lg border border-slate-300 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword((v) => !v)}
                        aria-label="Toggle password visibility"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        {showRegPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Confirm Password *
                    </label>
                    <input
                      type={showRegPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                  <p className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-[#0B1D3A]" />
                    Password Recovery Question (Required for Forgot Password)
                  </p>
                  <select
                    value={regQuestion}
                    onChange={(e) => setRegQuestion(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800"
                  >
                    {SECURITY_QUESTIONS.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={regAnswer}
                    onChange={(e) => setRegAnswer(e.target.value)}
                    placeholder="Your security answer"
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="w-full h-10 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4 text-[#C89B3C]" />
                  <span>{loading ? 'Creating Account...' : 'Create Account'}</span>
                </button>
              </form>
            )}

            {/* FORGOT PASSWORD MODE */}
            {mode === 'forgot' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Reset Your Password</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Verify ownership via Google Sign-In, your security question, or your personal recovery key.
                  </p>
                </div>

                {!lookupResult ? (
                  <form onSubmit={handleForgotLookup} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Username or Registered Email *
                      </label>
                      <input
                        type="text"
                        required
                        value={forgotIdentifier}
                        onChange={(e) => setForgotIdentifier(e.target.value)}
                        placeholder="e.g. admin or mpangastanley04@gmail.com"
                        className="w-full h-10 px-3.5 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full h-10 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <KeyRound className="w-4 h-4 text-[#C89B3C]" />
                      {loading ? 'Searching Account...' : 'Find Account'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleForgotReset} className="space-y-4">
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs">
                      <div>
                        <p className="font-semibold text-slate-900">Account Verified</p>
                        <p className="text-slate-500 font-mono">{lookupResult.maskedEmail}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setLookupResult(null);
                          setError('');
                        }}
                        className="text-xs font-semibold text-[#0B1D3A] underline cursor-pointer"
                      >
                        Change
                      </button>
                    </div>

                    {/* Verification Method Tabs */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700">
                        Choose Verification Method
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {lookupResult.canVerifyWithGoogle && (
                          <button
                            type="button"
                            onClick={() => setResetMethod('google')}
                            className={`h-9 px-2.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                              resetMethod === 'google'
                                ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            Google Account
                          </button>
                        )}
                        {lookupResult.hasSecurityQuestion && (
                          <button
                            type="button"
                            onClick={() => setResetMethod('security_question')}
                            className={`h-9 px-2.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                              resetMethod === 'security_question'
                                ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            Security Question
                          </button>
                        )}
                        {lookupResult.hasRecoveryKey && (
                          <button
                            type="button"
                            onClick={() => setResetMethod('recovery_key')}
                            className={`h-9 px-2.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                              resetMethod === 'recovery_key'
                                ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            Recovery Key
                          </button>
                        )}
                      </div>
                    </div>

                    {resetMethod === 'google' && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-slate-700">
                        Enter your new password below, then click{' '}
                        <strong>Verify with Google &amp; Reset</strong> to sign in with the Google
                        account matching <strong>{lookupResult.maskedEmail}</strong>.
                      </div>
                    )}

                    {resetMethod === 'security_question' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {lookupResult.securityQuestion}
                        </label>
                        <input
                          type="text"
                          required
                          value={securityAnswerInput}
                          onChange={(e) => setSecurityAnswerInput(e.target.value)}
                          placeholder="Enter your recovery answer"
                          className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                        />
                      </div>
                    )}

                    {resetMethod === 'recovery_key' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Personal Recovery Key
                        </label>
                        <input
                          type="text"
                          required
                          value={recoveryKeyInput}
                          onChange={(e) => setRecoveryKeyInput(e.target.value.toUpperCase())}
                          placeholder="SBM-XXXX-XXXX-XXXX"
                          className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono uppercase"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          New Password *
                        </label>
                        <div className="relative">
                          <input
                            type={showResetPassword ? 'text' : 'password'}
                            required
                            minLength={6}
                            value={resetNewPassword}
                            onChange={(e) => setResetNewPassword(e.target.value)}
                            placeholder="Min. 6 chars"
                            className="w-full h-10 pl-3 pr-9 rounded-lg border border-slate-300 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => setShowResetPassword((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 cursor-pointer"
                          >
                            {showResetPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Confirm New Password *
                        </label>
                        <input
                          type={showResetPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={resetConfirmPassword}
                          onChange={(e) => setResetConfirmPassword(e.target.value)}
                          placeholder="Repeat password"
                          className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full h-11 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {resetMethod === 'google' ? (
                        <>
                          <GoogleLogoIcon />
                          <span>{loading ? 'Verifying...' : 'Verify with Google & Reset Password'}</span>
                        </>
                      ) : (
                        <>
                          <KeyRound className="w-4 h-4 text-[#C89B3C]" />
                          <span>{loading ? 'Resetting...' : 'Reset Password & Sign In'}</span>
                        </>
                      )}
                    </button>
                  </form>
                )}
              </div>
            )}

            <PWAInstallButton variant="login" autoOpenOnInstallParam />

            <div className="pt-2 border-t border-slate-100 flex items-center justify-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Protected local SQLite persistence &amp; Google Auth verification</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
