/**
 * Background service worker（MV3, module）。
 * 负责：
 *  - 接收 content / popup / options 消息
 *  - 调度并发的百度查询
 *  - 缓存命中直接返回
 *  - 验证码 → 自动暂停 + 通知
 */

import {
  getCache,
  setCache,
  clearCache,
  getAllCache,
  getHistory,
  clearHistory,
  getSettings,
  setSettings,
  getLists,
  setLists,
  getCampaign,
  setCampaign,
  clearCampaign,
  DEFAULTS
} from './cache.js';
import { queryBaidu } from './baidu-client.js';
import { queryChinaz } from './chinaz-client.js';
import { classify } from './classifier.js';
import { Scheduler } from './scheduler.js';
import { pushDomain as link113Push } from './link113-client.js';
import { sendTelegram, escapeHtml } from './telegram-client.js';

const MSG = {
  CHECK_DOMAINS: 'jbd.checkDomains',
  DOMAIN_RESULT: 'jbd.domainResult',
  GET_CACHED: 'jbd.getCached',
  CLEAR_CACHE: 'jbd.clearCache',
  GET_HISTORY: 'jbd.getHistory',
  GET_SETTINGS: 'jbd.getSettings',
  SET_SETTINGS: 'jbd.setSettings',
  PAUSE_QUEUE: 'jbd.pauseQueue',
  RESUME_QUEUE: 'jbd.resumeQueue',
  GET_QUEUE_STATUS: 'jbd.getQueueStatus',
  QUEUE_STATUS_UPDATE: 'jbd.queueStatusUpdate',
  CAPTCHA_DETECTED: 'jbd.captchaDetected',
  EXPORT_CSV: 'jbd.exportCsv',
  UPDATE_LIST: 'jbd.updateList',
  CLEAR_HISTORY: 'jbd.clearHistory',
  START_CAMPAIGN: 'jbd.startCampaign',
  STOP_CAMPAIGN: 'jbd.stopCampaign',
  GET_CAMPAIGN: 'jbd.getCampaign',
  INCR_CAMPAIGN: 'jbd.incrCampaign',
  CAMPAIGN_UPDATE: 'jbd.campaignUpdate',
  GET_PAGE_DOMAINS: 'jbd.getPageDomains',
  PUSH_LINK113: 'jbd.pushLink113'
};

let scheduler = null;
let captchaPaused = false;

// 广播到所有 content / popup / options
function broadcast(type, payload) {
  try {
    chrome.runtime.sendMessage({ type, payload }).catch(() => {});
  } catch (_) {}
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (!t.id) continue;
      chrome.tabs.sendMessage(t.id, { type, payload }).catch(() => {});
    }
  });
}

async function ensureScheduler() {
  if (scheduler) return scheduler;
  const s = await getSettings();
  scheduler = new Scheduler({
    concurrency: s.concurrency,
    delayMinMs: s.delayMinMs,
    delayMaxMs: s.delayMaxMs,
    onResult: handleSchedResult,
    onStatus: handleSchedStatus
  });
  return scheduler;
}

function handleSchedStatus(status) {
  broadcast(MSG.QUEUE_STATUS_UPDATE, status);
}

function handleSchedResult(domain, result, err) {
  if (err) {
    broadcast(MSG.DOMAIN_RESULT, { domain, status: 'error', reasons: ['exception:' + (err.message || err)] });
  }
}

async function checkOneDomain(domain, settings, lists) {
  if (lists.whitelist.includes(domain)) {
    const entry = { status: 'green', reasons: ['whitelisted'], baiduCount: null, ranksFirst: null };
    await setCache(domain, entry);
    broadcast(MSG.DOMAIN_RESULT, { domain, ...entry });
    return entry;
  }
  if (lists.blacklist.includes(domain)) {
    const entry = { status: 'red', reasons: ['blacklisted'], baiduCount: null, ranksFirst: null };
    await setCache(domain, entry);
    broadcast(MSG.DOMAIN_RESULT, { domain, ...entry });
    return entry;
  }

  const cached = await getCache(domain);
  if (cached) {
    broadcast(MSG.DOMAIN_RESULT, { domain, ...cached, fromCache: true });
    return cached;
  }

  const baidu = await queryBaidu(domain);
  if (baidu && baidu.error === 'parse' && baidu.sample) {
    await chrome.storage.local.set({
      jbd_last_parse_fail_v1: {
        domain,
        sample: baidu.sample,
        htmlSize: baidu.htmlSize,
        finalUrl: baidu.finalUrl,
        at: Date.now()
      }
    });
  }
  if (baidu && baidu.error === 'captcha') {
    captchaPaused = true;
    (await ensureScheduler()).pause();
    broadcast(MSG.CAPTCHA_DETECTED, { domain });
    const entry = { status: 'error', reasons: ['captcha'], baiduCount: null, ranksFirst: null };
    broadcast(MSG.DOMAIN_RESULT, { domain, ...entry });
    return entry;
  }
  // 一旦有一次百度请求顺利返回（非验证码），自动撤掉 captchaPaused 警示
  if (baidu && baidu.ok && captchaPaused) {
    captchaPaused = false;
  }

  let chinaz = null;
  if (settings.enableChinaz && baidu && baidu.ok) {
    chinaz = await queryChinaz(domain);
  }
  const verdict = classify({ baidu, chinaz }, settings);
  const entry = {
    status: verdict.status,
    reasons: verdict.reasons,
    baiduCount: baidu && baidu.ok ? baidu.baiduCount : null,
    ranksFirst: baidu && baidu.ok ? baidu.ranksFirst : null,
    chinazBR: chinaz && chinaz.ok ? chinaz.chinazBR : null,
    error: baidu && !baidu.ok ? baidu.error : null
  };
  await setCache(domain, entry);
  broadcast(MSG.DOMAIN_RESULT, { domain, ...entry });
  return entry;
}

