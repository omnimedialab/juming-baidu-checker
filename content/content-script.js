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
  let pageIdleMs = 6000;
  let minDwellMs = 10000;
  let paginationTriedAt = 0;
  const pageLoadedAt = Date.now();
  let everHadPending = false;          // 是否至少扫到过 1 个域名（防止空页立刻跳）
  let paginationCountdown = null;

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
      everHadPending = true;
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

  // 加载 settings (取 pageIdleMs / minDwellMs)
  (async () => {
    const res = await send(MSG.GET_SETTINGS);
    if (res && res.settings) {
      if (res.settings.pageIdleMs) pageIdleMs = res.settings.pageIdleMs;
      if (res.settings.minDwellMs) minDwellMs = res.settings.minDwellMs;
    }
  })();

  // Idle 轮询：判断本页是否扫完，且 campaign 是否需要翻页
  setInterval(async () => {
    if (paginationCountdown) return; // 倒计时进行中，别重复触发

    const dwellFor = Date.now() - pageLoadedAt;
    const idleFor = Date.now() - lastActivity;

    // 是否处于 campaign（取 campaign 状态用于快速早返）
    const camp = await send(MSG.GET_CAMPAIGN);
    const c = camp && camp.campaign;
    if (!c || !c.active) return;

    // 必须停留够最短时间
    if (dwellFor < minDwellMs) {
      console.log('[JBD] idle-check: waiting for min dwell', { dwellFor, minDwellMs });
      return;
    }
    // 至少要识别过一个域名，避免空页立刻跳
    if (!everHadPending) {
      console.log('[JBD] idle-check: never had pending domains; skip');
      return;
    }
    // 本页所有结果都回来了
    if (pendingDomains.size > 0) {
      console.log('[JBD] idle-check: pending', pendingDomains.size);
      return;
    }
    // idle 持续时长够长
    if (idleFor < pageIdleMs) {
      console.log('[JBD] idle-check: idle too short', { idleFor, pageIdleMs });
      return;
    }
    // 后台队列也得是空的
    const qs = await send(MSG.GET_QUEUE_STATUS);
    if (qs && qs.status && (qs.status.queued > 0 || qs.status.inflight > 0)) {
      console.log('[JBD] idle-check: bg queue busy', qs.status);
      return;
    }
    // 防止 8s 内重复
    if (Date.now() - paginationTriedAt < 8000) return;

    // 决定下一步
    if ((c.currentPage || 1) >= (c.maxPages || 1)) {
      await send(MSG.STOP_CAMPAIGN);
      showToast(`✅ 批量扫描完成 · 共 ${c.maxPages} 页`);
      paginationTriedAt = Date.now();
      return;
    }
    const nextUrl = findNextPageLink();
    if (!nextUrl) {
      await send(MSG.STOP_CAMPAIGN);
      showToast('⚠ 没找到下一页链接，扫描结束');
      paginationTriedAt = Date.now();
      return;
    }

    // 3 秒倒计时让用户看清楚 / 有机会停止
    let n = 3;
    showToast(`第 ${c.currentPage}/${c.maxPages} 页扫描完毕，${n} 秒后跳转下一页…`);
    paginationCountdown = setInterval(async () => {
      n--;
      if (n <= 0) {
        clearInterval(paginationCountdown);
        paginationCountdown = null;
        // 跳转前再确认 campaign 仍 active（用户可能在倒计时里点停止）
        const camp2 = await send(MSG.GET_CAMPAIGN);
        if (!camp2 || !camp2.campaign || !camp2.campaign.active) {
          showToast('已取消跳转');
          return;
        }
        await send(MSG.INCR_CAMPAIGN);
        paginationTriedAt = Date.now();
        location.assign(nextUrl);
      } else {
        showToast(`第 ${c.currentPage}/${c.maxPages} 页扫描完毕，${n} 秒后跳转下一页…`);
      }
    }, 1000);
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
