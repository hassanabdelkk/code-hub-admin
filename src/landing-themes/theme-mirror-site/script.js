(function () {
  'use strict';

  /* ── Year auto-update ── */
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  /* ── Mobile hamburger nav ── */
  var toggle = document.getElementById('menuToggle');
  var nav    = document.getElementById('mobileNav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', open ? 'false' : 'true');
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      toggle.setAttribute('aria-label', open ? 'Menü öffnen' : 'Menü schließen');
    });
    /* Close when a nav link is clicked */
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.setAttribute('data-open', 'false');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Menü öffnen');
      });
    });
  }

  /* ── Sticky header shadow on scroll ── */
  var header = document.querySelector('.bpo-header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.style.boxShadow = window.scrollY > 10
        ? '0 4px 20px rgba(0,0,0,0.10)'
        : '0 2px 14px rgba(0,0,0,0.07)';
    }, { passive: true });
  }
})();
