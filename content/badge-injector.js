/**
 * 给 (domain, anchor) 注入徽章 DOM；同 domain 多处出现都更新。
 * 徽章设计：
 *   <span class="jbd-badge jbd-pending" data-jbd-domain="xxx.com" title="...">·</span>
 */
(function attach(scope) {
  scope.JBD = scope.JBD || {};

  // domain -> Set<HTMLElement>
  const badgesByDomain = new Map();

  function makeBadge(domain) {
    const span = document.createElement('span');
    span.className = 'jbd-badge jbd-pending';
    span.setAttribute('data-jbd-domain', domain);
    span.textContent = '…';
    span.title = `[JBD] ${domain} · 待检测`;
    return span;
  }

  function attachAfterTextNode(textNode, matchEnd, domain) {
    // 把 textNode 切开：保留前缀+域名，把徽章插到域名后面
    const after = textNode.splitText(matchEnd); // textNode = 前段(含域名), after = 后段
    const badge = makeBadge(domain);
    if (textNode.parentNode) {
      textNode.parentNode.insertBefore(badge, after);
    }
    return badge;
  }

  function attachAfterAnchor(anchorEl, domain) {
    const badge = makeBadge(domain);
    if (anchorEl.nextSibling) {
      anchorEl.parentNode.insertBefore(badge, anchorEl.nextSibling);
    } else {
      anchorEl.parentNode.appendChild(badge);
    }
    return badge;
  }

  function inject(hit) {
    // hit = { domain, anchor: Node, kind, matchStart?, matchEnd?, el? }
    const { domain, anchor, kind } = hit;
    if (!anchor || !anchor.parentNode) return null;
    // 避免给同一段重复注入
    const sibling = (kind === 'attr') ? anchor.nextElementSibling : anchor.nextSibling;
    if (sibling && sibling.classList && sibling.classList.contains('jbd-badge') && sibling.getAttribute('data-jbd-domain') === domain) {
      return sibling;
    }
    let badge;
    if (kind === 'text') {
      try {
        badge = attachAfterTextNode(anchor, hit.matchEnd, domain);
      } catch (e) {
        return null;
      }
    } else {
      badge = attachAfterAnchor(anchor, domain);
    }
    if (badge) {
      if (!badgesByDomain.has(domain)) badgesByDomain.set(domain, new Set());
      badgesByDomain.get(domain).add(badge);
    }
    return badge;
  }

  function updateBadge(domain, result) {
    const set = badgesByDomain.get(domain);
    if (!set || !set.size) return;
    const cls = `jbd-${result.status || 'pending'}`;
    const txt = labelFor(result.status);
    const tooltip = tooltipFor(domain, result);
    for (const el of set) {
      el.classList.remove('jbd-pending','jbd-queued','jbd-green','jbd-yellow','jbd-red','jbd-error','jbd-blacklisted','jbd-whitelisted');
      el.classList.add(cls);
      el.textContent = txt;
      el.title = tooltip;
      el.setAttribute('data-jbd-status', result.status || '');
    }
  }

  function labelFor(status) {
    switch (status) {
      case 'green': return '✓';
      case 'yellow': return '?';
      case 'red': return '×';
      case 'error': return '!';
      case 'queued': return '…';
      default: return '·';
    }
  }

  function tooltipFor(domain, r) {
    const lines = [`[JBD] ${domain}`];
    if (r.status) lines.push('状态：' + statusName(r.status));
    if (typeof r.baiduCount === 'number') lines.push('百度收录：' + r.baiduCount);
    if (typeof r.ranksFirst === 'boolean') lines.push('首页排第一：' + (r.ranksFirst ? '是' : '否'));
    if (typeof r.chinazBR === 'number') lines.push('Chinaz BR：' + r.chinazBR);
    if (r.error) lines.push('错误：' + r.error);
    if (r.reasons && r.reasons.length) lines.push('依据：' + r.reasons.join(', '));
    if (r.checkedAt) lines.push('时间：' + new Date(r.checkedAt).toLocaleString());
    if (r.fromCache) lines.push('(来自缓存)');
    return lines.join('\n');
  }

  function statusName(s) {
    return {
      green: '值得购买',
      yellow: '待人工复核',
      red: '不建议',
      error: '检测失败',
      pending: '待检测',
      queued: '排队中',
      blacklisted: '已加入黑名单',
      whitelisted: '已加入白名单'
    }[s] || s;
  }

  function allDomains() {
    return Array.from(badgesByDomain.keys());
  }

  scope.JBD.injector = {
    inject,
    updateBadge,
    allDomains
  };
})(typeof window !== 'undefined' ? window : globalThis);
