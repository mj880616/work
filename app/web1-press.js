(()=>{
'use strict';
if(window.KPTUWeb1Press)return;
const frame=document.getElementById('web1PressArchiveFrame');
function ready(){
  document.getElementById('mediaView')?.setAttribute('data-press-ready','1');
  return true;
}
window.KPTUWeb1Press={load:async()=>ready(),render:ready};
window.__KPTU_WEB1_PRESS_READY__=Promise.resolve(ready());
})();