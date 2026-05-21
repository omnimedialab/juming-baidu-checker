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
 *   2. 立刻发送一条消息到 Telegram 群
 *   3. 返回 "SUCCESS"
 *
 * 配置全部走环境变量：
 *   TG_BOT_TOKEN   必填
 *   TG_CHAT_ID     必填（群 id，例如 -100xxxxxxxxxx）
 *   PORT           可选，默认 3119
 *   ALLOW_IPS      可选，逗号分隔，例如 "212.129.155.107,127.0.0.1"
 *   SHARED_SECRET  可选，如果设置则要求 query 串里携带 ?secret=<value>
 */

const http = require('http');
const { URL } = require('url');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';
const PORT = parseInt(process.env.PORT || '3119', 10);
const ALLOW_IPS = (process.env.ALLOW_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
const SHARED_SECRET = process.env.SHARED_SECRET || '';

if (!TG_BOT_TOKEN) {
  console.error('[notify] missing TG_BOT_TOKEN env. exit.');
  process.exit(1);
}
if (!TG_CHAT_ID) {
  console.warn('[notify] TG_CHAT_ID not set yet — callbacks will be logged but not delivered.');
}

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

async function sendTelegram(text) {
  if (!TG_CHAT_ID) {
    console.warn('[notify] no TG_CHAT_ID, skipping send. preview:', text.slice(0, 200));
    return { ok: false, error: 'no-chat-id' };
  }
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
  return { ok: !!(json && json.ok), json, status: res.status };
}

/**
 * 从 link113 回调的 result 字段里提取「日收录 / 周收录」。
 * link113 文档没给样本，所以我们同时支持：
 *   - JSON: result 是 JSON 字符串或对象，递归扫描 key 含 day/daily/today/24h
 *     和 week/weekly/7d 的字段
 *   - plain-text 正则：兼容 "日收录:N" / "日收:N" / "周收录:N" / "周收:N" 等
 *   - 中文键：直接命中 "日收录"/"周收录"
 */
function parseStats(result) {
  const raw = result == null ? '' : (typeof result === 'string' ? result : JSON.stringify(result));
  let json = null;
  if (result && typeof result === 'object') {
    json = result;
  } else if (typeof result === 'string') {
    try { json = JSON.parse(result); } catch (_) {}
  }
  let daily = null, weekly = null;

  if (json && typeof json === 'object') {
    const flat = {};
    (function flatten(o, prefix) {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object') flatten(v, key);
        else flat[key] = v;
      }
    })(json, '');
    for (const [k, v] of Object.entries(flat)) {
      const lk = k.toLowerCase();
      const num = (() => {
        if (v == null) return null;
        const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
        return Number.isNaN(n) ? null : n;
      })();
      if (num == null) continue;
      if (daily == null && (
        /(^|[._-])(day|daily|today|24h)([._-]|$)/.test(lk) ||
        /日收/.test(k)
      )) daily = num;
      if (weekly == null && (
        /(^|[._-])(week|weekly|7d|7day|sevenday)([._-]|$)/.test(lk) ||
        /周收/.test(k)
      )) weekly = num;
    }
  }
  // plain-text 正则兜底
  if (daily == null) {
    const m = raw.match(/日收(?:录)?\s*[:：=]?\s*(-?\d[\d,]*)/);
    if (m) daily = parseInt(m[1].replace(/,/g, ''), 10);
  }
  if (weekly == null) {
    const m = raw.match(/周收(?:录)?\s*[:：=]?\s*(-?\d[\d,]*)/);
    if (m) weekly = parseInt(m[1].replace(/,/g, ''), 10);
  }
  return { daily, weekly, raw };
}

function fmtNum(n) {
  if (n == null) return '<i>—</i>';
  return `<b>${n}</b>`;
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

function buildText(payload) {
  const id = payload.id || '';
  const url = payload.url || '';
  const host = extractHost(url);
  const stats = parseStats(payload.result);

  const lines = [];
  // 标题：点域名直接跳百度 site: 查询，方便复核
  if (host) {
    lines.push(`📊 <a href="${baiduSiteUrl(host)}">${escHtml(host)}</a>`);
  } else {
    lines.push(`📊 <b>${escHtml(url || '?')}</b>`);
  }
  lines.push(`日收 ${fmtNum(stats.daily)} · 周收 ${fmtNum(stats.weekly)}`);

  // 解析失败时，附原始 result 一小段让人能手动看
  if (stats.daily == null && stats.weekly == null) {
    const preview = String(stats.raw || '').slice(0, 800);
    if (preview) lines.push(`<pre>${escHtml(preview)}</pre>`);
  }

  if (id) lines.push(`<i>id=${escHtml(id)}</i>`);
  return lines.join('\n');
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  // health
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
    // 详细日志：原始 raw 也打一份，方便对照 link113 真实回调结构
    console.log('[notify] ip=%s payload=%j', ip, payload);
    console.log('[notify] raw=%s', raw.slice(0, 2000));

    // 必须在 10s 内返回 SUCCESS。先回复，再异步发 TG。
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('SUCCESS');

    try {
      const text = buildText(payload);
      const tg = await sendTelegram(text);
      if (!tg.ok) console.error('[notify] tg send failed', tg);
    } catch (e) {
      console.error('[notify] tg exception', e);
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not-found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[notify] listening on 127.0.0.1:' + PORT);
});
