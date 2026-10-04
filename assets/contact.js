(function () {
  var form = document.getElementById('booking-form');
  if (!form) return;

  var dateField = document.getElementById('booking-date');

  function localDateString(date) {
    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    var day = date.getDate();
    month = (month < 10 ? '0' : '') + month;
    day = (day < 10 ? '0' : '') + day;
    return year + '-' + month + '-' + day;
  }

  dateField.min = localDateString(new Date());
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;

    var fields = new FormData(form);
    var body = [
      'Name: ' + fields.get('name'),
      'Email: ' + fields.get('email'),
      'Phone: ' + fields.get('phone'),
      'Preferred date: ' + fields.get('date'),
      'Preferred time: ' + fields.get('time'),
      'Purpose: ' + fields.get('purpose')
    ].join('\r\n');
    var subject = 'Booking request for Tiff';
    var mailto = 'mailto:hello@tiff.co.ke?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);

    window.location.href = mailto;
  });
})();
