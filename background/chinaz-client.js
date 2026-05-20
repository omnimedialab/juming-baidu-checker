/**
 * 可选：抓 Chinaz 首页权重 / 反链。仅做最小可用解析，默认关闭。
 * 入口：https://seo.chinaz.com/{domain}
 */

const CHINAZ_BASE = 'https://seo.chinaz.com/';

const BR_PATTERNS = [
  /百度权重[^0-9]*([0-9])/,
  /百度PC权重[^0-9]*([0-9])/,
  /百度移动权重[^0-9]*([0-9])/
];

export async function queryChinaz(domain, { signal } = {}) {
  const url = CHINAZ_BASE + encodeURIComponent(domain);
  let res;
  try {
    res = await fetch(url, { method: 'GET', signal, cache: 'no-cache' });
  } catch (e) {
    return { ok: false, error: 'network', message: e.message };
  }
  let html;
  try {
    html = await res.text();
  } catch (e) {
    return { ok: false, error: 'read', message: e.message };
  }
  let br = null;
  for (const re of BR_PATTERNS) {
    const m = html.match(re);
    if (m) { br = parseInt(m[1], 10); break; }
  }
  return { ok: true, domain, chinazBR: br };
}
