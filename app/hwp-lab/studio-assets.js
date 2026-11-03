// LIB-편집열기느림: 편집기 frame이 큰 엔진 파일(assets/*.wasm)을 Web2 창에게 받아 쓰게 한다.
// 편집기는 sandbox="allow-scripts" iframe(고유 origin "null")이라 브라우저가 그 안의 내려받기를 HTTP 캐시에 남기지 않는다
// (opaque origin의 요청은 매번 일회용 캐시 칸을 쓴다). 그래서 편집기를 열 때마다 엔진 파일 십수 MB를 새로 받았다.
// 이 스크립트는 편집기 번들보다 먼저 돌며 fetch를 감싸, 같은 폴더의 assets/*.wasm 요청만 Web2 창에 물어본다.
// Web2 창(hwp-frame.js)은 정해진 이름 모양의 공개 편집기 파일만 자기 캐시로 받아 바이트로 넘긴다. 로그인 정보·문서는 오가지 않는다.
// 창이 답하지 않거나 실패하면 원래 fetch로 받는다(지금과 같은 동작).
(()=>{
  'use strict';
  if(window.parent===window||typeof MessageChannel!=='function')return;
  const ASSET=/^assets\/[A-Za-z0-9_-]+\.wasm$/;
  const base=new URL('./',location.href).href;
  const realFetch=window.fetch.bind(window);
  const waiting=new Map();
  let portFlight=null,seq=0;
  function bridge(){
    if(portFlight)return portFlight;
    portFlight=new Promise(resolve=>{
      const channel=new MessageChannel();
      const timer=setTimeout(()=>resolve(null),3000);
      channel.port1.onmessage=event=>{
        const message=event.data;
        if(message?.type==='ready'){clearTimeout(timer);resolve(channel.port1);return}
        const wait=waiting.get(message?.id);
        if(!wait)return;
        waiting.delete(message.id);
        if(message.ok&&message.bytes instanceof ArrayBuffer)wait.resolve(message.bytes);else wait.reject(new Error('asset'));
      };
      // 보내는 것은 통로(port)뿐이다. 받는 쪽 Web2 창은 이 frame에서 온 첫 통로만 받는다.
      window.parent.postMessage({type:'kptu-hwp-assets'},'*',[channel.port2]);
    });
    return portFlight;
  }
  function ask(port,path){
    return new Promise((resolve,reject)=>{
      const id=++seq;
      waiting.set(id,{resolve,reject});
      port.postMessage({id,path});
    });
  }
  function assetPath(input,init){
    try{
      const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
      if(method!=='GET')return null;
      const url=new URL(input instanceof Request?input.url:String(input),location.href);
      if(url.search||url.hash||!url.href.startsWith(base))return null;
      const path=url.href.slice(base.length);
      return ASSET.test(path)?path:null;
    }catch{return null}
  }
  window.fetch=function(input,init){
    const path=assetPath(input,init);
    if(!path)return realFetch(input,init);
    return bridge()
      .then(port=>port?ask(port,path):Promise.reject(new Error('no bridge')))
      .then(bytes=>new Response(bytes,{status:200,headers:{'content-type':'application/wasm'}}))
      .catch(()=>realFetch(input,init));
  };
})();
