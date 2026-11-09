(() => {
  const root = document.querySelector('[data-tiff-chat]');
  if (!root) return;

  const log = root.querySelector('[data-chat-log]');
  const form = root.querySelector('[data-chat-form]');
  const input = root.querySelector('[data-chat-input]');
  const sendButton = root.querySelector('[data-chat-send]');
  const status = root.querySelector('[data-chat-status]');
  const newChatButton = root.querySelector('[data-new-chat]');
  const starters = root.querySelector('[data-chat-starters]');
  const history = [];
  const maxHistoryMessages = 16;
  let busy = false;

  function messageElement(role, text, extraClass = '') {
    const article = document.createElement('article');
    article.className = `tiff-message ${role}${extraClass ? ` ${extraClass}` : ''}`;
    article.setAttribute('aria-label', role === 'user' ? 'Your message' : 'Tiff reply');

    const label = document.createElement('span');
    label.className = 'tiff-message-label';
    label.textContent = role === 'user' ? 'You' : 'Tiff';

    const body = document.createElement('p');
    body.className = 'tiff-message-body';
    body.textContent = text;

    article.append(label, body);
    return article;
  }

  function addMessage(role, text) {
    const element = messageElement(role, text);
    log.append(element);
    log.scrollTop = log.scrollHeight;
    return element;
  }

  function showWelcome() {
    log.replaceChildren(messageElement('assistant', 'Hi, I’m Tiff. What would you like to explore?'));
    log.scrollTop = 0;
  }

  function setBusy(value) {
    busy = value;
    input.disabled = value;
    sendButton.disabled = value;
    newChatButton.disabled = value;
    if (starters) starters.querySelectorAll('button').forEach((button) => { button.disabled = value; });
  }

  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 152)}px`;
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
    if (starters) starters.hidden = true;
    input.value = '';
    resizeInput();
    setBusy(true);
    status.textContent = 'Tiff is thinking…';
    const pending = addMessage('assistant', 'Tiff is thinking…', 'pending');

    try {
      if (!endpointIsConfigured()) {
        throw new Error('Tiff Chat is being connected. Please try again soon.');
      }

      const response = await fetch(window.TIFF_CHAT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
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

  if (starters) {
    starters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-prompt]');
      if (button && !busy) sendMessage(button.dataset.prompt || button.textContent || '');
    });
  }

  newChatButton.addEventListener('click', () => {
    if (busy) return;
    history.length = 0;
    if (starters) starters.hidden = false;
    showWelcome();
    status.textContent = 'New conversation started. Your chat history is only kept in this page while it is open.';
    input.focus();
  });

  showWelcome();
  resizeInput();
})();
