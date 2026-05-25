const SETTINGS_KEY = 'jbd_settings_v1';
const DEFAULT_RANGE = 'week';
const VALID = new Set(['day', 'week', 'month', 'all']);
const HOSTS = ['juming.com', 'gname.com'];

function load() {
  chrome.storage.local.get([SETTINGS_KEY], (res) => {
    const s = (res && res[SETTINGS_KEY]) || {};
    const r = VALID.has(s.baiduTimeRange) ? s.baiduTimeRange : DEFAULT_RANGE;
    const el = document.querySelector(`input[name="range"][value="${r}"]`);
    if (el) el.checked = true;

    const enabled = s.enabled || {};
    for (const host of HOSTS) {
      const cb = document.querySelector(`input[data-host="${host}"]`);
      if (cb) cb.checked = enabled[host] !== false; // undefined → 默认勾选
    }
  });
}

document.getElementById('range-group').addEventListener('change', (ev) => {
  const v = ev.target && ev.target.value;
  if (!VALID.has(v)) return;
  chrome.storage.local.get([SETTINGS_KEY], (res) => {
    const cur = (res && res[SETTINGS_KEY]) || {};
    chrome.storage.local.set({ [SETTINGS_KEY]: { ...cur, baiduTimeRange: v } });
  });
});

document.getElementById('site-toggle').addEventListener('change', (ev) => {
  const host = ev.target && ev.target.dataset && ev.target.dataset.host;
  if (!host || !HOSTS.includes(host)) return;
  const checked = !!ev.target.checked;
  chrome.storage.local.get([SETTINGS_KEY], (res) => {
    const cur = (res && res[SETTINGS_KEY]) || {};
    const enabled = { ...(cur.enabled || {}), [host]: checked };
    chrome.storage.local.set({ [SETTINGS_KEY]: { ...cur, enabled } });
  });
});

load();
