/**
 * link113 -> Telegram relay.
 *
 * link113 在 https://www.link113.com/openapi 文档里说：查询完成后会向我们
 * 预先配置在他们后台的 webhook 地址发起 POST，body 至少包含
 *   id    : 我们 push 时填的自定义 ID
 *   item  : 查询类型代码
 *   url   : 我们 push 进去的域名/URL
 *   result: 查询结果字符串
 * 我们必须在 10 秒内返回字面量 "SUCCESS"，否则他们认为失败。
 *
 * 这个进程：
 *   1. 监听 POST /notify
 *   2. 立刻返回 "SUCCESS"
 *   3. 异步把结果发到 Telegram
 *
 * 重要：link113 每个 item 是一次独立查询且 result 只是单个值 (例如 "0")。
 * 想要一条 TG 消息里同时显示「日收 / 周收 / 月收」必须把多个回调聚合到一起。
 *
 * 配置（环境变量）：
 *   TG_BOT_TOKEN       必填
 *   TG_CHAT_ID         必填（群 id，例如 -100xxxxxxxxxx）
 *   PORT               可选，默认 3119
 *   ALLOW_IPS          可选，逗号分隔白名单（link113 官方 IP 是 212.129.155.107）
 *   SHARED_SECRET      可选，若设置则要求 query 串里携带 ?secret=<value>
 *   AGGREGATE_WAIT_MS  可选，>0 则把同 (host,session) 的回调缓冲再合并发；默认 0 = 即发
 */

const http = require('http');
const { URL } = require('url');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';
const PORT = parseInt(process.env.PORT || '3119', 10);
const ALLOW_IPS = (process.env.ALLOW_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SHARED_SECRET = process.env.SHARED_SECRET || '';
const AGGREGATE_WAIT_MS = parseInt(process.env.AGGREGATE_WAIT_MS || '0', 10);

if (!TG_BOT_TOKEN) {
  console.error('[notify] missing TG_BOT_TOKEN env. exit.');
  process.exit(1);
}
if (!TG_CHAT_ID) {
  console.warn('[notify] TG_CHAT_ID not set yet — callbacks will be logged but not delivered.');
}
console.log('[notify] AGGREGATE_WAIT_MS=%d (%s)', AGGREGATE_WAIT_MS, AGGREGATE_WAIT_MS > 0 ? 'buffer mode' : 'immediate mode');

/** link113 item code -> 中文标签 + 显示顺序 */
const ITEM_LABELS = {
  'baidu-check': '百度收录',
  'baidu-s-count-day': '百度日收',
  'baidu-s-count-week': '百度周收',
  'baidu-s-count-month': '百度月收',
  'baidu-s-count-year': '百度年收',
  'baidu-s-count-all': '百度总收',
  'sogou-check': '搜狗收录',
  'sogou-s-count': '搜狗总收',
  'sogou-s-count-a': '搜狗精准',
  'so-check': '360收录',
  'so-s-count': '360总收',
  'bing-s-count': '必应总收'
};
const ITEM_ORDER = Object.keys(ITEM_LABELS);

function readBody(req, max = 1024 * 256) {
  return new Promise((resolve, reject) => {
    const bufs = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { req.destroy(); reject(new Error('body-too-large')); return; }
      bufs.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(bufs).toString('utf8')));
    req.on('error', reject);
  });
}

function parseBody(req, raw) {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const out = {};
    for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
    return out;
  }
  // 兜底：先尝试 JSON，再尝试 form
  try { return JSON.parse(raw); } catch (_) {}
  try {
    const out = {};
    for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
    if (Object.keys(out).length) return out;
  } catch (_) {}
  return { _raw: raw };
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  return req.socket.remoteAddress || '';
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 串行化 + 限速 + 429 自动重试。
 * TG bot 限制: 每个 chat 1 msg/s; 全局 30 msg/s。突发超过后 TG 返回 429,
 * body.parameters.retry_after 给出建议等待秒数。之前的实现没排队没重试,
 * 高并发回调 (500 域 × 2 item = 1000 条) 直接被 TG 静默或 429 大量丢失。
 */
