// Smooth-Scroll für interne Links (ohne Bewerbungs-Modal-Trigger)
document.addEventListener('click', function(e){
  var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
  if (!a) return;
  var href = a.getAttribute('href');
  if (!href || href === '#' || href.indexOf('#bewerbung-form') !== -1) return;
  var el = document.querySelector(href);
  if (el){ e.preventDefault(); el.scrollIntoView({ behavior:'smooth', block:'start' }); }
});
