/**
 * 消息协议常量：content <-> background <-> popup/options 共用。
 * 用 globalThis 暴露以便 content script(非 module) 也能引用。
 */
(function attach(scope) {
  scope.JBD = scope.JBD || {};
  scope.JBD.MSG = {
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
    START_CAMPAIGN: 'jbd.startCampaign',
    STOP_CAMPAIGN: 'jbd.stopCampaign',
    GET_CAMPAIGN: 'jbd.getCampaign',
    INCR_CAMPAIGN: 'jbd.incrCampaign',
    CAMPAIGN_UPDATE: 'jbd.campaignUpdate'
  };

  scope.JBD.STATUS = {
    PENDING: 'pending',
    QUEUED: 'queued',
    GREEN: 'green',
    YELLOW: 'yellow',
    RED: 'red',
    ERROR: 'error',
    BLACKLISTED: 'blacklisted',
    WHITELISTED: 'whitelisted'
  };

  scope.JBD.DEFAULTS = {
    concurrency: 3,
    delayMinMs: 1200,
    delayMaxMs: 3000,
    cacheTtlDays: 7,
    enableChinaz: false,
    rotateUserAgent: true,
    greenMinIndexed: 10,
    yellowMinIndexed: 1,
    historyLimit: 500,
    maxPages: 5,
    pageIdleMs: 4000
  };
})(typeof self !== 'undefined' ? self : globalThis);
