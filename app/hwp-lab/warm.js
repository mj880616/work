// LIB-편집열기느림(S55-15): HWP 편집기 부품 미리 받기. 자료실이 hwp-warm.js로 이 문서를 화면에 안 보이는 칸막이 frame
// (sandbox="allow-scripts", 편집기 frame과 같은 고유 origin 조건)에 띄우면, 편집기가 처음 열 때 받는 이름에 내용 해시가 든 부품
// (화면 JS·CSS·엔진 WASM)을 편집기와 같은 요청 모양(fetch 기본 = CORS, 로그인 정보 없음)으로 받아 브라우저 디스크 캐시에 둔다.
// 운영 Worker가 이 부품을 오래 보관(immutable)으로 답하므로 한 번 받은 기기는 판이 바뀔 때까지 다시 받지 않는다(갱신 구조: 새 판 = 새 이름).
// 받은 바이트는 읽고 버린다(실행·저장 없음). Web2 창에는 끝났다는 글자만 보낸다(내용·주소 없음).
(()=>{
  'use strict';
  const STUDIO='./rhwp-0.8.7/studio/';
  const done=ok=>{try{parent.postMessage({hwpWarm:ok?'done':'failed'},'*')}catch{}};
  // 끝까지 읽고 버린다(큰 WASM을 메모리에 모으지 않음). 끝까지 읽어야 캐시에 온전히 남는다.
  const drain=async url=>{const r=await fetch(url);if(!r.ok)throw new Error('warm '+r.status);const reader=r.body.getReader();for(;;){const {done}=await reader.read();if(done)return}};
  const text=async url=>{const r=await fetch(url);if(!r.ok)throw new Error('warm '+r.status);return r.text()};
  (async()=>{
    // 편집기 첫 화면(번호 없는 파일, 매번 확인)에서 이번 판의 해시 이름을 읽는다. 이름을 여기에 따로 적지 않는다.
    const html=await text(STUDIO+'index.html');
    const parts=[...new Set([...html.matchAll(/\.\/(assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:js|css))/g)].map(m=>m[1]))];
    const main=parts.find(p=>p.endsWith('.js'));
    if(!main)throw new Error('warm: no bundle');
    const js=await text(STUDIO+main);
    const wasm=[...new Set([...js.matchAll(/rhwp_bg-[A-Za-z0-9_-]{8}\.wasm/g)].map(m=>'assets/'+m[0]))];
    if(!wasm.length)throw new Error('warm: no engine');
    for(const p of [...parts.filter(p=>p!==main),...wasm])await drain(STUDIO+p);
    done(true);
  })().catch(()=>done(false));
})();
