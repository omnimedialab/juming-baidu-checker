/**
 * 内容脚本：
 *   1. 扫描页面域名,在每个出现处后面注入一个 [百度] 链接
 *      → https://www.baidu.com/s?wd=site:<domain>&gpc=stf%3D<from>,<to>%7Cstftype%3D1
 *      时间段(day/week/month/all)从 chrome.storage.local 读取,popup 可改
 *   2. 监听 storage 变化:时间段变 → 重写 href;启用开关变 → 注入/拆除
 *   3. AJAX 翻页/动态加载由 MutationObserver 兜底,alreadyInjected 守卫幂等
 *   4. popup 总开关可按站(juming.com / gname.com)关闭注入,避免触发某些站点的反爬刷新
 */
(function () {
  const extractor = self.JBD && self.JBD.extractor;
  if (!extractor) {
    console.warn('[JBD] domain extractor not loaded');
    return;
  }

  const SETTINGS_KEY = 'jbd_settings_v1';
  const RANGE_DAYS = { day: 1, week: 7, month: 30 };
  const DEFAULT_ENABLED = { 'juming.com': true, 'gname.com': true };

  function detectHost() {
    const h = (location.hostname || '').toLowerCase();
    if (h === 'juming.com' || h.endsWith('.juming.com')) return 'juming.com';
    if (h === 'gname.com' || h.endsWith('.gname.com')) return 'gname.com';
    return null;
  }
  const HOST = detectHost();
  if (!HOST) return;

  let currentRange = 'week';
  let enabled = false; // 启动时关闭,首次读 storage 决定是否激活
  let observer = null;
  let pending = false;

  function buildHref(domain, range) {
    const base = 'https://www.baidu.com/s?wd=site%3A' + encodeURIComponent(domain);
    const days = RANGE_DAYS[range];
    if (!days) return base; // 'all' or unknown → 无时间过滤
    const toSec = Math.floor(Date.now() / 1000);
    const fromSec = toSec - days * 24 * 60 * 60;
    // baidu 高级搜索时间段:gpc=stf=<from>,<to>|stftype=1
    const gpc = 'stf=' + fromSec + ',' + toSec + '|stftype=1';
    return base + '&gpc=' + encodeURIComponent(gpc);
  }

  function labelFor(range) {
    return { day: '日', week: '周', month: '月', all: '全' }[range] || '周';
  }

  function ensureStyle() {
    if (document.getElementById('jbd-style')) return;
    const style = document.createElement('style');
    style.id = 'jbd-style';
    style.textContent = `
      .jbd-baidu-link {
        display: inline-block;
        margin: 0 2px 0 4px;
        padding: 0 5px;
        font-size: 11px;
        line-height: 16px;
        color: #1565c0;
        background: #e3f2fd;
        border: 1px solid #bbdefb;
        border-radius: 3px;
        text-decoration: none !important;
        vertical-align: middle;
        cursor: pointer;
        font-weight: normal;
      }
      .jbd-baidu-link:hover {
        background: #1565c0;
        color: #fff !important;
        border-color: #1565c0;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function makeLink(domain) {
    const a = document.createElement('a');
    a.className = 'jbd-baidu-link';
    a.href = buildHref(domain, currentRange);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = '百度' + labelFor(currentRange);
    a.title = 'site:' + domain + ' (' + currentRange + ')';
    a.dataset.jbdDomain = domain;
    return a;
  }

  function alreadyInjected(parent, domain) {
    if (!parent || !parent.querySelector) return false;
    const sel = '.jbd-baidu-link[data-jbd-domain="' + domain.replace(/"/g, '\\"') + '"]';
    return !!parent.querySelector(':scope > ' + sel);
  }

  function injectAfter(node, domain) {
    const parent = node.parentNode;
    if (!parent) return;
    if (alreadyInjected(parent, domain)) return;
    parent.insertBefore(makeLink(domain), node.nextSibling);
  }

  function injectForHits(hits) {
    for (const h of hits) {
      if (h.kind === 'text') injectAfter(h.anchor, h.domain);
      else if (h.kind === 'attr' && h.el) injectAfter(h.el, h.domain);
    }
  }

  function scanAndInject() {
    if (!enabled) return [];
    try {
      const hits = extractor.scanRoot(document.body);
      injectForHits(hits);
      return hits;
    } catch (e) {
      console.warn('[JBD] scanAndInject failed', e);
      return [];
    }
  }

  // 用户在 popup 改了时间段后,把页面上已经注入的链接全部 re-target
  function retargetAllLinks() {
    const links = document.querySelectorAll('a.jbd-baidu-link[data-jbd-domain]');
    const label = labelFor(currentRange);
    for (const a of links) {
      const d = a.dataset.jbdDomain;
      a.href = buildHref(d, currentRange);
      a.textContent = '百度' + label;
      a.title = 'site:' + d + ' (' + currentRange + ')';
    }
  }

  function removeAllLinks() {
    const links = document.querySelectorAll('a.jbd-baidu-link');
    for (const a of links) a.remove();
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; scanAndInject(); }, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  function activate() {
    ensureStyle();
    scanAndInject();
    startObserver();
  }

  function deactivate() {
    stopObserver();
    removeAllLinks();
  }

  function applySettings(s) {
    if (s && typeof s.baiduTimeRange === 'string') currentRange = s.baiduTimeRange;
    const map = (s && s.enabled) || DEFAULT_ENABLED;
    const next = map[HOST] !== false; // undefined → true (默认启用)
    if (next !== enabled) {
      enabled = next;
      if (enabled) activate();
      else deactivate();
    } else if (enabled) {
      retargetAllLinks();
    }
  }

  chrome.storage.local.get([SETTINGS_KEY], (res) => {
    applySettings((res && res[SETTINGS_KEY]) || {});
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    applySettings(changes[SETTINGS_KEY].newValue || {});
  });

  console.log('[JBD] content script ready at', location.href, 'host=', HOST);
})();
