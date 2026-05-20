const MSG = {
  GET_HISTORY: 'jbd.getHistory',
  GET_QUEUE_STATUS: 'jbd.getQueueStatus',
  PAUSE_QUEUE: 'jbd.pauseQueue',
  RESUME_QUEUE: 'jbd.resumeQueue',
  CLEAR_CACHE: 'jbd.clearCache',
  UPDATE_LIST: 'jbd.updateList',
  GET_SETTINGS: 'jbd.getSettings',
  START_CAMPAIGN: 'jbd.startCampaign',
  STOP_CAMPAIGN: 'jbd.stopCampaign',
  GET_CAMPAIGN: 'jbd.getCampaign'
};

const STATUS_NAME = {
  green: '值得购买',
  yellow: '待复核',
  red: '不建议',
  error: '错误',
  pending: '排队',
  queued: '排队',
  blacklisted: '黑名单',
  whitelisted: '白名单'
};

const ERROR_NAME = {
  captcha: '验证码',
  parse: '解析失败',
  network: '网络',
  read: '读取',
  exception: '异常'
};

function statusLabel(r) {
  if (r.status === 'error' && r.error && ERROR_NAME[r.error]) {
    return `错误·${ERROR_NAME[r.error]}`;
  }
  return STATUS_NAME[r.status] || r.status || '?';
}

const $ = (s) => document.querySelector(s);
let history = [];
let lists = { whitelist: [], blacklist: [] };

function sendMsg(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (res) => resolve(res || { ok: false }));
  });
}

async function refreshStatus() {
  const res = await sendMsg(MSG.GET_QUEUE_STATUS);
  const s = res.status || {};
  const total = s.totalEnqueued || 0;
  const done = s.totalDone || 0;
  const inflight = s.inflight || 0;
  const queued = s.queued || 0;
  $('#status-summary').textContent =
    `并发 ${s.concurrency || 0} · 排队 ${queued} · 进行中 ${inflight} · 已完成 ${done}/${total} · ${s.paused ? '已暂停' : '运行中'}`;
  if (s.captchaPaused) {
    $('#captcha-warn').classList.remove('hidden');
  } else {
    $('#captcha-warn').classList.add('hidden');
  }
}

async function refreshHistory() {
  const res = await sendMsg(MSG.GET_HISTORY);
  history = (res && res.data) || [];
  renderHistory();
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderHistory() {
  const q = ($('#search').value || '').trim().toLowerCase();
  const sf = $('#status-filter').value;
  const tbody = $('#history-body');
  tbody.innerHTML = '';
  const rows = history.filter(r => {
    if (sf && r.status !== sf) return false;
    if (q && !(r.domain || '').toLowerCase().includes(q) && !(r.status || '').includes(q)) return false;
    return true;
  });
  if (!rows.length) {
    $('#empty-state').classList.remove('hidden');
    return;
  }
  $('#empty-state').classList.add('hidden');
  for (const r of rows) {
    const tr = document.createElement('tr');
    const statusName = statusLabel(r);
    tr.innerHTML = `
      <td><span class="tag ${r.status || 'pending'}">${statusName}</span></td>
      <td>${escape(r.domain || '')}</td>
      <td>${r.baiduCount ?? '-'}</td>
      <td>${r.ranksFirst === true ? '是' : (r.ranksFirst === false ? '否' : '-')}</td>
      <td>${r.chinazBR ?? '-'}</td>
      <td>${fmtTime(r.checkedAt)}</td>
      <td class="row-actions">
        <button data-act="open" data-domain="${escape(r.domain)}" class="prim" title="在百度新标签页打开 site:${escape(r.domain)} 人工复核">🔍 去百度</button>
        <button data-act="white" data-domain="${escape(r.domain)}" title="加入白名单：手动标记为良性域名，下次扫描自动判为绿">✓ 白</button>
        <button data-act="black" data-domain="${escape(r.domain)}" class="danger" title="加入黑名单：手动标记为不要买，下次扫描自动判为红">✗ 黑</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toCSV(rows) {
  const cols = [
    { h: 'domain', f: r => r.domain || '' },
    { h: 'status', f: r => r.status || '' },
    { h: 'baidu_count', f: r => r.baiduCount ?? '' },
    { h: 'ranks_first', f: r => r.ranksFirst ?? '' },
    { h: 'chinaz_br', f: r => r.chinazBR ?? '' },
    { h: 'error', f: r => r.error || '' },
    { h: 'reasons', f: r => (r.reasons || []).join('|') },
    { h: 'checked_at_iso', f: r => r.checkedAt ? new Date(r.checkedAt).toISOString() : '' }
  ];
  const esc = (v) => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  return cols.map(c => esc(c.h)).join(',') + '\n' +
    rows.map(r => cols.map(c => esc(c.f(r))).join(',')).join('\n');
}

function downloadCSV(content) {
  const blob = new Blob(["\uFEFF" + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jbd-history-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadLists() {
  const res = await sendMsg(MSG.GET_SETTINGS);
  if (res && res.ok) lists = res.lists || { whitelist: [], blacklist: [] };
}

async function setLists(next) {
  await sendMsg(MSG.UPDATE_LIST, next);
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const domain = t.getAttribute('data-domain');
  const act = t.getAttribute('data-act');
  if (act === 'white') {
    if (!lists.whitelist.includes(domain)) lists.whitelist.push(domain);
    lists.blacklist = lists.blacklist.filter(d => d !== domain);
    await setLists(lists);
    refreshHistory();
  } else if (act === 'black') {
    if (!lists.blacklist.includes(domain)) lists.blacklist.push(domain);
    lists.whitelist = lists.whitelist.filter(d => d !== domain);
    await setLists(lists);
    refreshHistory();
  } else if (act === 'open') {
    chrome.tabs.create({ url: `https://www.baidu.com/s?wd=site%3A${encodeURIComponent(domain)}` });
  }
});

