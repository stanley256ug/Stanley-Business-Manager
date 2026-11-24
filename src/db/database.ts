import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_LOGO_URL = '/src/assets/images/stanley_brand_logo_1795171819618.jpg';

const DATA_DIR = process.env.STANLEY_DATA_DIR
  ? path.resolve(process.env.STANLEY_DATA_DIR)
  : path.resolve(process.cwd(), 'data');
export const DB_PATH = path.join(DATA_DIR, 'stanley_business.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

export function generateRecoveryKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  return `SBM-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function generateBillingPassCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let raw = '';
  for (let i = 0; i < 8; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  return `SBM-PAY-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export function suggestReceiptPrefix(businessName: string): string {
  const words = String(businessName || '')
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

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Business Owner',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      is_default_password INTEGER NOT NULL DEFAULT 0,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      google_uid TEXT,
      icloud_uid TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      security_question TEXT NOT NULL DEFAULT '',
      recovery_answer_hash TEXT NOT NULL DEFAULT '',
      recovery_answer_salt TEXT NOT NULL DEFAULT '',
      recovery_key_hash TEXT NOT NULL DEFAULT '',
      recovery_key_salt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS login_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      identifier TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      auth_method TEXT NOT NULL DEFAULT 'local',
      status TEXT NOT NULL DEFAULT 'success',
      failure_reason TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS system_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      actor_username TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      actor_user_id INTEGER,
      actor_name TEXT NOT NULL DEFAULT '',
      related_entity_type TEXT NOT NULL DEFAULT '',
      related_entity_id TEXT NOT NULL DEFAULT '',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS billing_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pass_code TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      plan_code TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      amount_ugx INTEGER NOT NULL DEFAULT 0,
      payment_provider TEXT NOT NULL,
      recipient_number TEXT NOT NULL DEFAULT '',
      payer_phone TEXT NOT NULL DEFAULT '',
      payer_name TEXT NOT NULL DEFAULT '',
      transaction_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      reviewed_by_user_id INTEGER,
      reviewed_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS business_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL UNIQUE,
      business_name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL DEFAULT '',
      phone_primary TEXT NOT NULL DEFAULT '',
      phone_secondary TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'UGX',
      default_payment_method TEXT NOT NULL DEFAULT 'Mobile Money',
      receipt_template TEXT NOT NULL DEFAULT 'executive',
      receipt_thank_you TEXT NOT NULL DEFAULT 'Thank you for doing business with us! We appreciate your trust.',
      receipt_prefix TEXT NOT NULL DEFAULT 'SBM',
      next_receipt_seq INTEGER NOT NULL DEFAULT 1,
      inactivity_timeout_minutes INTEGER NOT NULL DEFAULT 15,
      profile_completed INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      unit_price REAL NOT NULL DEFAULT 0,
      production_cost REAL NOT NULL DEFAULT 0,
      unit_label TEXT NOT NULL DEFAULT 'pcs',
      is_active INTEGER NOT NULL DEFAULT 1,
      client_sync_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      client_sync_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL DEFAULT 1,
      order_number TEXT NOT NULL,
      customer_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      items_summary TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      total_amount REAL NOT NULL DEFAULT 0,
      deposit_paid REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'New Order',
      deadline TEXT NOT NULL DEFAULT '',
      delivery_details TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      client_sync_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (owner_user_id, order_number),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL DEFAULT 1,
      receipt_number TEXT NOT NULL,
      order_id INTEGER,
      customer_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL DEFAULT '',
      items_json TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'Cash',
      payment_status TEXT NOT NULL DEFAULT 'Paid',
      notes TEXT NOT NULL DEFAULT '',
      sale_date TEXT NOT NULL,
      client_sync_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (owner_user_id, receipt_number),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sale_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'Cash',
      vendor TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      expense_date TEXT NOT NULL,
      client_sync_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureColumnMigrations();
  seedInitialData();
  backfillSyncIds();
}

function hasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

function getTableSql(table: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql?: string } | undefined;
  return row?.sql || '';
}

