function openShortcut(anchor){
  if(!anchor)return;
  try{
    const u=new URL(anchor.getAttribute('href')||'',location.href);
    u.searchParams.set('external','1');
    anchor.href=u.href;
  }catch{}
  if(/KPTUAndroid/i.test(navigator.userAgent))location.href=anchor.href;
}
function install(){
  document.addEventListener('click',e=>{
    const a=e.target.closest?.('[data-page-shortcut="1"],#pageList .page-card .card-actions a.mini[href*="../p/?slug="]');
    if(!a)return;
    try{const u=new URL(a.getAttribute('href')||'',location.href);u.searchParams.set('external','1');a.href=u.href}catch{}
    if(!/KPTUAndroid/i.test(navigator.userAgent))return;
    e.preventDefault();openShortcut(a);
  },false);
}
install();
window.__KPTU_PAGE_SHORTCUT_READY__=Promise.resolve(true);
