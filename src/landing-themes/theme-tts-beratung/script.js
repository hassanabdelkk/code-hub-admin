(function(){
  var burger=document.getElementById('tts-hamburger');
  var menu=document.getElementById('tts-mobile-nav');
  if(burger && menu){
    burger.addEventListener('click',function(){menu.classList.toggle('is-open');});
    menu.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){menu.classList.remove('is-open');});});
  }
  var y=document.getElementById('tts-year'); if(y) y.textContent=new Date().getFullYear();
})();
