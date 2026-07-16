/* ===== Eilers Replica — script.js ===== */

(function () {
  'use strict';

  /* ---- Year auto-update ---- */
  const yr = new Date().getFullYear();
  document.querySelectorAll('[data-year], #year').forEach(function (el) {
    el.textContent = yr;
  });

  /* ---- Service tabs ---- */
  const tabs   = document.querySelectorAll('.svc-tab');
  const panels = document.querySelectorAll('.svc-panel');

  function activateTab(idx) {
    tabs.forEach(function (t) {
      const active = parseInt(t.dataset.svc, 10) === idx;
      t.classList.toggle('svc-tab--active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach(function (p) {
      const active = parseInt(p.dataset.panel, 10) === idx;
      p.classList.toggle('svc-panel--active', active);
      if (active) {
        p.removeAttribute('hidden');
      } else {
        p.setAttribute('hidden', '');
      }
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      activateTab(parseInt(tab.dataset.svc, 10));
    });
  });

  /* ---- Mobile hamburger ---- */
  const hamburger = document.getElementById('hamburger');
  const mobileNav = document.getElementById('mobile-nav');

  function closeMobileNav() {
    if (!hamburger || !mobileNav) return;
    hamburger.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    mobileNav.classList.remove('open');
    mobileNav.setAttribute('aria-hidden', 'true');
  }

  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', function () {
      const isOpen = hamburger.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      mobileNav.classList.toggle('open', isOpen);
      mobileNav.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    });

    /* Close nav when any mobile nav link is clicked */
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMobileNav);
    });
  }

  /* ---- Smooth-scroll for in-page anchors ---- */
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      closeMobileNav();
    });
  });

})();
