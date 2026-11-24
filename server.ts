import express, { Request, Response, NextFunction } from 'express';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
  db,
  DB_PATH,
  initDatabase,
  hashPassword,
  verifyPassword,
  generateRecoveryKey,
  generateBillingPassCode,
  ensureWorkspaceForUser,
  DEFAULT_LOGO_URL,
} from './src/db/database.ts';
import {
  BILLING_PLANS,
  MOBILE_MONEY_ACCOUNTS,
  getBillingPlanByCode,
} from './src/constants/billing.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initDatabase();

export const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '15mb' }));

// Allow Google Chrome Extension (Manifest V3) origins to call /api/* with Bearer auth
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('chrome-extension://')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
  }
  next();
});

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
    full_name: string;
    email: string;
    role: string;
    is_default_password: boolean;
    last_login_at: string | null;
  };
  sessionToken?: string;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    cookies[key] = val;
  }
  return cookies;
}

function getTokenFromReq(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies['sbm_session'] || null;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = getTokenFromReq(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const row = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.email, u.role, u.status, u.is_default_password, u.last_login_at, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as
    | {
        id: number;
        username: string;
        full_name: string;
        email: string;
        role: string;
        status: string;
        is_default_password: number;
        last_login_at: string | null;
        expires_at: string;
      }
    | undefined;

  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    if (row) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }

  if (row.status === 'suspended') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    res.status(403).json({ error: 'Account suspended by system administrator.' });
    return;
  }

  req.user = {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    is_default_password: Boolean(row.is_default_password),
    last_login_at: row.last_login_at,
  };
  req.sessionToken = token;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'Administrator') {
    res.status(403).json({ error: 'Administrator privileges required to access system monitor.' });
    return;
  }
  next();
}

function formatSaleRow(row: any) {
  let items = [];
  try {
    items = JSON.parse(row.items_json || '[]');
  } catch {
    items = [];
  }
  const payments = db
    .prepare('SELECT id, sale_id, amount, payment_method, note, paid_at FROM sale_payments WHERE sale_id = ? ORDER BY paid_at DESC, id DESC')
    .all(row.id);

  return {
    id: row.id,
    receipt_number: row.receipt_number,
    order_id: row.order_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    items,
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    total_amount: Number(row.total_amount),
    amount_paid: Number(row.amount_paid),
    balance_due: Number(row.balance_due),
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    notes: row.notes,
    sale_date: row.sale_date,
    client_sync_id: row.client_sync_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    payments,
  };
}

function getCustomersWithAggregates(ownerUserId: number) {
  const customers = db
    .prepare('SELECT * FROM customers WHERE owner_user_id = ? ORDER BY name ASC')
    .all(ownerUserId) as any[];
  const salesAgg = db
    .prepare(
      `SELECT customer_id,
              COALESCE(SUM(total_amount), 0) AS total_spent,
              COALESCE(SUM(balance_due), 0) AS outstanding_balance,
              COUNT(*) AS sale_count
       FROM sales
       WHERE owner_user_id = ? AND customer_id IS NOT NULL
       GROUP BY customer_id`
    )
    .all(ownerUserId) as any[];
  const ordersAgg = db
    .prepare(
      `SELECT customer_id, COUNT(*) AS order_count
       FROM orders
       WHERE owner_user_id = ? AND customer_id IS NOT NULL
       GROUP BY customer_id`
    )
    .all(ownerUserId) as any[];

  const salesMap = new Map(salesAgg.map((r) => [r.customer_id, r]));
  const ordersMap = new Map(ordersAgg.map((r) => [r.customer_id, r]));

  return customers.map((c) => {
    const s = salesMap.get(c.id);
    const o = ordersMap.get(c.id);
    return {
      ...c,
      total_spent: s ? Number(s.total_spent) : 0,
      outstanding_balance: s ? Number(s.outstanding_balance) : 0,
      sale_count: s ? Number(s.sale_count) : 0,
      order_count: o ? Number(o.order_count) : 0,
    };
  });
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

let cachedFirebaseCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

function getFirebaseProjectId(): string {
  const candidates = [
    path.resolve(__dirname, 'firebase-applet-config.json'),
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed?.projectId) return String(parsed.projectId);
      } catch {
        // try next candidate
      }
    }
  }
  return '';
}

async function getFirebasePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  if (!forceRefresh && cachedFirebaseCerts && Date.now() < cachedFirebaseCerts.expiresAt) {
    return cachedFirebaseCerts.certs;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error('Failed to fetch Google authentication certificates.');
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlMs = (maxAgeMatch ? Number(maxAgeMatch[1]) : 3600) * 1000;
  cachedFirebaseCerts = { certs, expiresAt: Date.now() + ttlMs };
  return certs;
}

async function verifyFirebaseIdToken(
  idToken: string,
  expectedProvider?: 'google' | 'icloud'
): Promise<{ uid: string; email: string; name: string; signInProvider: string }> {
  const projectId = getFirebaseProjectId();
  if (!projectId) {
    throw new Error('Firebase project configuration is missing.');
  }
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid authentication token format.');
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Unsupported token signing algorithm.');
  }

  let certs = await getFirebasePublicCerts(false);
  if (!certs[header.kid]) {
    certs = await getFirebasePublicCerts(true);
  }
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error('Unable to verify authentication signing key.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  const validSig = verifier.verify(cert, signatureB64, 'base64url');
  if (!validSig) {
    throw new Error('Invalid authentication signature.');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    payload.aud !== projectId ||
    payload.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    typeof payload.exp !== 'number' ||
    payload.exp <= nowSec ||
    typeof payload.iat !== 'number' ||
    payload.iat > nowSec + 300
  ) {
    throw new Error('Authentication token is expired or invalid for this app.');
  }

  const signInProvider = String(payload?.firebase?.sign_in_provider || '');
  if (expectedProvider === 'icloud' && signInProvider && signInProvider !== 'apple.com') {
    throw new Error('Please complete sign-in with an Apple / iCloud account.');
  }

  const email = typeof payload.email === 'string' ? String(payload.email).trim() : '';
  if (expectedProvider !== 'icloud') {
    if (payload.email_verified !== true || !email) {
      throw new Error('A verified Google email address is required.');
    }
  } else if (!email && signInProvider !== 'apple.com') {
    throw new Error('An Apple / iCloud email address is required.');
  }

  return {
    uid: payload.sub,
    email,
    name: String(payload.name || (email ? email.split('@')[0] : 'iCloud User')).trim(),
    signInProvider,
  };
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim().slice(0, 64);
  }
  if (Array.isArray(fwd) && fwd[0]) {
    return String(fwd[0]).split(',')[0].trim().slice(0, 64);
  }
  return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

function getClientAgent(req: Request): string {
  return String(req.headers['user-agent'] || 'Unknown client').slice(0, 240);
}

function recordLoginEvent(
  req: Request,
  opts: {
    user?: any;
    identifier?: string;
    authMethod: 'local' | 'google' | 'icloud';
    status: 'success' | 'failed' | 'register' | 'password_reset' | 'logout';
    failureReason?: string;
  }
): void {
  try {
    db.prepare(
      `INSERT INTO login_events (
        user_id, identifier, username, full_name, email, auth_method, status, failure_reason, ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      opts.user?.id ?? null,
      String(opts.identifier || opts.user?.username || opts.user?.email || '').slice(0, 120),
      String(opts.user?.username || '').slice(0, 80),
      String(opts.user?.full_name || '').slice(0, 120),
      String(opts.user?.email || '').slice(0, 140),
      opts.authMethod,
      opts.status,
      String(opts.failureReason || '').slice(0, 200),
      getClientIp(req),
      getClientAgent(req)
    );
  } catch {
    // Never break auth flow on audit write failure
  }
}

function recordSystemAudit(
  actor: { id?: number | null; username?: string } | null,
  action: string,
  targetType: string,
  targetId: string | number,
  details: string
): void {
  try {
    db.prepare(
      `INSERT INTO system_audit_logs (actor_user_id, actor_username, action, target_type, target_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      actor?.id ?? null,
      String(actor?.username || 'system').slice(0, 80),
      action,
      targetType,
      String(targetId),
      details.slice(0, 300)
    );
  } catch {
    // Non-fatal
  }
}

interface ServerNotificationPayload {
  id: number;
  target_user_id: number;
  type: 'login' | 'order' | 'billing';
  title: string;
  message: string;
  actor_user_id: number | null;
  actor_name: string;
  related_entity_type: string;
  related_entity_id: string;
  is_read: boolean;
  created_at: string;
}

const notificationClients = new Map<number, Set<Response>>();

function formatNotificationRow(row: any): ServerNotificationPayload {
  const safeType =
    row.type === 'order' ? 'order' : row.type === 'billing' ? 'billing' : 'login';
  return {
    id: Number(row.id),
    target_user_id: Number(row.target_user_id),
    type: safeType,
    title: String(row.title || ''),
    message: String(row.message || ''),
    actor_user_id: row.actor_user_id !== null && row.actor_user_id !== undefined ? Number(row.actor_user_id) : null,
    actor_name: String(row.actor_name || ''),
    related_entity_type: String(row.related_entity_type || ''),
    related_entity_id: String(row.related_entity_id || ''),
    is_read: Boolean(row.is_read),
    created_at: String(row.created_at || new Date().toISOString()),
  };
}

function broadcastNotificationToUser(targetUserId: number, payload: ServerNotificationPayload): void {
  const clients = notificationClients.get(targetUserId);
  if (!clients || clients.size === 0) return;
  const serialized = `event: notification\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const clientRes of clients) {
    try {
      clientRes.write(serialized);
    } catch {
      clients.delete(clientRes);
    }
  }
}

function createAndBroadcastNotification(opts: {
  targetUserId: number;
  type: 'login' | 'order' | 'billing';
  title: string;
  message: string;
  actorUserId?: number | null;
  actorName?: string;
  relatedEntityType?: string;
  relatedEntityId?: string | number;
}): void {
  try {
    const info = db
      .prepare(
        `INSERT INTO notifications (
          target_user_id, type, title, message, actor_user_id, actor_name, related_entity_type, related_entity_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        opts.targetUserId,
        opts.type,
        opts.title.slice(0, 140),
        opts.message.slice(0, 400),
        opts.actorUserId ?? null,
        String(opts.actorName || '').slice(0, 120),
        String(opts.relatedEntityType || '').slice(0, 40),
        String(opts.relatedEntityId ?? '').slice(0, 80)
      );
    const createdRow = db.prepare('SELECT * FROM notifications WHERE id = ?').get(info.lastInsertRowid);
    if (createdRow) {
      broadcastNotificationToUser(opts.targetUserId, formatNotificationRow(createdRow));
    }
  } catch {
    // Never break core auth/order mutations if notification storage fails
  }
}

function notifyLoginEvent(
  userRow: any,
  authMethod: 'local' | 'google' | 'icloud',
  isRegistration = false
): void {
  if (!userRow?.id) return;
  const methodLabel = authMethod === 'google' ? 'Google' : authMethod === 'icloud' ? 'iCloud' : 'Password';
  const displayName = String(userRow.full_name || userRow.username || 'User').trim();
  const usernameTag = userRow.username ? `@${userRow.username}` : userRow.email || '';

  const activeAdmins = db
    .prepare("SELECT id FROM users WHERE role = 'Administrator' AND status = 'active'")
    .all() as Array<{ id: number }>;

  const notifiedIds = new Set<number>();
  for (const admin of activeAdmins) {
    const isSelf = admin.id === Number(userRow.id);
    const title = isRegistration
      ? isSelf
        ? 'Administrator Account Created'
        : 'New User Registered & Signed In'
      : isSelf
      ? 'Administrator Signed In'
      : 'User Signed In';
    const message = isRegistration
      ? `${displayName} (${usernameTag}) created a workspace and signed in via ${methodLabel}.`
      : `${displayName} (${usernameTag}) signed in via ${methodLabel}.`;

    createAndBroadcastNotification({
      targetUserId: admin.id,
      type: 'login',
      title,
      message,
      actorUserId: Number(userRow.id),
      actorName: displayName,
      relatedEntityType: 'user',
      relatedEntityId: userRow.id,
    });
    notifiedIds.add(admin.id);
  }

  if (!notifiedIds.has(Number(userRow.id))) {
    createAndBroadcastNotification({
      targetUserId: Number(userRow.id),
      type: 'login',
      title: isRegistration ? 'Workspace Created & Signed In' : 'New Sign-In Detected',
      message: `Signed in to your workspace as ${displayName} (${usernameTag}) via ${methodLabel}.`,
      actorUserId: Number(userRow.id),
      actorName: displayName,
      relatedEntityType: 'user',
      relatedEntityId: userRow.id,
    });
  }
}

function notifyNewOrderEvent(
  ownerUserId: number,
  orderRow: any,
  actorUser?: { id?: number; full_name?: string; username?: string } | null
): void {
  if (!orderRow) return;
  const settings = db
    .prepare('SELECT business_name, currency FROM business_settings WHERE owner_user_id = ?')
    .get(ownerUserId) as { business_name?: string; currency?: string } | undefined;
  const currency = settings?.currency || 'UGX';
  const bizName = settings?.business_name || 'Business Workspace';
  const formattedTotal = `${currency} ${Number(orderRow.total_amount || 0).toLocaleString('en-US')}`;
  const actorName = actorUser?.full_name || orderRow.customer_name || 'Workspace';

  createAndBroadcastNotification({
    targetUserId: ownerUserId,
    type: 'order',
    title: 'New Order Registered',
    message: `${orderRow.order_number} — ${orderRow.title} for ${orderRow.customer_name} (${formattedTotal})`,
    actorUserId: actorUser?.id ?? ownerUserId,
    actorName,
    relatedEntityType: 'order',
    relatedEntityId: orderRow.id,
  });

  const activeAdmins = db
    .prepare("SELECT id FROM users WHERE role = 'Administrator' AND status = 'active'")
    .all() as Array<{ id: number }>;
  for (const admin of activeAdmins) {
    if (admin.id === ownerUserId) continue;
    createAndBroadcastNotification({
      targetUserId: admin.id,
      type: 'order',
      title: 'New Order Registered',
      message: `[${bizName}] ${orderRow.order_number} — ${orderRow.title} for ${orderRow.customer_name} (${formattedTotal})`,
      actorUserId: actorUser?.id ?? ownerUserId,
      actorName,
      relatedEntityType: 'order',
      relatedEntityId: orderRow.id,
    });
  }
}

function notifyBillingEvent(subRow: any): void {
  if (!subRow) return;
  const activeAdmins = db
    .prepare("SELECT id FROM users WHERE role = 'Administrator' AND status = 'active'")
    .all() as Array<{ id: number }>;
  const providerLabel =
    subRow.payment_provider === 'airtel'
      ? `Airtel Money (${subRow.recipient_number})`
      : subRow.payment_provider === 'mtn'
      ? `MTN MoMo (${subRow.recipient_number})`
      : '24-Hour Trial';
  const payerDesc = subRow.payer_name || subRow.payer_phone || subRow.pass_code;
  const amountLabel =
    Number(subRow.amount_ugx || 0) > 0
      ? `UGX ${Number(subRow.amount_ugx).toLocaleString('en-US')}`
      : 'Free Trial';
  const txNote = subRow.transaction_id ? ` · Tx: ${subRow.transaction_id}` : '';

  for (const admin of activeAdmins) {
    createAndBroadcastNotification({
      targetUserId: admin.id,
      type: 'billing',
      title:
        subRow.plan_code === 'trial_24h'
          ? '24-Hour Trial Activated'
          : 'Mobile Money Payment Submitted',
      message: `${payerDesc} selected ${subRow.plan_name} (${amountLabel}) via ${providerLabel}${txNote}`,
      actorUserId: subRow.user_id ?? null,
      actorName: String(subRow.payer_name || subRow.payer_phone || 'New Subscriber'),
      relatedEntityType: 'billing',
      relatedEntityId: subRow.id,
    });
  }
}

