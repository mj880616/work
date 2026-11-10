import {test,expect} from '@playwright/test';
import {bootLibrary,libDoc} from './helpers/library-folder-server.mjs';
import {servePagesCors} from './helpers/hwp-editor.mjs';
// LIB-편집열기느림(S55-15): 자료실에 HWP·HWPX 자료가 있으면 한가할 때 HWP 편집기 부품을 화면에 안 보이는 칸막이 frame으로 미리 받는다(이 창에서 한 번).
// HWP가 없으면, 데이터 절약 모드·휴대폰 데이터면 받지 않는다. 시간·바이트 실측은 hwp-editor-warm.spec.mjs. 이름은 지어낸 것.
const HWP=[libDoc('h-1',null,{file_name:'가상-주간보고.hwpx',title:'가상 주간보고'}),libDoc('a-1','top-a')];
const PLAIN=[libDoc('a-1','top-a'),libDoc('a-2','top-a')];
const watch=page=>{const seen=[];page.on('request',r=>{const u=r.url();if(/\/app\/hwp-lab\/(warm\.html|rhwp-[^/]+\/studio\/assets\/rhwp_bg-)/.test(u))seen.push(u.replace(/^.*\/app\/hwp-lab\//,'').replace(/\?.*$/,''))});return seen};
// 받지 않음 확인: 화면 읽기가 끝나고(networkidle) 미리 받기가 기다리는 '한가할 때'가 두 번 지난 뒤에도 요청이 없다.
const settled=async page=>{await page.waitForLoadState('networkidle');for(let i=0;i<2;i++)await page.evaluate(()=>new Promise(r=>requestIdleCallback(()=>r(),{timeout:5000})))};
const connection=(page,value)=>page.addInitScript(v=>{Object.defineProperty(navigator,'connection',{configurable:true,get:()=>v})},value);

for(const width of [1440,390])test(`${width}: HWP 자료가 있으면 편집기 부품을 미리 받고 frame을 지운다, 칸막이(allow-scripts만)`,async({page})=>{
  test.setTimeout(90000);
  await servePagesCors(page);
  const seen=watch(page);
  const sandbox=[];await page.exposeFunction('__warmSandbox',v=>sandbox.push(v));
  await page.addInitScript(()=>new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.tagName==='IFRAME'&&/warm\.html/.test(n.src))window.__warmSandbox(n.getAttribute('sandbox'))}).observe(document,{childList:true,subtree:true}));
  const {errors}=await bootLibrary(page,width,{docs:HWP});
  await expect.poll(()=>seen.includes('warm.html'),{timeout:20000}).toBe(true);
  await expect.poll(()=>seen.some(u=>/rhwp_bg-[A-Za-z0-9_-]{8}\.wasm$/.test(u)),{timeout:30000}).toBe(true);
  expect(sandbox).toEqual(['allow-scripts']);
  await expect(page.locator('iframe[title="HWP 편집 미리 받기"]')).toHaveCount(0,{timeout:60000});
  expect(seen.filter(u=>u==='warm.html')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('1440: HWP 자료가 없으면 미리 받지 않는다',async({page})=>{
  const seen=watch(page);
  const {errors}=await bootLibrary(page,1440,{docs:PLAIN});
  await settled(page);
  expect(seen).toEqual([]);
  expect(errors).toEqual([]);
});

for(const [label,value] of [['데이터 절약 모드',{saveData:true,type:'wifi'}],['휴대폰 데이터',{saveData:false,type:'cellular'}]])
test(`390 ${label}: HWP 자료가 있어도 미리 받지 않는다`,async({page})=>{
  await connection(page,value);
  const seen=watch(page);
  const {errors}=await bootLibrary(page,390,{docs:HWP});
  await settled(page);
  expect(seen).toEqual([]);
  expect(errors).toEqual([]);
});
