/**
 * Telegram Bot API client - minimal sendMessage.
 *  https://core.telegram.org/bots/api#sendmessage
 */

export async function sendTelegram({ botToken, chatId, text, parseMode = 'HTML' }) {
  if (!botToken || !chatId) return { ok: false, error: 'no-credentials' };
  if (!text) return { ok: false, error: 'no-text' };
  const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true
      })
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.ok === false) {
      return { ok: false, error: 'tg-' + (json && json.description ? json.description : res.status) };
    }
    return { ok: true, message_id: json.result && json.result.message_id };
  } catch (e) {
    return { ok: false, error: 'network', detail: e.message || String(e) };
  }
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
