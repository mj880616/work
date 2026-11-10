// STAB-HWP저장버튼초점(S56-2): 편집기 frame은 사람이 frame 안을 누르거나 frame에 초점이 있을 때만 초점을 가져간다.
// 편집기는 시작할 때 빈 문서를 만들고(initDoc) 글자 입력칸에 스스로 초점을 준다(activateWithCaretPosition → textarea.focus()).
// frame 밖(Web2 창)의 [파일 ▾]·[저장 ▾] 등에 있던 키보드 초점이 그때 사람 손 없이 편집기로 넘어가던 것을 막는다.
// 편집기 안을 누르면(사용자 활성) 또는 frame에 이미 초점이 있으면 전과 같이 초점을 준다. 문서를 열고 글자를 쓰는 동작은 그대로다.
// 편집기 iframe 안에서만 돈다(studio-guard.js와 같은 방식으로 빌드 마무리 때 index.html에 넣는다). 다른 동작·통신은 하지 않는다.
(()=>{
  'use strict';
  const focus=HTMLElement.prototype.focus;
  const allowed=()=>document.hasFocus()||navigator.userActivation?.isActive===true;
  Object.defineProperty(HTMLElement.prototype,'focus',{configurable:true,enumerable:false,writable:true,
    value:function(...args){if(allowed())return focus.apply(this,args)}});
})();