async function enqueueDomains(domains) {
  const sched = await ensureScheduler();
  const settings = await getSettings();
  sched.configure({
    concurrency: settings.concurrency,
    delayMinMs: settings.delayMinMs,
    delayMaxMs: settings.delayMaxMs
  });
  const lists = await getLists();

  for (const domain of domains) {
    if (!domain) continue;
    const cached = await getCache(domain);
    if (cached) {
      broadcast(MSG.DOMAIN_RESULT, { domain, ...cached, fromCache: true });
      continue;
    }
    sched.enqueue({
      id: domain,
      run: () => checkOneDomain(domain, settings, lists)
    });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case MSG.CHECK_DOMAINS: {
          const domains = (msg.payload && msg.payload.domains) || [];
          await enqueueDomains(domains);
          sendResponse({ ok: true, accepted: domains.length });
          break;
        }
        case MSG.GET_CACHED: {
          const all = await getAllCache();
          sendResponse({ ok: true, data: all });
          break;
        }
        case MSG.CLEAR_CACHE: {
          await clearCache();
          sendResponse({ ok: true });
          break;
        }
        case MSG.CLEAR_HISTORY: {
          await clearHistory();
          sendResponse({ ok: true });
          break;
        }
        case MSG.GET_HISTORY: {
          const hist = await getHistory();
          sendResponse({ ok: true, data: hist });
          break;
        }
        case MSG.GET_SETTINGS: {
          const s = await getSettings();
          const lists = await getLists();
          sendResponse({ ok: true, settings: s, lists });
          break;
        }
        case MSG.SET_SETTINGS: {
          const s = await setSettings(msg.payload || {});
          if (scheduler) scheduler.configure(s);
          sendResponse({ ok: true, settings: s });
          break;
        }
        case MSG.UPDATE_LIST: {
          const next = await setLists(msg.payload || {});
          sendResponse({ ok: true, lists: next });
          break;
        }
        case MSG.PAUSE_QUEUE: {
          (await ensureScheduler()).pause();
          sendResponse({ ok: true });
          break;
        }
        case MSG.RESUME_QUEUE: {
          captchaPaused = false;
          (await ensureScheduler()).resume();
          sendResponse({ ok: true });
          break;
        }
        case MSG.GET_QUEUE_STATUS: {
          const s = await ensureScheduler();
          sendResponse({ ok: true, status: { ...s.status(), captchaPaused } });
          break;
        }
        case MSG.START_CAMPAIGN: {
          const { maxPages, startUrl } = msg.payload || {};
          const settings = await getSettings();
          const c = await setCampaign({
            active: true,
            currentPage: 1,
            maxPages: Math.max(1, parseInt(maxPages, 10) || settings.maxPages || 5),
            startUrl: startUrl || '',
            startedAt: Date.now()
          });
          broadcast(MSG.CAMPAIGN_UPDATE, c);
          // 主动通知活动 tab 做一次显式重扫，给用户可见反馈
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
              chrome.tabs.sendMessage(tabs[0].id, { type: 'jbd.campaignKickstart', payload: c }).catch(() => {});
            }
          });
          sendResponse({ ok: true, campaign: c });
          break;
        }
        case MSG.STOP_CAMPAIGN: {
          await clearCampaign();
          broadcast(MSG.CAMPAIGN_UPDATE, { active: false });
          sendResponse({ ok: true });
          break;
        }
        case MSG.GET_CAMPAIGN: {
          const c = await getCampaign();
          // 防呆：超过 30 分钟自动过期（用户大概早就离开了）
          if (c && c.active && c.startedAt && Date.now() - c.startedAt > 30 * 60 * 1000) {
            await clearCampaign();
            sendResponse({ ok: true, campaign: { active: false } });
            break;
          }
          sendResponse({ ok: true, campaign: c });
          break;
        }
        case 'jbd.retryErrors': {
          const all = await getAllCache();
          const errored = [];
          for (const [domain, entry] of Object.entries(all)) {
            if (entry && entry.status === 'error') {
              errored.push(domain);
              delete all[domain];
            }
          }
          if (errored.length) {
            await chrome.storage.local.set({ jbd_cache_v1: all });
            await enqueueDomains(errored);
          }
          sendResponse({ ok: true, requeued: errored.length });
          break;
        }
        case MSG.PUSH_LINK113: {
          const r = await pushCurrentPageToLink113();
          sendResponse(r);
          break;
        }
        case MSG.INCR_CAMPAIGN: {
          const cur = await getCampaign();
          if (!cur || !cur.active) { sendResponse({ ok: false, error: 'campaign-not-active' }); break; }
          const next = await setCampaign({ currentPage: (cur.currentPage || 1) + 1 });
          broadcast(MSG.CAMPAIGN_UPDATE, next);
          sendResponse({ ok: true, campaign: next });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown-msg' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true; // async sendResponse
});