function ensureColumnMigrations(): void {
  const userCols: Array<[string, string]> = [
    ['auth_provider', "TEXT NOT NULL DEFAULT 'local'"],
    ['google_uid', 'TEXT'],
    ['icloud_uid', 'TEXT'],
    ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['security_question', "TEXT NOT NULL DEFAULT ''"],
    ['recovery_answer_hash', "TEXT NOT NULL DEFAULT ''"],
    ['recovery_answer_salt', "TEXT NOT NULL DEFAULT ''"],
    ['recovery_key_hash', "TEXT NOT NULL DEFAULT ''"],
    ['recovery_key_salt', "TEXT NOT NULL DEFAULT ''"],
    ['subscription_plan', "TEXT NOT NULL DEFAULT 'legacy'"],
    ['subscription_status', "TEXT NOT NULL DEFAULT 'active'"],
    ['subscription_expires_at', 'TEXT'],
    ['active_billing_id', 'INTEGER'],
  ];
  for (const [col, def] of userCols) {
    if (!hasColumn('users', col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_google_uid ON users(google_uid) WHERE google_uid IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_icloud_uid ON users(icloud_uid) WHERE icloud_uid IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_login_events_created ON login_events(created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_system_audit_created ON system_audit_logs(created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_target_created ON notifications(target_user_id, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_target_unread ON notifications(target_user_id, is_read)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_billing_user ON billing_subscriptions(user_id, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_billing_status ON billing_subscriptions(status, created_at DESC)');
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_provider_tx ON billing_subscriptions(payment_provider, LOWER(transaction_id)) WHERE transaction_id != ''"
  );

  // Migrate legacy single-tenant business_settings (id = 1 CHECK) to multi-owner
  const settingsSql = getTableSql('business_settings');
  if (!hasColumn('business_settings', 'owner_user_id') || settingsSql.includes('CHECK')) {
    const hasInactivity = hasColumn('business_settings', 'inactivity_timeout_minutes');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE business_settings_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER NOT NULL UNIQUE,
        business_name TEXT NOT NULL,
        tagline TEXT NOT NULL DEFAULT '',
        logo_url TEXT NOT NULL DEFAULT '',
        phone_primary TEXT NOT NULL DEFAULT '',
        phone_secondary TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL DEFAULT 'UGX',
        default_payment_method TEXT NOT NULL DEFAULT 'Mobile Money',
        receipt_template TEXT NOT NULL DEFAULT 'executive',
        receipt_thank_you TEXT NOT NULL DEFAULT 'Thank you for doing business with us! We appreciate your trust.',
        receipt_prefix TEXT NOT NULL DEFAULT 'SBM',
        next_receipt_seq INTEGER NOT NULL DEFAULT 1,
        inactivity_timeout_minutes INTEGER NOT NULL DEFAULT 15,
        profile_completed INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO business_settings_v2 (
        id, owner_user_id, business_name, tagline, logo_url, phone_primary, phone_secondary,
        email, location, currency, default_payment_method, receipt_template, receipt_thank_you,
        receipt_prefix, next_receipt_seq, inactivity_timeout_minutes, profile_completed, updated_at
      )
      SELECT
        id, 1, business_name, tagline, logo_url, phone_primary, phone_secondary,
        email, location, currency, default_payment_method, receipt_template, receipt_thank_you,
        receipt_prefix, next_receipt_seq, ${hasInactivity ? 'inactivity_timeout_minutes' : '15'}, 1, updated_at
      FROM business_settings;
      DROP TABLE business_settings;
      ALTER TABLE business_settings_v2 RENAME TO business_settings;
      COMMIT;
    `);
  } else {
    if (!hasColumn('business_settings', 'inactivity_timeout_minutes')) {
      db.exec('ALTER TABLE business_settings ADD COLUMN inactivity_timeout_minutes INTEGER NOT NULL DEFAULT 15');
    }
    if (!hasColumn('business_settings', 'profile_completed')) {
      db.exec('ALTER TABLE business_settings ADD COLUMN profile_completed INTEGER NOT NULL DEFAULT 1');
    }
  }

  // Ensure owner_user_id on simple tables
  for (const table of ['products', 'customers', 'expenses']) {
    if (!hasColumn(table, 'owner_user_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN owner_user_id INTEGER NOT NULL DEFAULT 1`);
    }
    if (!hasColumn(table, 'client_sync_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN client_sync_id TEXT`);
    }
    db.exec(`DROP INDEX IF EXISTS idx_${table}_client_sync_id`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_owner_sync_id ON ${table}(owner_user_id, client_sync_id) WHERE client_sync_id IS NOT NULL`
    );
  }

  // Rebuild legacy orders if missing owner_user_id or still has global UNIQUE(order_number)
  if (!hasColumn('orders', 'owner_user_id')) {
    const hasSync = hasColumn('orders', 'client_sync_id');
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE orders_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER NOT NULL DEFAULT 1,
        order_number TEXT NOT NULL,
        customer_id INTEGER,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        items_summary TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 1,
        total_amount REAL NOT NULL DEFAULT 0,
        deposit_paid REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'New Order',
        deadline TEXT NOT NULL DEFAULT '',
        delivery_details TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        client_sync_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (owner_user_id, order_number),
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
      );
      INSERT INTO orders_v2 (
        id, owner_user_id, order_number, customer_id, customer_name, customer_phone, title,
        items_summary, quantity, total_amount, deposit_paid, status, deadline,
        delivery_details, instructions, client_sync_id, created_at, updated_at
      )
      SELECT
        id, 1, order_number, customer_id, customer_name, customer_phone, title,
        items_summary, quantity, total_amount, deposit_paid, status, deadline,
        delivery_details, instructions, ${hasSync ? 'client_sync_id' : 'NULL'}, created_at, updated_at
      FROM orders;
      DROP TABLE orders;
      ALTER TABLE orders_v2 RENAME TO orders;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
  }
  db.exec('DROP INDEX IF EXISTS idx_orders_client_sync_id');
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_owner_sync_id ON orders(owner_user_id, client_sync_id) WHERE client_sync_id IS NOT NULL'
  );

  // Rebuild legacy sales if missing owner_user_id or still has global UNIQUE(receipt_number)
  if (!hasColumn('sales', 'owner_user_id')) {
    const hasSync = hasColumn('sales', 'client_sync_id');
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE sales_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER NOT NULL DEFAULT 1,
        receipt_number TEXT NOT NULL,
        order_id INTEGER,
        customer_id INTEGER,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL DEFAULT '',
        items_json TEXT NOT NULL,
        subtotal REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        amount_paid REAL NOT NULL DEFAULT 0,
        balance_due REAL NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL DEFAULT 'Cash',
        payment_status TEXT NOT NULL DEFAULT 'Paid',
        notes TEXT NOT NULL DEFAULT '',
        sale_date TEXT NOT NULL,
        client_sync_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (owner_user_id, receipt_number),
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
      );
      INSERT INTO sales_v2 (
        id, owner_user_id, receipt_number, order_id, customer_id, customer_name, customer_phone,
        items_json, subtotal, discount, total_amount, amount_paid, balance_due,
        payment_method, payment_status, notes, sale_date, client_sync_id, created_at, updated_at
      )
      SELECT
        id, 1, receipt_number, order_id, customer_id, customer_name, customer_phone,
        items_json, subtotal, discount, total_amount, amount_paid, balance_due,
        payment_method, payment_status, notes, sale_date, ${hasSync ? 'client_sync_id' : 'NULL'}, created_at, updated_at
      FROM sales;
      DROP TABLE sales;
      ALTER TABLE sales_v2 RENAME TO sales;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
  }
  db.exec('DROP INDEX IF EXISTS idx_sales_client_sync_id');
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_owner_sync_id ON sales(owner_user_id, client_sync_id) WHERE client_sync_id IS NOT NULL'
  );
}

function backfillSyncIds(): void {
  db.exec(`
    UPDATE products SET client_sync_id = 'prod_' || id WHERE client_sync_id IS NULL OR client_sync_id = '';
    UPDATE customers SET client_sync_id = 'cust_' || id WHERE client_sync_id IS NULL OR client_sync_id = '';
    UPDATE orders SET client_sync_id = REPLACE(order_number, ' ', '_') WHERE client_sync_id IS NULL OR client_sync_id = '';
    UPDATE sales SET client_sync_id = REPLACE(receipt_number, ' ', '_') WHERE client_sync_id IS NULL OR client_sync_id = '';
    UPDATE expenses SET client_sync_id = 'exp_' || id WHERE client_sync_id IS NULL OR client_sync_id = '';
  `);
}

export function ensureWorkspaceForUser(
  userId: number,
  profile?: {
    business_name?: string;
    tagline?: string;
    phone_primary?: string;
    email?: string;
    location?: string;
    currency?: string;
    receipt_prefix?: string;
    full_name?: string;
    profile_completed?: number;
  }
): any {
  const existing = db
    .prepare('SELECT * FROM business_settings WHERE owner_user_id = ?')
    .get(userId);
  if (existing) return existing;

  const cleanBizName = String(profile?.business_name || '').trim();
  const fallbackName = profile?.full_name
    ? `${String(profile.full_name).trim().split(/\s+/)[0]}'s Business`
    : 'My Business Studio';
  const businessName = cleanBizName || fallbackName;
  const prefix =
    String(profile?.receipt_prefix || '').trim().toUpperCase().slice(0, 8) ||
    suggestReceiptPrefix(businessName);
  const completed =
    profile?.profile_completed !== undefined
      ? profile.profile_completed
      : cleanBizName.length >= 2
      ? 1
      : 0;

  db.prepare(`
    INSERT INTO business_settings (
      owner_user_id, business_name, tagline, logo_url, phone_primary, phone_secondary,
      email, location, currency, default_payment_method, receipt_template,
      receipt_thank_you, receipt_prefix, next_receipt_seq, inactivity_timeout_minutes, profile_completed
    ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'Mobile Money', 'executive', ?, ?, 1, 15, ?)
  `).run(
    userId,
    businessName,
    String(profile?.tagline || 'Sales, Services & Operations').trim(),
    DEFAULT_LOGO_URL,
    String(profile?.phone_primary || '').trim(),
    String(profile?.email || '').trim(),
    String(profile?.location || '').trim(),
    String(profile?.currency || 'UGX').trim() || 'UGX',
    `Thank you for doing business with ${businessName}! We appreciate your trust.`,
    prefix,
    completed
  );

  return db.prepare('SELECT * FROM business_settings WHERE owner_user_id = ?').get(userId);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthsAgoIso(months: number, dayOfMonth = 14): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(Math.min(dayOfMonth, 28));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysFromNowIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function seedInitialData(): void {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const { hash, salt } = hashPassword('stanley2026');
    db.prepare(`
      INSERT INTO users (username, full_name, email, role, password_hash, password_salt, is_default_password)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run('admin', 'Stanley Mpanga', 'mpangastanley04@gmail.com', 'Administrator', hash, salt);
  }

  const adminUser = db
    .prepare("SELECT id FROM users WHERE role = 'Administrator' ORDER BY id ASC LIMIT 1")
    .get() as { id: number } | undefined;
  const adminId = adminUser?.id || 1;

  const settingsCount = db
    .prepare('SELECT COUNT(*) AS count FROM business_settings WHERE owner_user_id = ?')
    .get(adminId) as { count: number };
  if (settingsCount.count === 0) {
    db.prepare(`
      INSERT INTO business_settings (
        owner_user_id, business_name, tagline, logo_url, phone_primary, phone_secondary, email,
        location, currency, default_payment_method, receipt_template, receipt_thank_you,
        receipt_prefix, next_receipt_seq, profile_completed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      adminId,
      'Stanley Print & Branding Studio',
      'Printing, Graphics, Branding & Advertising Solutions',
      DEFAULT_LOGO_URL,
      '+256 772 481 920',
      '+256 704 118 350',
      'mpangastanley04@gmail.com',
      'Nasser Road, Kampala, Uganda',
      'UGX',
      'Mobile Money',
      'executive',
      'Thank you for choosing Stanley Print & Branding Studio! Goods once printed per approved proof are non-refundable.',
      'SBM',
      9
    );
  }

  const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number };
  if (productCount.count > 0) return;

  const insertProduct = db.prepare(`
    INSERT INTO products (owner_user_id, name, category, description, unit_price, production_cost, unit_label)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const seedProducts: Array<[string, string, string, number, number, string]> = [
    ['Matte Laminated Business Cards (100 pcs)', 'Business Cards', '350gsm art card, double-sided full color with matte lamination', 45000, 18000, 'pack (100)'],
    ['Custom Die-Cut Vinyl Stickers (100 pcs)', 'Business Stickers', 'Waterproof PVC adhesive product labels', 65000, 26000, 'pack (100)'],
    ['Tear Drop Flag Banner (3.4m Complete)', 'Tear Drop Banners', 'Double-sided fabric print with aluminum pole & spike/cross base', 280000, 145000, 'set'],
    ['Promotional PVC Banner (6x3 ft)', 'Promotional Banners', 'Heavy duty 440gsm outdoor flex banner with eyelets', 75000, 32000, 'piece'],
    ['A5 Promotional Flyers (500 pcs)', 'Posters & Flyers', '150gsm glossy full color double-sided', 160000, 72000, 'batch (500)'],
    ['A3 Event Posters (50 pcs)', 'Posters & Flyers', '170gsm gloss high-resolution digital print', 95000, 38000, 'batch (50)'],
    ['Corporate Brand Identity & Logo Design', 'Graphic Design', '3 logo concepts, brand color palette, typography & vector files', 350000, 45000, 'project'],
    ['Commercial Product & Event Photography', 'Photography', 'Half-day shoot with color-graded digital deliverables', 450000, 90000, 'session'],
    ['Roll-Up Stand Banner (85x200cm)', 'Promotional Banners', 'Non-curl PP media with heavy aluminum cassette & carry bag', 185000, 92000, 'unit'],
    ['Branded Polo T-Shirts (Heat Press)', 'Other Printing & Branding', '100% cotton polo shirt with front & back logo branding', 35000, 19000, 'piece'],
  ];

  const productIds: number[] = [];
  for (const p of seedProducts) {
    const info = insertProduct.run(adminId, ...p);
    productIds.push(Number(info.lastInsertRowid));
  }

  const insertCustomer = db.prepare(`
    INSERT INTO customers (owner_user_id, name, phone, email, location, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const seedCustomers: Array<[string, string, string, string, string]> = [
    ['Kigozi Hardware & Suppliers', '+256 774 320 811', 'sales@kigozihardware.ug', 'Ntinda, Kampala', 'Regular client for vinyl stickers, receipts, and store signage.'],
    ['Pearl Roasters Coffee Co.', '+256 701 892 440', 'orders@pearlroasters.ug', 'Kololo, Kampala', 'Orders waterproof packaging stickers monthly. Prefers Mobile Money.'],
    ['Grace Namukasa Events', '+256 782 519 004', 'grace.events@gmail.com', 'Entebbe Road', 'Wedding & corporate event banners, backdrops, and invitations.'],
    ['Makerere Tech Hub', '+256 756 209 117', 'hello@makereretech.org', 'Makerere, Kampala', 'Tear drop flags, roll-up stands, and event photography.'],
    ['Ssemakula Pharmacy Ltd', '+256 779 640 233', 'info@ssemakulapharma.ug', 'Wandegeya, Kampala', 'Branded staff polo shirts and outdoor promotional banners.'],
  ];

  const customerIds: number[] = [];
  for (const c of seedCustomers) {
    const info = insertCustomer.run(adminId, ...c);
    customerIds.push(Number(info.lastInsertRowid));
  }

  const insertOrder = db.prepare(`
    INSERT INTO orders (
      owner_user_id, order_number, customer_id, customer_name, customer_phone, title,
      items_summary, quantity, total_amount, deposit_paid, status,
      deadline, delivery_details, instructions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertOrder.run(adminId, 'ORD-1001', customerIds[0], 'Kigozi Hardware & Suppliers', '+256 774 320 811', 'Storefront Promo Banners & Cards', 'Promotional PVC Banner (6x3 ft) x2, Matte Laminated Business Cards x3', 5, 285000, 285000, 'Completed', daysAgoIso(5), 'Collected at Nasser Road workshop', 'Use deep blue background with bold yellow phone numbers.');
  insertOrder.run(adminId, 'ORD-1002', customerIds[1], 'Pearl Roasters Coffee Co.', '+256 701 892 440', '250g Roast Bag Die-Cut Labels', 'Custom Die-Cut Vinyl Stickers (100 pcs) x4', 4, 260000, 150000, 'In Production', daysFromNowIso(2), 'Boda delivery to Acacia Avenue, Kololo', 'Matte laminate finish, 6cm circular die-cut.');
  insertOrder.run(adminId, 'ORD-1003', customerIds[2], 'Grace Namukasa Events', '+256 782 519 004', 'Corporate Gala Roll-Up & Flyers', 'Roll-Up Stand Banner x2, A5 Promotional Flyers (500 pcs) x1', 3, 530000, 250000, 'Ready for Collection', daysFromNowIso(1), 'Client driver picking up at 4:00 PM', 'Include gold border framing on both roll-up stands.');
  insertOrder.run(adminId, 'ORD-1004', customerIds[3], 'Makerere Tech Hub', '+256 756 209 117', 'Annual Hackathon Tear Drop Flags', 'Tear Drop Flag Banner (3.4m Complete) x3', 3, 840000, 0, 'Awaiting Deposit', daysFromNowIso(5), 'Deliver to Innovation Village Gate B', 'Double-sided print, cross bases required for indoor/outdoor.');
  insertOrder.run(adminId, 'ORD-1005', customerIds[4], 'Ssemakula Pharmacy Ltd', '+256 779 640 233', 'Staff Branded Polo Uniforms', 'Branded Polo T-Shirts (Heat Press) x12', 12, 420000, 200000, 'New Order', daysFromNowIso(4), 'Deliver to Wandegeya Main Branch', 'Sizes: 4 Medium, 5 Large, 3 XL in navy blue.');

  const insertSale = db.prepare(`
    INSERT INTO sales (
      owner_user_id, receipt_number, order_id, customer_id, customer_name, customer_phone,
      items_json, subtotal, discount, total_amount, amount_paid, balance_due,
      payment_method, payment_status, notes, sale_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSalePayment = db.prepare(`
    INSERT INTO sale_payments (sale_id, amount, payment_method, note, paid_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const sampleSales = [
    {
      receipt: 'SBM-2026-0001',
      custIdx: 3,
      name: 'Makerere Tech Hub',
      phone: '+256 756 209 117',
      items: [
        { product_id: productIds[2], product_name: 'Tear Drop Flag Banner (3.4m Complete)', category: 'Tear Drop Banners', quantity: 2, unit_price: 280000, unit_cost: 145000, line_total: 560000 },
        { product_id: productIds[4], product_name: 'A5 Promotional Flyers (500 pcs)', category: 'Posters & Flyers', quantity: 1, unit_price: 160000, unit_cost: 72000, line_total: 160000 },
      ],
      discount: 20000,
      paid: 700000,
      method: 'Bank Transfer',
      date: monthsAgoIso(4, 18),
      notes: 'Innovation week branding package',
    },
    {
      receipt: 'SBM-2026-0002',
      custIdx: 2,
      name: 'Grace Namukasa Events',
      phone: '+256 782 519 004',
      items: [
        { product_id: productIds[7], product_name: 'Commercial Product & Event Photography', category: 'Photography', quantity: 1, unit_price: 450000, unit_cost: 90000, line_total: 450000 },
        { product_id: productIds[5], product_name: 'A3 Event Posters (50 pcs)', category: 'Posters & Flyers', quantity: 2, unit_price: 95000, unit_cost: 38000, line_total: 190000 },
      ],
      discount: 0,
      paid: 640000,
      method: 'Mobile Money',
      date: monthsAgoIso(3, 12),
      notes: 'Annual awards coverage and posters',
    },
    {
      receipt: 'SBM-2026-0003',
      custIdx: 1,
      name: 'Pearl Roasters Coffee Co.',
      phone: '+256 701 892 440',
      items: [
        { product_id: productIds[6], product_name: 'Corporate Brand Identity & Logo Design', category: 'Graphic Design', quantity: 1, unit_price: 350000, unit_cost: 45000, line_total: 350000 },
        { product_id: productIds[1], product_name: 'Custom Die-Cut Vinyl Stickers (100 pcs)', category: 'Business Stickers', quantity: 5, unit_price: 65000, unit_cost: 26000, line_total: 325000 },
      ],
      discount: 25000,
      paid: 650000,
      method: 'Mobile Money',
      date: monthsAgoIso(2, 20),
      notes: 'New coffee line rebrand + labels',
    },
    {
      receipt: 'SBM-2026-0004',
      custIdx: 4,
      name: 'Ssemakula Pharmacy Ltd',
      phone: '+256 779 640 233',
      items: [
        { product_id: productIds[8], product_name: 'Roll-Up Stand Banner (85x200cm)', category: 'Promotional Banners', quantity: 3, unit_price: 185000, unit_cost: 92000, line_total: 555000 },
        { product_id: productIds[9], product_name: 'Branded Polo T-Shirts (Heat Press)', category: 'Other Printing & Branding', quantity: 10, unit_price: 35000, unit_cost: 19000, line_total: 350000 },
      ],
      discount: 0,
      paid: 905000,
      method: 'Bank Transfer',
      date: monthsAgoIso(1, 15),
      notes: 'Branch launch promotional kit',
    },
    {
      receipt: 'SBM-2026-0005',
      custIdx: 0,
      name: 'Kigozi Hardware & Suppliers',
      phone: '+256 774 320 811',
      items: [
        { product_id: productIds[3], product_name: 'Promotional PVC Banner (6x3 ft)', category: 'Promotional Banners', quantity: 2, unit_price: 75000, unit_cost: 32000, line_total: 150000 },
        { product_id: productIds[0], product_name: 'Matte Laminated Business Cards (100 pcs)', category: 'Business Cards', quantity: 3, unit_price: 45000, unit_cost: 18000, line_total: 135000 },
      ],
      discount: 0,
      paid: 285000,
      method: 'Cash',
      date: daysAgoIso(6),
      notes: 'Paid in full on collection',
    },
    {
      receipt: 'SBM-2026-0006',
      custIdx: 1,
      name: 'Pearl Roasters Coffee Co.',
      phone: '+256 701 892 440',
      items: [
        { product_id: productIds[1], product_name: 'Custom Die-Cut Vinyl Stickers (100 pcs)', category: 'Business Stickers', quantity: 4, unit_price: 65000, unit_cost: 26000, line_total: 260000 },
      ],
      discount: 0,
      paid: 150000,
      method: 'Mobile Money',
      date: daysAgoIso(3),
      notes: '58% deposit paid via MTN MoMo; balance on delivery',
    },
    {
      receipt: 'SBM-2026-0007',
      custIdx: 2,
      name: 'Grace Namukasa Events',
      phone: '+256 782 519 004',
      items: [
        { product_id: productIds[8], product_name: 'Roll-Up Stand Banner (85x200cm)', category: 'Promotional Banners', quantity: 2, unit_price: 185000, unit_cost: 92000, line_total: 370000 },
        { product_id: productIds[4], product_name: 'A5 Promotional Flyers (500 pcs)', category: 'Posters & Flyers', quantity: 1, unit_price: 160000, unit_cost: 72000, line_total: 160000 },
      ],
      discount: 0,
      paid: 250000,
      method: 'Mobile Money',
      date: daysAgoIso(1),
      notes: 'Deposit received; remaining due at pickup',
    },
    {
      receipt: 'SBM-2026-0008',
      custIdx: 0,
      name: 'Kigozi Hardware & Suppliers',
      phone: '+256 774 320 811',
      items: [
        { product_id: productIds[6], product_name: 'Corporate Brand Identity & Logo Design', category: 'Graphic Design', quantity: 1, unit_price: 350000, unit_cost: 45000, line_total: 350000 },
        { product_id: productIds[0], product_name: 'Matte Laminated Business Cards (100 pcs)', category: 'Business Cards', quantity: 2, unit_price: 45000, unit_cost: 18000, line_total: 90000 },
      ],
      discount: 10000,
      paid: 430000,
      method: 'Cash',
      date: daysAgoIso(0),
      notes: 'Today walk-in order paid via cash',
    },
  ];

  for (const s of sampleSales) {
    const subtotal = s.items.reduce((sum, i) => sum + i.line_total, 0);
    const total = Math.max(0, subtotal - s.discount);
    const balance = Math.max(0, total - s.paid);
    const status = balance === 0 ? 'Paid' : s.paid > 0 ? 'Partially Paid' : 'Unpaid';
    const info = insertSale.run(
      adminId,
      s.receipt,
      null,
      customerIds[s.custIdx],
      s.name,
      s.phone,
      JSON.stringify(s.items),
      subtotal,
      s.discount,
      total,
      s.paid,
      balance,
      s.method,
      status,
      s.notes,
      s.date
    );
    if (s.paid > 0) {
      insertSalePayment.run(Number(info.lastInsertRowid), s.paid, s.method, 'Initial payment', `${s.date}T10:30:00`);
    }
  }

  const insertExpense = db.prepare(`
    INSERT INTO expenses (owner_user_id, title, category, amount, payment_method, vendor, notes, expense_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedExpenses: Array<[string, string, number, string, string, string, string]> = [
    ['Workshop Monthly Rent', 'Rent', 550000, 'Bank Transfer', 'Nasser Arcade Management', 'Shop No. 24 monthly lease', monthsAgoIso(2, 3)],
    ['Vinyl & Flex Banner Media Rolls', 'Materials & Printing Costs', 380000, 'Cash', 'Kampala Print Supplies', '440gsm flex and gloss vinyl rolls', monthsAgoIso(2, 10)],
    ['Workshop Monthly Rent', 'Rent', 550000, 'Bank Transfer', 'Nasser Arcade Management', 'Shop No. 24 monthly lease', monthsAgoIso(1, 3)],
    ['Eco-Solvent Inks & Lamination Film', 'Materials & Printing Costs', 410000, 'Mobile Money', 'East Africa Graphics Ltd', 'CMYK 1L bottles + matte pouch roll', monthsAgoIso(1, 14)],
    ['Staff Assistant Wages', 'Salaries & Wages', 450000, 'Mobile Money', 'Print Operator & Finisher', 'Monthly allowance & production commission', monthsAgoIso(1, 27)],
    ['Workshop Monthly Rent', 'Rent', 550000, 'Bank Transfer', 'Nasser Arcade Management', 'Current month shop rent', daysAgoIso(12)],
    ['Umeme Electricity Yaka Token', 'Electricity', 145000, 'Mobile Money', 'Umeme Ltd', 'Heavy plotter & laminator power', daysAgoIso(8)],
    ['Fiber Internet & Adobe Creative Cloud', 'Internet & Subscriptions', 195000, 'Mobile Money', 'Airtel / Adobe', 'Office Wi-Fi + design software', daysAgoIso(5)],
    ['Boda Delivery & Material Pickup', 'Transport', 55000, 'Cash', 'Local Courier', 'Client deliveries in Kololo & Ntinda', daysAgoIso(2)],
    ['Heavy-Duty Guillotine Paper Cutter', 'Equipment Purchases', 240000, 'Cash', 'Nasser Equipment Hub', 'Upgraded A3 stack paper trimmer', daysAgoIso(1)],
  ];

  for (const e of seedExpenses) {
    insertExpense.run(adminId, ...e);
  }
}
