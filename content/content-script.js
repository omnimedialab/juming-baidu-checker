/**
 * Content script 入口：
 *  - 初次 scan
 *  - 注入徽章
 *  - 发消息让 background 去检测
 *  - 监听 DOM 变化（聚名网 ajax 翻页）增量 scan
 *  - 监听 background 回填结果，更新徽章
 */
(function () {
  const MSG = (self.JBD && self.JBD.MSG) || {
    CHECK_DOMAINS: 'jbd.checkDomains',
    DOMAIN_RESULT: 'jbd.domainResult',
    CAPTCHA_DETECTED: 'jbd.captchaDetected'
  };
  const extractor = self.JBD.extractor;
  const injector = self.JBD.injector;

  if (!extractor || !injector) {
    console.warn('[JBD] extractor/injector not loaded');
    return;
  }

  const seenDomains = new Set();
  let pendingScan = null;

  function scanAndInject(root) {
    const hits = extractor.scanRoot(root || document.body);
    const newDomains = [];
    for (const hit of hits) {
      const badge = injector.inject(hit);
      if (badge && !seenDomains.has(hit.domain)) {
        seenDomains.add(hit.domain);
        newDomains.push(hit.domain);
      }
    }
    if (newDomains.length) {
      requestCheck(newDomains);
    }
  }

  function requestCheck(domains) {
    try {
      chrome.runtime.sendMessage({
        type: MSG.CHECK_DOMAINS,
        payload: { domains }
      }).catch(() => {});
    } catch (_) {}
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
      if (domain) injector.updateBadge(domain, rest);
    } else if (msg.type === MSG.CAPTCHA_DETECTED) {
      showToast('百度返回了验证码页 — 队列已暂停。请在新标签页打开 baidu.com 通过验证码后，在扩展弹窗点"继续"。');
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
    if (touched) scheduleScan();
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: false });

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