function normalizePhoneDigits(raw: string): string {
  return String(raw || '').replace(/[^\d+]/g, '').trim();
}

function validateBillingPassForUse(passCode: string): { valid: boolean; row?: any; error?: string } {
  const cleanCode = String(passCode || '').trim().toUpperCase();
  if (!cleanCode) {
    return {
      valid: false,
      error: 'Please select a billing plan (24-Hour Trial, 1 Month UGX 10,000, or 1 Year UGX 100,000) before accessing registration.',
    };
  }
  const row = db
    .prepare('SELECT * FROM billing_subscriptions WHERE UPPER(pass_code) = ? LIMIT 1')
    .get(cleanCode) as any;
  if (!row) {
    return { valid: false, error: 'Billing pass code not found. Please activate a plan or pay via Mobile Money.' };
  }
  if (row.status === 'rejected') {
    return { valid: false, error: 'This Mobile Money payment was rejected by the administrator. Please submit a valid transaction.' };
  }
  if (row.status === 'expired' || new Date(row.expires_at).getTime() <= Date.now()) {
    return { valid: false, error: 'This billing pass has expired. Please select a new plan or renew via Mobile Money.' };
  }
  if (row.user_id !== null && row.user_id !== undefined) {
    return { valid: false, error: 'This billing pass has already been claimed by an existing workspace. Please sign in or start a new plan.' };
  }
  return { valid: true, row };
}

function attachBillingPassToUser(billingRow: any, userId: number): void {
  const userSubStatus =
    billingRow.status === 'verified' || billingRow.plan_code === 'trial_24h'
      ? 'active'
      : billingRow.status === 'pending_verification'
      ? 'pending_verification'
      : 'active';
  db.prepare('UPDATE billing_subscriptions SET user_id = ? WHERE id = ?').run(userId, billingRow.id);
  db.prepare(
    `UPDATE users SET
      subscription_plan = ?,
      subscription_status = ?,
      subscription_expires_at = ?,
      active_billing_id = ?
     WHERE id = ?`
  ).run(
    billingRow.plan_code,
    userSubStatus,
    billingRow.expires_at,
    billingRow.id,
    userId
  );
}

function evaluateUserSubscription(userRow: any): { allowed: boolean; reason?: string } {
  if (!userRow) return { allowed: false, reason: 'Account not found.' };
  if (userRow.role === 'Administrator') return { allowed: true };
  if (userRow.subscription_status === 'rejected') {
    return {
      allowed: false,
      reason: 'Your Mobile Money payment could not be verified. Please submit a valid Airtel or MTN Mobile Money payment to continue.',
    };
  }
  const plan = String(userRow.subscription_plan || 'legacy');
  const expiresAt = userRow.subscription_expires_at;
  if (plan !== 'legacy' && expiresAt) {
    const expMs = new Date(expiresAt).getTime();
    if (!Number.isNaN(expMs) && expMs <= Date.now()) {
      db.prepare("UPDATE users SET subscription_status = 'expired' WHERE id = ?").run(userRow.id);
      return {
        allowed: false,
        reason:
          plan === 'trial_24h'
            ? 'Your 24-hour free trial has ended. Subscribe to 1 Month (UGX 10,000) or 1 Year (UGX 100,000) via Airtel or MTN Mobile Money to continue.'
            : 'Your subscription period has expired. Please renew via Airtel or MTN Mobile Money to continue.',
      };
    }
  }
  return { allowed: true };
}

function mapUserRow(row: any) {
  const provider =
    row.auth_provider === 'google'
      ? 'google'
      : row.auth_provider === 'icloud'
      ? 'icloud'
      : 'local';
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    is_default_password: Boolean(row.is_default_password),
    last_login_at: row.last_login_at ?? null,
    auth_provider: provider as 'local' | 'google' | 'icloud',
    status: (row.status === 'suspended' ? 'suspended' : 'active') as 'active' | 'suspended',
    security_question: row.security_question ? String(row.security_question) : null,
    has_recovery_key: Boolean(row.recovery_key_hash),
    subscription_plan: (row.subscription_plan || 'legacy') as 'legacy' | 'trial_24h' | 'monthly_1m' | 'annual_1y',
    subscription_status: (row.subscription_status || 'active') as
      | 'active'
      | 'pending_verification'
      | 'expired'
      | 'rejected',
    subscription_expires_at: row.subscription_expires_at ?? null,
  };
}

function setSessionCookie(req: Request, res: Response, token: string, maxAgeSeconds: number): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const cookieAttrs = isHttps
    ? `Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${maxAgeSeconds}`
    : `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  res.setHeader('Set-Cookie', `sbm_session=${encodeURIComponent(token)}; ${cookieAttrs}`);
}

function issueSessionForUser(req: Request, res: Response, userRow: any) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userRow.id, expiresAt);
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userRow.id);
  setSessionCookie(req, res, token, 30 * 24 * 3600);
  const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(userRow.id);
  return { token, user: mapUserRow(refreshed || userRow) };
}

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const [local, domain] = parts;
  if (local.length <= 2) return `${local[0] || '*'}*@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(5, local.length - 2))}${local[local.length - 1]}@${domain}`;
}

// Auth endpoints
const PUBLIC_PLATFORM_BRAND = {
  business_name: 'STANLEY BUSINESS MANAGER',
  logo_url: DEFAULT_LOGO_URL,
  location: 'Business Management, Receipts & Cloud Sync',
};

app.get('/api/auth/session', (req: AuthenticatedRequest, res) => {
  const token = getTokenFromReq(req);

  if (!token) {
    res.json({
      authenticated: false,
      user: null,
      showDefaultHint: false,
      brand: PUBLIC_PLATFORM_BRAND,
    });
    return;
  }

  const row = db
    .prepare(
      `SELECT u.*, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as any;

  if (!row || new Date(row.expires_at).getTime() < Date.now() || row.status === 'suspended') {
    if (row) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.json({
      authenticated: false,
      user: null,
      showDefaultHint: false,
      brand: PUBLIC_PLATFORM_BRAND,
    });
    return;
  }

  const subCheck = evaluateUserSubscription(row);
  if (!subCheck.allowed) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.json({
      authenticated: false,
      user: null,
      showDefaultHint: false,
      subscriptionRequired: true,
      subscriptionError: subCheck.reason,
      brand: PUBLIC_PLATFORM_BRAND,
    });
    return;
  }

  const settings = ensureWorkspaceForUser(row.id, {
    full_name: row.full_name,
    email: row.email,
  });

  res.json({
    authenticated: true,
    user: mapUserRow(row),
    showDefaultHint: false,
    brand: settings,
  });
});

app.post('/api/auth/login', (req, res) => {
  const { identifier, password, billingPassCode } = req.body || {};
  if (!identifier || !password) {
    res.status(400).json({ error: 'Username/email and password are required.' });
    return;
  }

  const cleanId = String(identifier).trim().toLowerCase();
  const user = db
    .prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1')
    .get(cleanId, cleanId) as any;

  if (!user || !verifyPassword(String(password), user.password_hash, user.password_salt)) {
    recordLoginEvent(req, {
      user: user || undefined,
      identifier: cleanId,
      authMethod: 'local',
      status: 'failed',
      failureReason: user ? 'Incorrect password' : 'Account not found',
    });
    res.status(401).json({ error: 'Invalid credentials. Please verify your username/email and password.' });
    return;
  }

  if (user.status === 'suspended') {
    recordLoginEvent(req, {
      user,
      identifier: cleanId,
      authMethod: 'local',
      status: 'failed',
      failureReason: 'Account suspended by administrator',
    });
    res.status(403).json({ error: 'This account has been suspended by the system administrator.' });
    return;
  }

  if (billingPassCode) {
    const passCheck = validateBillingPassForUse(String(billingPassCode));
    if (!passCheck.valid || !passCheck.row) {
      res.status(402).json({ error: passCheck.error || 'Invalid billing pass code.', code: 'SUBSCRIPTION_REQUIRED' });
      return;
    }
    attachBillingPassToUser(passCheck.row, user.id);
  }

  const refreshedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as any;
  const subCheck = evaluateUserSubscription(refreshedUser || user);
  if (!subCheck.allowed) {
    res.status(402).json({
      error: subCheck.reason,
      code: 'SUBSCRIPTION_REQUIRED',
      subscriptionUser: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        subscription_plan: user.subscription_plan,
        subscription_status: user.subscription_status,
        subscription_expires_at: user.subscription_expires_at,
      },
    });
    return;
  }

  ensureWorkspaceForUser(user.id, { full_name: user.full_name, email: user.email });
  recordLoginEvent(req, {
    user: refreshedUser || user,
    identifier: cleanId,
    authMethod: 'local',
    status: 'success',
  });
  notifyLoginEvent(refreshedUser || user, 'local', false);
  res.json(issueSessionForUser(req, res, refreshedUser || user));
});

app.post('/api/auth/google', async (req, res) => {
  const { idToken, billingPassCode } = req.body || {};
  if (!idToken || typeof idToken !== 'string') {
    res.status(400).json({ error: 'Google ID token is required.' });
    return;
  }

  try {
    const verified = await verifyFirebaseIdToken(idToken);
    let user = db
      .prepare('SELECT * FROM users WHERE google_uid = ? OR LOWER(email) = LOWER(?) LIMIT 1')
      .get(verified.uid, verified.email) as any;

    if (user) {
      if (user.status === 'suspended') {
        recordLoginEvent(req, {
          user,
          identifier: verified.email,
          authMethod: 'google',
          status: 'failed',
          failureReason: 'Account suspended by administrator',
        });
        res.status(403).json({ error: 'This account has been suspended by the system administrator.' });
        return;
      }
      if (!user.google_uid) {
        db.prepare('UPDATE users SET google_uid = ? WHERE id = ?').run(verified.uid, user.id);
      }
      if (billingPassCode) {
        const passCheck = validateBillingPassForUse(String(billingPassCode));
        if (!passCheck.valid || !passCheck.row) {
          res.status(402).json({ error: passCheck.error || 'Invalid billing pass code.', code: 'SUBSCRIPTION_REQUIRED' });
          return;
        }
        attachBillingPassToUser(passCheck.row, user.id);
      }
      const refreshedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as any;
      const subCheck = evaluateUserSubscription(refreshedUser || user);
      if (!subCheck.allowed) {
        res.status(402).json({
          error: subCheck.reason,
          code: 'SUBSCRIPTION_REQUIRED',
        });
        return;
      }
      ensureWorkspaceForUser(user.id, { full_name: user.full_name, email: user.email });
      recordLoginEvent(req, {
        user: refreshedUser || user,
        identifier: verified.email,
        authMethod: 'google',
        status: 'success',
      });
      notifyLoginEvent(refreshedUser || user, 'google', false);
      res.json(issueSessionForUser(req, res, refreshedUser || user));
      return;
    }

    const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    const role = totalUsers.count === 0 ? 'Administrator' : 'Business Owner';

    let validPassRow: any = null;
    if (role !== 'Administrator') {
      const passCheck = validateBillingPassForUse(String(billingPassCode || ''));
      if (!passCheck.valid || !passCheck.row) {
        res.status(402).json({
          error: passCheck.error || 'Please activate a billing plan (24h Trial, 1 Month, or 1 Year) before signing up.',
          code: 'BILLING_PASS_REQUIRED',
        });
        return;
      }
      validPassRow = passCheck.row;
    }

    // Create a new user account & dedicated workspace linked to Google Sign-In
    const baseUsername = verified.email
      .split('@')[0]
      .replace(/[^a-zA-Z0-9_.-]/g, '')
      .slice(0, 20) || 'user';
    let candidateUsername = baseUsername;
    let suffix = 1;
    while (db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(candidateUsername)) {
      candidateUsername = `${baseUsername}${suffix++}`;
    }

    const { hash, salt } = hashPassword(crypto.randomBytes(32).toString('hex'));

    const newUserId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO users (username, full_name, email, role, password_hash, password_salt, is_default_password, auth_provider, google_uid)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'google', ?)`
        )
        .run(candidateUsername, verified.name, verified.email, role, hash, salt, verified.uid);

      const createdId = Number(info.lastInsertRowid);
      if (validPassRow) {
        attachBillingPassToUser(validPassRow, createdId);
      }
      ensureWorkspaceForUser(createdId, {
        full_name: verified.name,
        email: verified.email,
        profile_completed: 0,
      });
      return createdId;
    })();

    user = db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId);
    recordLoginEvent(req, {
      user,
      identifier: verified.email,
      authMethod: 'google',
      status: 'register',
    });
    recordSystemAudit(user, 'USER_REGISTERED', 'user', newUserId, `New Google workspace registered (@${candidateUsername})`);
    notifyLoginEvent(user, 'google', true);
    res.status(201).json(issueSessionForUser(req, res, user));
  } catch (err: any) {
    recordLoginEvent(req, {
      identifier: 'google-oauth',
      authMethod: 'google',
      status: 'failed',
      failureReason: err.message || 'Google verification failed',
    });
    res.status(401).json({ error: err.message || 'Google authentication verification failed.' });
  }
});

app.post('/api/auth/icloud', async (req, res) => {
  const { idToken, displayName, billingPassCode } = req.body || {};
  if (!idToken || typeof idToken !== 'string') {
    res.status(400).json({ error: 'iCloud / Apple ID token is required.' });
    return;
  }

  try {
    const verified = await verifyFirebaseIdToken(idToken, 'icloud');
    let user = verified.email
      ? (db
          .prepare('SELECT * FROM users WHERE icloud_uid = ? OR LOWER(email) = LOWER(?) LIMIT 1')
          .get(verified.uid, verified.email) as any)
      : (db.prepare('SELECT * FROM users WHERE icloud_uid = ? LIMIT 1').get(verified.uid) as any);

    if (user) {
      if (user.status === 'suspended') {
        recordLoginEvent(req, {
          user,
          identifier: verified.email || user.email,
          authMethod: 'icloud',
          status: 'failed',
          failureReason: 'Account suspended by administrator',
        });
        res.status(403).json({ error: 'This account has been suspended by the system administrator.' });
        return;
      }
      if (!user.icloud_uid) {
        db.prepare('UPDATE users SET icloud_uid = ? WHERE id = ?').run(verified.uid, user.id);
      }
      if (billingPassCode) {
        const passCheck = validateBillingPassForUse(String(billingPassCode));
        if (!passCheck.valid || !passCheck.row) {
          res.status(402).json({ error: passCheck.error || 'Invalid billing pass code.', code: 'SUBSCRIPTION_REQUIRED' });
          return;
        }
        attachBillingPassToUser(passCheck.row, user.id);
      }
      const refreshedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as any;
      const subCheck = evaluateUserSubscription(refreshedUser || user);
      if (!subCheck.allowed) {
        res.status(402).json({
          error: subCheck.reason,
          code: 'SUBSCRIPTION_REQUIRED',
        });
        return;
      }
      ensureWorkspaceForUser(user.id, { full_name: user.full_name, email: user.email });
      recordLoginEvent(req, {
        user: refreshedUser || user,
        identifier: verified.email || user.email,
        authMethod: 'icloud',
        status: 'success',
      });
      notifyLoginEvent(refreshedUser || user, 'icloud', false);
      res.json(issueSessionForUser(req, res, refreshedUser || user));
      return;
    }

    const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    const role = totalUsers.count === 0 ? 'Administrator' : 'Business Owner';

    let validPassRow: any = null;
    if (role !== 'Administrator') {
      const passCheck = validateBillingPassForUse(String(billingPassCode || ''));
      if (!passCheck.valid || !passCheck.row) {
        res.status(402).json({
          error: passCheck.error || 'Please activate a billing plan (24h Trial, 1 Month, or 1 Year) before signing up.',
          code: 'BILLING_PASS_REQUIRED',
        });
        return;
      }
      validPassRow = passCheck.row;
    }

    const effectiveEmail = verified.email || `${verified.uid.slice(0, 12)}@privaterelay.appleid.local`;
    const effectiveName = String(displayName || verified.name || 'iCloud Business Owner').trim();
    const baseUsername =
      effectiveEmail
        .split('@')[0]
        .replace(/[^a-zA-Z0-9_.-]/g, '')
        .slice(0, 20) || 'iclouduser';
    let candidateUsername = baseUsername;
    let suffix = 1;
    while (db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(candidateUsername)) {
      candidateUsername = `${baseUsername}${suffix++}`;
    }

    const { hash, salt } = hashPassword(crypto.randomBytes(32).toString('hex'));

    const newUserId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO users (username, full_name, email, role, password_hash, password_salt, is_default_password, auth_provider, icloud_uid)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'icloud', ?)`
        )
        .run(candidateUsername, effectiveName, effectiveEmail, role, hash, salt, verified.uid);

      const createdId = Number(info.lastInsertRowid);
      if (validPassRow) {
        attachBillingPassToUser(validPassRow, createdId);
      }
      ensureWorkspaceForUser(createdId, {
        full_name: effectiveName,
        email: effectiveEmail,
        profile_completed: 0,
      });
      return createdId;
    })();

    user = db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId);
    recordLoginEvent(req, {
      user,
      identifier: effectiveEmail,
      authMethod: 'icloud',
      status: 'register',
    });
    recordSystemAudit(user, 'USER_REGISTERED', 'user', newUserId, `New iCloud workspace registered (@${candidateUsername})`);
    notifyLoginEvent(user, 'icloud', true);
    res.status(201).json(issueSessionForUser(req, res, user));
  } catch (err: any) {
    recordLoginEvent(req, {
      identifier: 'icloud-oauth',
      authMethod: 'icloud',
      status: 'failed',
      failureReason: err.message || 'iCloud verification failed',
    });
    res.status(401).json({ error: err.message || 'iCloud authentication verification failed.' });
  }
});