const TG_MIN_INTERVAL_MS = 1100;   // 1 msg/s + 缓冲
const TG_MAX_RETRIES = 5;
let lastTgSentAt = 0;
let tgChain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendTelegramOnce(text, attempt) {
  const url = `https://api.telegram.org/bot${encodeURIComponent(TG_BOT_TOKEN)}/sendMessage`;
  const body = JSON.stringify({
    chat_id: TG_CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const json = await res.json().catch(() => null);
  if (res.status === 429 && attempt < TG_MAX_RETRIES) {
    const retryAfter = (json && json.parameters && json.parameters.retry_after) || 1;
    console.warn('[notify] tg 429 retry_after=%ds (attempt %d/%d)', retryAfter, attempt + 1, TG_MAX_RETRIES);
    await sleep((retryAfter + 1) * 1000);
    return sendTelegramOnce(text, attempt + 1);
  }
  if (!json || !json.ok) {
    console.error('[notify] tg send failed status=%s body=%j attempts=%d', res.status, json, attempt + 1);
  }
  return { ok: !!(json && json.ok), json, status: res.status, attempts: attempt + 1 };
}

async function sendTelegram(text) {
  if (!TG_CHAT_ID) {
    console.warn('[notify] no TG_CHAT_ID, skipping send. preview:', text.slice(0, 200));
    return { ok: false, error: 'no-chat-id' };
  }
  // 串行 chain: 每条都接在上一条 promise 后,确保至少 TG_MIN_INTERVAL_MS 间隔
  const job = tgChain.then(async () => {
    const elapsed = Date.now() - lastTgSentAt;
    if (elapsed < TG_MIN_INTERVAL_MS) await sleep(TG_MIN_INTERVAL_MS - elapsed);
    const r = await sendTelegramOnce(text, 0);
    lastTgSentAt = Date.now();
    return r;
  });
  // chain 必须捕获 reject 否则后续都被毒化; 但返回的 job 仍保留原错误
  tgChain = job.catch(() => {});
  return job;
}

/**
 * 解析 link113 单 item 回调的 result。
 * 文档没给样本，实测每个 item 返回的是单个数字字符串（如 "0"、"15"）。
 * 旧测试数据里有 JSON 串和「日收录:N」格式，做容错保留。
 */
function parseSingleResult(result) {
  if (result == null) return { value: null, raw: '' };
  const raw = typeof result === 'string' ? result : JSON.stringify(result);
  // 1) 整体就是数字（允许千分位逗号 "123,456"）
  const direct = raw.trim();
  const stripped = direct.replace(/,/g, '');
  if (/^-?\d+$/.test(stripped)) return { value: parseInt(stripped, 10), raw };
  // 2) JSON 内含 daily/weekly 等（兼容旧测试 payload）
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') {
      for (const k of Object.keys(j)) {
        const v = j[k];
        if (typeof v === 'number') return { value: v, raw };
        if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return { value: parseInt(v.trim(), 10), raw };
      }
    } else if (typeof j === 'number') {
      return { value: j, raw };
    }
  } catch (_) {}
  // 3) plain-text 「日收录:N」/「收录:N」等
  const m = raw.match(/(?:日|周|月|年|总)?\s*收(?:录)?\s*[:：=]?\s*(-?\d[\d,]*)/);
  if (m) return { value: parseInt(m[1].replace(/,/g, ''), 10), raw };
  return { value: null, raw };
}

function extractHost(u) {
  if (!u) return '';
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^\/+/, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  s = s.replace(/:\d+$/, '');
  if (s.startsWith('www.')) s = s.slice(4);
  return s;
}

function baiduSiteUrl(host) {
  return `https://www.baidu.com/s?wd=site%3A${encodeURIComponent(host)}`;
}

function fmtItemLine(item, parsed) {
  const label = ITEM_LABELS[item] || item || '(no-item)';
  if (parsed.value == null) {
    const preview = String(parsed.raw || '').slice(0, 120);
    return `${escHtml(label)} <i>${escHtml(preview || '?')}</i>`;
  }
  return `${escHtml(label)} <b>${parsed.value}</b>`;
}

function buildSingleText(payload) {
  const url = payload.url || '';
  const host = extractHost(url);
  const parsed = parseSingleResult(payload.result);
  const lines = [];
  lines.push(host
    ? `📊 <a href="${baiduSiteUrl(host)}">${escHtml(host)}</a>`
    : `📊 <b>${escHtml(url || '?')}</b>`);
  lines.push(fmtItemLine(payload.item || '', parsed));
  if (payload.id) lines.push(`<i>id=${escHtml(payload.id)}</i>`);
  return lines.join('\n');
}

