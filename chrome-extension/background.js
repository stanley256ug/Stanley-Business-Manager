const SYNC_ALARM_NAME = 'stanley_extension_outbox_sync';

async function updateBadge() {
  try {
    const data = await chrome.storage.local.get(['sbm_outbox']);
    const outbox = Array.isArray(data.sbm_outbox) ? data.sbm_outbox : [];
    if (outbox.length > 0) {
      await chrome.action.setBadgeText({ text: String(outbox.length) });
      await chrome.action.setBadgeBackgroundColor({ color: '#C89B3C' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // ignore badge errors
  }
}

async function flushOutbox() {
  const data = await chrome.storage.local.get(['sbm_outbox', 'sbm_token', 'sbm_server_url']);
  const outbox = Array.isArray(data.sbm_outbox) ? data.sbm_outbox : [];
  if (outbox.length === 0) {
    await updateBadge();
    return { synced: 0, remaining: 0 };
  }

  const remaining = [];
  let synced = 0;

  for (const item of outbox) {
    const token = item.token || data.sbm_token;
    const baseUrl = String(item.serverUrl || data.sbm_server_url || '').replace(/\/+$/, '');
    if (!token || !baseUrl) {
      remaining.push(item);
      continue;
    }

    const endpoint =
      item.operation === 'create_sale'
        ? '/api/sales'
        : item.operation === 'create_expense'
        ? '/api/expenses'
        : null;

    if (!endpoint) continue;

    try {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(item.payload),
      });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429)) {
        if (res.ok) synced++;
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  await chrome.storage.local.set({ sbm_outbox: remaining });
  await updateBadge();
  return { synced, remaining: remaining.length };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 3 });
  void updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 3 });
  void flushOutbox();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    void flushOutbox();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'FLUSH_OUTBOX') {
    flushOutbox().then(sendResponse);
    return true;
  }
  if (message?.type === 'UPDATE_BADGE') {
    updateBadge().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