app.post('/api/auth/register', (req, res) => {
  const {
    full_name,
    username,
    email,
    password,
    security_question,
    security_answer,
    business_name,
    tagline,
    phone_primary,
    location,
    currency,
    billingPassCode,
  } = req.body || {};

  const cleanName = String(full_name || '').trim();
  const cleanUsername = String(username || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const rawPassword = String(password || '');
  const cleanQuestion = String(security_question || '').trim();
  const cleanAnswer = String(security_answer || '').trim().toLowerCase();
  const cleanBusinessName = String(business_name || '').trim();

  if (cleanName.length < 2) {
    res.status(400).json({ error: 'Please enter your full name.' });
    return;
  }
  if (cleanBusinessName.length < 2) {
    res.status(400).json({ error: 'Please enter your business name (at least 2 characters).' });
    return;
  }
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(cleanUsername)) {
    res.status(400).json({ error: 'Username must be 3–32 characters (letters, numbers, _, ., -).' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (rawPassword.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    return;
  }
  if (cleanQuestion && cleanAnswer.length < 2) {
    res.status(400).json({ error: 'Please provide a security recovery answer (at least 2 characters).' });
    return;
  }

  const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  const role = totalUsers.count === 0 ? 'Administrator' : 'Business Owner';

  let validPassRow: any = null;
  if (role !== 'Administrator') {
    const passCheck = validateBillingPassForUse(String(billingPassCode || ''));
    if (!passCheck.valid || !passCheck.row) {
      res.status(402).json({
        error: passCheck.error || 'Please complete billing selection before creating a business account.',
        code: 'BILLING_PASS_REQUIRED',
      });
      return;
    }
    validPassRow = passCheck.row;
  }

  const existingUsername = db
    .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)')
    .get(cleanUsername);
  if (existingUsername) {
    res.status(409).json({ error: 'That username is already taken. Please choose another.' });
    return;
  }

  const existingEmail = db
    .prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)')
    .get(cleanEmail);
  if (existingEmail) {
    res.status(409).json({ error: 'An account with this email already exists. Try signing in or resetting your password.' });
    return;
  }

  const { hash, salt } = hashPassword(rawPassword);
  const answerHashed = cleanQuestion && cleanAnswer ? hashPassword(cleanAnswer) : { hash: '', salt: '' };
  const recoveryKey = generateRecoveryKey();
  const recoveryHashed = hashPassword(recoveryKey);

  const createTx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO users (
          username, full_name, email, role, password_hash, password_salt, is_default_password,
          auth_provider, security_question, recovery_answer_hash, recovery_answer_salt,
          recovery_key_hash, recovery_key_salt
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 'local', ?, ?, ?, ?, ?)`
      )
      .run(
        cleanUsername,
        cleanName,
        cleanEmail,
        role,
        hash,
        salt,
        cleanQuestion,
        answerHashed.hash,
        answerHashed.salt,
        recoveryHashed.hash,
        recoveryHashed.salt
      );

    const newUserId = Number(info.lastInsertRowid);
    if (validPassRow) {
      attachBillingPassToUser(validPassRow, newUserId);
    }
    ensureWorkspaceForUser(newUserId, {
      business_name: cleanBusinessName,
      tagline: String(tagline || '').trim() || 'Sales, Services & Operations',
      phone_primary: String(phone_primary || '').trim(),
      email: cleanEmail,
      location: String(location || '').trim(),
      currency: String(currency || 'UGX').trim() || 'UGX',
      full_name: cleanName,
      profile_completed: 1,
    });
    return newUserId;
  });

  const newUserId = createTx();
  const createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId) as any;
  recordLoginEvent(req, {
    user: createdUser,
    identifier: cleanUsername,
    authMethod: 'local',
    status: 'register',
  });
  recordSystemAudit(
    createdUser,
    'USER_REGISTERED',
    'user',
    newUserId,
    `New business workspace "${cleanBusinessName}" created by @${cleanUsername}`
  );
  notifyLoginEvent(createdUser, 'local', true);
  const session = issueSessionForUser(req, res, createdUser);
  res.status(201).json({
    ...session,
    recoveryKey,
  });
});

app.post('/api/auth/forgot-password/lookup', (req, res) => {
  const { identifier } = req.body || {};
  const cleanId = String(identifier || '').trim().toLowerCase();
  if (!cleanId) {
    res.status(400).json({ error: 'Please enter your username or email address.' });
    return;
  }

  const user = db
    .prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1')
    .get(cleanId, cleanId) as any;

  if (!user) {
    res.status(404).json({ error: 'No account found matching that username or email.' });
    return;
  }

  res.json({
    found: true,
    maskedEmail: maskEmail(String(user.email || '')),
    hasSecurityQuestion: Boolean(user.security_question && user.recovery_answer_hash),
    securityQuestion: user.security_question || null,
    hasRecoveryKey: Boolean(user.recovery_key_hash),
    canVerifyWithGoogle: Boolean(user.email),
    canVerifyWithICloud: Boolean(user.email || user.icloud_uid),
  });
});

app.post('/api/auth/forgot-password/reset', async (req, res) => {
  const { identifier, method, idToken, securityAnswer, recoveryKey, newPassword } = req.body || {};
  const cleanId = String(identifier || '').trim().toLowerCase();
  const nextPass = String(newPassword || '');

  if (!cleanId) {
    res.status(400).json({ error: 'Username or email is required.' });
    return;
  }
  if (nextPass.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    return;
  }

  const user = db
    .prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1')
    .get(cleanId, cleanId) as any;

  if (!user) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }

  let rotatedRecoveryKey: string | undefined;

  if (method === 'google') {
    try {
      const verified = await verifyFirebaseIdToken(String(idToken || ''));
      if (verified.email.toLowerCase() !== String(user.email || '').toLowerCase()) {
        res.status(403).json({
          error: `Signed-in Google account (${verified.email}) does not match this account's registered email (${maskEmail(user.email)}).`,
        });
        return;
      }
      if (!user.google_uid) {
        db.prepare('UPDATE users SET google_uid = ? WHERE id = ?').run(verified.uid, user.id);
      }
    } catch (err: any) {
      res.status(401).json({ error: err.message || 'Google verification failed.' });
      return;
    }
  } else if (method === 'icloud') {
    try {
      const verified = await verifyFirebaseIdToken(String(idToken || ''), 'icloud');
      const uidMatches = user.icloud_uid && verified.uid === user.icloud_uid;
      const emailMatches =
        verified.email && verified.email.toLowerCase() === String(user.email || '').toLowerCase();
      if (!uidMatches && !emailMatches) {
        res.status(403).json({
          error: `Signed-in iCloud account does not match this account (${maskEmail(user.email)}).`,
        });
        return;
      }
      if (!user.icloud_uid) {
        db.prepare('UPDATE users SET icloud_uid = ? WHERE id = ?').run(verified.uid, user.id);
      }
    } catch (err: any) {
      res.status(401).json({ error: err.message || 'iCloud verification failed.' });
      return;
    }
  } else if (method === 'security_question') {
    if (!user.recovery_answer_hash || !user.recovery_answer_salt) {
      res.status(400).json({ error: 'This account does not have a security question configured.' });
      return;
    }
    const cleanAns = String(securityAnswer || '').trim().toLowerCase();
    if (!cleanAns || !verifyPassword(cleanAns, user.recovery_answer_hash, user.recovery_answer_salt)) {
      res.status(401).json({ error: 'Security answer is incorrect.' });
      return;
    }
  } else if (method === 'recovery_key') {
    if (!user.recovery_key_hash || !user.recovery_key_salt) {
      res.status(400).json({ error: 'This account does not have a recovery key configured.' });
      return;
    }
    const cleanKey = String(recoveryKey || '').trim().toUpperCase();
    if (!cleanKey || !verifyPassword(cleanKey, user.recovery_key_hash, user.recovery_key_salt)) {
      res.status(401).json({ error: 'Invalid personal recovery key.' });
      return;
    }
    rotatedRecoveryKey = generateRecoveryKey();
    const rotatedHashed = hashPassword(rotatedRecoveryKey);
    db.prepare('UPDATE users SET recovery_key_hash = ?, recovery_key_salt = ? WHERE id = ?').run(
      rotatedHashed.hash,
      rotatedHashed.salt,
      user.id
    );
  } else {
    res.status(400).json({ error: 'Please select a valid password reset verification method.' });
    return;
  }

  const { hash, salt } = hashPassword(nextPass);
  db.prepare(
    'UPDATE users SET password_hash = ?, password_salt = ?, is_default_password = 0 WHERE id = ?'
  ).run(hash, salt, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

  recordLoginEvent(req, {
    user,
    identifier: cleanId,
    authMethod: method === 'google' ? 'google' : method === 'icloud' ? 'icloud' : 'local',
    status: 'password_reset',
  });
  recordSystemAudit(user, 'PASSWORD_RESET', 'user', user.id, `Password reset via ${method}`);

  const session = issueSessionForUser(req, res, user);
  res.json({
    ...session,
    newRecoveryKey: rotatedRecoveryKey,
  });
});

app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
  const token = getTokenFromReq(req);
  if (token) {
    const sess = db
      .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
      .get(token) as any;
    if (sess) {
      recordLoginEvent(req, {
        user: sess,
        identifier: sess.username,
        authMethod: sess.auth_provider === 'google' ? 'google' : sess.auth_provider === 'icloud' ? 'icloud' : 'local',
        status: 'logout',
      });
    }
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  setSessionCookie(req, res, '', 0);
  res.json({ ok: true });
});

app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
  const { currentPassword, newPassword, fullName, email, username } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const isExternalProvider = user.auth_provider === 'google' || user.auth_provider === 'icloud';
  if (!isExternalProvider) {
    if (!currentPassword || !verifyPassword(String(currentPassword), user.password_hash, user.password_salt)) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }
  } else if (currentPassword && !verifyPassword(String(currentPassword), user.password_hash, user.password_salt)) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }

  if (newPassword && String(newPassword).length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    return;
  }

  const nextFullName = fullName ? String(fullName).trim() : user.full_name;
  const nextEmail = email ? String(email).trim() : user.email;
  const nextUsername = username ? String(username).trim() : user.username;

  if (newPassword) {
    const { hash, salt } = hashPassword(String(newPassword));
    db.prepare(
      `UPDATE users SET username = ?, full_name = ?, email = ?, password_hash = ?, password_salt = ?, is_default_password = 0 WHERE id = ?`
    ).run(nextUsername, nextFullName, nextEmail, hash, salt, user.id);
  } else {
    db.prepare(`UPDATE users SET username = ?, full_name = ?, email = ? WHERE id = ?`).run(
      nextUsername,
      nextFullName,
      nextEmail,
      user.id
    );
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as any;
  res.json({
    user: mapUserRow(updated),
  });
});

app.post('/api/auth/recovery-settings', requireAuth, (req: AuthenticatedRequest, res) => {
  const { securityQuestion, securityAnswer, regenerateKey } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (securityQuestion !== undefined || securityAnswer !== undefined) {
    const q = String(securityQuestion || '').trim();
    const a = String(securityAnswer || '').trim().toLowerCase();
    if (!q || a.length < 2) {
      res.status(400).json({ error: 'Security question and answer (min 2 characters) are required.' });
      return;
    }
    const hashed = hashPassword(a);
    db.prepare(
      'UPDATE users SET security_question = ?, recovery_answer_hash = ?, recovery_answer_salt = ? WHERE id = ?'
    ).run(q, hashed.hash, hashed.salt, user.id);
  }

  let generatedKey: string | undefined;
  if (regenerateKey) {
    generatedKey = generateRecoveryKey();
    const hashedKey = hashPassword(generatedKey);
    db.prepare('UPDATE users SET recovery_key_hash = ?, recovery_key_salt = ? WHERE id = ?').run(
      hashedKey.hash,
      hashedKey.salt,
      user.id
    );
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as any;
  res.json({
    user: mapUserRow(updated),
    recoveryKey: generatedKey,
  });
});

// Bootstrap endpoint
app.get('/api/bootstrap', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const settings = ensureWorkspaceForUser(userId, {
    full_name: req.user!.full_name,
    email: req.user!.email,
  });
  const products = db
    .prepare('SELECT * FROM products WHERE owner_user_id = ? ORDER BY category ASC, name ASC')
    .all(userId);
  const customers = getCustomersWithAggregates(userId);
  const orders = db
    .prepare('SELECT * FROM orders WHERE owner_user_id = ? ORDER BY id DESC')
    .all(userId);
  const salesRows = db
    .prepare('SELECT * FROM sales WHERE owner_user_id = ? ORDER BY sale_date DESC, id DESC')
    .all(userId);
  const sales = salesRows.map(formatSaleRow);
  const expenses = db
    .prepare('SELECT * FROM expenses WHERE owner_user_id = ? ORDER BY expense_date DESC, id DESC')
    .all(userId);

  res.json({
    settings,
    products,
    customers,
    orders,
    sales,
    expenses,
  });
});

