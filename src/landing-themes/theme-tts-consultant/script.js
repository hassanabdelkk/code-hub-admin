(function(){
  // Year
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  // Mobile nav
  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav-links');
  if (burger && nav) {
    burger.addEventListener('click', function(){ nav.classList.toggle('open'); });
    nav.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(){ nav.classList.remove('open'); });
    });
  }

  // Scrollspy for nav
  var sections = document.querySelectorAll('section[id]');
  var navLinks = document.querySelectorAll('.nav-links a');
  function spy(){
    var pos = window.scrollY + 120;
    sections.forEach(function(s){
      if (pos >= s.offsetTop && pos < s.offsetTop + s.offsetHeight){
        var id = s.id;
        navLinks.forEach(function(l){
          l.classList.toggle('active', l.getAttribute('href') === '#' + id);
        });
      }
    });
  }
  window.addEventListener('scroll', spy, { passive:true });
  spy();

  // Reveal on scroll
  if ('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('[data-animate]').forEach(function(el){ io.observe(el); });
  } else {
    document.querySelectorAll('[data-animate]').forEach(function(el){ el.classList.add('in'); });
  }

  // Smooth scroll for in-page anchors
  document.querySelectorAll('a[href^="#"]').forEach(function(a){
    a.addEventListener('click', function(e){
      var href = a.getAttribute('href');
      if (!href || href === '#') return;
      var t = document.querySelector(href);
      if (t){ e.preventDefault(); window.scrollTo({ top: t.offsetTop - 80, behavior: 'smooth' }); }
    });
  });
})();
