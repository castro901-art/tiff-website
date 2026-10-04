(function () {
  document.body.classList.add('js-enabled');
  var button = document.querySelector('.menu-btn');
  var navigation = document.getElementById('primary-nav');
  if (!button || !navigation) return;

  function setOpen(open) {
    navigation.classList.toggle('open', open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  }

  button.addEventListener('click', function () {
    setOpen(button.getAttribute('aria-expanded') !== 'true');
  });
  navigation.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () { setOpen(false); });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      button.focus();
    }
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth > 720) setOpen(false);
  });
})();
