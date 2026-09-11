const link=document.createElement('link');
link.rel='manifest';
link.href='./windows-manifest.json?v=1';
document.head.appendChild(link);
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=1',{scope:'./'}).catch(()=>{}));
}
