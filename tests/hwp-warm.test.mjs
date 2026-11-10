// LIB-편집열기느림(S55-15): HWP 편집기 부품 미리 받기. ① 받을지 판정(데이터 절약·휴대폰 데이터는 안 함)
// ② 칸막이 문서(app/hwp-lab/warm.js)가 지금 들어 있는 편집기 판의 해시 이름 부품을 모두 찾아 받고, 그 부품이 운영 Worker에서 오래 보관 대상인지.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import {hwpWarmAllowed} from '../app/hwp-warm.js';
import {editorHashedAsset} from '../cloudflare/bokdoong-router.mjs';

test('hwpWarmAllowed: 데이터 절약·셀룰러면 받지 않고, 그 밖(와이파이·정보 없음)은 받는다',()=>{
  assert.equal(hwpWarmAllowed({connection:{saveData:true,type:'wifi'}}),false);
  assert.equal(hwpWarmAllowed({connection:{type:'cellular'}}),false);
  assert.equal(hwpWarmAllowed({connection:{type:'wifi'}}),true);
  assert.equal(hwpWarmAllowed({}),true);
  assert.equal(hwpWarmAllowed(undefined),true);
});

test('warm.js: 편집기 첫 화면에서 이번 판 부품 이름을 읽어 해시 이름 JS 외 CSS·엔진 WASM을 받고 done을 알린다(내용은 보내지 않음)',async()=>{
  const base=new URL('../app/hwp-lab/',import.meta.url);
  const fetched=[],messages=[];
  const fetch=async url=>{
    const file=new URL(url,base);fetched.push(file.pathname.replace(/^.*\/app\/hwp-lab\//,''));
    if(!existsSync(file))return {ok:false,status:404};
    const bytes=readFileSync(file);
    return {ok:true,status:200,text:async()=>bytes.toString('utf8'),body:{getReader:()=>{let sent=false;return {read:async()=>sent?{done:true}:(sent=true,{done:false,value:bytes})}}}};
  };
  const parent={postMessage:(data,target)=>messages.push({data,target})};
  vm.runInNewContext(readFileSync(new URL('warm.js',base),'utf8'),{fetch,parent});
  for(let i=0;i<50&&!messages.length;i++)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(JSON.parse(JSON.stringify(messages)),[{data:{hwpWarm:'done'},target:'*'}]);
  const studio=fetched.filter(p=>p.includes('/studio/assets/'));
  assert.ok(studio.some(p=>/rhwp_bg-[A-Za-z0-9_-]{8}\.wasm$/.test(p)),'엔진 WASM');
  assert.ok(studio.some(p=>/\.css$/.test(p)),'화면 CSS');
  assert.ok(studio.some(p=>/index-[A-Za-z0-9_-]{8}\.js$/.test(p)),'화면 JS');
  // 받은 해시 이름 부품은 모두 운영 Worker가 오래 보관(immutable)으로 답하는 이름이다(그래야 한 번 받은 기기가 다시 받지 않는다).
  for(const p of studio)assert.ok(editorHashedAsset('bokdoong.com',new URL('https://bokdoong.com/work/app/hwp-lab/'+p)),p);
});

test('warm.html: 편집기와 같은 칸막이 조건의 CSP(외부 주소 막음)와 warm.js만 싣는다',()=>{
  const html=readFileSync(new URL('../app/hwp-lab/warm.html',import.meta.url),'utf8');
  assert.match(html,/default-src 'none'; script-src 'self'; connect-src 'self'/);
  assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>m[1]),['./warm.js']);
  const js=readFileSync(new URL('../app/hwp-warm.js',import.meta.url),'utf8');
  assert.match(js,/setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.doesNotMatch(js,/allow-same-origin/);
});
