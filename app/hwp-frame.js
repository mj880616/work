// HWP-편집기 2단계 칸막이: rhwp 편집기를 sandbox="allow-scripts" iframe에서 연다(allow-same-origin 없음).
// 편집기 문서는 고유 origin("null")이 되어 Web2 창(parent·top), 로그인 정보·저장소·쿠키에 닿지 못하고,
// 편집기 HTML의 CSP가 외부·Supabase 주소 호출을 막는다. 파일은 연결 때 넘긴 MessagePort로만 주고받는다.
// 편집기 파일은 다른 origin에서 읽는 셈이라 응답에 Access-Control-Allow-Origin이 있어야 한다(GitHub Pages는 *).
// 버전은 scripts/hwp-lab/rhwp-pin.json과 같아야 한다(tests/hwp-lab-pin.test.mjs).
import {EditorTransport} from './hwp-lab/rhwp-0.8.7/sdk/transport.js';
import {RhwpEditor} from './hwp-lab/rhwp-0.8.7/sdk/index.js';

export const RHWP='./hwp-lab/rhwp-0.8.7/';

// The SDK addresses the frame by its URL origin. A sandboxed frame has an opaque origin, so the one-time connect
// message (no document data, only the private port) uses '*'; everything after it goes through that port.
// Without the port handshake the SDK would fall back to window messages it cannot verify: refuse instead.
class SandboxTransport extends EditorTransport{
  constructor(iframe,url,options){super(iframe,url,options);this._targetOrigin='*'}
  _useLegacy(){this._rejectConnect(new Error('편집기 연결을 확인하지 못했습니다.'))}
}

// LIB-편집열기느림: 고유 origin frame의 내려받기는 브라우저 HTTP 캐시에 남지 않아 편집기를 열 때마다 엔진 파일(WASM 약 19MB)을
// 새로 받았다. frame 안 studio-assets.js가 통로를 하나 보내면, 이 창이 정해진 모양의 공개 엔진 파일만 자기 캐시로 받아 바이트로 넘긴다.
// 통로는 이 iframe이 보낸 첫 것만 받는다. 이름 모양이 다르거나 받기에 실패하면 거절하고, frame은 원래대로 직접 받는다.
const ASSET=/^assets\/[A-Za-z0-9_-]+\.wasm$/;
export function serveEditorAssets(iframe){
  const onMessage=event=>{
    if(event.source!==iframe.contentWindow||event.data?.type!=='kptu-hwp-assets'||!event.ports?.[0])return;
    window.removeEventListener('message',onMessage);
    const port=event.ports[0];
    port.onmessage=async({data})=>{
      const id=data?.id,path=data?.path;
      if(!Number.isSafeInteger(id))return;
      if(typeof path!=='string'||!ASSET.test(path)){port.postMessage({id,ok:false});return}
      try{
        const response=await fetch(new URL(RHWP+'studio/'+path,import.meta.url),{credentials:'omit'});
        if(!response.ok)throw new Error(String(response.status));
        const bytes=await response.arrayBuffer();
        port.postMessage({id,ok:true,bytes},[bytes]);
      }catch{port.postMessage({id,ok:false})}
    };
    port.postMessage({type:'ready'});
  };
  window.addEventListener('message',onMessage);
  return ()=>window.removeEventListener('message',onMessage);
}

export async function createSandboxedEditor(host,{loadTimeoutMs=60000,handshakeTimeoutMs=10000}={}){
  const studioUrl=new URL(RHWP+'studio/index.html',import.meta.url).href;
  const iframe=document.createElement('iframe');
  iframe.setAttribute('sandbox','allow-scripts');
  iframe.setAttribute('referrerpolicy','no-referrer');
  iframe.title='HWP 편집기';
  iframe.style.cssText='width:100%;height:100%;border:none';
  iframe.src=studioUrl;
  const stopAssets=serveEditorAssets(iframe);
  host.appendChild(iframe);
  let transport;
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('편집기를 불러오지 못했습니다.')),loadTimeoutMs);
      iframe.addEventListener('load',()=>{clearTimeout(timer);resolve()},{once:true});
    });
    transport=new SandboxTransport(iframe,studioUrl,{handshakeTimeoutMs});
    await transport.connect();
    const editor=new RhwpEditor(iframe,transport);
    await editor._waitReady();
    return editor;
  }catch(err){
    stopAssets();
    transport?.destroy();
    iframe.remove();
    throw err;
  }
}
