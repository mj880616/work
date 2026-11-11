import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,SB} from './helpers/library-folder-server.mjs';
import {pinch} from './helpers/pinch.mjs';
// S53-19 LIB-화면끌어놓기 이어서: PC·펼친 폴드 자료실은 어느 보기·어느 자리에 PC 파일을 놓아도 올라간다.
// 두 칸 폴더 보기(왼쪽 나무 | 오른쪽 목록): 나무 줄·위치 줄·목록 폴더 줄 위면 그 폴더, 들어간 폴더 안 빈 곳이면 그 폴더, '자료실 전체'·최근 올린 파일 칸 등 그 밖은 폴더 밖.
// 끄는 동안 화면 전체 점선 + 한 줄 안내(놓일 폴더 이름) + 놓일 줄 표시, 올리는 동안 공용 '올리는 중' 줄(막대·%). 가짜 서버만(실제 Supabase·Drive·AI 없음), 이름은 지어낸 것.
const FOLDERS=[libFolder('fa',null,{name:'가상 A',sort_order:1024}),libFolder('fc',null,{name:'가상 C',parent_id:'fa',sort_order:0}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const ITEMS=[{document_id:'n-1',folder_id:'fa'}];
const nav=page=>page.locator('#libraryFolderNav');
const enterNav=async(page,id,width=1440)=>{if(width>=761){await page.locator(`#libraryFolderNav [data-lu-nav="${id}"]`).click({button:'right'});await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click()}else await pinch(page,page.locator(`#libraryFolderNav [data-lu-nav="${id}"]`),'out')}; // UI-폴더누르기한규칙: 나무 줄 누르기 = 펼침만, 들어가기는 PC 우클릭·폰·폴드 두 손가락 벌리기
const tops=page=>page.locator('#documentList > details').evaluateAll(xs=>xs.map(x=>x.dataset.luNode));
// 파일을 실은 DataTransfer로 dragenter → dragover → drop을 그 자리(점 x,y가 있으면 그 점의 맨 위 요소)에 보낸다. 놓기 직전의 안내·표시를 돌려준다.
const dropAt=(page,sel,names,{point=null}={})=>page.evaluate(({sel,names,point})=>{
  const box=document.querySelector(sel),r=box.getBoundingClientRect();
  // 점은 화면 안으로(아래 바 자리 80px 비움).
  const x=point?r.left+point[0]:r.left+r.width/2,y=point?Math.min(r.top+point[1],innerHeight-80):r.top+r.height/2;
  const dst=point?document.elementFromPoint(x,y):box,dt=new DataTransfer();
  for(const name of names)dt.items.add(new File(['PK synthetic'],name,{type:'application/octet-stream'}));
  const fire=type=>{const ev=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});dst.dispatchEvent(ev);return ev};
  fire('dragenter');const over=fire('dragover');
  const overlay=document.querySelector('#libraryDropOverlay');
  const out={allowed:over.defaultPrevented,shown:!!overlay&&!overlay.hidden,hint:overlay?.textContent||'',place:[...document.querySelectorAll('.lu-drop-place')].map(el=>el.querySelector('[data-lu-nav]')?.dataset.luNav??el.dataset.luPath??'?'),
    into:[...document.querySelectorAll('#documentList .lu-drop-into')].map(h=>h.parentElement?.dataset.luNode)};
  fire('drop');
  out.after=!!overlay&&!overlay.hidden||document.querySelectorAll('.lu-drop-place,#documentList .lu-drop-into').length>0;
  return out;
},{sel,names,point});
const inFolder=(s,id)=>s.items.filter(x=>x.folder_id===id).map(x=>x.document_id);

