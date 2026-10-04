(function () {
  var header = '<header class="site-header"><div class="wrap nav"><a class="brand" href="index.html" aria-label="Trendify home"><img class="brand-mark" src="assets/tiff-mark.png" alt=""><span class="brand-name">Trendify</span><span class="brand-by">AI Labs</span></a><button class="menu-btn" type="button" aria-expanded="false" aria-controls="primary-nav">Menu</button><nav id="primary-nav" aria-label="Primary navigation"><a href="products.html">Intelligent systems</a><a href="research.html">Research</a><a href="about.html">About</a><a href="contact.html">Contact</a></nav></div></header>';
  var footer = '<footer class="site-footer"><div class="wrap footer-grid"><div><a class="brand" href="index.html"><img class="brand-mark" src="assets/tiff-mark.png" alt=""><span class="brand-name">Trendify</span></a><p>AI research and technology from Kenya.</p></div><div><strong>Company</strong><a href="about.html">About</a><a href="research.html">Research</a><a href="contact.html">Contact</a></div><div><strong>Explore</strong><a href="products.html">Intelligent systems</a></div></div><div class="wrap footer-bottom">© 2026 Trendify.</div></footer>';
  var main = document.querySelector('main');
  if (main) {
    main.insertAdjacentHTML('beforebegin', header);
    main.insertAdjacentHTML('afterend', footer);
  }
  var btn = document.querySelector('.menu-btn');
  var nav = document.getElementById('primary-nav');
  if (btn && nav) btn.addEventListener('click', function () {
    var open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', open);
    nav.classList.toggle('open', open);
  });
})();
