const iconHref='./app-icon.svg?v=20260913';
let favicon=document.querySelector('link[rel="icon"]');
if(!favicon){favicon=document.createElement('link');favicon.rel='icon';document.head.appendChild(favicon)}
favicon.type='image/svg+xml';
favicon.href=iconHref;
let appleIcon=document.querySelector('link[rel="apple-touch-icon"]');
if(!appleIcon){appleIcon=document.createElement('link');appleIcon.rel='apple-touch-icon';document.head.appendChild(appleIcon)}
appleIcon.href=iconHref;
const link=document.createElement('link');
link.rel='manifest';
link.href='./windows-manifest.json?v=2';
document.head.appendChild(link);
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=1',{scope:'./'}).catch(()=>{}));
}
