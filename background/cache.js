/**
 * chrome.storage.local 缓存 + 历史 + 设置封装。
 * 模块化（service worker 使用 import 语法）。
 */

const CACHE_NS = 'jbd_cache_v1';
const HISTORY_KEY = 'jbd_history_v1';
const SETTINGS_KEY = 'jbd_settings_v1';
const LISTS_KEY = 'jbd_lists_v1'; // {whitelist:[], blacklist:[]}
const CAMPAIGN_KEY = 'jbd_campaign_v1';

export const DEFAULTS = {
  concurrency: 2,
  delayMinMs: 2000,
  delayMaxMs: 4000,
  cacheTtlDays: 7,
  enableChinaz: false,
  rotateUserAgent: true,
  greenMinIndexed: 10,
  yellowMinIndexed: 1,
  historyLimit: 500,
  maxPages: 5,
  pageIdleMs: 6000,
  minDwellMs: 10000,
  link113AccessKey: '',
  link113AccessSecret: '',
  link113Item: '',
  telegramBotToken: '',
  telegramChatId: ''
};

const storage = chrome.storage.local;

async function get(key, fallback) {
  return new Promise((resolve) => {
    storage.get([key], (res) => resolve(res[key] === undefined ? fallback : res[key]));
  });
}

async function set(key, value) {
  return new Promise((resolve) => storage.set({ [key]: value }, resolve));
}

export async function getCache(domain) {
  const all = await get(CACHE_NS, {});
  const entry = all[domain];
  if (!entry) return null;
  const settings = await getSettings();
  const ttlMs = settings.cacheTtlDays * 24 * 60 * 60 * 1000;
  if (Date.now() - entry.checkedAt > ttlMs) return null;
  return entry;
}

export async function setCache(domain, entry) {
  const all = await get(CACHE_NS, {});
  all[domain] = { ...entry, checkedAt: Date.now() };
  await set(CACHE_NS, all);
  await appendHistory(domain, all[domain]);
}

export async function clearCache() {
  await set(CACHE_NS, {});
}

export async function getAllCache() {
  return get(CACHE_NS, {});
}

async function appendHistory(domain, entry) {
  const settings = await getSettings();
  const list = await get(HISTORY_KEY, []);
  const next = [{ domain, ...entry }, ...list.filter(r => r.domain !== domain)].slice(0, settings.historyLimit);
  await set(HISTORY_KEY, next);
}

export async function getHistory() {
  return get(HISTORY_KEY, []);
}

export async function clearHistory() {
  await set(HISTORY_KEY, []);
}

export async function getSettings() {
  const s = await get(SETTINGS_KEY, {});
  return { ...DEFAULTS, ...s };
}

export async function setSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await set(SETTINGS_KEY, next);
  return next;
}

export async function getLists() {
  return get(LISTS_KEY, { whitelist: [], blacklist: [] });
}

export async function setLists(patch) {
  const cur = await getLists();
  const next = { ...cur, ...patch };
  await set(LISTS_KEY, next);
  return next;
}

export async function getCampaign() {
  return get(CAMPAIGN_KEY, { active: false, currentPage: 0, maxPages: 0 });
}

export async function setCampaign(patch) {
  const cur = await getCampaign();
  const next = { ...cur, ...patch };
  await set(CAMPAIGN_KEY, next);
  return next;
}

export async function clearCampaign() {
  await set(CAMPAIGN_KEY, { active: false, currentPage: 0, maxPages: 0 });
}
