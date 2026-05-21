const MSG = {
  GET_SETTINGS: 'jbd.getSettings',
  SET_SETTINGS: 'jbd.setSettings',
  UPDATE_LIST: 'jbd.updateList',
  CLEAR_CACHE: 'jbd.clearCache',
  CLEAR_HISTORY: 'jbd.clearHistory'
};

const $ = (s) => document.querySelector(s);

function send(type, payload) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, payload }, (res) => resolve(res || {}))
  );
}

async function load() {
  const res = await send(MSG.GET_SETTINGS);
  const s = res.settings || {};
  $('#concurrency').value = s.concurrency;
  $('#delayMinMs').value = s.delayMinMs;
  $('#delayMaxMs').value = s.delayMaxMs;
  $('#cacheTtlDays').value = s.cacheTtlDays;
  $('#greenMinIndexed').value = s.greenMinIndexed;
  $('#yellowMinIndexed').value = s.yellowMinIndexed;
  $('#enableChinaz').checked = !!s.enableChinaz;
  $('#rotateUserAgent').checked = !!s.rotateUserAgent;
  $('#maxPages').value = s.maxPages;
  $('#pageIdleMs').value = s.pageIdleMs;
  $('#minDwellMs').value = s.minDwellMs;
  $('#link113AccessKey').value = s.link113AccessKey || '';
  $('#link113AccessSecret').value = s.link113AccessSecret || '';
  $('#link113Item').value = s.link113Item || '';
  $('#telegramBotToken').value = s.telegramBotToken || '';
  $('#telegramChatId').value = s.telegramChatId || '';

  const lists = res.lists || { whitelist: [], blacklist: [] };
  $('#whitelist').value = (lists.whitelist || []).join('\n');
  $('#blacklist').value = (lists.blacklist || []).join('\n');
}

function parseList(text) {
  return (text || '')
    .split(/\r?\n/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

async function save() {
  const patch = {
    concurrency: parseInt($('#concurrency').value, 10) || 3,
    delayMinMs: parseInt($('#delayMinMs').value, 10) || 1200,
    delayMaxMs: parseInt($('#delayMaxMs').value, 10) || 3000,
    cacheTtlDays: parseInt($('#cacheTtlDays').value, 10) || 7,
    greenMinIndexed: parseInt($('#greenMinIndexed').value, 10) || 10,
    yellowMinIndexed: parseInt($('#yellowMinIndexed').value, 10) || 1,
    enableChinaz: $('#enableChinaz').checked,
    rotateUserAgent: $('#rotateUserAgent').checked,
    maxPages: parseInt($('#maxPages').value, 10) || 5,
    pageIdleMs: parseInt($('#pageIdleMs').value, 10) || 6000,
    minDwellMs: parseInt($('#minDwellMs').value, 10) || 10000,
    link113AccessKey: $('#link113AccessKey').value.trim(),
    link113AccessSecret: $('#link113AccessSecret').value.trim(),
    link113Item: $('#link113Item').value.trim(),
    telegramBotToken: $('#telegramBotToken').value.trim(),
    telegramChatId: $('#telegramChatId').value.trim()
  };
  if (patch.delayMaxMs < patch.delayMinMs) patch.delayMaxMs = patch.delayMinMs;
  await send(MSG.SET_SETTINGS, patch);

  await send(MSG.UPDATE_LIST, {
    whitelist: parseList($('#whitelist').value),
    blacklist: parseList($('#blacklist').value)
  });

  const m = $('#saved-msg');
  m.classList.remove('hidden');
  setTimeout(() => m.classList.add('hidden'), 1500);
}

$('#save').addEventListener('click', save);
$('#clearCache').addEventListener('click', async () => {
  if (!confirm('确定清空缓存？')) return;
  await send(MSG.CLEAR_CACHE);
  alert('缓存已清空');
});
$('#clearHistory').addEventListener('click', async () => {
  if (!confirm('确定清空历史？')) return;
  await send(MSG.CLEAR_HISTORY);
  alert('历史已清空');
});

load();
