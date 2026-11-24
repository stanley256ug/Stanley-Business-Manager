const DEFAULT_SERVER_URL =
  'https://ais-pre-lg7iq64pqxr4tdimmhmsvz-553917761561.europe-west3.run.app';
const DEV_SERVER_URL =
  'https://ais-dev-lg7iq64pqxr4tdimmhmsvz-553917761561.europe-west3.run.app';
const LOCAL_SERVER_URL = 'http://localhost:3000';

const EXPENSE_CATEGORIES = [
  'Materials & Printing Costs',
  'Transport',
  'Electricity',
  'Rent',
  'Equipment Purchases',
  'Internet & Subscriptions',
  'Salaries & Wages',
  'Other Business Expenses',
];

const PAYMENT_METHODS = ['Cash', 'Mobile Money', 'Bank Transfer', 'Other'];

const state = {
  serverUrl: DEFAULT_SERVER_URL,
  token: null,
  user: null,
  bootstrap: null,
  outbox: [],
  activeTab: 'overview',
  notice: null,
  loading: true,
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== undefined && v !== null) {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

function formatMoney(amount, currency = 'UGX') {
  const num = Number(amount) || 0;
  try {
    return `${currency} ${num.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  } catch {
    return `${currency} ${Math.round(num)}`;
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function makeSyncId(prefix) {
  if (crypto && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function setStorage(obj) {
  return chrome.storage.local.set(obj);
}

async function apiCall(path, options = {}) {
  const base = state.serverUrl.replace(/\/+$/, '');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function setNotice(message, type = 'success') {
  state.notice = { message, type };
  render();
  setTimeout(() => {
    if (state.notice && state.notice.message === message) {
      state.notice = null;
      render();
    }
  }, 4000);
}

async function openFullAppTab() {
  const targetUrl = state.serverUrl.replace(/\/+$/, '') + '/';
  await chrome.tabs.create({ url: targetUrl });
}

async function openSidePanel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.windowId && chrome.sidePanel && chrome.sidePanel.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    }
  } catch {
    setNotice('Open Chrome Side Panel from the browser toolbar icon.', 'warn');
  }
}

async function refreshBootstrap() {
  if (!state.token) return;
  try {
    const data = await apiCall('/api/bootstrap', { method: 'GET' });
    state.bootstrap = data;
    await setStorage({ [`cache_${state.user?.id || 'default'}`]: data });
  } catch (err) {
    if (err.status === 401) {
      await handleLogout();
      setNotice('Session expired. Please sign in again.', 'error');
      return;
    }
    const cached = await getStorage([`cache_${state.user?.id || 'default'}`]);
    const saved = cached[`cache_${state.user?.id || 'default'}`];
    if (saved) {
      state.bootstrap = saved;
      setNotice('Offline mode — showing cached workspace records.', 'warn');
    } else {
      setNotice(err.message || 'Could not reach server.', 'error');
    }
  }
}

async function flushOutboxNow() {
  if (!state.token || state.outbox.length === 0) return;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'FLUSH_OUTBOX' });
    const updated = await getStorage(['sbm_outbox']);
    state.outbox = Array.isArray(updated.sbm_outbox) ? updated.sbm_outbox : [];
    await refreshBootstrap();
    if (resp && resp.synced > 0) {
      setNotice(`Synced ${resp.synced} queued item(s) to server.`);
    } else if (state.outbox.length === 0) {
      setNotice('All records are synced.');
    } else {
      setNotice('Still offline — queued items remain safely saved.', 'warn');
    }
  } catch {
    setNotice('Sync deferred until server is reachable.', 'warn');
  }
  render();
}

async function handleSignIn(identifier, password, serverUrl) {
  state.serverUrl = serverUrl;
  await setStorage({ sbm_server_url: serverUrl });
  const data = await apiCall('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
  state.token = data.token;
  state.user = data.user;
  await setStorage({ sbm_token: data.token, sbm_user: data.user });
  await refreshBootstrap();
  state.notice = null;
  render();
}

async function handleLogout() {
  try {
    if (state.token) {
      await apiCall('/api/auth/logout', { method: 'POST' });
    }
  } catch {
    // ignore network error on sign out
  }
  state.token = null;
  state.user = null;
  state.bootstrap = null;
  await chrome.storage.local.remove(['sbm_token', 'sbm_user']);
  render();
}

async function queueOfflineOp(operation, payload) {
  const item = {
    id: makeSyncId('extop'),
    userId: state.user?.id,
    serverUrl: state.serverUrl,
    token: state.token,
    operation,
    payload,
    createdAt: new Date().toISOString(),
  };
  state.outbox = [...state.outbox, item];
  await setStorage({ sbm_outbox: state.outbox });
  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' }).catch(() => {});
}

function buildTopbar() {
  const surface = document.body.dataset.surface || 'popup';
  const bizName = state.bootstrap?.settings?.business_name || 'STANLEY BUSINESS MANAGER';
  const actions = [];

  if (surface === 'popup' && state.user) {
    actions.push(
      el('button', {
        type: 'button',
        className: 'icon-btn',
        textContent: 'Side Panel',
        onClick: () => void openSidePanel(),
      })
    );
  }
  actions.push(
    el('button', {
      type: 'button',
      className: 'icon-btn',
      textContent: 'Full App',
      onClick: () => void openFullAppTab(),
    })
  );
  if (state.user) {
    actions.push(
      el('button', {
        type: 'button',
        className: 'icon-btn',
        textContent: 'Sign Out',
        onClick: () => void handleLogout(),
      })
    );
  }

  return el('header', { className: 'topbar' }, [
    el('div', { className: 'brand-wrap' }, [
      el('img', { src: 'icons/icon48.png', alt: 'Logo', className: 'brand-icon' }),
      el('div', { style: 'min-width:0;' }, [
        el('div', { className: 'brand-kicker', textContent: 'STANLEY BUSINESS MANAGER' }),
        el('div', { className: 'brand-title', textContent: state.user ? bizName : 'Chrome Workspace' }),
      ]),
    ]),
    el('div', { className: 'topbar-actions' }, actions),
  ]);
}

function buildLoginView() {
  let serverChoice =
    state.serverUrl === DEV_SERVER_URL
      ? DEV_SERVER_URL
      : state.serverUrl === LOCAL_SERVER_URL
      ? LOCAL_SERVER_URL
      : DEFAULT_SERVER_URL;

  const serverSelect = el('select', {}, [
    el('option', { value: DEFAULT_SERVER_URL, textContent: 'Production Shared App (Cloud)' }),
    el('option', { value: DEV_SERVER_URL, textContent: 'Development Preview Server' }),
    el('option', { value: LOCAL_SERVER_URL, textContent: 'Local Server (localhost:3000)' }),
  ]);
  serverSelect.value = serverChoice;

  const idInput = el('input', {
    type: 'text',
    required: 'true',
    placeholder: 'Username or email',
  });
  const passInput = el('input', {
    type: 'password',
    required: 'true',
    placeholder: 'Enter password',
  });
  const submitBtn = el('button', {
    type: 'submit',
    className: 'btn btn-primary',
    textContent: 'Sign In to Workspace',
  });

  const form = el(
    'form',
    {
      className: 'card',
      onSubmit: async (e) => {
        e.preventDefault();
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';
        try {
          await handleSignIn(idInput.value.trim(), passInput.value, serverSelect.value);
        } catch (err) {
          setNotice(err.message || 'Invalid credentials.', 'error');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In to Workspace';
        }
      },
    },
    [
      el('div', {}, [
        el('div', { className: 'card-title', textContent: 'Sign In to Your Business' }),
        el('p', {
          className: 'muted',
          textContent: 'Access live sales, receipts, expenses, and offline quick entry from Chrome.',
        }),
      ]),
      el('div', { className: 'field' }, [
        el('label', { textContent: 'Workspace Server' }),
        serverSelect,
      ]),
      el('div', { className: 'field' }, [
        el('label', { textContent: 'Username or Email' }),
        idInput,
      ]),
      el('div', { className: 'field' }, [
        el('label', { textContent: 'Password' }),
        passInput,
      ]),
      submitBtn,
      el('button', {
        type: 'button',
        className: 'btn btn-outline',
        textContent: 'Create Account or Sign In with Google (Full App)',
        onClick: () => void openFullAppTab(),
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-outline',
        textContent: 'Extension Server Settings',
        onClick: () => chrome.runtime.openOptionsPage(),
      }),
    ]
  );

  return form;
}

function buildOverviewTab(boot) {
  const currency = boot.settings?.currency || 'UGX';
  const totalIncome = (boot.sales || []).reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
  const totalExpenses = (boot.expenses || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const netProfit = totalIncome - totalExpenses;
  const outstanding = (boot.sales || []).reduce((s, r) => s + (Number(r.balance_due) || 0), 0);
  const pendingOrders = (boot.orders || []).filter(
    (o) => o.status !== 'Completed' && o.status !== 'Cancelled'
  ).length;

  const recentSales = (boot.sales || []).slice(0, 5);

  return el('div', { style: 'display:flex;flex-direction:column;gap:10px;' }, [
    el('div', { className: 'kpi-grid' }, [
      el('div', { className: 'kpi-box' }, [
        el('div', { className: 'kpi-label', textContent: 'Total Income' }),
        el('div', { className: 'kpi-value', textContent: formatMoney(totalIncome, currency) }),
      ]),
      el('div', { className: 'kpi-box' }, [
        el('div', { className: 'kpi-label', textContent: 'Expenditures' }),
        el('div', { className: 'kpi-value expense', textContent: formatMoney(totalExpenses, currency) }),
      ]),
      el('div', { className: 'kpi-box' }, [
        el('div', { className: 'kpi-label', textContent: 'Net Profit' }),
        el('div', { className: 'kpi-value profit', textContent: formatMoney(netProfit, currency) }),
      ]),
      el('div', { className: 'kpi-box' }, [
        el('div', { className: 'kpi-label', textContent: `Due (${pendingOrders} Active Orders)` }),
        el('div', { className: 'kpi-value', textContent: formatMoney(outstanding, currency) }),
      ]),
    ]),
    el('div', { className: 'card' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' }, [
        el('div', { className: 'card-title', textContent: 'Recent Sales & Receipts' }),
        el('button', {
          type: 'button',
          className: 'btn btn-outline',
          style: 'height:26px;padding:0 8px;font-size:11px;',
          textContent: 'Refresh',
          onClick: async () => {
            await refreshBootstrap();
            render();
          },
        }),
      ]),
      recentSales.length === 0
        ? el('p', {
            className: 'muted',
            textContent: 'No sales recorded yet. Use Quick Sale to record your first receipt.',
          })
        : el(
            'div',
            { className: 'list' },
            recentSales.map((s) =>
              el('div', { className: 'list-item' }, [
                el('div', { className: 'list-main' }, [
                  el('div', { className: 'list-title', textContent: `${s.receipt_number} · ${s.customer_name}` }),
                  el('div', { className: 'list-sub', textContent: `${s.sale_date} · ${s.payment_status}` }),
                ]),
                el('div', { className: 'list-amount', textContent: formatMoney(s.total_amount, currency) }),
              ])
            )
          ),
    ]),
  ]);
}

function buildQuickSaleTab(boot) {
  const currency = boot.settings?.currency || 'UGX';
  const products = (boot.products || []).filter((p) => p.is_active !== 0);

  const custInput = el('input', { type: 'text', required: 'true', placeholder: 'Walk-in or Customer Name' });
  const phoneInput = el('input', { type: 'text', placeholder: '+256 7XX...' });

  const productSelect = el('select', {}, [
    el('option', { value: '', textContent: 'Custom product / service...' }),
    ...products.map((p) =>
      el('option', {
        value: String(p.id),
        textContent: `${p.name} (${formatMoney(p.unit_price, currency)})`,
      })
    ),
  ]);

  const itemNameInput = el('input', { type: 'text', required: 'true', placeholder: 'Product or service name' });
  const qtyInput = el('input', { type: 'number', min: '1', value: '1', required: 'true' });
  const priceInput = el('input', { type: 'number', min: '0', value: '0', required: 'true' });
  const paidInput = el('input', { type: 'number', min: '0', value: '0', required: 'true' });
  const methodSelect = el(
    'select',
    {},
    PAYMENT_METHODS.map((m) => el('option', { value: m, textContent: m }))
  );
  methodSelect.value = boot.settings?.default_payment_method || 'Mobile Money';

  const totalText = el('strong', { textContent: formatMoney(0, currency) });

  const syncTotal = () => {
    const total = Math.max(1, Number(qtyInput.value) || 1) * Math.max(0, Number(priceInput.value) || 0);
    totalText.textContent = formatMoney(total, currency);
    return total;
  };

  productSelect.addEventListener('change', () => {
    const selected = products.find((p) => String(p.id) === productSelect.value);
    if (selected) {
      itemNameInput.value = selected.name;
      priceInput.value = String(selected.unit_price);
      const total = syncTotal();
      paidInput.value = String(total);
    }
  });

  qtyInput.addEventListener('input', () => {
    const total = syncTotal();
    paidInput.value = String(total);
  });
  priceInput.addEventListener('input', () => {
    const total = syncTotal();
    paidInput.value = String(total);
  });

  const submitBtn = el('button', {
    type: 'submit',
    className: 'btn btn-primary',
    textContent: 'Record Sale & Receipt',
  });

  return el(
    'form',
    {
      className: 'card',
      onSubmit: async (e) => {
        e.preventDefault();
        const qty = Math.max(1, Number(qtyInput.value) || 1);
        const unitPrice = Math.max(0, Number(priceInput.value) || 0);
        const lineTotal = qty * unitPrice;
        const selected = products.find((p) => String(p.id) === productSelect.value);

        const payload = {
          customer_name: custInput.value.trim() || 'Walk-in Customer',
          customer_phone: phoneInput.value.trim(),
          items: [
            {
              product_id: selected ? selected.id : null,
              product_name: itemNameInput.value.trim() || 'Business Service',
              category: selected ? selected.category : 'Other Printing & Branding',
              quantity: qty,
              unit_price: unitPrice,
              unit_cost: selected ? Number(selected.production_cost) || 0 : 0,
              line_total: lineTotal,
            },
          ],
          discount: 0,
          amount_paid: Math.min(lineTotal, Math.max(0, Number(paidInput.value) || 0)),
          payment_method: methodSelect.value,
          sale_date: todayIso(),
          client_sync_id: makeSyncId('sale'),
        };

        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
        try {
          const res = await apiCall('/api/sales', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          await refreshBootstrap();
          state.activeTab = 'overview';
          setNotice(`Sale ${res.sale.receipt_number} recorded.`);
        } catch (err) {
          if (typeof err.status === 'number') {
            setNotice(err.message || 'Could not save sale.', 'error');
          } else {
            await queueOfflineOp('create_sale', payload);
            state.activeTab = 'overview';
            setNotice('Offline: sale queued and will sync automatically.', 'warn');
          }
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Record Sale & Receipt';
        }
      },
    },
    [
      el('div', { className: 'card-title', textContent: 'Quick Sale & Receipt Entry' }),
      el('div', { className: 'row-2' }, [
        el('div', { className: 'field' }, [el('label', { textContent: 'Customer Name *' }), custInput]),
        el('div', { className: 'field' }, [el('label', { textContent: 'Phone' }), phoneInput]),
      ]),
      products.length > 0
        ? el('div', { className: 'field' }, [el('label', { textContent: 'Catalog Shortcut' }), productSelect])
        : null,
      el('div', { className: 'field' }, [el('label', { textContent: 'Item / Service *' }), itemNameInput]),
      el('div', { className: 'row-2' }, [
        el('div', { className: 'field' }, [el('label', { textContent: 'Quantity' }), qtyInput]),
        el('div', { className: 'field' }, [el('label', { textContent: `Unit Price (${currency})` }), priceInput]),
      ]),
      el('div', { className: 'row-2' }, [
        el('div', { className: 'field' }, [el('label', { textContent: `Amount Paid (${currency})` }), paidInput]),
        el('div', { className: 'field' }, [el('label', { textContent: 'Payment Method' }), methodSelect]),
      ]),
      el('div', { className: 'summary-bar' }, [
        el('span', { textContent: 'Sale Total' }),
        totalText,
      ]),
      submitBtn,
    ]
  );
}

function buildQuickExpenseTab(boot) {
  const currency = boot.settings?.currency || 'UGX';
  const titleInput = el('input', { type: 'text', required: 'true', placeholder: 'e.g. Printing ink, Transport' });
  const catSelect = el(
    'select',
    {},
    EXPENSE_CATEGORIES.map((c) => el('option', { value: c, textContent: c }))
  );
  const amountInput = el('input', { type: 'number', min: '0', required: 'true', placeholder: '0' });
  const vendorInput = el('input', { type: 'text', placeholder: 'Supplier or payee' });
  const methodSelect = el(
    'select',
    {},
    PAYMENT_METHODS.map((m) => el('option', { value: m, textContent: m }))
  );

  const submitBtn = el('button', {
    type: 'submit',
    className: 'btn btn-gold',
    textContent: 'Save Expense',
  });

  return el(
    'form',
    {
      className: 'card',
      onSubmit: async (e) => {
        e.preventDefault();
        const payload = {
          title: titleInput.value.trim(),
          category: catSelect.value,
          amount: Math.max(0, Number(amountInput.value) || 0),
          vendor: vendorInput.value.trim(),
          payment_method: methodSelect.value,
          expense_date: todayIso(),
          client_sync_id: makeSyncId('exp'),
        };

        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
        try {
          await apiCall('/api/expenses', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          await refreshBootstrap();
          state.activeTab = 'overview';
          setNotice('Business expense recorded.');
        } catch (err) {
          if (typeof err.status === 'number') {
            setNotice(err.message || 'Could not save expense.', 'error');
          } else {
            await queueOfflineOp('create_expense', payload);
            state.activeTab = 'overview';
            setNotice('Offline: expense queued and will sync automatically.', 'warn');
          }
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Expense';
        }
      },
    },
    [
      el('div', { className: 'card-title', textContent: 'Quick Expense Logger' }),
      el('div', { className: 'field' }, [el('label', { textContent: 'Expense Description *' }), titleInput]),
      el('div', { className: 'field' }, [el('label', { textContent: 'Category' }), catSelect]),
      el('div', { className: 'row-2' }, [
        el('div', { className: 'field' }, [el('label', { textContent: `Amount (${currency}) *` }), amountInput]),
        el('div', { className: 'field' }, [el('label', { textContent: 'Payment Method' }), methodSelect]),
      ]),
      el('div', { className: 'field' }, [el('label', { textContent: 'Vendor / Supplier' }), vendorInput]),
      submitBtn,
    ]
  );
}

function render() {
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();

  root.appendChild(buildTopbar());

  const container = el('main', { className: 'container' });

  if (state.notice) {
    const cls =
      state.notice.type === 'error'
        ? 'banner banner-error'
        : state.notice.type === 'warn'
        ? 'banner banner-warn'
        : 'banner banner-success';
    container.appendChild(el('div', { className: cls, textContent: state.notice.message }));
  }

  if (state.loading) {
    container.appendChild(
      el('div', { className: 'card' }, [
        el('p', { className: 'muted', textContent: 'Loading workspace...' }),
      ])
    );
    root.appendChild(container);
    return;
  }

  if (!state.token || !state.user) {
    container.appendChild(buildLoginView());
    root.appendChild(container);
    return;
  }

  if (state.outbox.length > 0) {
    container.appendChild(
      el('div', { className: 'banner banner-warn' }, [
        el('span', { textContent: `${state.outbox.length} offline record(s) pending sync` }),
        el('button', {
          type: 'button',
          className: 'btn btn-outline',
          style: 'height:26px;padding:0 8px;font-size:11px;',
          textContent: 'Sync Now',
          onClick: () => void flushOutboxNow(),
        }),
      ])
    );
  }

  const tabs = el('div', { className: 'tabs' }, [
    el('button', {
      type: 'button',
      className: `tab-btn ${state.activeTab === 'overview' ? 'active' : ''}`,
      textContent: 'Overview',
      onClick: () => {
        state.activeTab = 'overview';
        render();
      },
    }),
    el('button', {
      type: 'button',
      className: `tab-btn ${state.activeTab === 'sale' ? 'active' : ''}`,
      textContent: '+ Quick Sale',
      onClick: () => {
        state.activeTab = 'sale';
        render();
      },
    }),
    el('button', {
      type: 'button',
      className: `tab-btn ${state.activeTab === 'expense' ? 'active' : ''}`,
      textContent: '+ Expense',
      onClick: () => {
        state.activeTab = 'expense';
        render();
      },
    }),
  ]);
  container.appendChild(tabs);

  const boot = state.bootstrap || { settings: { currency: 'UGX' }, sales: [], expenses: [], orders: [], products: [] };
  if (state.activeTab === 'overview') {
    container.appendChild(buildOverviewTab(boot));
  } else if (state.activeTab === 'sale') {
    container.appendChild(buildQuickSaleTab(boot));
  } else {
    container.appendChild(buildQuickExpenseTab(boot));
  }

  root.appendChild(container);
}

async function init() {
  const stored = await getStorage(['sbm_server_url', 'sbm_token', 'sbm_user', 'sbm_outbox']);
  if (stored.sbm_server_url) state.serverUrl = stored.sbm_server_url;
  state.token = stored.sbm_token || null;
  state.user = stored.sbm_user || null;
  state.outbox = Array.isArray(stored.sbm_outbox) ? stored.sbm_outbox : [];

  if (state.token && state.user) {
    await refreshBootstrap();
  }
  state.loading = false;
  render();
}

void init();
