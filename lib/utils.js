/**
 * 跨上下文共用工具。挂到 globalThis.JBD.utils。
 */
(function attach(scope) {
  scope.JBD = scope.JBD || {};
  const utils = {};

  utils.sleep = (ms) => new Promise(r => setTimeout(r, ms));

  utils.randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  utils.now = () => Date.now();

  utils.normalizeDomain = (raw) => {
    if (!raw) return null;
    let d = String(raw).trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^\/+/, '');
    d = d.split('/')[0].split('?')[0].split('#')[0];
    d = d.replace(/:\d+$/, '');
    if (d.startsWith('www.')) d = d.slice(4);
    if (!utils.isValidDomain(d)) return null;
    return d;
  };

  utils.isValidDomain = (d) => {
    if (!d || d.length > 253) return false;
    if (!/^[a-z0-9]/.test(d)) return false;
    const parts = d.split('.');
    if (parts.length < 2) return false;
    for (const p of parts) {
      if (!/^[a-z0-9-]+$/.test(p)) return false;
      if (p.startsWith('-') || p.endsWith('-')) return false;
      if (p.length > 63) return false;
    }
    return true;
  };

  utils.toCSV = (rows, columns) => {
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      if (/[",\n\r]/.test(s)) return `"${s}"`;
      return s;
    };
    const head = columns.map(c => esc(c.header)).join(',');
    const body = rows.map(r => columns.map(c => esc(c.get(r))).join(',')).join('\n');
    return head + '\n' + body;
  };

  utils.fmtTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  utils.dedupe = (arr) => Array.from(new Set(arr));

  scope.JBD.utils = utils;
})(typeof self !== 'undefined' ? self : globalThis);
