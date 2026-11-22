import express, { Request, Response, NextFunction } from 'express';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initDatabase, hashPassword, verifyPassword, generateRecoveryKey, DEFAULT_LOGO_URL } from './src/db/database.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initDatabase();

export const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '15mb' }));

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
      `SELECT u.id, u.username, u.full_name, u.email, u.role, u.is_default_password, u.last_login_at, s.expires_at
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

function getCustomersWithAggregates() {
  const customers = db.prepare('SELECT * FROM customers ORDER BY name ASC').all() as any[];
  const salesAgg = db
    .prepare(
      `SELECT customer_id,
              COALESCE(SUM(total_amount), 0) AS total_spent,
              COALESCE(SUM(balance_due), 0) AS outstanding_balance,
              COUNT(*) AS sale_count
       FROM sales
       WHERE customer_id IS NOT NULL
       GROUP BY customer_id`
    )
    .all() as any[];
  const ordersAgg = db
    .prepare(
      `SELECT customer_id, COUNT(*) AS order_count
       FROM orders
       WHERE customer_id IS NOT NULL
       GROUP BY customer_id`
    )
    .all() as any[];

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

async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email: string; name: string }> {
  const projectId = getFirebaseProjectId();
  if (!projectId) {
    throw new Error('Firebase project configuration is missing.');
  }
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid Google ID token format.');
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Unsupported Google token algorithm.');
  }

  let certs = await getFirebasePublicCerts(false);
  if (!certs[header.kid]) {
    certs = await getFirebasePublicCerts(true);
  }
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error('Unable to verify Google token signing key.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  const validSig = verifier.verify(cert, signatureB64, 'base64url');
  if (!validSig) {
    throw new Error('Invalid Google authentication signature.');
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
    throw new Error('Google authentication token is expired or invalid for this app.');
  }

  if (payload.email_verified !== true || typeof payload.email !== 'string' || !payload.email) {
    throw new Error('A verified Google email address is required.');
  }

  return {
    uid: payload.sub,
    email: String(payload.email).trim(),
    name: String(payload.name || payload.email.split('@')[0]).trim(),
  };
}

function mapUserRow(row: any) {
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    is_default_password: Boolean(row.is_default_password),
    last_login_at: row.last_login_at ?? null,
    auth_provider: (row.auth_provider === 'google' ? 'google' : 'local') as 'local' | 'google',
    security_question: row.security_question ? String(row.security_question) : null,
    has_recovery_key: Boolean(row.recovery_key_hash),
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
app.get('/api/auth/session', (req: AuthenticatedRequest, res) => {
  const token = getTokenFromReq(req);
  const adminInfo = db
    .prepare('SELECT is_default_password FROM users WHERE role = ? LIMIT 1')
    .get('Administrator') as { is_default_password: number } | undefined;
  const settings = db
    .prepare('SELECT business_name, logo_url, location FROM business_settings WHERE id = 1')
    .get() as { business_name: string; logo_url: string; location: string } | undefined;

  if (!token) {
    res.json({
      authenticated: false,
      user: null,
      showDefaultHint: Boolean(adminInfo?.is_default_password),
      brand: settings || { business_name: 'STANLEY BUSINESS MANAGER', logo_url: DEFAULT_LOGO_URL, location: 'Kampala, Uganda' },
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

  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.json({
      authenticated: false,
      user: null,
      showDefaultHint: Boolean(adminInfo?.is_default_password),
      brand: settings || { business_name: 'STANLEY BUSINESS MANAGER', logo_url: DEFAULT_LOGO_URL, location: 'Kampala, Uganda' },
    });
    return;
  }

  res.json({
    authenticated: true,
    user: mapUserRow(row),
    showDefaultHint: Boolean(row.is_default_password),
    brand: settings,
  });
});

app.post('/api/auth/login', (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    res.status(400).json({ error: 'Username/email and password are required.' });
    return;
  }

  const cleanId = String(identifier).trim().toLowerCase();
  const user = db
    .prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1')
    .get(cleanId, cleanId) as any;

  if (!user || !verifyPassword(String(password), user.password_hash, user.password_salt)) {
    res.status(401).json({ error: 'Invalid credentials. Please verify your username/email and password.' });
    return;
  }

  res.json(issueSessionForUser(req, res, user));
});

app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body || {};
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
      if (!user.google_uid) {
        db.prepare('UPDATE users SET google_uid = ? WHERE id = ?').run(verified.uid, user.id);
      }
      res.json(issueSessionForUser(req, res, user));
      return;
    }

    // Create a new user account linked to Google Sign-In
    const baseUsername = verified.email
      .split('@')[0]
      .replace(/[^a-zA-Z0-9_.-]/g, '')
      .slice(0, 20) || 'user';
    let candidateUsername = baseUsername;
    let suffix = 1;
    while (db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(candidateUsername)) {
      candidateUsername = `${baseUsername}${suffix++}`;
    }

    const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    const role = totalUsers.count === 0 ? 'Administrator' : 'Staff';
    const { hash, salt } = hashPassword(crypto.randomBytes(32).toString('hex'));

    const info = db
      .prepare(
        `INSERT INTO users (username, full_name, email, role, password_hash, password_salt, is_default_password, auth_provider, google_uid)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'google', ?)`
      )
      .run(candidateUsername, verified.name, verified.email, role, hash, salt, verified.uid);

    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(issueSessionForUser(req, res, user));
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'Google authentication verification failed.' });
  }
});

app.post('/api/auth/register', (req, res) => {
  const { full_name, username, email, password, security_question, security_answer } = req.body || {};

  const cleanName = String(full_name || '').trim();
  const cleanUsername = String(username || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const rawPassword = String(password || '');
  const cleanQuestion = String(security_question || '').trim();
  const cleanAnswer = String(security_answer || '').trim().toLowerCase();

  if (cleanName.length < 2) {
    res.status(400).json({ error: 'Please enter your full name.' });
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

  const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  const role = totalUsers.count === 0 ? 'Administrator' : 'Staff';
  const { hash, salt } = hashPassword(rawPassword);

  const answerHashed = cleanQuestion && cleanAnswer ? hashPassword(cleanAnswer) : { hash: '', salt: '' };
  const recoveryKey = generateRecoveryKey();
  const recoveryHashed = hashPassword(recoveryKey);

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

  const createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
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

  const session = issueSessionForUser(req, res, user);
  res.json({
    ...session,
    newRecoveryKey: rotatedRecoveryKey,
  });
});

app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
  const token = getTokenFromReq(req);
  if (token) {
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

  if (user.auth_provider !== 'google') {
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
app.get('/api/bootstrap', requireAuth, (_req, res) => {
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  const products = db.prepare('SELECT * FROM products ORDER BY category ASC, name ASC').all();
  const customers = getCustomersWithAggregates();
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  const salesRows = db.prepare('SELECT * FROM sales ORDER BY sale_date DESC, id DESC').all();
  const sales = salesRows.map(formatSaleRow);
  const expenses = db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC').all();

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
app.put('/api/settings', requireAuth, (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM business_settings WHERE id = 1').get() as any;
  if (!existing) {
    res.status(404).json({ error: 'Settings not found' });
    return;
  }

  const nextInactivity =
    b.inactivity_timeout_minutes !== undefined && Number.isFinite(Number(b.inactivity_timeout_minutes))
      ? Math.max(0, Math.min(240, Math.round(Number(b.inactivity_timeout_minutes))))
      : Number(existing.inactivity_timeout_minutes ?? 15);

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
      updated_at = datetime('now')
    WHERE id = 1
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
    nextInactivity
  );

  const updated = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.json(updated);
});

// Products & Services
app.post('/api/products', requireAuth, (req, res) => {
  const { name, category, description, unit_price, production_cost, unit_label, is_active, client_sync_id } = req.body || {};
  if (!name || !category) {
    res.status(400).json({ error: 'Product name and category are required.' });
    return;
  }
  const syncId = String(client_sync_id || `prod-${crypto.randomUUID().slice(0, 12)}`).trim();
  const existingBySync = db.prepare('SELECT * FROM products WHERE client_sync_id = ?').get(syncId);
  if (existingBySync) {
    res.json(existingBySync);
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO products (name, category, description, unit_price, production_cost, unit_label, is_active, client_sync_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      String(category).trim(),
      String(description || '').trim(),
      Math.max(0, Number(unit_price) || 0),
      Math.max(0, Number(production_cost) || 0),
      String(unit_label || 'piece').trim(),
      is_active === undefined ? 1 : Number(Boolean(is_active)),
      syncId
    );

  const created = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

app.put('/api/products/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  const { name, category, description, unit_price, production_cost, unit_label, is_active } = req.body || {};
  db.prepare(
    `UPDATE products SET
      name = ?, category = ?, description = ?, unit_price = ?, production_cost = ?, unit_label = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    String(name ?? existing.name).trim(),
    String(category ?? existing.category).trim(),
    String(description ?? existing.description).trim(),
    Math.max(0, Number(unit_price ?? existing.unit_price) || 0),
    Math.max(0, Number(production_cost ?? existing.production_cost) || 0),
    String(unit_label ?? existing.unit_label).trim(),
    is_active === undefined ? existing.is_active : Number(Boolean(is_active)),
    id
  );
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Customers
app.post('/api/customers', requireAuth, (req, res) => {
  const { name, phone, email, location, notes, client_sync_id } = req.body || {};
  if (!name) {
    res.status(400).json({ error: 'Customer name is required.' });
    return;
  }
  const syncId = String(client_sync_id || `cust-${crypto.randomUUID().slice(0, 12)}`).trim();
  const existingBySync = db.prepare('SELECT id FROM customers WHERE client_sync_id = ?').get(syncId) as { id: number } | undefined;
  if (existingBySync) {
    const existingCust = getCustomersWithAggregates().find((c) => c.id === existingBySync.id);
    res.json(existingCust);
    return;
  }

  const info = db
    .prepare(`INSERT INTO customers (name, phone, email, location, notes, client_sync_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      String(name).trim(),
      String(phone || '').trim(),
      String(email || '').trim(),
      String(location || '').trim(),
      String(notes || '').trim(),
      syncId
    );

  const created = getCustomersWithAggregates().find((c) => c.id === Number(info.lastInsertRowid));
  res.status(201).json(created);
});

app.put('/api/customers/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }
  const { name, phone, email, location, notes } = req.body || {};
  db.prepare(
    `UPDATE customers SET name = ?, phone = ?, email = ?, location = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    String(name ?? existing.name).trim(),
    String(phone ?? existing.phone).trim(),
    String(email ?? existing.email).trim(),
    String(location ?? existing.location).trim(),
    String(notes ?? existing.notes).trim(),
    id
  );
  const updated = getCustomersWithAggregates().find((c) => c.id === id);
  res.json(updated);
});

