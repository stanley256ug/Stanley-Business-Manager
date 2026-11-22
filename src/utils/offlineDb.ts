import { AppBootstrapData } from '../types';

const DB_NAME = 'stanley_business_offline_db';
const DB_VERSION = 1;
const STORE_SNAPSHOT = 'snapshot';
const STORE_OUTBOX = 'outbox';
const SNAPSHOT_KEY = 'latest_bootstrap';

export type OutboxOperationType =
  | 'create_sale'
  | 'record_payment'
  | 'delete_sale'
  | 'create_expense'
  | 'update_expense'
  | 'delete_expense'
  | 'create_product'
  | 'update_product'
  | 'delete_product'
  | 'create_customer'
  | 'update_customer'
  | 'delete_customer'
  | 'create_order'
  | 'update_order'
  | 'delete_order'
  | 'update_settings';

export interface OutboxItem {
  id: string;
  operation: OutboxOperationType;
  targetId?: number;
  payload: any;
  createdAt: string;
  retries: number;
  lastError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) {
        db.createObjectStore(STORE_SNAPSHOT);
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function generateClientSyncId(prefix = 'sbm'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveOfflineSnapshot(data: AppBootstrapData): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOT, 'readwrite');
      tx.objectStore(STORE_SNAPSHOT).put(data, SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // fallback silently if storage quota or private mode blocks IDB
  }
}

export async function loadOfflineSnapshot(): Promise<AppBootstrapData | null> {
  try {
    const db = await openDb();
    const result = await new Promise<AppBootstrapData | null>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOT, 'readonly');
      const req = tx.objectStore(STORE_SNAPSHOT).get(SNAPSHOT_KEY);
      req.onsuccess = () => resolve((req.result as AppBootstrapData) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function enqueueOutbox(
  operation: OutboxOperationType,
  payload: any,
  targetId?: number
): Promise<OutboxItem> {
  const item: OutboxItem = {
    id: generateClientSyncId('op'),
    operation,
    targetId,
    payload,
    createdAt: new Date().toISOString(),
    retries: 0,
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    tx.objectStore(STORE_OUTBOX).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return item;
}

export async function getOutboxItems(): Promise<OutboxItem[]> {
  try {
    const db = await openDb();
    const items = await new Promise<OutboxItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX, 'readonly');
      const req = tx.objectStore(STORE_OUTBOX).getAll();
      req.onsuccess = () => resolve((req.result as OutboxItem[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  } catch {
    return [];
  }
}

export async function removeOutboxItem(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    tx.objectStore(STORE_OUTBOX).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function markOutboxRetry(item: OutboxItem, errorMessage: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    tx.objectStore(STORE_OUTBOX).put({
      ...item,
      retries: item.retries + 1,
      lastError: errorMessage,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
