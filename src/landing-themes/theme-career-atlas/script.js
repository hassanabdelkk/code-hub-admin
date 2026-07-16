document.addEventListener('DOMContentLoaded',function(){
  var y=document.getElementById('ca-year');if(y)y.textContent=new Date().getFullYear();
});
document.addEventListener('click',function(e){
  var a=e.target&&e.target.closest?e.target.closest('a[href^="#"]'):null;
  if(!a)return;var h=a.getAttribute('href');
  if(!h||h==='#'||h.indexOf('#bewerbung-form')!==-1)return;
  var el=document.querySelector(h);
  if(el){e.preventDefault();el.scrollIntoView({behavior:'smooth',block:'start'});}
});