app.delete('/api/customers/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Orders
app.post('/api/orders', requireAuth, (req, res) => {
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
  const existingBySync = db.prepare('SELECT * FROM orders WHERE client_sync_id = ?').get(syncId);
  if (existingBySync) {
    res.json(existingBySync);
    return;
  }

  const maxOrder = db.prepare('SELECT COALESCE(MAX(id), 0) AS maxId FROM orders').get() as { maxId: number };
  let orderNumber = providedOrderNumber ? String(providedOrderNumber).trim() : `ORD-${1001 + Number(maxOrder.maxId)}`;
  const collision = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(orderNumber);
  if (collision) {
    orderNumber = `ORD-${1001 + Number(maxOrder.maxId)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  }

  const info = db
    .prepare(
      `INSERT INTO orders (
        order_number, customer_id, customer_name, customer_phone, title,
        items_summary, quantity, total_amount, deposit_paid, status,
        deadline, delivery_details, instructions, client_sync_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      orderNumber,
      customer_id ? Number(customer_id) : null,
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

  const created = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

app.put('/api/orders/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  const b = req.body || {};
  db.prepare(
    `UPDATE orders SET
      customer_id = ?, customer_name = ?, customer_phone = ?, title = ?,
      items_summary = ?, quantity = ?, total_amount = ?, deposit_paid = ?,
      status = ?, deadline = ?, delivery_details = ?, instructions = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    b.customer_id !== undefined ? (b.customer_id ? Number(b.customer_id) : null) : existing.customer_id,
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
    id
  );
  res.json(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
});

app.delete('/api/orders/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Sales & Receipts
app.post('/api/sales', requireAuth, (req, res) => {
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
  const existingBySync = db.prepare('SELECT * FROM sales WHERE client_sync_id = ?').get(syncId);
  if (existingBySync) {
    res.json({
      sale: formatSaleRow(existingBySync),
      customers: getCustomersWithAggregates(),
      settings: db.prepare('SELECT * FROM business_settings WHERE id = 1').get(),
    });
    return;
  }

  const normalizedItems = items.map((item: any) => {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const price = Math.max(0, Number(item.unit_price) || 0);
    const cost = Math.max(0, Number(item.unit_cost) || 0);
    return {
      product_id: item.product_id ? Number(item.product_id) : null,
      product_name: String(item.product_name || 'Printing Service').trim(),
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
    let resolvedCustomerId = customer_id ? Number(customer_id) : null;
    if (!resolvedCustomerId && customer_name.trim().toLowerCase() !== 'walk-in customer') {
      const existingCust = db
        .prepare('SELECT id FROM customers WHERE LOWER(name) = LOWER(?) LIMIT 1')
        .get(customer_name.trim()) as { id: number } | undefined;
      if (existingCust) {
        resolvedCustomerId = existingCust.id;
      } else {
        const custInfo = db
          .prepare('INSERT INTO customers (name, phone, email, location, notes, client_sync_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(customer_name.trim(), String(customer_phone || '').trim(), '', '', 'Auto-added from sale', `cust-${crypto.randomUUID().slice(0, 12)}`);
        resolvedCustomerId = Number(custInfo.lastInsertRowid);
      }
    }

    const settings = db
      .prepare('SELECT receipt_prefix, next_receipt_seq FROM business_settings WHERE id = 1')
      .get() as { receipt_prefix: string; next_receipt_seq: number };
    const year = new Date().getFullYear();
    let seq = settings?.next_receipt_seq || 1;
    const prefix = settings?.receipt_prefix || 'SBM';

    let receiptNumber = providedReceiptNumber ? String(providedReceiptNumber).trim() : `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
    while (db.prepare('SELECT id FROM sales WHERE receipt_number = ?').get(receiptNumber)) {
      seq += 1;
      receiptNumber = `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
    }

    db.prepare('UPDATE business_settings SET next_receipt_seq = MAX(next_receipt_seq + 1, ?) WHERE id = 1').run(seq + 1);

    const info = db
      .prepare(
        `INSERT INTO sales (
          receipt_number, order_id, customer_id, customer_name, customer_phone,
          items_json, subtotal, discount, total_amount, amount_paid, balance_due,
          payment_method, payment_status, notes, sale_date, client_sync_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        receiptNumber,
        order_id ? Number(order_id) : null,
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

    if (order_id) {
      db.prepare("UPDATE orders SET status = ?, deposit_paid = ?, updated_at = datetime('now') WHERE id = ?").run(
        balanceDue === 0 ? 'Completed' : 'In Production',
        cleanPaid,
        Number(order_id)
      );
    }

    return saleId;
  });

  const saleId = createSaleTx();
  const createdRow = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  const customers = getCustomersWithAggregates();
  const settings = db.prepare('SELECT * FROM business_settings WHERE id = 1').get();
  res.status(201).json({
    sale: formatSaleRow(createdRow),
    customers,
    settings,
  });
});

app.post('/api/sales/:id/payments', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { amount, payment_method, note } = req.body || {};
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as any;
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
      `UPDATE sales SET amount_paid = ?, balance_due = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(newPaid, newBalance, newStatus, id);
  });

  tx();
  const updatedRow = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  res.json({
    sale: formatSaleRow(updatedRow),
    customers: getCustomersWithAggregates(),
  });
});

app.delete('/api/sales/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM sales WHERE id = ?').run(id);
  res.json({ ok: true, customers: getCustomersWithAggregates() });
});

// Expenses
app.post('/api/expenses', requireAuth, (req, res) => {
  const { title, category, amount, payment_method, vendor, notes, expense_date, client_sync_id } = req.body || {};
  if (!title || !category) {
    res.status(400).json({ error: 'Expense description and category are required.' });
    return;
  }
  const syncId = String(client_sync_id || `exp-${crypto.randomUUID().slice(0, 12)}`).trim();
  const existingBySync = db.prepare('SELECT * FROM expenses WHERE client_sync_id = ?').get(syncId);
  if (existingBySync) {
    res.json(existingBySync);
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO expenses (title, category, amount, payment_method, vendor, notes, expense_date, client_sync_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(title).trim(),
      String(category).trim(),
      Math.max(0, Number(amount) || 0),
      String(payment_method || 'Cash'),
      String(vendor || '').trim(),
      String(notes || '').trim(),
      String(expense_date || new Date().toISOString().slice(0, 10)),
      syncId
    );
  const created = db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

app.put('/api/expenses/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Expense not found' });
    return;
  }
  const b = req.body || {};
  db.prepare(
    `UPDATE expenses SET title = ?, category = ?, amount = ?, payment_method = ?, vendor = ?, notes = ?, expense_date = ? WHERE id = ?`
  ).run(
    String(b.title ?? existing.title).trim(),
    String(b.category ?? existing.category).trim(),
    Math.max(0, Number(b.amount ?? existing.amount) || 0),
    String(b.payment_method ?? existing.payment_method),
    String(b.vendor ?? existing.vendor).trim(),
    String(b.notes ?? existing.notes).trim(),
    String(b.expense_date ?? existing.expense_date),
    id
  );
  res.json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id));
});

app.delete('/api/expenses/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Database Backup & Restoration
app.get('/api/backup/export', requireAuth, (_req, res) => {
  const payload = {
    app: 'STANLEY BUSINESS MANAGER',
    version: 1,
    exported_at: new Date().toISOString(),
    data: {
      business_settings: db.prepare('SELECT * FROM business_settings').all(),
      products: db.prepare('SELECT * FROM products').all(),
      customers: db.prepare('SELECT * FROM customers').all(),
      orders: db.prepare('SELECT * FROM orders').all(),
      sales: db.prepare('SELECT * FROM sales').all(),
      sale_payments: db.prepare('SELECT * FROM sale_payments').all(),
      expenses: db.prepare('SELECT * FROM expenses').all(),
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

app.post('/api/backup/restore', requireAuth, (req, res) => {
  const backup = req.body;
  if (!backup || backup.app !== 'STANLEY BUSINESS MANAGER' || !backup.data) {
    res.status(400).json({ error: 'Invalid backup file format. Please select a valid Stanley Business Manager JSON backup.' });
    return;
  }

  const d = backup.data;
  const restoreTx = db.transaction(() => {
    db.prepare('DELETE FROM sale_payments').run();
    db.prepare('DELETE FROM sales').run();
    db.prepare('DELETE FROM orders').run();
    db.prepare('DELETE FROM expenses').run();
    db.prepare('DELETE FROM customers').run();
    db.prepare('DELETE FROM products').run();

    if (Array.isArray(d.business_settings) && d.business_settings.length > 0) {
      const s = d.business_settings[0];
      db.prepare(`
        UPDATE business_settings SET
          business_name = ?, tagline = ?, logo_url = ?, phone_primary = ?, phone_secondary = ?,
          email = ?, location = ?, currency = ?, default_payment_method = ?, receipt_template = ?,
          receipt_thank_you = ?, receipt_prefix = ?, next_receipt_seq = ?, updated_at = datetime('now')
        WHERE id = 1
      `).run(
        s.business_name || 'Stanley Print & Branding Studio',
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
        Number(s.next_receipt_seq) || 1
      );
    }

    const insProd = db.prepare(
      'INSERT INTO products (id, name, category, description, unit_price, production_cost, unit_label, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const p of d.products || []) {
      insProd.run(p.id, p.name, p.category, p.description || '', p.unit_price || 0, p.production_cost || 0, p.unit_label || 'pcs', p.is_active ?? 1, p.created_at || new Date().toISOString(), p.updated_at || new Date().toISOString());
    }

    const insCust = db.prepare(
      'INSERT INTO customers (id, name, phone, email, location, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const c of d.customers || []) {
      insCust.run(c.id, c.name, c.phone || '', c.email || '', c.location || '', c.notes || '', c.created_at || new Date().toISOString(), c.updated_at || new Date().toISOString());
    }

    const insOrd = db.prepare(
      'INSERT INTO orders (id, order_number, customer_id, customer_name, customer_phone, title, items_summary, quantity, total_amount, deposit_paid, status, deadline, delivery_details, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const o of d.orders || []) {
      insOrd.run(o.id, o.order_number, o.customer_id ?? null, o.customer_name, o.customer_phone || '', o.title, o.items_summary || '', o.quantity || 1, o.total_amount || 0, o.deposit_paid || 0, o.status || 'New Order', o.deadline || '', o.delivery_details || '', o.instructions || '', o.created_at || new Date().toISOString(), o.updated_at || new Date().toISOString());
    }

    const insSale = db.prepare(
      'INSERT INTO sales (id, receipt_number, order_id, customer_id, customer_name, customer_phone, items_json, subtotal, discount, total_amount, amount_paid, balance_due, payment_method, payment_status, notes, sale_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const s of d.sales || []) {
      insSale.run(s.id, s.receipt_number, s.order_id ?? null, s.customer_id ?? null, s.customer_name, s.customer_phone || '', s.items_json || '[]', s.subtotal || 0, s.discount || 0, s.total_amount || 0, s.amount_paid || 0, s.balance_due || 0, s.payment_method || 'Cash', s.payment_status || 'Paid', s.notes || '', s.sale_date, s.created_at || new Date().toISOString(), s.updated_at || new Date().toISOString());
    }

    const insPay = db.prepare(
      'INSERT INTO sale_payments (id, sale_id, amount, payment_method, note, paid_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const sp of d.sale_payments || []) {
      insPay.run(sp.id, sp.sale_id, sp.amount || 0, sp.payment_method || 'Cash', sp.note || '', sp.paid_at || new Date().toISOString());
    }

    const insExp = db.prepare(
      'INSERT INTO expenses (id, title, category, amount, payment_method, vendor, notes, expense_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const e of d.expenses || []) {
      insExp.run(e.id, e.title, e.category, e.amount || 0, e.payment_method || 'Cash', e.vendor || '', e.notes || '', e.expense_date, e.created_at || new Date().toISOString());
    }
  });

  try {
    restoreTx();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: `Failed to restore backup: ${err.message}` });
  }
});

app.post('/api/backup/clear-transactions', requireAuth, (_req, res) => {
  const clearTx = db.transaction(() => {
    db.prepare('DELETE FROM sale_payments').run();
    db.prepare('DELETE FROM sales').run();
    db.prepare('DELETE FROM orders').run();
    db.prepare('DELETE FROM expenses').run();
    db.prepare('DELETE FROM customers').run();
    db.prepare('UPDATE business_settings SET next_receipt_seq = 1 WHERE id = 1').run();
  });
  clearTx();
  res.json({ ok: true });
});

// Cloud Sync Merge (idempotent conflict resolution using clientSyncId)
app.post('/api/sync/merge-cloud', requireAuth, (req, res) => {
  const { settings, products, customers, orders, sales, expenses } = req.body || {};
  let mergedCount = 0;

  const mergeTx = db.transaction(() => {
    if (settings && typeof settings === 'object') {
      const existing = db.prepare('SELECT * FROM business_settings WHERE id = 1').get() as any;
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
            updated_at = datetime('now')
          WHERE id = 1
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
          nextSeq
        );
        mergedCount++;
      }
    }

    for (const p of Array.isArray(products) ? products : []) {
      const syncId = String(p.clientSyncId || p.id || '').trim();
      if (!syncId) continue;
      const existing = db.prepare('SELECT * FROM products WHERE client_sync_id = ?').get(syncId) as any;
      if (existing) {
        db.prepare(`
          UPDATE products SET name = ?, category = ?, description = ?, unit_price = ?, production_cost = ?, unit_label = ?, is_active = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(
          String(p.name || existing.name),
          String(p.category || existing.category),
          String(p.description || ''),
          Math.max(0, Number(p.unit_price) || 0),
          Math.max(0, Number(p.production_cost) || 0),
          String(p.unit_label || 'piece'),
          p.is_active === false ? 0 : 1,
          existing.id
        );
      } else {
        db.prepare(`
          INSERT INTO products (name, category, description, unit_price, production_cost, unit_label, is_active, client_sync_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
      const existing = db.prepare('SELECT * FROM customers WHERE client_sync_id = ?').get(syncId) as any;
      if (existing) {
        db.prepare(`UPDATE customers SET name = ?, phone = ?, email = ?, location = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`).run(
          String(c.name || existing.name),
          String(c.phone || ''),
          String(c.email || ''),
          String(c.location || ''),
          String(c.notes || ''),
          existing.id
        );
      } else {
        db.prepare(`INSERT INTO customers (name, phone, email, location, notes, client_sync_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
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
      const existing = db.prepare('SELECT * FROM orders WHERE client_sync_id = ? OR order_number = ?').get(syncId, String(o.order_number || '')) as any;
      if (existing) {
        db.prepare(`
          UPDATE orders SET customer_name = ?, customer_phone = ?, title = ?, items_summary = ?, quantity = ?, total_amount = ?, deposit_paid = ?, status = ?, deadline = ?, delivery_details = ?, instructions = ?, updated_at = datetime('now')
          WHERE id = ?
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
          existing.id
        );
      } else {
        const orderNum = String(o.order_number || `ORD-${Date.now().toString().slice(-5)}`);
        db.prepare(`
          INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, title, items_summary, quantity, total_amount, deposit_paid, status, deadline, delivery_details, instructions, client_sync_id)
          VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
      }
      mergedCount++;
    }

    for (const s of Array.isArray(sales) ? sales : []) {
      const syncId = String(s.clientSyncId || s.id || '').trim();
      if (!syncId) continue;
      const existing = db.prepare('SELECT * FROM sales WHERE client_sync_id = ? OR receipt_number = ?').get(syncId, String(s.receipt_number || '')) as any;
      const itemsJson = JSON.stringify(Array.isArray(s.items) ? s.items : []);
      if (existing) {
        db.prepare(`
          UPDATE sales SET customer_name = ?, customer_phone = ?, items_json = ?, subtotal = ?, discount = ?, total_amount = ?, amount_paid = ?, balance_due = ?, payment_method = ?, payment_status = ?, notes = ?, sale_date = ?, updated_at = datetime('now')
          WHERE id = ?
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
          existing.id
        );
      } else {
        const receiptNum = String(s.receipt_number || `SBM-CLD-${Date.now().toString().slice(-6)}`);
        db.prepare(`
          INSERT INTO sales (receipt_number, order_id, customer_id, customer_name, customer_phone, items_json, subtotal, discount, total_amount, amount_paid, balance_due, payment_method, payment_status, notes, sale_date, client_sync_id)
          VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
      const existing = db.prepare('SELECT * FROM expenses WHERE client_sync_id = ?').get(syncId) as any;
      if (existing) {
        db.prepare(`
          UPDATE expenses SET title = ?, category = ?, amount = ?, payment_method = ?, vendor = ?, notes = ?, expense_date = ?
          WHERE id = ?
        `).run(
          String(e.title || existing.title),
          String(e.category || existing.category),
          Math.max(0, Number(e.amount) || 0),
          String(e.payment_method || existing.payment_method),
          String(e.vendor || ''),
          String(e.notes || ''),
          String(e.expense_date || existing.expense_date),
          existing.id
        );
      } else {
        db.prepare(`
          INSERT INTO expenses (title, category, amount, payment_method, vendor, notes, expense_date, client_sync_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
  res.json({ ok: true, mergedCount });
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
