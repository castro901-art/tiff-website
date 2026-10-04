(function () {
  var header = '<header class="site-header"><div class="wrap nav"><a class="brand" href="index.html" aria-label="Trendify home"><img class="brand-mark" src="assets/tiff-mark.png" alt=""><span class="brand-name">Trendify</span><span class="brand-by">AI Labs</span></a><button class="menu-btn" type="button" aria-expanded="false" aria-controls="primary-nav">Menu</button><nav id="primary-nav" aria-label="Primary navigation"><a href="models.html">Models</a><a href="tiff.html">Tiff</a><div class="nav-dropdown"><div class="nav-research-top"><a href="tam.html">Research</a><button class="dropdown-toggle" type="button" aria-label="Toggle Research topics" aria-expanded="false"><span aria-hidden="true">▾</span></button></div><div class="dropdown-menu"><a class="dropdown-parent" href="tam.html#ca-aallm">CA-AALLM</a><a class="dropdown-child" href="tam.html#tam">TAM</a><a class="dropdown-child" href="tam.html#communities">Communities</a><span class="dropdown-divider" aria-hidden="true"></span><a href="tam.html#culture">Culture</a><a href="tam.html#economy">Economy</a><a href="tam.html#sports">Sports</a><a href="tam.html#governance">Governance</a></div></div><a href="news.html">News</a><a href="about.html">Company</a></nav></div></header>';
  var footer = '<footer class="site-footer"><div class="wrap"><div class="foot-top"><a href="index.html" class="brand"><img class="brand-mark" src="assets/tiff-mark.png" alt=""><span class="brand-name">Trendify</span></a><p class="muted small">Intelligence redefined.</p></div><div class="foot-grid"><div><h4>Products</h4><a href="tiff.html">Tiff</a><a href="tiff.html#versions">Tiff Normal</a><a href="tiff.html#versions">Tiff Lite</a><a href="tiff.html#get">Get Tiff</a></div><div><h4>Business solutions</h4><a href="index.html#business">Tiffbot</a><a href="index.html#business">Orbit AI</a></div><div><h4>Models</h4><a href="models.html#aurelius">Aurelius</a><a href="models.html#llull">Llull</a></div><div><h4>Research</h4><a href="tam.html#ca-aallm">CA-AALLM</a><a href="tam.html#tam">TAM</a><a href="tam.html#communities">Communities</a><a href="tam.html#culture">Culture</a><a href="tam.html#economy">Economy</a><a href="tam.html#sports">Sports</a><a href="tam.html#governance">Governance</a></div><div><h4>Company</h4><a href="about.html">About</a><a href="news.html">News</a><a href="contact.html">Contact</a><a href="#" id="corporate-link">Corporate</a><a href="privacy.html">Privacy</a></div></div><div class="legal muted small">&copy; 2026 Trendify. All rights reserved. &middot; Nairobi, Kenya</div></div></footer>';

  var main = document.querySelector('main');
  if (main) {
    main.insertAdjacentHTML('beforebegin', header);
    main.insertAdjacentHTML('afterend', footer);
  }

  var menuButton = document.querySelector('.menu-btn');
  var nav = document.getElementById('primary-nav');
  if (menuButton && nav) {
    menuButton.addEventListener('click', function () {
      var open = menuButton.getAttribute('aria-expanded') !== 'true';
      menuButton.setAttribute('aria-expanded', open);
      nav.classList.toggle('open', open);
    });
  }

  var dropdown = document.querySelector('.nav-dropdown');
  var dropdownButton = document.querySelector('.dropdown-toggle');
  if (dropdown && dropdownButton) {
    dropdownButton.addEventListener('click', function () {
      var open = dropdownButton.getAttribute('aria-expanded') !== 'true';
      dropdownButton.setAttribute('aria-expanded', open);
      dropdown.classList.toggle('open', open);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        dropdown.classList.remove('open');
        dropdownButton.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (window.fetch && document.getElementById('latest-releases')) {
    window.fetch('assets/updates.json').then(function (response) {
      if (!response.ok) throw new Error('Release data unavailable');
      return response.json();
    }).then(function (posts) {
      posts.forEach(function (p) {
        var card = document.querySelector('[data-release="' + p.title + '"]');
        var link = card && card.querySelector('.release-read-more');
        if (!link || !p.link) return;
        if (p.link.href) link.href = p.link.href;
        link.textContent = p.link.text || 'Read more';
      });
    }).catch(function () {
      // Static release cards already include working links and labels.
    });
  }
})();
