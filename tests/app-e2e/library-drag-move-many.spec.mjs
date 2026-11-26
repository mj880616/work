import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {libraryTopMenu} from './helpers/library-tree.mjs';
import {treeEnter} from './helpers/tree-enter.mjs';
// LIB-끌어옮기기저장실패 · LIB-두칸폴더밖 · LIB-끄는중막대 (S69, 사용자 11/24 16:09·16:12·16:17).
// ① 자료가 1000개를 넘으면 서버가 한 번에 1000줄까지만 준다(가짜 서버도 같게). 전에는 자료실이 한 번만 읽어 잡동사니에 든 자료가 '폴더 밖'으로 보이고,
//    그것을 폴더로 끌면 겹침 거절(409)로 '저장하지 못했어요'. 지금은 끝까지 읽어 개수가 맞고, 여러 개 끌어 옮기기가 된다(드라이브에서 가져온 연결 원본 포함, 드라이브 요청 없음).
// ② 두 칸 보기 각 칸 맨 위 '폴더 밖' 줄(개수) — 폴더 밖 자료는 그 안에서만. ③ 끄는 동안 고르기 막대 = '옮기는 중 N개 · 취소'만, 끝나면 원래대로.
// 이름은 모두 지어낸 것이다.
const FOLDERS=[libFolder('junk',null,{name:'가상 잡동사니',sort_order:1024}),libFolder('fb',null,{name:'가상 받을곳',sort_order:2048})];
const N_JUNK=1100,N_OUT=40;
const DOCS=[
  ...Array.from({length:N_JUNK},(_,i)=>libDoc('j'+i,null,{title:'가상 가져온 자료 '+i,classification_note:'드라이브에서 가져옴 · 파일명 기반 자동분류',file_id:'drv'+i,document_date:'2026-09-01'})),
  ...Array.from({length:N_OUT},(_,i)=>libDoc('o'+i,null,{title:'가상 밖 자료 '+i,classification_note:'드라이브에서 가져옴 · 파일명 기반 자동분류',file_id:'drvo'+i,document_date:'2026-10-0'+(1+i%9)}))
];
const ITEMS=Array.from({length:N_JUNK},(_,i)=>({document_id:'j'+i,folder_id:'junk'}));
const folderOf=(s,doc)=>s.items.find(x=>x.document_id===doc)?.folder_id||null;
const line=page=>page.locator('#libraryFolderStatusLine');
const nav=id=>`#libraryFolderNav [data-lu-nav="${id}"]`;

// 안에서 시작한 끌기를 DragEvent로: dragstart → 한 박자 뒤 막대 읽기 → dragover·drop → dragend → 끝난 뒤 막대 읽기.
async function dragWithBar(page,from,to){
  return page.evaluate(async({from,to})=>{
    const bar=()=>({count:document.querySelector('#librarySelectCount')?.textContent||'',acts:[...document.querySelectorAll('#librarySelectBar button')].map(b=>b.getAttribute('aria-label')||b.textContent.trim()),hidden:document.querySelector('#librarySelectBar')?.hidden});
    const src=document.querySelector(from),dst=document.querySelector(to),dt=new DataTransfer(),r=dst.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,el=document.elementFromPoint(x,y);
    const before=bar();
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    await new Promise(res=>setTimeout(res,50));
    const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});el.dispatchEvent(over);
    await new Promise(res=>setTimeout(res,20));
    const during=bar();
    el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));
    src.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
    return {before,during,allowed:over.defaultPrevented};
  },{from,to});
}

