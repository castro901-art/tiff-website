(() => {
  if (window.location.pathname === '/page') {
    window.history.replaceState(null, '', `/page/${window.location.search}${window.location.hash}`);
  }

  const root = document.querySelector('[data-chat-log]')?.closest('.tiff-conversation');
  if (!root) return;

  const log = root.querySelector('[data-chat-log]');
  const form = root.querySelector('[data-chat-form]');
  const input = root.querySelector('[data-chat-input]');
  const sendButton = root.querySelector('[data-chat-send]');
  const status = root.querySelector('[data-chat-status]');
  const newChatButton = document.querySelector('[data-new-chat]');
  const history = [];
  const maxHistoryMessages = 16;
  const pendingPromptKey = 'tiff.pendingPrompt.v1';
  let busy = false;
  let turnstileScriptPromise = null;
  let turnstileWidgetId = null;
  let pendingTurnstile = null;

  function settleTurnstile(error, token) {
    if (!pendingTurnstile) return;
    const pending = pendingTurnstile;
    pendingTurnstile = null;
    window.clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(token);
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileScriptPromise) return turnstileScriptPromise;

    turnstileScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('The security check could not be loaded. Please try again.'));
      script.onerror = () => reject(new Error('The security check could not be loaded. Please try again.'));
      document.head.append(script);
    });
    return turnstileScriptPromise;
  }

  async function getTurnstileToken() {
    const sitekey = window.TIFF_TURNSTILE_SITE_KEY;
    if (typeof sitekey !== 'string' || !sitekey.trim()) {
      throw new Error('Tiff Chat security is being set up. Please try again soon.');
    }
    const turnstile = await loadTurnstile();

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        settleTurnstile(new Error('The security check timed out. Please try again.'));
      }, 90_000);
      pendingTurnstile = { resolve, reject, timer };

      try {
        if (turnstileWidgetId === null) {
          const slot = document.createElement('div');
          slot.className = 'tiff-turnstile-slot';
          document.body.append(slot);
          turnstileWidgetId = turnstile.render(slot, {
            sitekey,
            action: 'tiff_chat',
            execution: 'execute',
            appearance: 'interaction-only',
            callback(token) {
              if (typeof token === 'string' && token) settleTurnstile(null, token);
              else settleTurnstile(new Error('The security check could not be completed. Please try again.'));
            },
            'error-callback': () => settleTurnstile(new Error('The security check could not be completed. Please try again.')),
            'expired-callback': () => settleTurnstile(new Error('The security check expired. Please try again.'))
          });
        }
        turnstile.execute(turnstileWidgetId);
      } catch {
        settleTurnstile(new Error('The security check could not be completed. Please try again.'));
      }
    });
  }

  function resetTurnstileWidget() {
    if (!window.turnstile || turnstileWidgetId === null) return;
    try {
      window.turnstile.reset(turnstileWidgetId);
    } catch {
      // A failed or expired challenge may already have reset itself.
    }
  }

  function welcomeElement() {
    const section = document.createElement('section');
    section.className = 'tiff-empty-state';
    section.setAttribute('aria-labelledby', 'tiff-welcome-title');

    const mark = document.createElement('img');
    mark.src = '/assets/tiff-mark.png';
    mark.alt = '';
    mark.width = 54;
    mark.height = 48;

    const heading = document.createElement('h1');
    heading.id = 'tiff-welcome-title';
    heading.textContent = 'What would you like to explore?';

    const description = document.createElement('p');
    description.textContent = 'Ask a question, work through an idea, or get help with something you’re writing.';

    section.append(mark, heading, description);
    return section;
  }

  function messageElement(role, text, extraClass = '') {
    const article = document.createElement('article');
    article.className = `tiff-turn ${role}${extraClass ? ` ${extraClass}` : ''}`;
    article.setAttribute('aria-label', role === 'user' ? 'Your message' : 'Tiff reply');

    if (role === 'assistant') {
      const avatar = document.createElement('span');
      avatar.className = 'tiff-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      const mark = document.createElement('img');
      mark.src = '/assets/tiff-mark.png';
      mark.alt = '';
      avatar.append(mark);
      article.append(avatar);
    }

    const content = document.createElement('div');
    content.className = 'tiff-turn-content';
    const body = document.createElement('p');
    body.className = 'tiff-message-body';
    body.textContent = text;
    content.append(body);
    article.append(content);
    return article;
  }

  function addMessage(role, text, extraClass = '') {
    if (log.querySelector('.tiff-empty-state')) log.replaceChildren();
    const element = messageElement(role, text, extraClass);
    log.append(element);
    log.scrollTop = log.scrollHeight;
    return element;
  }

  function showWelcome() {
    log.replaceChildren(welcomeElement());
    log.scrollTop = 0;
  }

  function setBusy(value) {
    busy = value;
    input.disabled = value;
    sendButton.disabled = value;
    newChatButton.disabled = value;
  }

  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  function endpointIsConfigured() {
    const endpoint = window.TIFF_CHAT_API_URL;
    return typeof endpoint === 'string' && /^https:\/\//i.test(endpoint) && !endpoint.includes('YOUR-WORKER');
  }

  async function sendMessage(value) {
    const text = value.trim();
    if (!text || busy) return;

    addMessage('user', text);
    history.push({ role: 'user', text });
    while (history.length > maxHistoryMessages) history.splice(0, 2);
    input.value = '';
    resizeInput();
    setBusy(true);
    status.textContent = 'Tiff is thinking…';
    const pending = addMessage('assistant', 'Tiff is thinking…', 'pending');

    try {
      if (!endpointIsConfigured()) {
        throw new Error('Tiff Chat is being connected. Please try again soon.');
      }

      const turnstileToken = await getTurnstileToken();
      const response = await fetch(window.TIFF_CHAT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, turnstileToken })
      });

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error('Tiff could not respond just now. Please try again.');
      }

      if (!response.ok || typeof payload.reply !== 'string' || !payload.reply.trim()) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Tiff could not respond just now. Please try again.');
      }

      pending.remove();
      history.push({ role: 'assistant', text: payload.reply });
      addMessage('assistant', payload.reply);
      status.textContent = 'Tiff replied.';
    } catch (error) {
      if (history[history.length - 1]?.role === 'user') history.pop();
      pending.remove();
      const message = error instanceof TypeError
        ? 'Tiff could not connect just now. Please try again in a moment.'
        : (error.message || 'Tiff could not respond just now. Please try again.');
      addMessage('assistant', message);
      status.textContent = 'There was a problem sending your message.';
    } finally {
      resetTurnstileWidget();
      setBusy(false);
      input.focus();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });

  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  newChatButton.addEventListener('click', () => {
    if (busy) return;
    history.length = 0;
    input.value = '';
    showWelcome();
    status.textContent = 'New conversation started. Your chat history is only kept in this page while it is open.';
    input.focus();
    resizeInput();
  });

  showWelcome();
  resizeInput();

  let initialPrompt = '';
  try {
    initialPrompt = window.sessionStorage.getItem(pendingPromptKey) || '';
    window.sessionStorage.removeItem(pendingPromptKey);
  } catch {
    // Direct visits still work when session storage is unavailable.
  }
  if (initialPrompt.trim()) sendMessage(initialPrompt);
})();