// Settings
app.put('/api/settings', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const b = req.body || {};
  const existing = ensureWorkspaceForUser(userId, {
    full_name: req.user!.full_name,
    email: req.user!.email,
  });

  const nextInactivity =
    b.inactivity_timeout_minutes !== undefined && Number.isFinite(Number(b.inactivity_timeout_minutes))
      ? Math.max(0, Math.min(240, Math.round(Number(b.inactivity_timeout_minutes))))
      : Number(existing.inactivity_timeout_minutes ?? 15);
  const nextProfileCompleted =
    b.profile_completed !== undefined
      ? Number(Boolean(b.profile_completed))
      : String(b.business_name ?? '').trim().length >= 2
      ? 1
      : Number(existing.profile_completed ?? 1);

  db.prepare(`
    UPDATE business_settings SET
      business_name = ?,
      tagline = ?,
      logo_url = ?,
      phone_primary = ?,
      phone_secondary = ?,
      email = ?,
      location = ?,
      currency = ?,
      default_payment_method = ?,
      receipt_template = ?,
      receipt_thank_you = ?,
      receipt_prefix = ?,
      inactivity_timeout_minutes = ?,
      profile_completed = ?,
      updated_at = datetime('now')
    WHERE owner_user_id = ?
  `).run(
    String(b.business_name ?? existing.business_name).trim() || existing.business_name,
    String(b.tagline ?? existing.tagline).trim(),
    String(b.logo_url ?? existing.logo_url).trim() || DEFAULT_LOGO_URL,
    String(b.phone_primary ?? existing.phone_primary).trim(),
    String(b.phone_secondary ?? existing.phone_secondary).trim(),
    String(b.email ?? existing.email).trim(),
    String(b.location ?? existing.location).trim(),
    String(b.currency ?? existing.currency).trim() || 'UGX',
    String(b.default_payment_method ?? existing.default_payment_method),
    String(b.receipt_template ?? existing.receipt_template),
    String(b.receipt_thank_you ?? existing.receipt_thank_you).trim(),
    String(b.receipt_prefix ?? existing.receipt_prefix).trim().toUpperCase() || 'SBM',
    nextInactivity,
    nextProfileCompleted,
    userId
  );

  const updated = db.prepare('SELECT * FROM business_settings WHERE owner_user_id = ?').get(userId);
  res.json(updated);
});

// Products & Services
app.post('/api/products', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { name, category, description, unit_price, production_cost, unit_label, is_active, client_sync_id } = req.body || {};
  if (!name || !category) {
    res.status(400).json({ error: 'Product name and category are required.' });
    return;
  }
  const syncId = String(client_sync_id || `prod-${crypto.randomUUID().slice(0, 12)}`).trim();
  const existingBySync = db
    .prepare('SELECT * FROM products WHERE owner_user_id = ? AND client_sync_id = ?')
    .get(userId, syncId);
  if (existingBySync) {
    res.json(existingBySync);
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO products (owner_user_id, name, category, description, unit_price, production_cost, unit_label, is_active, client_sync_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      String(name).trim(),
      String(category).trim(),
      String(description || '').trim(),
      Math.max(0, Number(unit_price) || 0),
      Math.max(0, Number(production_cost) || 0),
      String(unit_label || 'piece').trim(),
      is_active === undefined ? 1 : Number(Boolean(is_active)),
      syncId
    );

  const created = db.prepare('SELECT * FROM products WHERE id = ? AND owner_user_id = ?').get(info.lastInsertRowid, userId);
  res.status(201).json(created);
});

app.put('/api/products/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ? AND owner_user_id = ?').get(id, userId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  const { name, category, description, unit_price, production_cost, unit_label, is_active } = req.body || {};
  db.prepare(
    `UPDATE products SET
      name = ?, category = ?, description = ?, unit_price = ?, production_cost = ?, unit_label = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ? AND owner_user_id = ?`
  ).run(
    String(name ?? existing.name).trim(),
    String(category ?? existing.category).trim(),
    String(description ?? existing.description).trim(),
    Math.max(0, Number(unit_price ?? existing.unit_price) || 0),
    Math.max(0, Number(production_cost ?? existing.production_cost) || 0),
    String(unit_label ?? existing.unit_label).trim(),
    is_active === undefined ? existing.is_active : Number(Boolean(is_active)),
    id,
    userId
  );
  res.json(db.prepare('SELECT * FROM products WHERE id = ? AND owner_user_id = ?').get(id, userId));
});

app.delete('/api/products/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM products WHERE id = ? AND owner_user_id = ?').run(id, userId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json({ ok: true });
});

// Customers
app.post('/api/customers', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { name, phone, email, location, notes, client_sync_id } = req.body || {};
  if (!name) {
    res.status(400).json({ error: 'Customer name is required.' });
    return;
  }
  const syncId = String(client_sync_id || `cust-${crypto.randomUUID().slice(0, 12)}`).trim();
  const existingBySync = db
    .prepare('SELECT id FROM customers WHERE owner_user_id = ? AND client_sync_id = ?')
    .get(userId, syncId) as { id: number } | undefined;
  if (existingBySync) {
    const existingCust = getCustomersWithAggregates(userId).find((c) => c.id === existingBySync.id);
    res.json(existingCust);
    return;
  }

  const info = db
    .prepare(`INSERT INTO customers (owner_user_id, name, phone, email, location, notes, client_sync_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      userId,
      String(name).trim(),
      String(phone || '').trim(),
      String(email || '').trim(),
      String(location || '').trim(),
      String(notes || '').trim(),
      syncId
    );

  const created = getCustomersWithAggregates(userId).find((c) => c.id === Number(info.lastInsertRowid));
  res.status(201).json(created);
});

app.put('/api/customers/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM customers WHERE id = ? AND owner_user_id = ?').get(id, userId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }
  const { name, phone, email, location, notes } = req.body || {};
  db.prepare(
    `UPDATE customers SET name = ?, phone = ?, email = ?, location = ?, notes = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
  ).run(
    String(name ?? existing.name).trim(),
    String(phone ?? existing.phone).trim(),
    String(email ?? existing.email).trim(),
    String(location ?? existing.location).trim(),
    String(notes ?? existing.notes).trim(),
    id,
    userId
  );
  const updated = getCustomersWithAggregates(userId).find((c) => c.id === id);
  res.json(updated);
});

app.delete('/api/customers/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM customers WHERE id = ? AND owner_user_id = ?').run(id, userId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }
  res.json({ ok: true });
});

// Orders
app.post('/api/orders', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const {
    customer_id,
    customer_name,
    customer_phone,
    title,
    items_summary,
    quantity,
    total_amount,
    deposit_paid,
    status,
    deadline,
    delivery_details,
    instructions,
    client_sync_id,
    order_number: providedOrderNumber,
  } = req.body || {};

  if (!customer_name || !title) {
    res.status(400).json({ error: 'Customer name and order title are required.' });
    return;
  }

  const syncId = String(client_sync_id || `ord-${crypto.randomUUID().slice(0, 12)}`).trim();
  const existingBySync = db
    .prepare('SELECT * FROM orders WHERE owner_user_id = ? AND client_sync_id = ?')
    .get(userId, syncId);
  if (existingBySync) {
    res.json(existingBySync);
    return;
  }

  let validCustomerId: number | null = null;
  if (customer_id) {
    const ownedCust = db
      .prepare('SELECT id FROM customers WHERE id = ? AND owner_user_id = ?')
      .get(Number(customer_id), userId) as { id: number } | undefined;
    validCustomerId = ownedCust ? ownedCust.id : null;
  }

  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM orders WHERE owner_user_id = ?').get(userId) as { cnt: number };
  let seqNum = 1001 + Number(countRow.cnt);
  let orderNumber = providedOrderNumber ? String(providedOrderNumber).trim() : `ORD-${seqNum}`;
  while (db.prepare('SELECT id FROM orders WHERE owner_user_id = ? AND order_number = ?').get(userId, orderNumber)) {
    seqNum += 1;
    orderNumber = `ORD-${seqNum}`;
  }

  const info = db
    .prepare(
      `INSERT INTO orders (
        owner_user_id, order_number, customer_id, customer_name, customer_phone, title,
        items_summary, quantity, total_amount, deposit_paid, status,
        deadline, delivery_details, instructions, client_sync_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      orderNumber,
      validCustomerId,
      String(customer_name).trim(),
      String(customer_phone || '').trim(),
      String(title).trim(),
      String(items_summary || '').trim(),
      Math.max(1, Number(quantity) || 1),
      Math.max(0, Number(total_amount) || 0),
      Math.max(0, Number(deposit_paid) || 0),
      String(status || 'New Order'),
      String(deadline || '').trim(),
      String(delivery_details || '').trim(),
      String(instructions || '').trim(),
      syncId
    );

  const created = db.prepare('SELECT * FROM orders WHERE id = ? AND owner_user_id = ?').get(info.lastInsertRowid, userId);
  notifyNewOrderEvent(userId, created, req.user);
  res.status(201).json(created);
});

app.put('/api/orders/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM orders WHERE id = ? AND owner_user_id = ?').get(id, userId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  const b = req.body || {};
  let nextCustId = existing.customer_id;
  if (b.customer_id !== undefined) {
    if (b.customer_id) {
      const ownedCust = db
        .prepare('SELECT id FROM customers WHERE id = ? AND owner_user_id = ?')
        .get(Number(b.customer_id), userId) as { id: number } | undefined;
      nextCustId = ownedCust ? ownedCust.id : null;
    } else {
      nextCustId = null;
    }
  }

  db.prepare(
    `UPDATE orders SET
      customer_id = ?, customer_name = ?, customer_phone = ?, title = ?,
      items_summary = ?, quantity = ?, total_amount = ?, deposit_paid = ?,
      status = ?, deadline = ?, delivery_details = ?, instructions = ?,
      updated_at = datetime('now')
     WHERE id = ? AND owner_user_id = ?`
  ).run(
    nextCustId,
    String(b.customer_name ?? existing.customer_name).trim(),
    String(b.customer_phone ?? existing.customer_phone).trim(),
    String(b.title ?? existing.title).trim(),
    String(b.items_summary ?? existing.items_summary).trim(),
    Math.max(1, Number(b.quantity ?? existing.quantity) || 1),
    Math.max(0, Number(b.total_amount ?? existing.total_amount) || 0),
    Math.max(0, Number(b.deposit_paid ?? existing.deposit_paid) || 0),
    String(b.status ?? existing.status),
    String(b.deadline ?? existing.deadline).trim(),
    String(b.delivery_details ?? existing.delivery_details).trim(),
    String(b.instructions ?? existing.instructions).trim(),
    id,
    userId
  );
  res.json(db.prepare('SELECT * FROM orders WHERE id = ? AND owner_user_id = ?').get(id, userId));
});

app.delete('/api/orders/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM orders WHERE id = ? AND owner_user_id = ?').run(id, userId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  res.json({ ok: true });
});

// Sales & Receipts
app.post('/api/sales', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const {
    order_id,
    customer_id,
    customer_name,
    customer_phone,
    items,
    discount,
    amount_paid,
    payment_method,
    notes,
    sale_date,
    client_sync_id,
    receipt_number: providedReceiptNumber,
  } = req.body || {};

  if (!customer_name || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Customer name and at least one item are required.' });
    return;
  }

  const syncId = String(client_sync_id || `sale-${crypto.randomUUID().slice(0, 12)}`).trim();
  const existingBySync = db
    .prepare('SELECT * FROM sales WHERE owner_user_id = ? AND client_sync_id = ?')
    .get(userId, syncId);
  if (existingBySync) {
    res.json({
      sale: formatSaleRow(existingBySync),
      customers: getCustomersWithAggregates(userId),
      settings: db.prepare('SELECT * FROM business_settings WHERE owner_user_id = ?').get(userId),
    });
    return;
  }

  const normalizedItems = items.map((item: any) => {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const price = Math.max(0, Number(item.unit_price) || 0);
    const cost = Math.max(0, Number(item.unit_cost) || 0);
    return {
      product_id: item.product_id ? Number(item.product_id) : null,
      product_name: String(item.product_name || 'Service / Product').trim(),
      category: String(item.category || 'Other Printing & Branding').trim(),
      quantity: qty,
      unit_price: price,
      unit_cost: cost,
      line_total: qty * price,
    };
  });

  const subtotal = normalizedItems.reduce((sum: number, i: any) => sum + i.line_total, 0);
  const cleanDiscount = Math.min(subtotal, Math.max(0, Number(discount) || 0));
  const totalAmount = Math.max(0, subtotal - cleanDiscount);
  const cleanPaid = Math.min(totalAmount, Math.max(0, Number(amount_paid) || 0));
  const balanceDue = Math.max(0, totalAmount - cleanPaid);
  const paymentStatus = balanceDue === 0 ? 'Paid' : cleanPaid > 0 ? 'Partially Paid' : 'Unpaid';
  const cleanDate = String(sale_date || new Date().toISOString().slice(0, 10));

  const createSaleTx = db.transaction(() => {
    let resolvedCustomerId: number | null = null;
    if (customer_id) {
      const ownedCust = db
        .prepare('SELECT id FROM customers WHERE id = ? AND owner_user_id = ?')
        .get(Number(customer_id), userId) as { id: number } | undefined;
      resolvedCustomerId = ownedCust ? ownedCust.id : null;
    }

    if (!resolvedCustomerId && customer_name.trim().toLowerCase() !== 'walk-in customer') {
      const existingCust = db
        .prepare('SELECT id FROM customers WHERE owner_user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1')
        .get(userId, customer_name.trim()) as { id: number } | undefined;
      if (existingCust) {
        resolvedCustomerId = existingCust.id;
      } else {
        const custInfo = db
          .prepare('INSERT INTO customers (owner_user_id, name, phone, email, location, notes, client_sync_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(userId, customer_name.trim(), String(customer_phone || '').trim(), '', '', 'Auto-added from sale', `cust-${crypto.randomUUID().slice(0, 12)}`);
        resolvedCustomerId = Number(custInfo.lastInsertRowid);
      }
    }

    let resolvedOrderId: number | null = null;
    if (order_id) {
      const ownedOrder = db
        .prepare('SELECT id FROM orders WHERE id = ? AND owner_user_id = ?')
        .get(Number(order_id), userId) as { id: number } | undefined;
      resolvedOrderId = ownedOrder ? ownedOrder.id : null;
    }

    const settings = ensureWorkspaceForUser(userId, {
      full_name: req.user!.full_name,
      email: req.user!.email,
    });
    const year = new Date().getFullYear();
    let seq = settings?.next_receipt_seq || 1;
    const prefix = settings?.receipt_prefix || 'SBM';

    let receiptNumber = providedReceiptNumber ? String(providedReceiptNumber).trim() : `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
    while (db.prepare('SELECT id FROM sales WHERE owner_user_id = ? AND receipt_number = ?').get(userId, receiptNumber)) {
      seq += 1;
      receiptNumber = `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
    }

    db.prepare('UPDATE business_settings SET next_receipt_seq = MAX(next_receipt_seq + 1, ?) WHERE owner_user_id = ?').run(seq + 1, userId);

    const info = db
      .prepare(
        `INSERT INTO sales (
          owner_user_id, receipt_number, order_id, customer_id, customer_name, customer_phone,
          items_json, subtotal, discount, total_amount, amount_paid, balance_due,
          payment_method, payment_status, notes, sale_date, client_sync_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        receiptNumber,
        resolvedOrderId,
        resolvedCustomerId,
        String(customer_name).trim(),
        String(customer_phone || '').trim(),
        JSON.stringify(normalizedItems),
        subtotal,
        cleanDiscount,
        totalAmount,
        cleanPaid,
        balanceDue,
        String(payment_method || 'Cash'),
        paymentStatus,
        String(notes || '').trim(),
        cleanDate,
        syncId
      );

    const saleId = Number(info.lastInsertRowid);

    if (cleanPaid > 0) {
      db.prepare('INSERT INTO sale_payments (sale_id, amount, payment_method, note) VALUES (?, ?, ?, ?)').run(
        saleId,
        cleanPaid,
        String(payment_method || 'Cash'),
        'Initial payment recorded with sale'
      );
    }

    if (resolvedOrderId) {
      db.prepare("UPDATE orders SET status = ?, deposit_paid = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?").run(
        balanceDue === 0 ? 'Completed' : 'In Production',
        cleanPaid,
        resolvedOrderId,
        userId
      );
    }

    return saleId;
  });

  const saleId = createSaleTx();
  const createdRow = db.prepare('SELECT * FROM sales WHERE id = ? AND owner_user_id = ?').get(saleId, userId);
  const customers = getCustomersWithAggregates(userId);
  const settings = db.prepare('SELECT * FROM business_settings WHERE owner_user_id = ?').get(userId);
  res.status(201).json({
    sale: formatSaleRow(createdRow),
    customers,
    settings,
  });
});

