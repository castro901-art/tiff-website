(() => {
  const root = document.querySelector('[data-chat-launch]');
  if (!root) return;

  const form = root.querySelector('[data-chat-launch-form]');
  const input = root.querySelector('[data-launch-input]');
  const status = root.querySelector('[data-launch-status]');
  const starters = document.querySelector('[data-chat-starters]');
  const pendingPromptKey = 'tiff.pendingPrompt.v1';

  function openConversation(value) {
    const prompt = value.trim();
    if (!prompt) return;
    try {
      window.sessionStorage.setItem(pendingPromptKey, prompt);
      window.location.assign('/page/');
    } catch {
      status.textContent = 'Your browser could not carry the question to Tiff. Please allow session storage and try again.';
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    openConversation(input.value);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  if (starters) {
    starters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-prompt]');
      if (!button) return;
      input.value = button.dataset.prompt || button.textContent || '';
      form.requestSubmit();
    });
  }
})();
