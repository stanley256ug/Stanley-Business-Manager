const PROD_URL = 'https://ais-pre-lg7iq64pqxr4tdimmhmsvz-553917761561.europe-west3.run.app';
const LOCAL_URL = 'http://localhost:3000';

const input = document.getElementById('server-url');
const banner = document.getElementById('status-banner');
const form = document.getElementById('options-form');

function showBanner(msg, type = 'success') {
  banner.textContent = msg;
  banner.className = `banner ${type === 'error' ? 'banner-error' : 'banner-success'}`;
}

async function loadOptions() {
  const data = await chrome.storage.local.get(['sbm_server_url']);
  input.value = data.sbm_server_url || PROD_URL;
}

document.getElementById('preset-prod').addEventListener('click', () => {
  input.value = PROD_URL;
});

document.getElementById('preset-local').addEventListener('click', () => {
  input.value = LOCAL_URL;
});

document.getElementById('sign-out-btn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['sbm_token', 'sbm_user']);
  showBanner('Extension session cleared. Sign in again from the popup.');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const parsed = new URL(input.value.trim());
    const originPattern = `${parsed.origin}/*`;
    if (chrome.permissions && chrome.permissions.request) {
      await chrome.permissions.request({ origins: [originPattern] });
    }
    await chrome.storage.local.set({ sbm_server_url: parsed.origin });
    showBanner(`Saved server URL: ${parsed.origin}`);
  } catch (err) {
    showBanner(err.message || 'Please enter a valid http/https server URL.', 'error');
  }
});

void loadOptions();