app.post('/api/sales/:id/payments', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const { amount, payment_method, note } = req.body || {};
  const sale = db.prepare('SELECT * FROM sales WHERE id = ? AND owner_user_id = ?').get(id, userId) as any;
  if (!sale) {
    res.status(404).json({ error: 'Sale not found' });
    return;
  }

  const payAmount = Math.max(0, Number(amount) || 0);
  if (payAmount <= 0) {
    res.status(400).json({ error: 'Payment amount must be greater than zero.' });
    return;
  }

  const tx = db.transaction(() => {
    const newPaid = Math.min(Number(sale.total_amount), Number(sale.amount_paid) + payAmount);
    const newBalance = Math.max(0, Number(sale.total_amount) - newPaid);
    const newStatus = newBalance === 0 ? 'Paid' : newPaid > 0 ? 'Partially Paid' : 'Unpaid';

    db.prepare('INSERT INTO sale_payments (sale_id, amount, payment_method, note) VALUES (?, ?, ?, ?)').run(
      id,
      payAmount,
      String(payment_method || sale.payment_method),
      String(note || 'Balance payment').trim()
    );

    db.prepare(
      `UPDATE sales SET amount_paid = ?, balance_due = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
    ).run(newPaid, newBalance, newStatus, id, userId);
  });

  tx();
  const updatedRow = db.prepare('SELECT * FROM sales WHERE id = ? AND owner_user_id = ?').get(id, userId);
  res.json({
    sale: formatSaleRow(updatedRow),
    customers: getCustomersWithAggregates(userId),
  });
});

app.delete('/api/sales/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM sales WHERE id = ? AND owner_user_id = ?').run(id, userId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Sale not found' });
    return;
  }
  res.json({ ok: true, customers: getCustomersWithAggregates(userId) });
});

// Expenses
app.post('/api/expenses', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { title, category, amount, payment_method, vendor, notes, expense_date, client_sync_id } = req.body || {};
  if (!title || !category) {
    res.status(400).json({ error: 'Expense description and category are required.' });
    return;
  }
  const syncId = String(client_sync_id || `exp-${crypto.randomUUID().slice(0, 12)}`).trim();
  const existingBySync = db
    .prepare('SELECT * FROM expenses WHERE owner_user_id = ? AND client_sync_id = ?')
    .get(userId, syncId);
  if (existingBySync) {
    res.json(existingBySync);
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO expenses (owner_user_id, title, category, amount, payment_method, vendor, notes, expense_date, client_sync_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      String(title).trim(),
      String(category).trim(),
      Math.max(0, Number(amount) || 0),
      String(payment_method || 'Cash'),
      String(vendor || '').trim(),
      String(notes || '').trim(),
      String(expense_date || new Date().toISOString().slice(0, 10)),
      syncId
    );
  const created = db.prepare('SELECT * FROM expenses WHERE id = ? AND owner_user_id = ?').get(info.lastInsertRowid, userId);
  res.status(201).json(created);
});

app.put('/api/expenses/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ? AND owner_user_id = ?').get(id, userId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Expense not found' });
    return;
  }
  const b = req.body || {};
  db.prepare(
    `UPDATE expenses SET title = ?, category = ?, amount = ?, payment_method = ?, vendor = ?, notes = ?, expense_date = ? WHERE id = ? AND owner_user_id = ?`
  ).run(
    String(b.title ?? existing.title).trim(),
    String(b.category ?? existing.category).trim(),
    Math.max(0, Number(b.amount ?? existing.amount) || 0),
    String(b.payment_method ?? existing.payment_method),
    String(b.vendor ?? existing.vendor).trim(),
    String(b.notes ?? existing.notes).trim(),
    String(b.expense_date ?? existing.expense_date),
    id,
    userId
  );
  res.json(db.prepare('SELECT * FROM expenses WHERE id = ? AND owner_user_id = ?').get(id, userId));
});

app.delete('/api/expenses/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM expenses WHERE id = ? AND owner_user_id = ?').run(id, userId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Expense not found' });
    return;
  }
  res.json({ ok: true });
});

// Database Backup & Restoration
app.get('/api/backup/export', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const payload = {
    app: 'STANLEY BUSINESS MANAGER',
    version: 2,
    exported_at: new Date().toISOString(),
    data: {
      business_settings: db.prepare('SELECT * FROM business_settings WHERE owner_user_id = ?').all(userId),
      products: db.prepare('SELECT * FROM products WHERE owner_user_id = ?').all(userId),
      customers: db.prepare('SELECT * FROM customers WHERE owner_user_id = ?').all(userId),
      orders: db.prepare('SELECT * FROM orders WHERE owner_user_id = ?').all(userId),
      sales: db.prepare('SELECT * FROM sales WHERE owner_user_id = ?').all(userId),
      sale_payments: db
        .prepare('SELECT sp.* FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE s.owner_user_id = ?')
        .all(userId),
      expenses: db.prepare('SELECT * FROM expenses WHERE owner_user_id = ?').all(userId),
    },
  };
  res.json(payload);
});

// Download Standalone Windows & Android Packaging Kit (.tar.gz)
app.get('/api/download/packaging-kit', requireAuth, (req, res) => {
  const projectRoot = fs.existsSync(path.join(__dirname, 'package.json')) ? __dirname : process.cwd();
  const allowlistedEntries = [
    'package.json',
    'vite.config.ts',
    'tsconfig.json',
    'index.html',
    'metadata.json',
    'capacitor.config.ts',
    'electron-builder.yml',
    'electron',
    'android-templates',
    'chrome-extension',
    '.github',
    'docs',
    'public',
    'src',
    'server.ts',
    'firebase-applet-config.json',
  ].filter((entry) => fs.existsSync(path.join(projectRoot, entry)));

  if (allowlistedEntries.length === 0) {
    res.status(404).json({ error: 'Packaging files not available on this server.' });
    return;
  }

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="stanley-business-manager-packaging-kit.tar.gz"'
  );

  const tar = spawn(
    'tar',
    [
      '-czf',
      '-',
      '--exclude=node_modules',
      '--exclude=dist',
      '--exclude=dev-dist',
      '--exclude=data',
      '--exclude=.env',
      '--exclude=*.db',
      '--exclude=*.db-*',
      ...allowlistedEntries,
    ],
    {
      cwd: projectRoot,
      shell: false,
    }
  );

  let respondedError = false;
  tar.stdout.pipe(res);

  tar.stderr.on('data', () => {
    // Discard non-fatal tar notices to keep stream clean
  });

  tar.on('error', () => {
    if (!respondedError && !res.headersSent) {
      respondedError = true;
      res.status(500).json({ error: 'Unable to package Windows & Android build kit.' });
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  tar.on('close', (code) => {
    if (code !== 0 && !res.headersSent && !respondedError) {
      respondedError = true;
      res.status(500).json({ error: 'Packaging archive creation failed.' });
    }
  });

  req.on('close', () => {
    if (!tar.killed) {
      tar.kill('SIGTERM');
    }
  });
});

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFilesRecursively(baseDir: string, prefix = ''): Array<{ name: string; data: Buffer }> {
  const results: Array<{ name: string; data: Buffer }> = [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(baseDir, entry.name);
    const zipName = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(fullPath, zipName));
    } else if (entry.isFile()) {
      results.push({ name: zipName, data: fs.readFileSync(fullPath) });
    }
  }
  return results;
}

function buildZipBuffer(files: Array<{ name: string; data: Buffer }>): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const compressed = zlib.deflateRawSync(file.data, { level: 9 });
    const useDeflate = compressed.length < file.data.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? compressed : file.data;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // Extra field length

    localChunks.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // Extra length
    centralHeader.writeUInt16LE(0, 32); // Comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number
    centralHeader.writeUInt16LE(0, 36); // Internal attributes
    centralHeader.writeUInt32LE(0, 38); // External attributes
    centralHeader.writeUInt32LE(offset, 42); // Local header offset

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDir, eocd]);
}

// Download Google Chrome Extension (Manifest V3 .zip)
app.get('/api/download/chrome-extension', requireAuth, (_req, res) => {
  const projectRoot = fs.existsSync(path.join(__dirname, 'package.json')) ? __dirname : process.cwd();
  const extDir = path.join(projectRoot, 'chrome-extension');
  if (!fs.existsSync(extDir)) {
    res.status(404).json({ error: 'Chrome extension package is not available on this server.' });
    return;
  }
  try {
    const files = collectFilesRecursively(extDir);
    if (files.length === 0) {
      res.status(404).json({ error: 'Chrome extension directory is empty.' });
      return;
    }
    const zipBuffer = buildZipBuffer(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="stanley-business-manager-chrome-extension.zip"'
    );
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  } catch (err) {
    console.error('Chrome extension ZIP error:', err);
    res.status(500).json({ error: 'Unable to package Chrome extension.' });
  }
});

function findLocalReleaseBinary(
  directories: string[],
  extension: '.exe' | '.apk',
  preferredSubstring?: string
): { filePath: string; filename: string; sizeBytes: number } | null {
  for (const dir of directories) {
    if (!fs.existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = fs
        .readdirSync(dir)
        .filter((name) => name.toLowerCase().endsWith(extension))
        .sort();
    } catch {
      entries = [];
    }
    if (entries.length === 0) continue;
    const chosen =
      (preferredSubstring &&
        entries.find((n) => n.toLowerCase().includes(preferredSubstring.toLowerCase()))) ||
      entries[0];
    const fullPath = path.join(dir, chosen);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        return {
          filePath: fullPath,
          filename: chosen,
          sizeBytes: stat.size,
        };
      }
    } catch {
      // continue searching
    }
  }
  return null;
}

function getReleaseStatus() {
  const projectRoot = fs.existsSync(path.join(__dirname, 'package.json')) ? __dirname : process.cwd();
  const winUrl = String(process.env.WINDOWS_EXE_URL || '').trim();
  const apkUrl = String(process.env.ANDROID_APK_URL || '').trim();

  const localWin = findLocalReleaseBinary(
    [path.join(projectRoot, 'release', 'windows'), path.join(projectRoot, 'public', 'downloads')],
    '.exe',
    'Setup'
  );
  const localApk = findLocalReleaseBinary(
    [
      path.join(projectRoot, 'release', 'android'),
      path.join(projectRoot, 'android', 'app', 'build', 'outputs', 'apk', 'release'),
      path.join(projectRoot, 'public', 'downloads'),
    ],
    '.apk',
    'release'
  );

  return {
    windowsExe: {
      available: Boolean(localWin || winUrl),
      filename: localWin?.filename || 'StanleyBusinessManager-Setup-1.0.0-x64.exe',
      downloadUrl: localWin || winUrl ? '/api/download/windows-exe' : null,
      externalUrl: winUrl || null,
      sizeBytes: localWin?.sizeBytes ?? null,
      source: localWin ? 'local_binary' : winUrl ? 'external_url' : 'packaging_kit',
      localPath: localWin?.filePath ?? null,
    },
    androidApk: {
      available: Boolean(localApk || apkUrl),
      filename: localApk?.filename || 'StanleyBusinessManager-v1.0.0.apk',
      downloadUrl: localApk || apkUrl ? '/api/download/android-apk' : null,
      externalUrl: apkUrl || null,
      sizeBytes: localApk?.sizeBytes ?? null,
      source: localApk ? 'local_binary' : apkUrl ? 'external_url' : 'packaging_kit',
      localPath: localApk?.filePath ?? null,
    },
    packagingKitUrl: '/api/download/packaging-kit',
  };
}

app.get('/api/download/releases', requireAuth, (_req, res) => {
  const status = getReleaseStatus();
  res.json({
    windowsExe: {
      available: status.windowsExe.available,
      filename: status.windowsExe.filename,
      downloadUrl: status.windowsExe.downloadUrl,
      externalUrl: status.windowsExe.externalUrl,
      sizeBytes: status.windowsExe.sizeBytes,
      source: status.windowsExe.source,
    },
    androidApk: {
      available: status.androidApk.available,
      filename: status.androidApk.filename,
      downloadUrl: status.androidApk.downloadUrl,
      externalUrl: status.androidApk.externalUrl,
      sizeBytes: status.androidApk.sizeBytes,
      source: status.androidApk.source,
    },
    packagingKitUrl: status.packagingKitUrl,
  });
});

app.get('/api/download/windows-exe', requireAuth, (_req, res) => {
  const status = getReleaseStatus().windowsExe;
  if (status.localPath && fs.existsSync(status.localPath)) {
    res.download(status.localPath, status.filename);
    return;
  }
  if (status.externalUrl) {
    res.redirect(302, status.externalUrl);
    return;
  }
  res.status(404).json({
    error:
      'No compiled Windows .exe binary is hosted on this server yet. Download the Build Kit (.tar.gz) or install the standalone Windows desktop app directly.',
  });
});

app.get('/api/download/android-apk', requireAuth, (_req, res) => {
  const status = getReleaseStatus().androidApk;
  if (status.localPath && fs.existsSync(status.localPath)) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.download(status.localPath, status.filename);
    return;
  }
  if (status.externalUrl) {
    res.redirect(302, status.externalUrl);
    return;
  }
  res.status(404).json({
    error:
      'No compiled Android .apk binary is hosted on this server yet. Download the Build Kit (.tar.gz) or open the direct link on Android Chrome to install.',
  });
});

app.post('/api/backup/restore', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const backup = req.body;
  if (!backup || backup.app !== 'STANLEY BUSINESS MANAGER' || !backup.data) {
    res.status(400).json({ error: 'Invalid backup file format. Please select a valid Stanley Business Manager JSON backup.' });
    return;
  }

  const d = backup.data;
  const restoreTx = db.transaction(() => {
    db.prepare('DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM sales WHERE owner_user_id = ?)').run(userId);
    db.prepare('DELETE FROM sales WHERE owner_user_id = ?').run(userId);
    db.prepare('DELETE FROM orders WHERE owner_user_id = ?').run(userId);
    db.prepare('DELETE FROM expenses WHERE owner_user_id = ?').run(userId);
    db.prepare('DELETE FROM customers WHERE owner_user_id = ?').run(userId);
    db.prepare('DELETE FROM products WHERE owner_user_id = ?').run(userId);

    ensureWorkspaceForUser(userId, { full_name: req.user!.full_name, email: req.user!.email });
    if (Array.isArray(d.business_settings) && d.business_settings.length > 0) {
      const s = d.business_settings[0];
      db.prepare(`
        UPDATE business_settings SET
          business_name = ?, tagline = ?, logo_url = ?, phone_primary = ?, phone_secondary = ?,
          email = ?, location = ?, currency = ?, default_payment_method = ?, receipt_template = ?,
          receipt_thank_you = ?, receipt_prefix = ?, next_receipt_seq = ?, profile_completed = 1, updated_at = datetime('now')
        WHERE owner_user_id = ?
      `).run(
        s.business_name || 'My Business Studio',
        s.tagline || '',
        s.logo_url || DEFAULT_LOGO_URL,
        s.phone_primary || '',
        s.phone_secondary || '',
        s.email || '',
        s.location || '',
        s.currency || 'UGX',
        s.default_payment_method || 'Mobile Money',
        s.receipt_template || 'executive',
        s.receipt_thank_you || '',
        s.receipt_prefix || 'SBM',
        Number(s.next_receipt_seq) || 1,
        userId
      );
    }

    const insProd = db.prepare(
      'INSERT INTO products (owner_user_id, name, category, description, unit_price, production_cost, unit_label, is_active, client_sync_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const p of d.products || []) {
      insProd.run(
        userId,
        p.name,
        p.category,
        p.description || '',
        p.unit_price || 0,
        p.production_cost || 0,
        p.unit_label || 'pcs',
        p.is_active ?? 1,
        p.client_sync_id || `prod-${crypto.randomUUID().slice(0, 12)}`,
        p.created_at || new Date().toISOString(),
        p.updated_at || new Date().toISOString()
      );
    }

    const custIdMap = new Map<number, number>();
    const insCust = db.prepare(
      'INSERT INTO customers (owner_user_id, name, phone, email, location, notes, client_sync_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const c of d.customers || []) {
      const info = insCust.run(
        userId,
        c.name,
        c.phone || '',
        c.email || '',
        c.location || '',
        c.notes || '',
        c.client_sync_id || `cust-${crypto.randomUUID().slice(0, 12)}`,
        c.created_at || new Date().toISOString(),
        c.updated_at || new Date().toISOString()
      );
      if (c.id !== undefined) custIdMap.set(Number(c.id), Number(info.lastInsertRowid));
    }

    const orderIdMap = new Map<number, number>();
    const insOrd = db.prepare(
      'INSERT INTO orders (owner_user_id, order_number, customer_id, customer_name, customer_phone, title, items_summary, quantity, total_amount, deposit_paid, status, deadline, delivery_details, instructions, client_sync_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const o of d.orders || []) {
      const mappedCustId = o.customer_id ? (custIdMap.get(Number(o.customer_id)) ?? null) : null;
      const info = insOrd.run(
        userId,
        o.order_number,
        mappedCustId,
        o.customer_name,
        o.customer_phone || '',
        o.title,
        o.items_summary || '',
        o.quantity || 1,
        o.total_amount || 0,
        o.deposit_paid || 0,
        o.status || 'New Order',
        o.deadline || '',
        o.delivery_details || '',
        o.instructions || '',
        o.client_sync_id || `ord-${crypto.randomUUID().slice(0, 12)}`,
        o.created_at || new Date().toISOString(),
        o.updated_at || new Date().toISOString()
      );
      if (o.id !== undefined) orderIdMap.set(Number(o.id), Number(info.lastInsertRowid));
    }

    const saleIdMap = new Map<number, number>();
    const insSale = db.prepare(
      'INSERT INTO sales (owner_user_id, receipt_number, order_id, customer_id, customer_name, customer_phone, items_json, subtotal, discount, total_amount, amount_paid, balance_due, payment_method, payment_status, notes, sale_date, client_sync_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const s of d.sales || []) {
      const mappedOrderId = s.order_id ? (orderIdMap.get(Number(s.order_id)) ?? null) : null;
      const mappedCustId = s.customer_id ? (custIdMap.get(Number(s.customer_id)) ?? null) : null;
      const info = insSale.run(
        userId,
        s.receipt_number,
        mappedOrderId,
        mappedCustId,
        s.customer_name,
        s.customer_phone || '',
        s.items_json || '[]',
        s.subtotal || 0,
        s.discount || 0,
        s.total_amount || 0,
        s.amount_paid || 0,
        s.balance_due || 0,
        s.payment_method || 'Cash',
        s.payment_status || 'Paid',
        s.notes || '',
        s.sale_date,
        s.client_sync_id || `sale-${crypto.randomUUID().slice(0, 12)}`,
        s.created_at || new Date().toISOString(),
        s.updated_at || new Date().toISOString()
      );
      if (s.id !== undefined) saleIdMap.set(Number(s.id), Number(info.lastInsertRowid));
    }

    const insPay = db.prepare(
      'INSERT INTO sale_payments (sale_id, amount, payment_method, note, paid_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const sp of d.sale_payments || []) {
      const mappedSaleId = saleIdMap.get(Number(sp.sale_id));
      if (!mappedSaleId) continue;
      insPay.run(mappedSaleId, sp.amount || 0, sp.payment_method || 'Cash', sp.note || '', sp.paid_at || new Date().toISOString());
    }

    const insExp = db.prepare(
      'INSERT INTO expenses (owner_user_id, title, category, amount, payment_method, vendor, notes, expense_date, client_sync_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const e of d.expenses || []) {
      insExp.run(
        userId,
        e.title,
        e.category,
        e.amount || 0,
        e.payment_method || 'Cash',
        e.vendor || '',
        e.notes || '',
        e.expense_date,
        e.client_sync_id || `exp-${crypto.randomUUID().slice(0, 12)}`,
        e.created_at || new Date().toISOString()
      );
    }
  });

  try {
    restoreTx();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: `Failed to restore backup: ${err.message}` });
  }
});

app.post('/api/backup/clear-transactions', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const clearTx = db.transaction(() => {
    db.prepare('DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM sales WHERE owner_user_id = ?)').run(userId);
    db.prepare('DELETE FROM sales WHERE owner_user_id = ?').run(userId);
    db.prepare('DELETE FROM orders WHERE owner_user_id = ?').run(userId);
    db.prepare('DELETE FROM expenses WHERE owner_user_id = ?').run(userId);
    db.prepare('DELETE FROM customers WHERE owner_user_id = ?').run(userId);
    db.prepare('UPDATE business_settings SET next_receipt_seq = 1 WHERE owner_user_id = ?').run(userId);
  });
  clearTx();
  res.json({ ok: true });
});

// Cloud Sync Merge (idempotent conflict resolution using clientSyncId)
app.post('/api/sync/merge-cloud', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { settings, products, customers, orders, sales, expenses } = req.body || {};
  let mergedCount = 0;
  const newlySyncedOrders: number[] = [];

  const mergeTx = db.transaction(() => {
    if (settings && typeof settings === 'object') {
      const existing = ensureWorkspaceForUser(userId, {
        full_name: req.user!.full_name,
        email: req.user!.email,
      });
      if (existing) {
        const nextSeq = Math.max(Number(existing.next_receipt_seq) || 1, Number(settings.next_receipt_seq) || 1);
        db.prepare(`
          UPDATE business_settings SET
            business_name = COALESCE(NULLIF(?, ''), business_name),
            tagline = ?,
            phone_primary = ?,
            phone_secondary = ?,
            email = ?,
            location = ?,
            currency = ?,
            default_payment_method = ?,
            receipt_template = ?,
            receipt_thank_you = ?,
            receipt_prefix = COALESCE(NULLIF(?, ''), receipt_prefix),
            next_receipt_seq = ?,
            profile_completed = 1,
            updated_at = datetime('now')
          WHERE owner_user_id = ?
        `).run(
          String(settings.business_name || ''),
          String(settings.tagline ?? existing.tagline),
          String(settings.phone_primary ?? existing.phone_primary),
          String(settings.phone_secondary ?? existing.phone_secondary),
          String(settings.email ?? existing.email),
          String(settings.location ?? existing.location),
          String(settings.currency || existing.currency),
          String(settings.default_payment_method || existing.default_payment_method),
          String(settings.receipt_template || existing.receipt_template),
          String(settings.receipt_thank_you ?? existing.receipt_thank_you),
          String(settings.receipt_prefix || existing.receipt_prefix),
          nextSeq,
          userId
        );
        mergedCount++;
      }
    }

    for (const p of Array.isArray(products) ? products : []) {
      const syncId = String(p.clientSyncId || p.id || '').trim();
      if (!syncId) continue;
      const existing = db
        .prepare('SELECT * FROM products WHERE owner_user_id = ? AND client_sync_id = ?')
        .get(userId, syncId) as any;
      if (existing) {
        db.prepare(`
          UPDATE products SET name = ?, category = ?, description = ?, unit_price = ?, production_cost = ?, unit_label = ?, is_active = ?, updated_at = datetime('now')
          WHERE id = ? AND owner_user_id = ?
        `).run(
          String(p.name || existing.name),
          String(p.category || existing.category),
          String(p.description || ''),
          Math.max(0, Number(p.unit_price) || 0),
          Math.max(0, Number(p.production_cost) || 0),
          String(p.unit_label || 'piece'),
          p.is_active === false ? 0 : 1,
          existing.id,
          userId
        );
      } else {
        db.prepare(`
          INSERT INTO products (owner_user_id, name, category, description, unit_price, production_cost, unit_label, is_active, client_sync_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          String(p.name || 'Product'),
          String(p.category || 'Other Printing & Branding'),
          String(p.description || ''),
          Math.max(0, Number(p.unit_price) || 0),
          Math.max(0, Number(p.production_cost) || 0),
          String(p.unit_label || 'piece'),
          p.is_active === false ? 0 : 1,
          syncId
        );
      }
      mergedCount++;
    }

    for (const c of Array.isArray(customers) ? customers : []) {
      const syncId = String(c.clientSyncId || c.id || '').trim();
      if (!syncId) continue;
      const existing = db
        .prepare('SELECT * FROM customers WHERE owner_user_id = ? AND client_sync_id = ?')
        .get(userId, syncId) as any;
      if (existing) {
        db.prepare(`UPDATE customers SET name = ?, phone = ?, email = ?, location = ?, notes = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`).run(
          String(c.name || existing.name),
          String(c.phone || ''),
          String(c.email || ''),
          String(c.location || ''),
          String(c.notes || ''),
          existing.id,
          userId
        );
      } else {
        db.prepare(`INSERT INTO customers (owner_user_id, name, phone, email, location, notes, client_sync_id) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          userId,
          String(c.name || 'Customer'),
          String(c.phone || ''),
          String(c.email || ''),
          String(c.location || ''),
          String(c.notes || ''),
          syncId
        );
      }
      mergedCount++;
    }

    for (const o of Array.isArray(orders) ? orders : []) {
      const syncId = String(o.clientSyncId || o.id || '').trim();
      if (!syncId) continue;
      const existing = db
        .prepare('SELECT * FROM orders WHERE owner_user_id = ? AND (client_sync_id = ? OR order_number = ?)')
        .get(userId, syncId, String(o.order_number || '')) as any;
      if (existing) {
        db.prepare(`
          UPDATE orders SET customer_name = ?, customer_phone = ?, title = ?, items_summary = ?, quantity = ?, total_amount = ?, deposit_paid = ?, status = ?, deadline = ?, delivery_details = ?, instructions = ?, updated_at = datetime('now')
          WHERE id = ? AND owner_user_id = ?
        `).run(
          String(o.customer_name || existing.customer_name),
          String(o.customer_phone || ''),
          String(o.title || existing.title),
          String(o.items_summary || ''),
          Math.max(1, Number(o.quantity) || 1),
          Math.max(0, Number(o.total_amount) || 0),
          Math.max(0, Number(o.deposit_paid) || 0),
          String(o.status || existing.status),
          String(o.deadline || ''),
          String(o.delivery_details || ''),
          String(o.instructions || ''),
          existing.id,
          userId
        );
      } else {
        const orderNum = String(o.order_number || `ORD-${Date.now().toString().slice(-5)}`);
        const ordInfo = db.prepare(`
          INSERT INTO orders (owner_user_id, order_number, customer_id, customer_name, customer_phone, title, items_summary, quantity, total_amount, deposit_paid, status, deadline, delivery_details, instructions, client_sync_id)
          VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          orderNum,
          String(o.customer_name || 'Customer'),
          String(o.customer_phone || ''),
          String(o.title || 'Order'),
          String(o.items_summary || ''),
          Math.max(1, Number(o.quantity) || 1),
          Math.max(0, Number(o.total_amount) || 0),
          Math.max(0, Number(o.deposit_paid) || 0),
          String(o.status || 'New Order'),
          String(o.deadline || ''),
          String(o.delivery_details || ''),
          String(o.instructions || ''),
          syncId
        );
        newlySyncedOrders.push(Number(ordInfo.lastInsertRowid));
      }
      mergedCount++;
    }

    for (const s of Array.isArray(sales) ? sales : []) {
      const syncId = String(s.clientSyncId || s.id || '').trim();
      if (!syncId) continue;
      const existing = db
        .prepare('SELECT * FROM sales WHERE owner_user_id = ? AND (client_sync_id = ? OR receipt_number = ?)')
        .get(userId, syncId, String(s.receipt_number || '')) as any;
      const itemsJson = JSON.stringify(Array.isArray(s.items) ? s.items : []);
      if (existing) {
        db.prepare(`
          UPDATE sales SET customer_name = ?, customer_phone = ?, items_json = ?, subtotal = ?, discount = ?, total_amount = ?, amount_paid = ?, balance_due = ?, payment_method = ?, payment_status = ?, notes = ?, sale_date = ?, updated_at = datetime('now')
          WHERE id = ? AND owner_user_id = ?
        `).run(
          String(s.customer_name || existing.customer_name),
          String(s.customer_phone || ''),
          itemsJson,
          Math.max(0, Number(s.subtotal) || 0),
          Math.max(0, Number(s.discount) || 0),
          Math.max(0, Number(s.total_amount) || 0),
          Math.max(0, Number(s.amount_paid) || 0),
          Math.max(0, Number(s.balance_due) || 0),
          String(s.payment_method || existing.payment_method),
          String(s.payment_status || existing.payment_status),
          String(s.notes || ''),
          String(s.sale_date || existing.sale_date),
          existing.id,
          userId
        );
      } else {
        const receiptNum = String(s.receipt_number || `SBM-CLD-${Date.now().toString().slice(-6)}`);
        db.prepare(`
          INSERT INTO sales (owner_user_id, receipt_number, order_id, customer_id, customer_name, customer_phone, items_json, subtotal, discount, total_amount, amount_paid, balance_due, payment_method, payment_status, notes, sale_date, client_sync_id)
          VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          receiptNum,
          String(s.customer_name || 'Walk-in Customer'),
          String(s.customer_phone || ''),
          itemsJson,
          Math.max(0, Number(s.subtotal) || 0),
          Math.max(0, Number(s.discount) || 0),
          Math.max(0, Number(s.total_amount) || 0),
          Math.max(0, Number(s.amount_paid) || 0),
          Math.max(0, Number(s.balance_due) || 0),
          String(s.payment_method || 'Cash'),
          String(s.payment_status || 'Paid'),
          String(s.notes || ''),
          String(s.sale_date || new Date().toISOString().slice(0, 10)),
          syncId
        );
      }
      mergedCount++;
    }

    for (const e of Array.isArray(expenses) ? expenses : []) {
      const syncId = String(e.clientSyncId || e.id || '').trim();
      if (!syncId) continue;
      const existing = db
        .prepare('SELECT * FROM expenses WHERE owner_user_id = ? AND client_sync_id = ?')
        .get(userId, syncId) as any;
      if (existing) {
        db.prepare(`
          UPDATE expenses SET title = ?, category = ?, amount = ?, payment_method = ?, vendor = ?, notes = ?, expense_date = ?
          WHERE id = ? AND owner_user_id = ?
        `).run(
          String(e.title || existing.title),
          String(e.category || existing.category),
          Math.max(0, Number(e.amount) || 0),
          String(e.payment_method || existing.payment_method),
          String(e.vendor || ''),
          String(e.notes || ''),
          String(e.expense_date || existing.expense_date),
          existing.id,
          userId
        );
      } else {
        db.prepare(`
          INSERT INTO expenses (owner_user_id, title, category, amount, payment_method, vendor, notes, expense_date, client_sync_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          String(e.title || 'Business Expense'),
          String(e.category || 'Other Business Expenses'),
          Math.max(0, Number(e.amount) || 0),
          String(e.payment_method || 'Cash'),
          String(e.vendor || ''),
          String(e.notes || ''),
          String(e.expense_date || new Date().toISOString().slice(0, 10)),
          syncId
        );
      }
      mergedCount++;
    }
  });

  mergeTx();
  for (const newOrderId of newlySyncedOrders) {
    const syncedOrder = db
      .prepare('SELECT * FROM orders WHERE id = ? AND owner_user_id = ?')
      .get(newOrderId, userId);
    if (syncedOrder) {
      notifyNewOrderEvent(userId, syncedOrder, req.user);
    }
  }
  res.json({ ok: true, mergedCount });
});

