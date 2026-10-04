(function () {
  function loadArticle(panel) {
    if (!panel || panel.getAttribute('data-fragment-loaded') === 'true' || panel.getAttribute('data-fragment-loading') === 'true') return;
    var target = panel.querySelector('[data-article-fragment]');
    if (!target) return;
    panel.setAttribute('data-fragment-loading', 'true');
    target.setAttribute('aria-busy', 'true');
    target.innerHTML = '<p class="article-loading" role="status">Loading full article...</p>';
    window.fetch(target.getAttribute('data-article-fragment')).then(function (response) {
      if (!response.ok) throw new Error('Article unavailable');
      return response.text();
    }).then(function (html) {
      target.innerHTML = html;
      target.setAttribute('aria-busy', 'false');
      panel.setAttribute('data-fragment-loaded', 'true');
      var region = panel.closest('.research-detail-area');
      var live = region && region.querySelector('[data-reveal-status]');
      var heading = panel.querySelector('[data-reveal-heading]');
      if (live && heading) live.textContent = heading.textContent + ' full article loaded.';
    }).catch(function () {
      target.innerHTML = '<p class="article-load-error" role="status">The full article could not be loaded. Check your connection and try again.</p><button class="btn ghost" type="button" data-fragment-retry>Try again</button>';
      target.setAttribute('aria-busy', 'false');
    }).finally(function () {
      panel.removeAttribute('data-fragment-loading');
    });
  }

  document.querySelectorAll('[data-reveal-control]').forEach(function (control) {
    control.addEventListener('click', function () {
      var panel = document.getElementById(control.getAttribute('aria-controls'));
      if (panel && !panel.hidden) loadArticle(panel);
    });
  });

  document.addEventListener('click', function (event) {
    if (!event.target.matches('[data-fragment-retry]')) return;
    loadArticle(event.target.closest('[data-reveal-panel]'));
  });

  document.querySelectorAll('[data-reveal-panel]:not([hidden])').forEach(loadArticle);
})();
