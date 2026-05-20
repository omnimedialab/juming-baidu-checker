/**
 * Content script 入口：
 *  - 扫描页面、注入徽章、把域名推给 background 排队
 *  - 监听 DOM 变化（ajax 翻页 / 异步加载）
 *  - 监听 background 回填 → 更新徽章
 *  - Campaign 模式：扫完 + 队列空 + idle 一段时间后，自动点"下一页"跳转
 */
(function () {
  const MSG = (self.JBD && self.JBD.MSG) || {};
  const extractor = self.JBD.extractor;
  const injector = self.JBD.injector;

  if (!extractor || !injector) {
    console.warn('[JBD] extractor/injector not loaded');
    return;
  }
  console.log('[JBD] content script loaded at', location.href);

  const seenDomains = new Set();      // 本页已识别到的域名
  const pendingDomains = new Set();   // 已交给 background、还没回结果
  let pendingScan = null;
  let lastActivity = Date.now();
  let pageIdleMs = 4000;
  let paginationTriedAt = 0;

  function touch() { lastActivity = Date.now(); }

  function send(type, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, (res) => resolve(res || { ok: false }));
      } catch (_) { resolve({ ok: false }); }
    });
  }

  function scanAndInject(root) {
    const hits = extractor.scanRoot(root || document.body);
    const newDomains = [];
    for (const hit of hits) {
      const badge = injector.inject(hit);
      if (badge && !seenDomains.has(hit.domain)) {
        seenDomains.add(hit.domain);
        pendingDomains.add(hit.domain);
        newDomains.push(hit.domain);
      }
    }
    if (newDomains.length) {
      console.log('[JBD] requesting check for', newDomains.length, 'new domain(s)');
      send(MSG.CHECK_DOMAINS, { domains: newDomains });
      touch();
    }
  }

  function scheduleScan() {
    if (pendingScan) return;
    pendingScan = setTimeout(() => {
      pendingScan = null;
      scanAndInject(document.body);
    }, 300);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === MSG.DOMAIN_RESULT) {
      const { domain, ...rest } = msg.payload || {};
      if (domain) {
        injector.updateBadge(domain, rest);
        pendingDomains.delete(domain);
        touch();
      }
    } else if (msg.type === MSG.CAPTCHA_DETECTED) {
      showToast('百度返回了验证码页 — 队列已暂停。请新开 baidu.com 通过验证码后在扩展弹窗点"继续"。');
    } else if (msg.type === MSG.CAMPAIGN_UPDATE) {
      // 仅用于打印日志，逻辑由 idle 轮询统一处理
      console.log('[JBD] campaign update', msg.payload);
    }
  });

  // 初始扫描
  scanAndInject(document.body);

  // 监听 DOM 变化
  const mo = new MutationObserver((records) => {
    let touched = false;
    for (const r of records) {
      if (r.addedNodes && r.addedNodes.length) { touched = true; break; }
    }
    if (touched) {
      touch();
      scheduleScan();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: false });

  // 找"下一页"链接（juming 通常是 a 标签，文字"下一页"）
  function findNextPageLink() {
    const all = document.querySelectorAll('a[href]');
    for (const a of all) {
      const t = (a.textContent || '').trim();
      if (!t) continue;
      if (t === '下一页' || t === '下页' || /^下[\s-]*一?[\s-]*页$/.test(t) || /^next$/i.test(t)) {
        const href = a.getAttribute('href');
        if (!href || href === '#' || href === 'javascript:;') continue;
        try { return new URL(href, location.href).toString(); } catch (_) {}
      }
    }
    // class fallback
    const classCands = document.querySelectorAll('a.next, a.page-next, .pagination a[rel="next"], a[rel="next"]');
    for (const a of classCands) {
      const href = a.getAttribute('href');
      if (href && href !== '#') {
        try { return new URL(href, location.href).toString(); } catch (_) {}
      }
    }
    return null;
  }

  // 加载 settings (取 pageIdleMs)
  (async () => {
    const res = await send(MSG.GET_SETTINGS);
    if (res && res.settings && res.settings.pageIdleMs) {
      pageIdleMs = res.settings.pageIdleMs;
    }
  })();

  // Idle 轮询：判断本页是否扫完，且 campaign 是否需要翻页
  setInterval(async () => {
    const idleFor = Date.now() - lastActivity;
    if (idleFor < pageIdleMs) return;
    if (pendingDomains.size > 0) return;
    if (Date.now() - paginationTriedAt < 8000) return; // 防止短期内连续跳

    const camp = await send(MSG.GET_CAMPAIGN);
    const c = camp && camp.campaign;
    if (!c || !c.active) return;

    const qs = await send(MSG.GET_QUEUE_STATUS);
    if (qs && qs.status && (qs.status.queued > 0 || qs.status.inflight > 0)) return;

    paginationTriedAt = Date.now();

    if ((c.currentPage || 1) >= (c.maxPages || 1)) {
      await send(MSG.STOP_CAMPAIGN);
      showToast(`批量扫描完成 · 共 ${c.maxPages} 页`);
      return;
    }
    const nextUrl = findNextPageLink();
    if (!nextUrl) {
      await send(MSG.STOP_CAMPAIGN);
      showToast('没找到下一页链接，扫描结束');
      return;
    }
    await send(MSG.INCR_CAMPAIGN);
    showToast(`第 ${c.currentPage}/${c.maxPages} 页扫描完毕，跳转下一页…`);
    setTimeout(() => location.assign(nextUrl), 800);
  }, 1500);

  // 简易 toast
  function showToast(text) {
    let el = document.getElementById('jbd-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'jbd-toast';
      el.className = 'jbd-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('jbd-toast-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove('jbd-toast-visible'), 8000);
  }
})();