// ============================================================================
// Billing & Mobile Money Subscription Endpoints (Airtel & MTN)
// ============================================================================
app.get('/api/billing/plans', (_req, res) => {
  res.json({
    plans: BILLING_PLANS,
    mobileMoney: MOBILE_MONEY_ACCOUNTS,
  });
});

app.get('/api/billing/pass/:passCode', (req, res) => {
  const cleanCode = String(req.params.passCode || '').trim().toUpperCase();
  if (!cleanCode) {
    res.status(400).json({ error: 'Billing pass code is required.' });
    return;
  }
  const row = db
    .prepare('SELECT * FROM billing_subscriptions WHERE UPPER(pass_code) = ? LIMIT 1')
    .get(cleanCode) as any;
  if (!row) {
    res.status(404).json({ valid: false, error: 'Billing pass not found.' });
    return;
  }
  const expired = row.status === 'expired' || new Date(row.expires_at).getTime() <= Date.now();
  const valid = !expired && row.status !== 'rejected';
  res.json({
    valid,
    claimed: row.user_id !== null && row.user_id !== undefined,
    subscription: {
      pass_code: row.pass_code,
      plan_code: row.plan_code,
      plan_name: row.plan_name,
      amount_ugx: Number(row.amount_ugx || 0),
      payment_provider: row.payment_provider,
      recipient_number: row.recipient_number,
      payer_name: row.payer_name,
      status: expired ? 'expired' : row.status,
      starts_at: row.starts_at,
      expires_at: row.expires_at,
    },
  });
});

