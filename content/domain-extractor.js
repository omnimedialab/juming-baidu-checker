/**
 * 域名提取器：在文本节点 / a[href] / data-* 上扫描可能的待售域名。
 * 过滤聚名网自身、CDN、统计、知名公共域名。
 */
(function attach(scope) {
  scope.JBD = scope.JBD || {};

  const TLD = [
    'com','net','cn','com.cn','net.cn','org.cn','gov.cn',
    'org','cc','top','io','me','info','biz','club','xyz',
    'vip','wang','site','store','online','tech','shop','app','dev',
    'co','tv','la','red','pro','fun','link','live','run','ink','art',
    'pub','work','press','design','ltd','group','team','ren','plus','asia'
  ];
  const TLD_REGEX_PART = TLD
    .sort((a, b) => b.length - a.length)
    .map(t => t.replace(/\./g, '\\.'))
    .join('|');
  const DOMAIN_RE = new RegExp(
    `\\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.(?:${TLD_REGEX_PART}))\\b`,
    'gi'
  );

  const SKIP_DOMAINS = new Set([
    'juming.com',
    'jumingauction.com',
    'jiance.juming.com',
    'tools.juming.com',
    'bootcss.com',
    'bootcdn.cn',
    'baidu.com',
    'baidustatic.com',
    'baiduyun.com',
    'qq.com',
    'sina.com',
    'sohu.com',
    'cnzz.com',
    'umeng.com',
    'hm.baidu.com',
    'cloudflare.com',
    'cloudflareinsights.com',
    'gstatic.com',
    'googletagmanager.com',
    'google-analytics.com',
    'jsdelivr.net',
    'unpkg.com',
    'github.com',
    'github.io',
    'gitee.com',
    'aliyuncs.com',
    'alicdn.com',
    'tencent.com',
    'tcdn.com',
    'staticfile.org',
    'icpchecker.com',
    'beian.miit.gov.cn',
    'miit.gov.cn',
    'example.com',
    'example.net',
    'example.org',
    'localhost'
  ]);

  function normalize(raw) {
    let d = String(raw).trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^\/+/, '');
    d = d.split('/')[0].split('?')[0].split('#')[0];
    d = d.replace(/:\d+$/, '');
    if (d.startsWith('www.')) d = d.slice(4);
    return d;
  }

  function isSkipped(d) {
    if (SKIP_DOMAINS.has(d)) return true;
    // 跳过 juming 自身子域
    if (d.endsWith('.juming.com')) return true;
    if (d.endsWith('.baidu.com')) return true;
    if (d.endsWith('.qq.com')) return true;
    return false;
  }

  /**
   * 扫描根节点下所有文本，提取（domain, textNode|element）。
   * 也会扫描 a[href]、data-* 属性。
   */
  function scanRoot(root) {
    const results = []; // {domain, anchor: Node, kind: 'text'|'attr', el?: Element}
    if (!root || !root.querySelectorAll) return results;

    // 1) text nodes
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = n.nodeValue;
        if (!v || v.length < 4) return NodeFilter.FILTER_REJECT;
        if (n.parentElement && /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(n.parentElement.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (n.parentElement && n.parentElement.classList && n.parentElement.classList.contains('jbd-badge')) {
          return NodeFilter.FILTER_REJECT;
        }
        // /g flag 的 .test() 会保留 lastIndex，跨节点会漏匹配 — 每次必须先归零
        DOMAIN_RE.lastIndex = 0;
        return DOMAIN_RE.test(v) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    DOMAIN_RE.lastIndex = 0;
    let node;
    while ((node = walker.nextNode())) {
      DOMAIN_RE.lastIndex = 0;
      const text = node.nodeValue;
      let m;
      while ((m = DOMAIN_RE.exec(text)) !== null) {
        const d = normalize(m[1]);
        if (d && !isSkipped(d)) {
          results.push({ domain: d, anchor: node, kind: 'text', matchStart: m.index, matchEnd: m.index + m[1].length });
        }
      }
    }

    // 2) anchor href 单独扫一遍（聚名网的域名链接里有 href）
    const anchors = root.querySelectorAll('a[href]');
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      // 只对外链 / 看起来是域名展示的链接处理
      if (!/^https?:\/\//.test(href) && !/^\/\//.test(href)) {
        // 但 a 的 textContent 可能就是域名 — 上面 text walker 已经处理过
        continue;
      }
      try {
        const u = new URL(href, location.origin);
        const d = normalize(u.hostname);
        if (d && !isSkipped(d)) {
          results.push({ domain: d, anchor: a, kind: 'attr', el: a });
        }
      } catch (_) {}
    }

    if (results.length) {
      const uniq = Array.from(new Set(results.map(r => r.domain)));
      console.log('[JBD] scanRoot detected', uniq.length, 'domain(s):', uniq);
    }
    return results;
  }

  scope.JBD.extractor = {
    scanRoot,
    normalize,
    isSkipped,
    DOMAIN_RE
  };
})(typeof window !== 'undefined' ? window : globalThis);
