(function () {
  'use strict';

  var API_BASE = 'https://tiffbot-waitlist.trendifytiff.workers.dev';

  function setStatus(element, message, state) {
    element.textContent = message;
    element.setAttribute('data-state', state || '');
  }

  function submitForm(form, button, status, path, payload, fallback) {
    button.disabled = true;
    var originalLabel = button.textContent;
    button.textContent = 'Please wait…';
    setStatus(status, '', '');

    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.message || fallback);
        return body;
      });
    }).then(function (body) {
      var state = body.status === 'not_recognised' || body.status === 'used_up' ? 'error' : 'success';
      setStatus(status, body.message || fallback, state);
      if (form.id === 'waitlist-form' && body.status === 'joined') form.reset();
    }).catch(function (error) {
      setStatus(status, error.message || fallback, 'error');
    }).finally(function () {
      button.disabled = false;
      button.textContent = originalLabel;
    });
  }

  var waitlistForm = document.getElementById('waitlist-form');
  if (waitlistForm) {
    waitlistForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var email = document.getElementById('waitlist-email');
      var website = document.getElementById('company-website');
      var status = document.getElementById('waitlist-status');
      var button = waitlistForm.querySelector('button[type="submit"]');
      if (!email.value.trim() || !email.validity.valid) {
        email.focus();
        setStatus(status, 'Enter a valid email address to join the waitlist.', 'error');
        return;
      }
      submitForm(waitlistForm, button, status, '/api/waitlist', {
        email: email.value.trim(),
        website: website.value
      }, 'We could not save your signup just now. Please try again later.');
    });
  }

  var inviteForm = document.getElementById('invite-form');
  if (inviteForm) {
    inviteForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var code = document.getElementById('invite-code');
      var status = document.getElementById('invite-status');
      var button = inviteForm.querySelector('button[type="submit"]');
      if (!code.value.trim()) {
        code.focus();
        setStatus(status, 'Enter an invitation code to check it.', 'error');
        return;
      }
      submitForm(inviteForm, button, status, '/api/invite', { code: code.value.trim() }, 'We could not check that invitation code. Please try again.');
    });
  }
})();