app.post('/api/billing/checkout', (req, res) => {
  const { planCode, paymentProvider, payerPhone, payerName, transactionId, notes } = req.body || {};
  const plan = getBillingPlanByCode(String(planCode || '').trim());
  if (!plan) {
    res.status(400).json({ error: 'Please select a valid plan (24h Trial, 1 Month, or 1 Year).' });
    return;
  }

  const cleanPhone = normalizePhoneDigits(String(payerPhone || ''));
  const cleanPayerName = String(payerName || '').trim().slice(0, 120);
  const cleanNotes = String(notes || '').trim().slice(0, 300);

  if (plan.code === 'trial_24h') {
    if (cleanPhone.replace(/\D/g, '').length < 9 && cleanPayerName.length < 2) {
      res.status(400).json({ error: 'Please enter your phone number or business/full name to start the 24-hour free trial.' });
      return;
    }
    if (cleanPhone) {
      const existingTrial = db
        .prepare(
          `SELECT * FROM billing_subscriptions
           WHERE plan_code = 'trial_24h' AND payer_phone = ? AND status != 'rejected'
           ORDER BY id DESC LIMIT 1`
        )
        .get(cleanPhone) as any;
      if (existingTrial) {
        const stillValid = new Date(existingTrial.expires_at).getTime() > Date.now();
        if (stillValid && existingTrial.user_id == null) {
          res.json({
            passCode: existingTrial.pass_code,
            subscription: existingTrial,
            resumed: true,
          });
          return;
        }
        res.status(409).json({
          error: 'A 24-hour free trial was already used for this phone number. Please subscribe to the 1 Month (UGX 10,000) or 1 Year (UGX 100,000) plan via Airtel or MTN Mobile Money.',
        });
        return;
      }
    }

    const now = new Date();
    const expires = new Date(now.getTime() + plan.durationHours * 3600 * 1000);
    const passCode = generateBillingPassCode();
    const info = db
      .prepare(
        `INSERT INTO billing_subscriptions (
          pass_code, plan_code, plan_name, amount_ugx, payment_provider, recipient_number,
          payer_phone, payer_name, transaction_id, status, starts_at, expires_at, notes
        ) VALUES (?, ?, ?, 0, 'trial', '', ?, ?, '', 'active', ?, ?, ?)`
      )
      .run(
        passCode,
        plan.code,
        plan.name,
        cleanPhone,
        cleanPayerName || '24h Trial User',
        now.toISOString(),
        expires.toISOString(),
        cleanNotes
      );
    const created = db.prepare('SELECT * FROM billing_subscriptions WHERE id = ?').get(info.lastInsertRowid) as any;
    notifyBillingEvent(created);
    res.status(201).json({ passCode, subscription: created });
    return;
  }

  // Paid Mobile Money plans: monthly_1m (10,000 UGX) or annual_1y (100,000 UGX)
  const providerKey = String(paymentProvider || '').trim().toLowerCase();
  if (providerKey !== 'airtel' && providerKey !== 'mtn') {
    res.status(400).json({ error: 'Please select Airtel Money or MTN Mobile Money as your payment network.' });
    return;
  }
  const accountInfo = MOBILE_MONEY_ACCOUNTS[providerKey];

  if (cleanPhone.replace(/\D/g, '').length < 9) {
    res.status(400).json({ error: 'Please enter the Mobile Money phone number you paid from (e.g. +256 7XX XXX XXX).' });
    return;
  }
  const cleanTx = String(transactionId || '').trim().toUpperCase();
  if (!/^[A-Z0-9\-_.]{6,48}$/.test(cleanTx)) {
    res.status(400).json({ error: 'Please enter the valid Mobile Money Transaction ID / Reference from your confirmation SMS (6–48 characters).' });
    return;
  }

  const dupTx = db
    .prepare('SELECT id FROM billing_subscriptions WHERE payment_provider = ? AND LOWER(transaction_id) = LOWER(?) LIMIT 1')
    .get(providerKey, cleanTx);
  if (dupTx) {
    res.status(409).json({ error: 'This Mobile Money Transaction ID has already been submitted.' });
    return;
  }

  const now = new Date();
  const expires = new Date(now.getTime() + plan.durationHours * 3600 * 1000);
  const passCode = generateBillingPassCode();

  const info = db
    .prepare(
      `INSERT INTO billing_subscriptions (
        pass_code, plan_code, plan_name, amount_ugx, payment_provider, recipient_number,
        payer_phone, payer_name, transaction_id, status, starts_at, expires_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification', ?, ?, ?)`
    )
    .run(
      passCode,
      plan.code,
      plan.name,
      plan.priceUgx,
      providerKey,
      accountInfo.phone,
      cleanPhone,
      cleanPayerName || cleanPhone,
      cleanTx,
      now.toISOString(),
      expires.toISOString(),
      cleanNotes
    );

  const created = db.prepare('SELECT * FROM billing_subscriptions WHERE id = ?').get(info.lastInsertRowid) as any;
  notifyBillingEvent(created);
  res.status(201).json({ passCode, subscription: created });
});

app.get('/api/billing/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  const history = db
    .prepare('SELECT * FROM billing_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 25')
    .all(req.user!.id);
  res.json({
    subscription: {
      plan: userRow?.subscription_plan || 'legacy',
      status: userRow?.subscription_status || 'active',
      expires_at: userRow?.subscription_expires_at ?? null,
    },
    history,
    plans: BILLING_PLANS,
    mobileMoney: MOBILE_MONEY_ACCOUNTS,
  });
});

app.post('/api/billing/renew', requireAuth, (req: AuthenticatedRequest, res) => {
  const { planCode, paymentProvider, payerPhone, payerName, transactionId, notes } = req.body || {};
  const plan = getBillingPlanByCode(String(planCode || '').trim());
  if (!plan || plan.code === 'trial_24h') {
    res.status(400).json({ error: 'Please select 1 Month (UGX 10,000) or 1 Year (UGX 100,000) to renew.' });
    return;
  }
  const providerKey = String(paymentProvider || '').trim().toLowerCase();
  if (providerKey !== 'airtel' && providerKey !== 'mtn') {
    res.status(400).json({ error: 'Please select Airtel Money or MTN Mobile Money.' });
    return;
  }
  const cleanPhone = normalizePhoneDigits(String(payerPhone || ''));
  if (cleanPhone.replace(/\D/g, '').length < 9) {
    res.status(400).json({ error: 'Please enter the Mobile Money phone number you paid from.' });
    return;
  }
  const cleanTx = String(transactionId || '').trim().toUpperCase();
  if (!/^[A-Z0-9\-_.]{6,48}$/.test(cleanTx)) {
    res.status(400).json({ error: 'Please enter a valid Mobile Money Transaction ID (6–48 characters).' });
    return;
  }
  const dupTx = db
    .prepare('SELECT id FROM billing_subscriptions WHERE payment_provider = ? AND LOWER(transaction_id) = LOWER(?) LIMIT 1')
    .get(providerKey, cleanTx);
  if (dupTx) {
    res.status(409).json({ error: 'This Mobile Money Transaction ID has already been submitted.' });
    return;
  }

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  const currentExpMs = userRow?.subscription_expires_at ? new Date(userRow.subscription_expires_at).getTime() : 0;
  const baseMs = Math.max(Date.now(), Number.isNaN(currentExpMs) ? 0 : currentExpMs);
  const startsAt = new Date().toISOString();
  const expiresAt = new Date(baseMs + plan.durationHours * 3600 * 1000).toISOString();
  const passCode = generateBillingPassCode();
  const accountInfo = MOBILE_MONEY_ACCOUNTS[providerKey];

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO billing_subscriptions (
          pass_code, user_id, plan_code, plan_name, amount_ugx, payment_provider, recipient_number,
          payer_phone, payer_name, transaction_id, status, starts_at, expires_at, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification', ?, ?, ?)`
      )
      .run(
        passCode,
        req.user!.id,
        plan.code,
        plan.name,
        plan.priceUgx,
        providerKey,
        accountInfo.phone,
        cleanPhone,
        String(payerName || req.user!.full_name).trim(),
        cleanTx,
        startsAt,
        expiresAt,
        String(notes || '').trim().slice(0, 300)
      );
    db.prepare(
      `UPDATE users SET subscription_plan = ?, subscription_status = 'pending_verification', subscription_expires_at = ?, active_billing_id = ? WHERE id = ?`
    ).run(plan.code, expiresAt, info.lastInsertRowid, req.user!.id);
    return Number(info.lastInsertRowid);
  });

  const subId = tx();
  const created = db.prepare('SELECT * FROM billing_subscriptions WHERE id = ?').get(subId) as any;
  notifyBillingEvent(created);
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  res.status(201).json({
    subscription: created,
    user: mapUserRow(updatedUser),
  });
});

