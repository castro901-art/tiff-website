// Public endpoint only. Set this to the deployed Worker URL ending in /chat.
// Keep provider credentials only in the server-side Worker secret.
window.TIFF_CHAT_API_URL = 'https://tiff-chat-api.trendifytiff.workers.dev/chat';

// Public Turnstile sitekey only; valid on the Tiff site and AI subdomain.
// Keep the matching secret in the Worker secret TURNSTILE_SECRET_KEY.
window.TIFF_TURNSTILE_SITE_KEY = '0x4AAAAAAGMBY7ImXwh2b13q';
