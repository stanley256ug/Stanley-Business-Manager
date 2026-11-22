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
  role: 'Administrator' | 'Staff';
  is_default_password: boolean;
  last_login_at: string | null;
  auth_provider?: 'local' | 'google';
  security_question?: string | null;
  has_recovery_key?: boolean;
}

export interface BusinessSettings {
  id: number;
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
