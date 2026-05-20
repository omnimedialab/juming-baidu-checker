/**
 * Baidu site: 查询客户端。
 * 解析「百度为您找到相关结果约 X 个」/「找到相关结果数约X个」/「没有找到该URL」等模式。
 * 同时尝试判断首条结果是否本站首页（仅作启发式，非严格）。
 */

const SEARCH_BASE = 'https://www.baidu.com/s';

const COUNT_PATTERNS = [
  /百度为您找到相关结果约?\s*([\d,]+)\s*个/,
  /找到相关结果数约\s*([\d,]+)\s*个/,
  /找到相关结果约\s*([\d,]+)\s*个/,
  /找到相关结果\s*([\d,]+)\s*个/
];

const NO_RESULT_PATTERNS = [
  /很抱歉，没有找到与/,
  /没有找到该URL/,
  /没有找到相关的网页/,
  /No standard result/
];

const CAPTCHA_PATTERNS = [
  /wappass\.baidu\.com/,
  /security_check/,
  /\/static\/captcha/,
  /请输入验证码/,
  /verify/i
];

function parseCount(html) {
  for (const re of COUNT_PATTERNS) {
    const m = html.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (!isNaN(n)) return n;
    }
  }
  for (const re of NO_RESULT_PATTERNS) {
    if (re.test(html)) return 0;
  }
  return null;
}

function detectCaptcha(html, finalUrl) {
  for (const re of CAPTCHA_PATTERNS) {
    if (re.test(html) || re.test(finalUrl || '')) return true;
  }
  return false;
}

function firstResultHomepage(html, domain) {
  // 启发式：在前 8000 字符里找第一个结果块包含的 URL，判断是否指向 domain 根。
  const head = html.slice(0, 16000);
  // 百度首条结果常见 mu="https://www.example.com/" 或 href="https://...example.com/" 在 <a class="c-showurl"> / <a class="..."> 内
  const muMatch = head.match(/mu="(https?:\/\/[^"]+)"/);
  if (muMatch) {
    try {
      const u = new URL(muMatch[1]);
      const host = u.hostname.replace(/^www\./, '');
      const path = u.pathname || '/';
      if ((host === domain || host.endsWith('.' + domain)) && (path === '/' || path === '')) return true;
    } catch (_) {}
  }
  // 退化：直接搜索 https://www.{domain}/ 字串
  if (head.includes(`https://www.${domain}/`) || head.includes(`http://www.${domain}/`)) return true;
  return false;
}

export async function queryBaidu(domain, { signal } = {}) {
  const url = `${SEARCH_BASE}?wd=${encodeURIComponent('site:' + domain)}&rn=10&ie=utf-8`;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      signal,
      cache: 'no-cache',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });
  } catch (e) {
    return { ok: false, error: 'network', message: e.message };
  }

  const finalUrl = res.url || url;
  let html;
  try {
    html = await res.text();
  } catch (e) {
    return { ok: false, error: 'read', message: e.message };
  }

  if (detectCaptcha(html, finalUrl)) {
    return { ok: false, error: 'captcha', finalUrl };
  }

  const count = parseCount(html);
  if (count === null) {
    return { ok: false, error: 'parse', finalUrl, htmlSize: html.length };
  }
  const ranksFirst = count > 0 ? firstResultHomepage(html, domain) : false;
  return {
    ok: true,
    domain,
    baiduCount: count,
    ranksFirst,
    finalUrl
  };
}