function buildAggregateText(buf) {
  const lines = [];
  lines.push(buf.host
    ? `📊 <a href="${baiduSiteUrl(buf.host)}">${escHtml(buf.host)}</a>`
    : `📊 <b>?</b>`);
  // 按 ITEM_ORDER 排序，未识别的 item 排在最后
  const sorted = buf.items.slice().sort((a, b) => {
    const ai = ITEM_ORDER.indexOf(a.item); const bi = ITEM_ORDER.indexOf(b.item);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  for (const it of sorted) lines.push(fmtItemLine(it.item, it.parsed));
  if (buf.sessionId) lines.push(`<i>session=${escHtml(buf.sessionId)} · ${buf.items.length} 项</i>`);
  return lines.join('\n');
}

/* ---------- aggregation buffer (按 host + sessionId 分组) ---------- */

const buffers = new Map(); // key -> { host, sessionId, items, timer }

/**
 * 从 link113 回调的 id 里抠出 sessionId。
 * 扩展构造 id = `sessionTs(10位秒级) * 1e6 + seq` → 16 位; 手动 curl 可能是
 * TS + 任意后缀。不论后缀长度,sessionTs 都是前 10 位 (大约 1.6e9 ~ 9.9e9 范围)。
 * 非数字或长度 < 10 的 id 退化成 'no-session',相同 host 仍可能合并到一起,
 * 这是聚合模式下可接受的代价。
 */
function sessionIdFromCallback(id) {
  const s = String(id || '');
  if (!/^\d{10,}$/.test(s)) return 'no-session';
  return s.slice(0, 10);
}

function flush(key) {
  const buf = buffers.get(key);
  if (!buf) return;
  buffers.delete(key);
  if (buf.timer) clearTimeout(buf.timer);
  const text = buildAggregateText(buf);
  sendTelegram(text).catch((e) => console.error('[notify] flush tg exception', e));
}

function enqueueAggregate(payload) {
  const host = extractHost(payload.url);
  const sessionId = sessionIdFromCallback(payload.id);
  const key = `${host}|${sessionId}`;
  let buf = buffers.get(key);
  if (!buf) {
    buf = { host, sessionId, items: [], firstAt: Date.now(), timer: null };
    buffers.set(key, buf);
  }
  buf.items.push({
    item: payload.item || '',
    parsed: parseSingleResult(payload.result),
    id: payload.id
  });
  if (buf.timer) clearTimeout(buf.timer);
  // 每收到新 item 就把 flush timer 重置 — 等持续 AGGREGATE_WAIT_MS 无新数据再发
  buf.timer = setTimeout(() => flush(key), AGGREGATE_WAIT_MS);
}

async function handlePayload(payload) {
  if (AGGREGATE_WAIT_MS > 0) {
    enqueueAggregate(payload);
    return { ok: true, mode: 'buffered' };
  }
  return sendTelegram(buildSingleText(payload));
}

/* ---------- http server ---------- */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && (u.pathname === '/health' || u.pathname === '/')) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OK link113-notify\n');
    return;
  }

  if (req.method === 'POST' && u.pathname === '/notify') {
    const ip = clientIp(req);
    if (ALLOW_IPS.length && !ALLOW_IPS.includes(ip)) {
      console.warn('[notify] reject ip', ip);
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    if (SHARED_SECRET && u.searchParams.get('secret') !== SHARED_SECRET) {
      console.warn('[notify] bad secret from', ip);
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('unauthorized');
      return;
    }
    let raw = '';
    try { raw = await readBody(req); } catch (e) {
      console.error('[notify] body read error', e.message);
      res.writeHead(400); res.end('bad-body'); return;
    }
    const payload = parseBody(req, raw);
    console.log('[notify] ip=%s payload=%j', ip, payload);
    console.log('[notify] raw=%s', raw.slice(0, 2000));

    // 必须在 10s 内返回 SUCCESS。先回，再异步处理。
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('SUCCESS');

    try {
      await handlePayload(payload);
    } catch (e) {
      console.error('[notify] handle exception', e);
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not-found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[notify] listening on 127.0.0.1:' + PORT);
});

/* expose internals for unit tests */
module.exports = {
  ITEM_LABELS,
  parseSingleResult,
  buildSingleText,
  buildAggregateText,
  sessionIdFromCallback,
  extractHost
};
