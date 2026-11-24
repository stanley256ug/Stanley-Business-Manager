import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { AppBootstrapData } from '../types';

function cleanId(raw: string | number | undefined, prefix: string): string {
  const base = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  return base || `${prefix}_${Date.now()}`;
}

function clampStr(val: unknown, max: number): string {
  return String(val ?? '').slice(0, max);
}

const VALID_CURRENCIES = ['UGX', 'USD', 'KES', 'TZS'];
const VALID_METHODS = ['Cash', 'Mobile Money', 'Bank Transfer', 'Other'];
const VALID_TEMPLATES = ['executive', 'classic', 'compact'];
const VALID_PRODUCT_CATEGORIES = [
  'Business Cards',
  'Business Stickers',
  'Tear Drop Banners',
  'Promotional Banners',
  'Posters & Flyers',
  'Graphic Design',
  'Photography',
  'Other Printing & Branding',
];
const VALID_EXPENSE_CATEGORIES = [
  'Materials & Printing Costs',
  'Transport',
  'Electricity',
  'Rent',
  'Equipment Purchases',
  'Internet & Subscriptions',
  'Salaries & Wages',
  'Other Business Expenses',
];
const VALID_ORDER_STATUSES = [
  'New Order',
  'Awaiting Deposit',
  'In Production',
  'Ready for Collection',
  'Delivered',
  'Completed',
  'Cancelled',
];
const VALID_PAYMENT_STATUSES = ['Paid', 'Partially Paid', 'Unpaid'];