async function getActiveTabDomains() {
  const tab = await new Promise((r) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => r((tabs && tabs[0]) || null));
  });
  if (!tab || !tab.id) return { ok: false, error: 'no-active-tab' };
  if (!/^https?:\/\/[^\/]*(juming|gname)\.com/.test(tab.url || '')) {
    return { ok: false, error: 'unsupported-host', url: tab.url || '' };
  }
  const res = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: MSG.GET_PAGE_DOMAINS }, (r) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: 'content-script-missing' });
      else resolve(r || { ok: false, error: 'no-response' });
    });
  });
  if (!res || !res.ok) return res || { ok: false, error: 'unknown' };
  return { ok: true, domains: res.domains || [], pageUrl: tab.url || '', pageTitle: tab.title || '' };
}

async function pushCurrentPageToLink113() {
  const settings = await getSettings();
  const missing = [];
  if (!settings.link113AccessKey) missing.push('link113AccessKey');
  if (!settings.link113AccessSecret) missing.push('link113AccessSecret');
  if (!settings.link113Item) missing.push('link113Item');
  if (!settings.telegramBotToken) missing.push('telegramBotToken');
  if (!settings.telegramChatId) missing.push('telegramChatId');
  if (missing.length) return { ok: false, error: 'missing-settings', missing };

  const dom = await getActiveTabDomains();
  if (!dom.ok) return dom;
  const domains = Array.from(new Set(dom.domains || [])).filter(Boolean);
  if (!domains.length) return { ok: false, error: 'no-domains-on-page' };

  // 1) push each to link113. Use a session prefix + index as id.
  const sessionPrefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const results = [];
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    const id = `${sessionPrefix}-${i}`;
    const r = await link113Push({
      id,
      domain: d,
      item: settings.link113Item,
      accessKey: settings.link113AccessKey,
      accessSecret: settings.link113AccessSecret
    });
    results.push({ domain: d, id, ok: r.ok, error: r.error || null, raw: r.raw || null });
  }

  const okCount = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;
  const errSamples = results.filter(r => !r.ok).slice(0, 3)
    .map(r => `${r.domain} → ${r.error || '?'}`).join('\n');

  // 2) post a summary to TG
  const lines = [];
  lines.push(`🚀 <b>link113 提交</b> · item=<code>${escapeHtml(settings.link113Item)}</code>`);
  lines.push(`<b>来源:</b> ${escapeHtml(dom.pageUrl)}`);
  if (dom.pageTitle) lines.push(`<b>标题:</b> ${escapeHtml(dom.pageTitle)}`);
  lines.push(`<b>提交:</b> ${okCount}/${results.length}${failCount ? ` · 失败 ${failCount}` : ''}`);
  lines.push(`<b>session:</b> <code>${sessionPrefix}</code>`);
  lines.push('');
  lines.push('<b>域名列表:</b>');
  for (const r of results) {
    const baiduSite = `https://www.baidu.com/s?wd=site%3A${encodeURIComponent(r.domain)}`;
    lines.push(`${r.ok ? '✅' : '❌'} <a href="${baiduSite}">${escapeHtml(r.domain)}</a>${r.ok ? '' : ` (${escapeHtml(r.error || '?')})`}`);
  }
  if (errSamples) {
    lines.push('');
    lines.push('<b>失败样本:</b>');
    lines.push(`<pre>${escapeHtml(errSamples)}</pre>`);
  }
  // TG sendMessage 上限 4096 字符 — 超长就截断
  let text = lines.join('\n');
  if (text.length > 3800) text = text.slice(0, 3800) + '\n…(已截断)';
  const tg = await sendTelegram({
    botToken: settings.telegramBotToken,
    chatId: settings.telegramChatId,
    text
  });

  return {
    ok: tg.ok,
    pushed: okCount,
    failed: failCount,
    total: results.length,
    sessionPrefix,
    tg
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  // 确保默认 settings 落库
  const s = await getSettings();
  await setSettings(s);
  // 每次安装/更新/重载扩展，重置 campaign 状态，避免上次未完成的批量扫描自动恢复
  await clearCampaign();
  await ensureScheduler();
});

// 浏览器启动也清一下，避免昨天的 campaign 今天接着跑
chrome.runtime.onStartup.addListener(async () => {
  await clearCampaign();
});

// keep-alive heartbeat：MV3 service worker 会被回收，业务消息会唤醒
chrome.alarms.create('jbd-heartbeat', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'jbd-heartbeat') {
    await ensureScheduler();
  }
});
