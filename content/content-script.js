/**
 * 内容脚本：
 *   1. 扫描页面域名,在每个出现处后面注入一个 [百度] 链接
 *      → https://www.baidu.com/s?wd=site:<domain>&gpc=stf%3D<from>,<to>%7Cstftype%3D1
 *      时间段(day/week/month/all)从 chrome.storage.local 读取,popup 可改
 *   2. 监听 storage 变化,实时更新已注入链接的 href
 *   3. AJAX 翻页/动态加载由 MutationObserver 兜底,alreadyInjected 守卫幂等
 */
(function () {
  const extractor = self.JBD && self.JBD.extractor;
  if (!extractor) {
    console.warn('[JBD] domain extractor not loaded');
    return;
  }

  const SETTINGS_KEY = 'jbd_settings_v1';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RANGE_DAYS = { day: 1, week: 7, month: 30 };

  let currentRange = 'week';

  function loadRange() {
    chrome.storage.local.get([SETTINGS_KEY], (res) => {
      const s = res && res[SETTINGS_KEY];
      if (s && typeof s.baiduTimeRange === 'string') currentRange = s.baiduTimeRange;
      retargetAllLinks();
    });
  }

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

  if (!document.getElementById('jbd-style')) {
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

  loadRange();
  scanAndInject();

  let pending = false;
  const obs = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; scanAndInject(); }, 400);
  });
  if (document.body) {
    obs.observe(document.body, { childList: true, subtree: true });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    const s = changes[SETTINGS_KEY].newValue || {};
    if (typeof s.baiduTimeRange === 'string' && s.baiduTimeRange !== currentRange) {
      currentRange = s.baiduTimeRange;
      retargetAllLinks();
    }
  });

  console.log('[JBD] content script ready at', location.href);
})();