// ============================================================================
// Administrator Monitoring & System Management Endpoints (Strict Admin Only)
// ============================================================================
app.get('/api/admin/overview', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const users = db
    .prepare(
      `SELECT
        u.id,
        u.username,
        u.full_name,
        u.email,
        u.role,
        u.auth_provider,
        u.status,
        u.last_login_at,
        u.created_at,
        u.subscription_plan,
        u.subscription_status,
        u.subscription_expires_at,
        COALESCE(bs.business_name, 'Unconfigured Workspace') AS business_name,
        COALESCE(bs.location, '') AS location,
        COALESCE(bs.currency, 'UGX') AS currency,
        COALESCE(bs.profile_completed, 0) AS profile_completed,
        (SELECT COUNT(*) FROM sales s WHERE s.owner_user_id = u.id) AS sales_count,
        (SELECT COUNT(*) FROM orders o WHERE o.owner_user_id = u.id) AS orders_count,
        (SELECT COUNT(*) FROM customers c WHERE c.owner_user_id = u.id) AS customers_count,
        (SELECT COUNT(*) FROM expenses e WHERE e.owner_user_id = u.id) AS expenses_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM sales s WHERE s.owner_user_id = u.id) AS total_sales_amount,
        (SELECT COUNT(*) FROM sessions sess WHERE sess.user_id = u.id AND datetime(sess.expires_at) > datetime('now')) AS active_sessions_count,
        (SELECT COUNT(*) FROM login_events le WHERE le.user_id = u.id AND le.status IN ('success', 'register')) AS login_count
       FROM users u
       LEFT JOIN business_settings bs ON bs.owner_user_id = u.id
       ORDER BY u.id ASC`
    )
    .all()
    .map((row: any) => ({
      id: row.id,
      username: row.username,
      full_name: row.full_name,
      email: row.email,
      role: row.role,
      auth_provider: row.auth_provider || 'local',
      status: row.status === 'suspended' ? 'suspended' : 'active',
      last_login_at: row.last_login_at ?? null,
      created_at: row.created_at,
      subscription_plan: row.subscription_plan || 'legacy',
      subscription_status: row.subscription_status || 'active',
      subscription_expires_at: row.subscription_expires_at ?? null,
      business_name: row.business_name,
      location: row.location,
      currency: row.currency,
      profile_completed: Boolean(row.profile_completed),
      sales_count: Number(row.sales_count || 0),
      orders_count: Number(row.orders_count || 0),
      customers_count: Number(row.customers_count || 0),
      expenses_count: Number(row.expenses_count || 0),
      total_sales_amount: Number(row.total_sales_amount || 0),
      active_sessions_count: Number(row.active_sessions_count || 0),
      login_count: Number(row.login_count || 0),
    }));

  const loginEvents = db
    .prepare(
      `SELECT id, user_id, identifier, username, full_name, email, auth_method, status, failure_reason, ip_address, user_agent, created_at
       FROM login_events
       ORDER BY id DESC
       LIMIT 200`
    )
    .all();

  const currentToken = req.sessionToken || '';
  const activeSessions = db
    .prepare(
      `SELECT
        s.rowid AS session_id,
        substr(s.token, 1, 8) AS token_prefix,
        s.user_id,
        s.created_at,
        s.expires_at,
        CASE WHEN s.token = ? THEN 1 ELSE 0 END AS is_current,
        u.username,
        u.full_name,
        u.email,
        u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE datetime(s.expires_at) > datetime('now')
       ORDER BY s.created_at DESC`
    )
    .all(currentToken)
    .map((s: any) => ({
      session_id: Number(s.session_id),
      token_prefix: `${s.token_prefix}...`,
      user_id: Number(s.user_id),
      username: s.username,
      full_name: s.full_name,
      email: s.email,
      role: s.role,
      is_current: Boolean(s.is_current),
      created_at: s.created_at,
      expires_at: s.expires_at,
    }));

  const auditLogs = db
    .prepare(
      `SELECT id, actor_user_id, actor_username, action, target_type, target_id, details, created_at
       FROM system_audit_logs
       ORDER BY id DESC
       LIMIT 120`
    )
    .all();

  const billingSubscriptions = db
    .prepare(
      `SELECT
        b.*,
        u.username AS username,
        u.full_name AS user_full_name,
        u.email AS user_email
       FROM billing_subscriptions b
       LEFT JOIN users u ON u.id = b.user_id
       ORDER BY b.id DESC
       LIMIT 200`
    )
    .all();

  const counts = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
        (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspended_users,
        (SELECT COUNT(*) FROM sessions WHERE datetime(expires_at) > datetime('now')) AS active_sessions,
        (SELECT COUNT(*) FROM sessions WHERE datetime(expires_at) <= datetime('now')) AS expired_sessions,
        (SELECT COUNT(*) FROM login_events WHERE status IN ('success', 'register') AND datetime(created_at) >= datetime('now', '-1 day')) AS logins_24h,
        (SELECT COUNT(*) FROM login_events WHERE status = 'failed' AND datetime(created_at) >= datetime('now', '-1 day')) AS failed_24h,
        (SELECT COUNT(*) FROM business_settings) AS total_workspaces,
        (SELECT COUNT(*) FROM products) AS total_products,
        (SELECT COUNT(*) FROM sales) AS total_sales,
        (SELECT COUNT(*) FROM orders) AS total_orders,
        (SELECT COUNT(*) FROM customers) AS total_customers,
        (SELECT COUNT(*) FROM expenses) AS total_expenses,
        (SELECT COALESCE(SUM(amount_ugx), 0) FROM billing_subscriptions WHERE status IN ('verified', 'active', 'pending_verification') AND amount_ugx > 0) AS billing_revenue_ugx,
        (SELECT COUNT(*) FROM billing_subscriptions WHERE status = 'pending_verification') AS pending_billing_count,
        (SELECT COUNT(*) FROM billing_subscriptions WHERE plan_code = 'trial_24h' AND status = 'active' AND datetime(expires_at) > datetime('now')) AS active_trials_count`
    )
    .get() as any;

  let databaseSizeBytes = 0;
  try {
    databaseSizeBytes = fs.statSync(DB_PATH).size;
  } catch {
    databaseSizeBytes = 0;
  }

  res.json({
    summary: {
      totalUsers: Number(counts.total_users || 0),
      activeUsers: Number(counts.active_users || 0),
      suspendedUsers: Number(counts.suspended_users || 0),
      activeSessions: Number(counts.active_sessions || 0),
      expiredSessions: Number(counts.expired_sessions || 0),
      logins24h: Number(counts.logins_24h || 0),
      failedLogins24h: Number(counts.failed_24h || 0),
      totalWorkspaces: Number(counts.total_workspaces || 0),
      totalProductsCount: Number(counts.total_products || 0),
      totalSalesCount: Number(counts.total_sales || 0),
      totalOrdersCount: Number(counts.total_orders || 0),
      totalCustomersCount: Number(counts.total_customers || 0),
      totalExpensesCount: Number(counts.total_expenses || 0),
      databaseSizeBytes,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      serverTime: new Date().toISOString(),
      billingRevenueUgx: Number(counts.billing_revenue_ugx || 0),
      pendingBillingCount: Number(counts.pending_billing_count || 0),
      activeTrialsCount: Number(counts.active_trials_count || 0),
    },
    users,
    loginEvents,
    activeSessions,
    auditLogs,
    billingSubscriptions,
  });
});

app.post('/api/admin/billing/:id/verify', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const billingId = Number(req.params.id);
  const action = req.body?.action === 'rejected' ? 'rejected' : req.body?.action === 'verified' ? 'verified' : null;
  if (!Number.isInteger(billingId) || !action) {
    res.status(400).json({ error: 'Valid billing ID and action (verified | rejected) are required.' });
    return;
  }

  const row = db.prepare('SELECT * FROM billing_subscriptions WHERE id = ?').get(billingId) as any;
  if (!row) {
    res.status(404).json({ error: 'Billing record not found.' });
    return;
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE billing_subscriptions SET status = ?, reviewed_by_user_id = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).run(action, req.user!.id, billingId);

    if (row.user_id) {
      db.prepare('UPDATE users SET subscription_status = ? WHERE id = ?').run(
        action === 'verified' ? 'active' : 'rejected',
        row.user_id
      );
      if (action === 'rejected') {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
      }
    }
  })();

  if (row.user_id) {
    createAndBroadcastNotification({
      targetUserId: Number(row.user_id),
      type: 'billing',
      title: action === 'verified' ? 'Mobile Money Payment Verified' : 'Mobile Money Payment Rejected',
      message:
        action === 'verified'
          ? `Your ${row.plan_name} payment (${row.transaction_id || row.pass_code}) has been verified.`
          : `Your ${row.plan_name} payment (${row.transaction_id || row.pass_code}) could not be verified. Please submit a valid payment.`,
      actorUserId: req.user!.id,
      actorName: req.user!.full_name,
      relatedEntityType: 'billing',
      relatedEntityId: billingId,
    });
  }

  recordSystemAudit(
    req.user!,
    action === 'verified' ? 'BILLING_VERIFIED' : 'BILLING_REJECTED',
    'billing',
    billingId,
    `${action === 'verified' ? 'Verified' : 'Rejected'} ${row.plan_name} (${row.payment_provider} ${row.transaction_id || row.pass_code})`
  );

  res.json({ ok: true, status: action });
});

app.post('/api/admin/users/:id/status', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  const nextStatus = req.body?.status === 'suspended' ? 'suspended' : req.body?.status === 'active' ? 'active' : null;
  if (!Number.isInteger(targetId) || !nextStatus) {
    res.status(400).json({ error: 'Valid user ID and status (active | suspended) are required.' });
    return;
  }
  if (targetId === req.user!.id) {
    res.status(400).json({ error: 'You cannot suspend your own administrator account.' });
    return;
  }

  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId) as any;
  if (!target) {
    res.status(404).json({ error: 'User account not found.' });
    return;
  }

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(nextStatus, targetId);
  if (nextStatus === 'suspended') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
  }

  recordSystemAudit(
    req.user!,
    nextStatus === 'suspended' ? 'USER_SUSPENDED' : 'USER_ACTIVATED',
    'user',
    targetId,
    `${nextStatus === 'suspended' ? 'Suspended' : 'Reactivated'} account @${target.username}`
  );
  res.json({ ok: true, status: nextStatus });
});

app.post('/api/admin/users/:id/role', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  const allowedRoles = ['Administrator', 'Business Owner', 'Staff'];
  const nextRole = String(req.body?.role || '');
  if (!Number.isInteger(targetId) || !allowedRoles.includes(nextRole)) {
    res.status(400).json({ error: 'Valid user ID and role are required.' });
    return;
  }
  if (targetId === req.user!.id && nextRole !== 'Administrator') {
    res.status(400).json({ error: 'You cannot remove your own Administrator role.' });
    return;
  }

  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId) as any;
  if (!target) {
    res.status(404).json({ error: 'User account not found.' });
    return;
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(nextRole, targetId);
  recordSystemAudit(
    req.user!,
    'ROLE_CHANGED',
    'user',
    targetId,
    `Changed role for @${target.username} from ${target.role} to ${nextRole}`
  );
  res.json({ ok: true, role: nextRole });
});

app.post('/api/admin/users/:id/revoke-sessions', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId)) {
    res.status(400).json({ error: 'Invalid user ID.' });
    return;
  }

  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId) as any;
  if (!target) {
    res.status(404).json({ error: 'User account not found.' });
    return;
  }

  const info =
    targetId === req.user!.id
      ? db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(targetId, req.sessionToken || '')
      : db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);

  recordSystemAudit(
    req.user!,
    'SESSIONS_REVOKED',
    'user',
    targetId,
    `Revoked ${info.changes} active session(s) for @${target.username}`
  );
  res.json({ ok: true, revokedCount: info.changes });
});

app.delete('/api/admin/sessions/:sessionId', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const sessionRowId = Number(req.params.sessionId);
  if (!Number.isInteger(sessionRowId)) {
    res.status(400).json({ error: 'Invalid session ID.' });
    return;
  }

  const target = db
    .prepare('SELECT s.rowid, s.token, s.user_id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.rowid = ?')
    .get(sessionRowId) as any;

  if (!target) {
    res.status(404).json({ error: 'Session not found or already closed.' });
    return;
  }
  if (target.token === req.sessionToken) {
    res.status(400).json({ error: 'Cannot revoke your own active session from here.' });
    return;
  }

  db.prepare('DELETE FROM sessions WHERE rowid = ?').run(sessionRowId);
  recordSystemAudit(
    req.user!,
    'SESSION_REVOKED',
    'session',
    sessionRowId,
    `Terminated session #${sessionRowId} for @${target.username}`
  );
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId)) {
    res.status(400).json({ error: 'Invalid user ID.' });
    return;
  }
  if (targetId === req.user!.id) {
    res.status(400).json({ error: 'You cannot delete your own administrator account.' });
    return;
  }

  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId) as any;
  if (!target) {
    res.status(404).json({ error: 'User account not found.' });
    return;
  }
  if (target.role === 'Administrator') {
    res.status(400).json({ error: 'Demote an Administrator account before deleting it.' });
    return;
  }

  const deleteWorkspaceTx = db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM sales WHERE owner_user_id = ?').run(targetId);
    db.prepare('DELETE FROM orders WHERE owner_user_id = ?').run(targetId);
    db.prepare('DELETE FROM expenses WHERE owner_user_id = ?').run(targetId);
    db.prepare('DELETE FROM customers WHERE owner_user_id = ?').run(targetId);
    db.prepare('DELETE FROM products WHERE owner_user_id = ?').run(targetId);
    db.prepare('DELETE FROM business_settings WHERE owner_user_id = ?').run(targetId);
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  });

  deleteWorkspaceTx();
  recordSystemAudit(
    req.user!,
    'USER_DELETED',
    'user',
    targetId,
    `Deleted user @${target.username} and associated workspace records`
  );
  res.json({ ok: true });
});

app.post('/api/admin/system/cleanup-sessions', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const info = db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')").run();
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // non-fatal
  }
  recordSystemAudit(
    req.user!,
    'EXPIRED_SESSIONS_PURGED',
    'system',
    'sessions',
    `Purged ${info.changes} expired session(s) and compacted database WAL`
  );
  res.json({ ok: true, purgedCount: info.changes });
});

app.get('/api/admin/export-logs', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT id, created_at, status, auth_method, username, full_name, email, identifier, failure_reason, ip_address, user_agent
       FROM login_events
       ORDER BY id DESC
       LIMIT 1000`
    )
    .all() as any[];

  const escapeCsvCell = (value: unknown): string => {
    let str = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  const headers = [
    'ID',
    'Timestamp (UTC)',
    'Status',
    'Auth Method',
    'Username',
    'Full Name',
    'Email',
    'Identifier',
    'Failure Reason',
    'IP Address',
    'User Agent',
  ];
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) =>
      [
        r.id,
        r.created_at,
        r.status,
        r.auth_method,
        r.username,
        r.full_name,
        r.email,
        r.identifier,
        r.failure_reason,
        r.ip_address,
        r.user_agent,
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="stanley-admin-login-audit-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send(lines.join('\n'));
});

// ============================================================================
// Real-Time Notifications & Alert Inbox Endpoints
// ============================================================================
app.get('/api/notifications/stream', (req: AuthenticatedRequest, res) => {
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  const token = getTokenFromReq(req) || queryToken || null;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const row = db
    .prepare(
      `SELECT u.id, u.status, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as { id: number; status: string; expires_at: string } | undefined;

  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    res.status(401).json({ error: 'Session expired.' });
    return;
  }
  if (row.status === 'suspended') {
    res.status(403).json({ error: 'Account suspended.' });
    return;
  }

  const userId = Number(row.id);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(': connected\n\n');

  let clients = notificationClients.get(userId);
  if (!clients) {
    clients = new Set();
    notificationClients.set(userId, clients);
  }
  clients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const set = notificationClients.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) {
        notificationClients.delete(userId);
      }
    }
  });
});

app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const rows = db
    .prepare(
      `SELECT * FROM notifications
       WHERE target_user_id = ?
       ORDER BY id DESC
       LIMIT 80`
    )
    .all(userId);
  const unreadRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE target_user_id = ? AND is_read = 0')
    .get(userId) as { cnt: number };

  res.json({
    notifications: rows.map(formatNotificationRow),
    unreadCount: Number(unreadRow?.cnt || 0),
  });
});

app.post('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid notification ID.' });
    return;
  }
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND target_user_id = ?').run(id, userId);
  const unreadRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE target_user_id = ? AND is_read = 0')
    .get(userId) as { cnt: number };
  res.json({ ok: true, unreadCount: Number(unreadRow?.cnt || 0) });
});

app.post('/api/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  db.prepare('UPDATE notifications SET is_read = 1 WHERE target_user_id = ? AND is_read = 0').run(userId);
  res.json({ ok: true, unreadCount: 0 });
});

app.delete('/api/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  db.prepare('DELETE FROM notifications WHERE target_user_id = ?').run(userId);
  res.json({ ok: true, unreadCount: 0 });
});

export async function startServer(customPort?: number) {
  const listenPort = customPort ?? PORT;
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return new Promise<void>((resolve) => {
    app.listen(listenPort, '0.0.0.0', () => {
      console.log(`STANLEY BUSINESS MANAGER running on http://0.0.0.0:${listenPort}`);
      resolve();
    });
  });
}

if (process.env.STANLEY_NO_AUTOSTART !== 'true') {
  startServer();
}