test('PC 1440 한 칸: 자료 1140개 — 폴더 밖 개수가 맞고, 폴더 밖 자료 여럿을 끌어 옮기면 저장 · 끄는 동안 막대는 옮기는 중·취소만',async({page})=>{
  test.setTimeout(120000);
  const fnCalls=[];page.on('request',r=>{if(/\/functions\/v1\/library-files/.test(r.url())&&r.method()==='POST'&&!/"action":"drive-auto"/.test(r.postData()||''))fnCalls.push(r.url())}); // S70-73: 자료실을 열 때 자동 등록 부탁은 뺌
  const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:false}}});
  // 개수: 잡동사니 1100, 폴더 밖 40(전에는 읽기가 1000줄에서 잘려 폴더 밖이 부풀었다).
  await expect(page.locator(`${nav('x:out')} .ft-num`)).toHaveText(String(N_OUT));
  await expect(page.locator(`${nav('junk')} .ft-num`)).toHaveText(String(N_JUNK));
  // 화면이 읽은 뒤에 연결 줄이 하나 생긴 자료(o0 → 잡동사니, 다른 기기에서 넣은 것처럼): 넣기가 겹쳐도 그 자료의 지금 폴더를 읽고 옮긴다.
  s.items.push({workspace_id:'workspace-1',document_id:'o0',folder_id:'junk'});
  await treeEnter(page.locator(nav('x:out')));
  // 가장 최근 자료(o8, 10.09)가 맨 위에 보인다.
  await expect(page.locator('#documentList [data-lu-document="o8"]')).toBeVisible();
  await libraryTopMenu(page,'select');
  await page.locator('#librarySelectAll').click();
  await expect(page.locator('#librarySelectCount')).toContainText(String(N_OUT));
  const r=await dragWithBar(page,'#documentList [data-lu-document="o8"]',nav('fb'));
  // ③ 끄기 전 막대 = 단추들, 끄는 동안 = '옮기는 중 40개' 글만(다른 단추는 화면에 없음), 전체 칩도 없음.
  // UI-고르기막대(S69-85): 바꾸기 셋은 ⋯ 안(막대에 보이지 않게 남음). S70-64b: [✕](선택 끝내기)는 없다 — 끄는 중 그만두기는 Esc·바깥에 놓기.
  expect(r.before.acts).toEqual(expect.arrayContaining(['사업영역 바꾸기','폴더로 옮기기','삭제','전체 선택']));
  expect(r.before.acts).not.toContain('선택 끝내기');
  expect(r.allowed).toBe(true);
  expect(r.during.count).toBe(`옮기는 중 ${N_OUT}개`);
  expect(r.during.acts).toEqual([]);
  // ① 모두 옮겨졌다(겹쳤던 o0 포함), 실패 없음.
  await expect.poll(()=>Array.from({length:N_OUT},(_,i)=>folderOf(s,'o'+i)).every(f=>f==='fb')).toBe(true);
  await expect(line(page)).toContainText(`옮겼어요 ${N_OUT}개 → 가상 받을곳 폴더`);
  await expect(line(page)).not.toContainText('저장하지 못했어요');
  await expect(line(page)).not.toContainText('옮기지 못했어요');
  // 100개씩 한 요청: 40개 옮기기에 연결 표 쓰기 몇 번뿐(하나마다 한 번이 아님).
  expect(s.writes.filter(w=>w.table==='items').length).toBeLessThan(10);
  // 드라이브 파일은 건드리지 않는다(연결 원본 포함) — 자료실 폴더 줄만.
  expect(fnCalls).toEqual([]);
  // 끝나면 막대가 원래대로(선택 모드가 남아 있으면 여섯 단추).
  await expect(page.locator('#librarySelectBar #librarySelectFolder, #librarySelectBar[hidden]').first()).toBeAttached();
  // 되돌리기: 겹쳤던 o0는 잡동사니로, 나머지는 폴더 밖으로.
  await line(page).locator('.lu-undo').click();
  await expect(line(page)).toContainText('되돌렸어요');
  await expect.poll(()=>folderOf(s,'o0')).toBe('junk');
  await expect.poll(()=>folderOf(s,'o1')).toBeNull();
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: 각 칸 맨 위 \'폴더 밖\' 줄(개수) · 폴더 밖 자료는 그 줄을 펼쳐야 · 그 묶음에서 폴더로 끌기',async({page})=>{
  test.setTimeout(120000);
  const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:null}});
  const pane=i=>`#documentList [data-lu-pane-i="${i}"]`,out=i=>`${pane(i)} [data-lu-nav="x:out"]`;
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  for(const i of [0,1]){
    await expect(page.locator(`${pane(i)} [data-lu-prow]`).first()).toHaveAttribute('data-lu-prow','x:out');
    await expect(page.locator(`${out(i)} .ft-num`)).toHaveText(String(N_OUT));
    await expect(page.locator(`${pane(i)} [data-lu-document="o8"]`)).toHaveCount(0);
  }
  await page.locator(out(0)).click();
  await expect(page.locator(`${pane(0)} [data-lu-pane-sub=""] [data-lu-document="o8"]`)).toBeVisible();
  // 오른쪽 칸 '가상 받을곳' 줄(폴더 밖 묶음 아래, 화면 밖일 수 있음)에 놓기 — 끌기 이벤트를 그 줄에 직접.
  await page.evaluate(({from,to})=>{const src=document.querySelector(from),dst=document.querySelector(to),dt=new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    const r=dst.getBoundingClientRect(),o={bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.left+r.width/2,clientY:r.top+r.height/2};
    dst.dispatchEvent(new DragEvent('dragover',o));dst.dispatchEvent(new DragEvent('drop',o));src.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}))},
    {from:`${pane(0)} [data-lu-document="o8"]`,to:`${pane(1)} [data-lu-nav="fb"]`});
  await expect.poll(()=>folderOf(s,'o8')).toBe('fb');
  await expect(line(page)).toContainText('옮겼어요 1개 → 가상 받을곳 폴더');
  await expect(page.locator(`${out(0)} .ft-num`)).toHaveText(String(N_OUT-1));
  expect(errors).toEqual([]);
});