$('#btn-pause').addEventListener('click', async () => {
  await sendMsg(MSG.PAUSE_QUEUE);
  refreshStatus();
});
$('#btn-resume').addEventListener('click', async () => {
  await sendMsg(MSG.RESUME_QUEUE);
  refreshStatus();
});

async function getActiveTabUrl() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve((tabs && tabs[0] && tabs[0].url) || '');
    });
  });
}

async function refreshCampaign() {
  const res = await sendMsg(MSG.GET_CAMPAIGN);
  const c = (res && res.campaign) || {};
  const startBtn = $('#btn-campaign-start');
  const stopBtn = $('#btn-campaign-stop');
  const status = $('#campaign-status');
  if (c.active) {
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    status.textContent = `进行中 · 第 ${c.currentPage || 1}/${c.maxPages || '?'} 页`;
  } else {
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    status.textContent = '';
  }
}

$('#btn-campaign-start').addEventListener('click', async () => {
  const maxPages = parseInt($('#campaign-pages').value, 10) || 5;
  const url = await getActiveTabUrl();
  if (!url || !/^https?:\/\/[^\/]*juming\.com/.test(url)) {
    alert('请先在 juming.com 域名列表页打开（如 /ykj/、/auction/、/buy/）');
    return;
  }
  await sendMsg(MSG.START_CAMPAIGN, { maxPages, startUrl: url });
  refreshCampaign();
});

$('#btn-campaign-stop').addEventListener('click', async () => {
  await sendMsg(MSG.STOP_CAMPAIGN);
  refreshCampaign();
});
$('#btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#btn-clear-cache').addEventListener('click', async () => {
  if (!confirm('确定清空所有缓存？历史记录仍保留。')) return;
  await sendMsg(MSG.CLEAR_CACHE);
  alert('缓存已清空');
});
$('#btn-retry-errors').addEventListener('click', async () => {
  const res = await sendMsg('jbd.retryErrors');
  if (res && res.ok) {
    alert(`已重新排队 ${res.requeued || 0} 个错误项`);
    refreshHistory();
    refreshStatus();
  } else {
    alert('失败：' + (res && res.error));
  }
});
$('#btn-export').addEventListener('click', () => {
  downloadCSV(toCSV(history));
});
$('#search').addEventListener('input', renderHistory);
$('#status-filter').addEventListener('change', renderHistory);

(async function init() {
  await loadLists();
  await refreshHistory();
  await refreshStatus();
  await refreshCampaign();
  // 从 settings 拿默认 maxPages 填到 input
  const res = await sendMsg(MSG.GET_SETTINGS);
  if (res && res.ok && res.settings && res.settings.maxPages) {
    $('#campaign-pages').value = res.settings.maxPages;
  }
  setInterval(refreshStatus, 1500);
  setInterval(refreshHistory, 5000);
  setInterval(refreshCampaign, 1500);
})();
