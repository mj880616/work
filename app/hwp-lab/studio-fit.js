// HWP-화면가득(2026-10-28): 편집기 칸막이 폭이 바뀌면(폰 돌리기·폴드 펼침·접힘) 문서를 다시 쪽 폭에 맞춘다.
// 편집기 iframe 안에서만 돈다(studio-guard.js와 같은 방식으로 빌드 마무리 때 index.html에 넣는다).
// 새 배율 계산을 만들지 않는다: 편집기가 좁은 화면(폭 1024px 미만)에서 문서를 열 때 쪽 폭에 맞추는 규칙을 그대로 따르고,
// 다시 맞출 때는 편집기 [보기] 메뉴의 [쪽 폭 맞춤](view:zoom-fit-width) 항목을 사람이 고른 것과 똑같이 누른다.
// 넓은 화면(PC)에서는 아무 일도 하지 않는다. 높이만 바뀔 때(화면 키보드)는 배율을 건드리지 않는다.
(()=>{
  'use strict';
  const NARROW=1024,SETTLE_MS=150;
  let lastWidth=window.innerWidth,timer=0;
  function refit(){
    timer=0;
    const width=window.innerWidth;
    if(width===lastWidth)return;
    lastWidth=width;
    if(width>=NARROW)return;
    const item=window.document.querySelector('.md-item[data-cmd="view:zoom-fit-width"]');
    // 문서가 열리기 전에는 편집기가 이 항목을 끈다(disabled). 그때는 문서를 열 때 편집기가 스스로 맞춘다.
    if(!item||item.classList.contains('disabled'))return;
    item.click();
  }
  window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(refit,SETTLE_MS)});
})();