for(const width of [1440,700])test.describe(`자료실 ${width} 끌어놓기`,()=>{test.use({hasTouch:width<761});test(`자료실 ${width}: 두 칸 폴더 보기 — 나무 줄·들어간 폴더 빈 곳·자료실 전체에 놓기`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
  await expect(nav(page)).toBeVisible();
  // 맨 위(들어간 폴더 없음)에서 빈 곳 = 폴더 밖.
  let r=await dropAt(page,'#documentList',['a.pdf']);
  expect(r).toMatchObject({allowed:true,shown:true,hint:'놓으면 바로 올려요',place:[],into:[],after:false});
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('1개 올렸어요');
  expect(s.uploads.length).toBe(1);expect(s.items.length).toBe(ITEMS.length);
  // 왼쪽 나무 줄 위 = 그 폴더(나무 줄에 놓을 곳 표시).
  r=await dropAt(page,'#libraryFolderNav [data-lu-nav="fn"]',['b.pdf','c.pdf']);
  expect(r).toMatchObject({allowed:true,shown:true,hint:'놓으면 ‘가상 N’ 폴더로 올려요',place:['fn'],after:false});
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('가상 N에 2개 올렸어요');
  expect(inFolder(s,'fn')).toEqual(['upload-2','upload-3']);
  // 나무에서 폴더로 들어간 뒤: 오른쪽 목록 빈 곳(목록 상자 아래쪽·자료실 화면 아래 빈 곳) = 그 폴더(들어간 폴더 머리 줄 표시).
  await enterNav(page,'fa',width);
  await expect.poll(()=>tops(page)).toEqual(['f:fa']);
  r=await dropAt(page,'#documentList',['d.pdf']);
  expect(r).toMatchObject({allowed:true,shown:true,hint:'놓으면 ‘가상 A’ 폴더로 올려요',into:['f:fa'],after:false});
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('가상 A에 1개 올렸어요');
  expect(inFolder(s,'fa')).toEqual(['n-1','upload-4']);
  await expect(page.locator('#documentList details[data-lu-node="f:fa"] [data-lu-document="upload-4"]')).toHaveCount(1);
  r=await dropAt(page,'#libraryListCard',['e.pdf'],{point:[width>=1000?600:400,(await page.locator('#libraryListCard').boundingBox()).height-6]});
  expect(r.hint).toBe('놓으면 ‘가상 A’ 폴더로 올려요');
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('가상 A에 1개 올렸어요');
  expect(inFolder(s,'fa')).toEqual(['n-1','upload-4','upload-5']);
  // 들어간 폴더 안의 아래 폴더 줄 = 그 아래 폴더.
  r=await dropAt(page,'#documentList details[data-lu-node="f:fc"] > summary',['f.pdf']);
  expect(r.hint).toBe('놓으면 ‘가상 C’ 폴더로 올려요');expect(r.into).toEqual(['f:fc']);
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('가상 C에 1개 올렸어요');
  expect(inFolder(s,'fc')).toEqual(['upload-6']);
  // 위치 줄 맨 앞 '자료실'과 나무 '자료실 전체' = 폴더 밖(들어가 있어도).
  if(await page.locator('#libraryPath [data-lu-path=""]').count()){
    r=await dropAt(page,'#libraryPath [data-lu-path=""]',['g.pdf']);
    expect(r).toMatchObject({hint:'놓으면 바로 올려요',place:[''],into:[]});
    await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('1개 올렸어요');
  }
  const before=s.items.length,ups=s.uploads.length;
  r=await dropAt(page,'#libraryFolderNav [data-lu-nav=""]',['h.pdf']);
  expect(r).toMatchObject({allowed:true,hint:'놓으면 바로 올려요',place:[''],into:[]});
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('1개 올렸어요');
  expect(s.uploads.length).toBe(ups+1);expect(s.items.length).toBe(before);
  // 최근 올린 파일 칸 위 = 폴더 밖.
  if(await page.locator('#libraryRecent [data-lu-recent]').count()){
    r=await dropAt(page,'#libraryRecent [data-lu-recent]',['i.pdf']);
    expect(r.hint).toBe('놓으면 바로 올려요');
    await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('1개 올렸어요');
    expect(s.items.length).toBe(before);
  }
  // 자료를 폴더로 옮기는 끌기(파일 아님)는 화면 놓기 안내를 띄우지 않는다.
  const moved=await page.evaluate(()=>{const dt=new DataTransfer();dt.setData('text/plain','x');const el=document.querySelector('#documentList');el.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));return !document.querySelector('#libraryDropOverlay').hidden});
  expect(moved).toBe(false);
  expect(errors).toEqual([]);
});});

test('자료실 1440: 올리는 동안 공용 올리는 중 줄(막대·%)이 보이고 끝나면 사라진다',async({page})=>{
  test.setTimeout(60000);
  const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,group:'폴더'});
  let release;const gate=new Promise(res=>{release=res});
  await page.route(`${SB}/functions/v1/library-files`,async route=>{await gate;await route.fallback()});
  await dropAt(page,'#libraryFolderNav [data-lu-nav="fn"]',['big.pdf']);
  const row=page.locator('#libraryUploadRows .up-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.up-name')).toHaveText('big.pdf');
  await expect(row.locator('.up-pc')).toHaveText(/\d+%|마무리 중/);
  // UX-알림하나로(S59-21): 진행은 목록 위 올리는 줄 하나(옛 상태 글줄 없음), 끝은 하단바 위 한 줄 하나.
  await expect(page.locator('#libraryDropStatus')).toHaveCount(0);
  release();
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('가상 N에 1개 올렸어요');
  await expect(row).toHaveCount(0,{timeout:10000});
  expect(inFolder(s,'fn')).toEqual(['upload-1']);
  expect(errors).toEqual([]);
});

// 다른 보기(사업영역·담당조직·분류·월별)도 목록 빈 곳·최근 올린 파일 칸·묶기 줄 어디에 놓아도 올라간다(묶음 머리는 그 값, #2033 묶음으로올리기 그대로).
test('자료실 1440: 사업영역·담당조직·분류·월별 보기도 빈 곳·묶기 줄에 놓으면 올라간다',async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS});
  let n=0;
  for(const group of ['사업영역','담당조직','분류','월별']){
    await page.locator('#libraryGroupBy').selectOption({label:group});
    await expect(nav(page)).toHaveCount(0);
    for(const sel of ['#documentList','#libraryGroupBy','#libraryView']){
      const r=await dropAt(page,sel,[`${group}-${++n}.pdf`]);
      expect(r,`${group} ${sel}`).toMatchObject({allowed:true,shown:true,hint:'놓으면 바로 올려요'});
      await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('1개 올렸어요');
      expect(s.uploads.length).toBe(n);
    }
  }
  expect(s.items.length).toBe(ITEMS.length);
  expect(errors).toEqual([]);
});
