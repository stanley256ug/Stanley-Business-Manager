export type PaymentMethod = 'Cash' | 'Mobile Money' | 'Bank Transfer' | 'Other';

export type PaymentStatus = 'Paid' | 'Partially Paid' | 'Unpaid';

export type OrderStatus =
  | 'New Order'
  | 'Awaiting Deposit'
  | 'In Production'
  | 'Ready for Collection'
  | 'Delivered'
  | 'Completed'
  | 'Cancelled';

export type ProductCategory =
  | 'Business Cards'
  | 'Business Stickers'
  | 'Tear Drop Banners'
  | 'Promotional Banners'
  | 'Posters & Flyers'
  | 'Graphic Design'
  | 'Photography'
  | 'Other Printing & Branding';

export type ExpenseCategory =
  | 'Materials & Printing Costs'
  | 'Transport'
  | 'Electricity'
  | 'Rent'
  | 'Equipment Purchases'
  | 'Internet & Subscriptions'
  | 'Salaries & Wages'
  | 'Other Business Expenses';

export type ReceiptTemplate = 'executive' | 'classic' | 'compact';

export interface UserProfile {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role: 'Administrator' | 'Business Owner' | 'Staff';
  is_default_password: boolean;
  last_login_at: string | null;
  auth_provider?: 'local' | 'google' | 'icloud';
  status?: 'active' | 'suspended';
  security_question?: string | null;
  has_recovery_key?: boolean;
  subscription_plan?: 'legacy' | 'trial_24h' | 'monthly_1m' | 'annual_1y';
  subscription_status?: 'active' | 'pending_verification' | 'expired' | 'rejected';
  subscription_expires_at?: string | null;
}

export interface BusinessSettings {
  id: number;
  owner_user_id?: number;
  business_name: string;
  tagline: string;
  logo_url: string;
  phone_primary: string;
  phone_secondary: string;
  email: string;
  location: string;
  currency: string;
  default_payment_method: PaymentMethod;
  receipt_template: ReceiptTemplate;
  receipt_thank_you: string;
  receipt_prefix: string;
  next_receipt_seq: number;
  inactivity_timeout_minutes?: number;
  profile_completed?: number | boolean;
  updated_at: string;
}

export interface Product {
  id: number;
  name: string;
  category: ProductCategory;
  description: string;
  unit_price: number;
  production_cost: number;
  unit_label: string;
  is_active: number;
  client_sync_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string;
  location: string;
  notes: string;
  client_sync_id?: string;
  created_at: string;
  updated_at: string;
  total_spent?: number;
  outstanding_balance?: number;
  order_count?: number;
  sale_count?: number;
}

export interface SaleItem {
  product_id?: number | null;
  product_name: string;
  category?: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  line_total: number;
}

export interface SalePayment {
  id: number;
  sale_id: number;
  amount: number;
  payment_method: PaymentMethod;
  note: string;
  paid_at: string;
}

export interface Sale {
  id: number;
  receipt_number: string;
  order_id: number | null;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  notes: string;
  sale_date: string;
  client_sync_id?: string;
  created_at: string;
  updated_at: string;
  payments?: SalePayment[];
}

export interface Order {
  id: number;
  order_number: string;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  title: string;
  items_summary: string;
  quantity: number;
  total_amount: number;
  deposit_paid: number;
  status: OrderStatus;
  deadline: string;
  delivery_details: string;
  instructions: string;
  client_sync_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: number;
  title: string;
  category: ExpenseCategory;
  amount: number;
  payment_method: PaymentMethod;
  vendor: string;
  notes: string;
  expense_date: string;
  client_sync_id?: string;
  created_at: string;
}

export interface AppBootstrapData {
  settings: BusinessSettings;
  products: Product[];
  customers: Customer[];
  orders: Order[];
  sales: Sale[];
  expenses: Expense[];
}

export type NavSection =
  | 'admin'
  | 'dashboard'
  | 'sales'
  | 'expenses'
  | 'receipts'
  | 'orders'
  | 'products'
  | 'customers'
  | 'analytics'
  | 'reports'
  | 'settings';

export interface AdminManagedUser {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role: 'Administrator' | 'Business Owner' | 'Staff';
  auth_provider: 'local' | 'google' | 'icloud';
  status: 'active' | 'suspended';
  last_login_at: string | null;
  created_at: string;
  business_name: string;
  location: string;
  currency: string;
  profile_completed: boolean;
  sales_count: number;
  orders_count: number;
  customers_count: number;
  expenses_count: number;
  total_sales_amount: number;
  active_sessions_count: number;
  login_count: number;
  subscription_plan?: string;
  subscription_status?: string;
  subscription_expires_at?: string | null;
}

export interface AdminLoginEvent {
  id: number;
  user_id: number | null;
  identifier: string;
  username: string;
  full_name: string;
  email: string;
  auth_method: string;
  status: 'success' | 'failed' | 'register' | 'password_reset' | 'logout';
  failure_reason: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
}

export interface AdminActiveSession {
  session_id: number;
  token_prefix: string;
  user_id: number;
  username: string;
  full_name: string;
  email: string;
  role: string;
  is_current: boolean;
  created_at: string;
  expires_at: string;
}

export interface AdminAuditLog {
  id: number;
  actor_user_id: number | null;
  actor_username: string;
  action: string;
  target_type: string;
  target_id: string;
  details: string;
  created_at: string;
}

export interface AdminSystemSummary {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  activeSessions: number;
  expiredSessions: number;
  logins24h: number;
  failedLogins24h: number;
  totalWorkspaces: number;
  totalProductsCount: number;
  totalSalesCount: number;
  totalOrdersCount: number;
  totalCustomersCount: number;
  totalExpensesCount: number;
  databaseSizeBytes: number;
  nodeVersion: string;
  uptimeSeconds: number;
  serverTime: string;
  billingRevenueUgx?: number;
  pendingBillingCount?: number;
  activeTrialsCount?: number;
}

export interface BillingSubscription {
  id: number;
  pass_code: string;
  user_id: number | null;
  username?: string | null;
  user_full_name?: string | null;
  user_email?: string | null;
  plan_code: 'trial_24h' | 'monthly_1m' | 'annual_1y';
  plan_name: string;
  amount_ugx: number;
  payment_provider: 'trial' | 'airtel' | 'mtn';
  recipient_number: string;
  payer_phone: string;
  payer_name: string;
  transaction_id: string;
  status: 'active' | 'pending_verification' | 'verified' | 'rejected' | 'expired';
  starts_at: string;
  expires_at: string;
  reviewed_by_user_id: number | null;
  reviewed_at: string | null;
  notes: string;
  created_at: string;
}

export interface AdminOverviewResponse {
  summary: AdminSystemSummary;
  users: AdminManagedUser[];
  loginEvents: AdminLoginEvent[];
  activeSessions: AdminActiveSession[];
  auditLogs: AdminAuditLog[];
  billingSubscriptions?: BillingSubscription[];
}

export interface AppNotification {
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

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  appVersion: string;
  printCurrent: () => Promise<{ ok: boolean; error?: string }>;
  checkForUpdates: () => Promise<{ supported: boolean; message: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
