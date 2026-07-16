(function(){
  var ham = document.getElementById('cle-hamburger');
  var nav = document.getElementById('cle-mobile-nav');
  if (ham && nav){
    ham.addEventListener('click', function(){ nav.classList.toggle('is-open'); });
    nav.addEventListener('click', function(e){ if(e.target.tagName==='A') nav.classList.remove('is-open'); });
  }
  var y = document.getElementById('cle-year'); if (y) y.textContent = new Date().getFullYear();
})();
