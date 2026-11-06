(function () {
  // Mobile menu
  var btn = document.querySelector('[data-menu]');
  var nav = document.getElementById('nav');
  if (btn && nav) btn.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // Gentle reveal on scroll
  var els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  } else els.forEach(function (el) { el.classList.add('in'); });

  // "I'm flexible" disables the destination box
  document.querySelectorAll('[data-flex-dest]').forEach(function (cb) {
    var input = document.getElementById(cb.getAttribute('data-flex-dest'));
    function sync() { if (input) { input.disabled = cb.checked; input.placeholder = cb.checked ? 'We will suggest destinations for you' : 'Type a destination or choose one'; } }
    cb.addEventListener('change', sync); sync();
  });

  // Return date can't be before departure
  document.querySelectorAll('input[name=depart_date]').forEach(function (d) {
    var form = d.form; var r = form && form.querySelector('input[name=return_date]');
    var today = new Date().toISOString().slice(0, 10);
    d.min = today; if (r) r.min = today;
    d.addEventListener('change', function () { if (r) { r.min = d.value || today; if (r.value && r.value < d.value) r.value = ''; } });
  });

  // Package comparison
  var bar = document.getElementById('compareBar');
  if (bar) {
    var boxes = document.querySelectorAll('[data-compare]');
    var count = document.getElementById('compareCount');
    var go = document.getElementById('compareGo');
    function update() {
      var ids = [].filter.call(boxes, function (b) { return b.checked; }).map(function (b) { return b.value; });
      if (ids.length > 4) { this.checked = false; ids = ids.slice(0, 4); }
      count.textContent = ids.length;
      bar.classList.toggle('show', ids.length > 0);
      go.href = '/packages/compare?ids=' + ids.join(',');
      go.style.pointerEvents = ids.length > 1 ? 'auto' : 'none';
      go.style.opacity = ids.length > 1 ? '1' : '.5';
    }
    boxes.forEach(function (b) { b.addEventListener('change', update); });
  }
})();
