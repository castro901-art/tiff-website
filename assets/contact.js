(function () {
  var form = document.getElementById('demo-booking-form');
  if (!form) return;

  var dateField = document.getElementById('booking-date');
  var status = document.getElementById('demo-confirmation');
  var submit = document.getElementById('booking-submit');

  function localDateString(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  dateField.min = localDateString(new Date());
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    status.textContent = 'Demo complete. No booking was made. Your request was not sent or stored. In a live version, Trendify would follow up by email or phone.';
    status.hidden = false;
    form.reset();
    dateField.min = localDateString(new Date());
    status.focus();
  });
  submit.disabled = false;
})();
