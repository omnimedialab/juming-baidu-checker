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
  CAMPAIGN_UPDATE: 'jbd.campaignUpdate'
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