export async function pushWorkspaceToCloud(
  uid: string,
  data: AppBootstrapData
): Promise<{ pushedCount: number }> {
  const workspacePath = `workspaces/${uid}`;
  const workspaceRef = doc(db, 'workspaces', uid);

  try {
    const existingWs = await getDoc(workspaceRef);
    const s = data.settings;
    const wsPayload = {
      ownerId: uid,
      business_name: clampStr(s.business_name || 'My Business Studio', 150),
      tagline: clampStr(s.tagline, 200),
      logo_url: clampStr(s.logo_url, 500000),
      phone_primary: clampStr(s.phone_primary, 40),
      phone_secondary: clampStr(s.phone_secondary, 40),
      email: clampStr(s.email, 120),
      location: clampStr(s.location, 160),
      currency: VALID_CURRENCIES.includes(s.currency) ? s.currency : 'UGX',
      default_payment_method: VALID_METHODS.includes(s.default_payment_method)
        ? s.default_payment_method
        : 'Mobile Money',
      receipt_template: VALID_TEMPLATES.includes(s.receipt_template)
        ? s.receipt_template
        : 'executive',
      receipt_thank_you: clampStr(s.receipt_thank_you, 400),
      receipt_prefix: clampStr(s.receipt_prefix || 'SBM', 10),
      next_receipt_seq: Math.max(1, Number(s.next_receipt_seq) || 1),
      createdAt: existingWs.exists() ? existingWs.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(workspaceRef, wsPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, workspacePath);
  }

  let pushedCount = 0;

  // Products
  for (const p of data.products) {
    const syncId = cleanId(p.client_sync_id || `prod_${p.id}`, 'prod');
    const path = `workspaces/${uid}/products/${syncId}`;
    try {
      const ref = doc(db, 'workspaces', uid, 'products', syncId);
      const snap = await getDoc(ref);
      await setDoc(ref, {
        ownerId: uid,
        clientSyncId: syncId,
        name: clampStr(p.name, 160) || 'Product',
        category: VALID_PRODUCT_CATEGORIES.includes(p.category)
          ? p.category
          : 'Other Printing & Branding',
        description: clampStr(p.description, 400),
        unit_price: Math.max(0, Number(p.unit_price) || 0),
        production_cost: Math.max(0, Number(p.production_cost) || 0),
        unit_label: clampStr(p.unit_label || 'piece', 40),
        is_active: Boolean(p.is_active),
        createdAt: snap.exists() ? snap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushedCount++;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  // Customers
  for (const c of data.customers) {
    const syncId = cleanId(c.client_sync_id || `cust_${c.id}`, 'cust');
    const path = `workspaces/${uid}/customers/${syncId}`;
    try {
      const ref = doc(db, 'workspaces', uid, 'customers', syncId);
      const snap = await getDoc(ref);
      await setDoc(ref, {
        ownerId: uid,
        clientSyncId: syncId,
        name: clampStr(c.name, 160) || 'Customer',
        phone: clampStr(c.phone, 40),
        email: clampStr(c.email, 120),
        location: clampStr(c.location, 160),
        notes: clampStr(c.notes, 1000),
        createdAt: snap.exists() ? snap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushedCount++;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  // Orders
  for (const o of data.orders) {
    const syncId = cleanId(o.client_sync_id || o.order_number || `ord_${o.id}`, 'ord');
    const path = `workspaces/${uid}/orders/${syncId}`;
    try {
      const ref = doc(db, 'workspaces', uid, 'orders', syncId);
      const snap = await getDoc(ref);
      await setDoc(ref, {
        ownerId: uid,
        clientSyncId: syncId,
        order_number: clampStr(o.order_number, 40) || `ORD-${o.id}`,
        customer_name: clampStr(o.customer_name, 160) || 'Customer',
        customer_phone: clampStr(o.customer_phone, 40),
        title: clampStr(o.title, 200) || 'Print Order',
        items_summary: clampStr(o.items_summary, 500),
        quantity: Math.max(1, Number(o.quantity) || 1),
        total_amount: Math.max(0, Number(o.total_amount) || 0),
        deposit_paid: Math.max(0, Number(o.deposit_paid) || 0),
        status: VALID_ORDER_STATUSES.includes(o.status) ? o.status : 'New Order',
        deadline: clampStr(o.deadline, 30),
        delivery_details: clampStr(o.delivery_details, 300),
        instructions: clampStr(o.instructions, 1000),
        createdAt: snap.exists() ? snap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushedCount++;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  // Sales
  for (const s of data.sales) {
    const syncId = cleanId(s.client_sync_id || s.receipt_number || `sale_${s.id}`, 'sale');
    const path = `workspaces/${uid}/sales/${syncId}`;
    try {
      const ref = doc(db, 'workspaces', uid, 'sales', syncId);
      const snap = await getDoc(ref);
      const boundedItems = (s.items || []).slice(0, 50).map((it) => ({
        product_name: clampStr(it.product_name, 160),
        category: clampStr(it.category || 'Other Printing & Branding', 80),
        quantity: Math.max(1, Number(it.quantity) || 1),
        unit_price: Math.max(0, Number(it.unit_price) || 0),
        unit_cost: Math.max(0, Number(it.unit_cost) || 0),
        line_total: Math.max(0, Number(it.line_total) || 0),
      }));
      if (boundedItems.length === 0) {
        boundedItems.push({
          product_name: 'Printing Service',
          category: 'Other Printing & Branding',
          quantity: 1,
          unit_price: Math.max(0, Number(s.total_amount) || 0),
          unit_cost: 0,
          line_total: Math.max(0, Number(s.total_amount) || 0),
        });
      }

      await setDoc(ref, {
        ownerId: uid,
        clientSyncId: syncId,
        receipt_number: clampStr(s.receipt_number, 40),
        customer_name: clampStr(s.customer_name, 160) || 'Walk-in Customer',
        customer_phone: clampStr(s.customer_phone, 40),
        items: boundedItems,
        subtotal: Math.max(0, Number(s.subtotal) || 0),
        discount: Math.max(0, Number(s.discount) || 0),
        total_amount: Math.max(0, Number(s.total_amount) || 0),
        amount_paid: Math.max(0, Number(s.amount_paid) || 0),
        balance_due: Math.max(0, Number(s.balance_due) || 0),
        payment_method: VALID_METHODS.includes(s.payment_method) ? s.payment_method : 'Cash',
        payment_status: VALID_PAYMENT_STATUSES.includes(s.payment_status)
          ? s.payment_status
          : 'Paid',
        notes: clampStr(s.notes, 500),
        sale_date: clampStr(s.sale_date || new Date().toISOString().slice(0, 10), 30),
        createdAt: snap.exists() ? snap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushedCount++;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  // Expenses
  for (const e of data.expenses) {
    const syncId = cleanId(e.client_sync_id || `exp_${e.id}`, 'exp');
    const path = `workspaces/${uid}/expenses/${syncId}`;
    try {
      const ref = doc(db, 'workspaces', uid, 'expenses', syncId);
      const snap = await getDoc(ref);
      await setDoc(ref, {
        ownerId: uid,
        clientSyncId: syncId,
        title: clampStr(e.title, 200) || 'Business Expense',
        category: VALID_EXPENSE_CATEGORIES.includes(e.category)
          ? e.category
          : 'Other Business Expenses',
        amount: Math.max(0, Number(e.amount) || 0),
        payment_method: VALID_METHODS.includes(e.payment_method) ? e.payment_method : 'Cash',
        vendor: clampStr(e.vendor, 160),
        notes: clampStr(e.notes, 500),
        expense_date: clampStr(e.expense_date || new Date().toISOString().slice(0, 10), 30),
        createdAt: snap.exists() ? snap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushedCount++;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  return { pushedCount };
}

export async function pullWorkspaceFromCloud(uid: string): Promise<{
  settings: any | null;
  products: any[];
  customers: any[];
  orders: any[];
  sales: any[];
  expenses: any[];
}> {
  const wsPath = `workspaces/${uid}`;
  let settings: any = null;
  try {
    const wsSnap = await getDoc(doc(db, 'workspaces', uid));
    if (wsSnap.exists()) {
      settings = wsSnap.data();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, wsPath);
  }

  const fetchCollection = async (sub: string) => {
    const colPath = `workspaces/${uid}/${sub}`;
    try {
      const q = query(collection(db, 'workspaces', uid, sub), where('ownerId', '==', uid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, colPath);
    }
  };

  const [products, customers, orders, sales, expenses] = await Promise.all([
    fetchCollection('products'),
    fetchCollection('customers'),
    fetchCollection('orders'),
    fetchCollection('sales'),
    fetchCollection('expenses'),
  ]);

  return { settings, products, customers, orders, sales, expenses };
}
