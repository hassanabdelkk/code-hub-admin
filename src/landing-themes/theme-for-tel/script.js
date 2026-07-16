(function(){
  var burger=document.getElementById('ft-hamburger');
  var menu=document.getElementById('ft-mobile-nav');
  if(burger && menu){
    burger.addEventListener('click',function(){menu.classList.toggle('is-open');});
    menu.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){menu.classList.remove('is-open');});});
  }
  var y=document.getElementById('ft-year'); if(y) y.textContent=new Date().getFullYear();
})();
