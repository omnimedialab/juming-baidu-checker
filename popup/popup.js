const SETTINGS_KEY = 'jbd_settings_v1';
const DEFAULT_RANGE = 'week';
const VALID = new Set(['day', 'week', 'month', 'all']);

function load() {
  chrome.storage.local.get([SETTINGS_KEY], (res) => {
    const s = (res && res[SETTINGS_KEY]) || {};
    const r = VALID.has(s.baiduTimeRange) ? s.baiduTimeRange : DEFAULT_RANGE;
    const el = document.querySelector(`input[name="range"][value="${r}"]`);
    if (el) el.checked = true;
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

load();
