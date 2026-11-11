import {test,expect} from '@playwright/test';
import {expandLibraryTree} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
// LIB-폴더로올리기 (2026-10-30 명진 요청): PC 파일을 폴더 묶기의 폴더 줄에 놓으면 그 폴더로 올린다(같은 library-files 길 + 자료 연결 표 한 줄).
// 끌고 오면 그 폴더 줄에 옮기기와 같은 놓을 곳 표시, 닫힌 폴더 위에 1초 머물면 열림, 폴더 밖에 놓으면 지금처럼(폴더 밖에 올림).
// 가짜 서버만 쓴다(실제 Supabase·Drive·AI 없음).
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fn',null,{name:'가상 N',sort_order:2048}),libFolder('fw',null,{name:'주간보고',sort_order:4096})];
const ITEMS=[{document_id:'n-1',folder_id:'fa'}];
const head=key=>`#documentList details[data-lu-node="${key}"] > summary`;
// 파일을 실은 DataTransfer로 dragenter → dragover(머무는 시간 ms 뒤 한 번 더) → drop. 놓기 직전의 표시·열림·안내 문구를 돌려준다.
const dropFiles=(page,to,names,{wait=0}={})=>page.evaluate(async({to,names,wait})=>{
  const dst=document.querySelector(to),dt=new DataTransfer(),r=dst.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  for(const name of names)dt.items.add(new File(['PK synthetic'],name,{type:'application/octet-stream'}));
  const fire=type=>{const ev=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});dst.dispatchEvent(ev);return ev};
  fire('dragenter');const over=fire('dragover');
  if(wait){await new Promise(res=>setTimeout(res,wait));fire('dragover')}
  const node=dst.closest('details[data-lu-node]');
  const out={allowed:over.defaultPrevented,into:dst.classList.contains('lu-drop-into'),group:!!node?.classList.contains('lu-drop-group'),open:!!node?.open,hint:document.querySelector('#libraryDropOverlay')?.textContent||''};
  fire('drop');return out;
},{to,names,wait});

test.describe('PC 1440 PC 파일을 폴더에 놓아 올리기',()=>{
  test('파일 2개를 닫힌 주간보고 폴더 줄에 놓으면 표시·머물면 열림 뒤 그 폴더에 들어가고, 폴더 밖에 놓으면 지금처럼',async({page})=>{
    const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await expect(page.locator('#documentList details[data-lu-node="f:fw"]')).not.toHaveAttribute('open','');
    const r=await dropFiles(page,head('f:fw'),['a-주간보고.hwpx','b-주간보고.pdf'],{wait:1300});
    expect(r).toEqual({allowed:true,into:true,group:true,open:true,hint:'놓으면 ‘주간보고’ 폴더로 올려요'});
    await expect(page.locator('#libraryDropStatus')).toHaveText('주간보고에 2개 올렸어요');
    expect(s.uploads.map(u=>u.id)).toEqual(['upload-1','upload-2']);
    expect(s.items.filter(x=>x.folder_id==='fw')).toEqual([{document_id:'upload-1',folder_id:'fw',workspace_id:'workspace-1'},{document_id:'upload-2',folder_id:'fw',workspace_id:'workspace-1'}]);
    await expect(page.locator('#documentList details[data-lu-node="f:fw"] [data-lu-document]')).toHaveCount(2);
    // 놓은 뒤 표시가 남지 않는다.
    await expect(page.locator('#documentList .lu-drop-into,#documentList .lu-drop-group')).toHaveCount(0);
    // '폴더 밖' 머리에 놓으면 지금처럼(폴더 연결 없이 올림, 문구에 폴더 이름 없음).
    const before=s.items.length;
    const out=await dropFiles(page,head('x:out'),['c-보도자료.pdf']);
    expect(out.hint).toBe('놓으면 바로 올려요');expect(out.group).toBe(false);
    await expect(page.locator('#libraryDropStatus')).toHaveText('1개 올렸어요');
    expect(s.uploads.length).toBe(3);expect(s.items.length).toBe(before);
    expect(errors).toEqual([]);
  });

  test('폴더 묶기가 아니면(사업영역) 폴더 줄에 놓아도 지금처럼 화면 끌어놓기',async({page})=>{
    const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,group:'사업영역'});
    await expandLibraryTree(page);
    const r=await dropFiles(page,head('f:fa'),['d.pdf']);
    expect(r.hint).toBe('놓으면 바로 올려요');expect(r.group).toBe(false);
    await expect(page.locator('#libraryDropStatus')).toHaveText('1개 올렸어요');
    expect(s.uploads.length).toBe(1);expect(s.items.length).toBe(ITEMS.length);
    expect(errors).toEqual([]);
  });
});

// S59-9 LIB-펼친폴더안놓기(명진 11/11 14:16): 두 칸 보기에서 PC 파일을 펼친 폴더 안 자료 줄(과 그 묶음 안 빈 틈)에 놓아도 그 폴더로 올린다.
// 자료 옮기기와 같은 판정(library-drop.js paneDropAt): 여러 겹이면 안쪽 폴더, 표시는 그 폴더 줄. 칸 바로 아래 자료 줄은 지금처럼 그 칸의 지금 폴더(맨 위 = 폴더 밖).
const TWO_FOLDERS=[...FOLDERS,libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0})];
const TWO_ITEMS=[...ITEMS,{document_id:'a-1',folder_id:'fc'}];
const pane=i=>`#documentList [data-lu-pane-i="${i}"]`;
const navIn=(i,id)=>`${pane(i)} [data-lu-nav="${id}"]`;
const subDoc=(i,id,doc)=>`${pane(i)} [data-lu-pane-sub="${id}"] [data-lu-document="${doc}"]`;
// 놓을 곳 안 점(기본 가운데)의 실제 맨 위 요소에 파일 끌기 이벤트. rows: 표시를 읽을 폴더 줄(.ft-row class).
const dropFilesAt=(page,to,names,{at=null,rows={}}={})=>page.evaluate(({to,names,at,rows})=>{
  const dst=document.querySelector(to),dt=new DataTransfer(),r=dst.getBoundingClientRect(),x=at?r.left+at.x:r.left+r.width/2,y=at?r.top+at.y:r.top+r.height/2,el=document.elementFromPoint(x,y);
  for(const name of names)dt.items.add(new File(['PK synthetic'],name,{type:'application/octet-stream'}));
  const fire=type=>{const ev=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});el.dispatchEvent(ev);return ev};
  fire('dragenter');const over=fire('dragover');
  const marks=Object.fromEntries(Object.entries(rows).map(([k,sel])=>[k,document.querySelector(sel)?.closest('.ft-row')?.className||'']));
  const out={allowed:over.defaultPrevented,marks,paneCls:dst.closest('[data-lu-pane-i]')?.className||'',hint:document.querySelector('#libraryDropOverlay')?.textContent||''};
  fire('drop');return out;
},{to,names,at,rows});

for(const width of [1440,884])test.describe(`${width} 두 칸 PC 파일을 펼친 폴더 안에 놓아 올리기`,()=>{
  test('펼친 폴더 안 자료 줄·빈 틈 = 그 폴더(여러 겹은 안쪽), 칸 바로 아래 자료 줄 = 그 칸의 지금 폴더',async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:TWO_FOLDERS,items:TWO_ITEMS,group:'폴더',init:{viewPrefs:null}});
    await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
    await page.locator(navIn(1,'fa')).click();
    await expect(page.locator(subDoc(1,'fa','n-1'))).toBeVisible();
    // 오른쪽 칸 펼친 가상 A 안 자료 줄 → 가상 A. 표시는 가상 A 줄(칸 상자 아님).
    let r=await dropFilesAt(page,subDoc(1,'fa','n-1'),['a-회의자료.pdf'],{rows:{fa:navIn(1,'fa')}});
    expect(r).toMatchObject({allowed:true,hint:'놓으면 ‘가상 A’ 폴더로 올려요'});
    expect(r.marks.fa).toContain('lu-drop-place');expect(r.paneCls).not.toMatch(/lu-drop-/);
    await expect(page.locator('#libraryDropStatus')).toHaveText('가상 A에 1개 올렸어요');
    expect(s.items.filter(x=>x.folder_id==='fa').map(x=>x.document_id)).toEqual(['n-1','upload-1']);
    await expect(page.locator('#documentList .lu-drop-place,#documentList .lu-drop-into')).toHaveCount(0);
    // 여러 겹: 안쪽 가상 C도 펼치면 그 안 자료 줄 = 가상 C(바깥 가상 A 아님).
    await page.locator(navIn(1,'fc')).click();
    await expect(page.locator(subDoc(1,'fc','a-1'))).toBeVisible();
    r=await dropFilesAt(page,subDoc(1,'fc','a-1'),['b-사진.jpg','c-표.xlsx'],{rows:{fa:navIn(1,'fa'),fc:navIn(1,'fc')}});
    expect(r.hint).toBe('놓으면 ‘가상 C’ 폴더로 올려요');expect(r.marks.fc).toContain('lu-drop-place');expect(r.marks.fa).not.toMatch(/lu-drop-/);
    await expect(page.locator('#libraryDropStatus')).toHaveText('가상 C에 2개 올렸어요');
    expect(s.items.filter(x=>x.folder_id==='fc').map(x=>x.document_id)).toEqual(['a-1','upload-2','upload-3']);
    // 가상 A 묶음 안 빈 틈(줄 왼쪽 들여쓰기 칸) → 가상 A.
    r=await dropFilesAt(page,`${pane(1)} [data-lu-pane-sub="fa"]`,['d-메모.txt'],{at:{x:4,y:10}});
    expect(r.hint).toBe('놓으면 ‘가상 A’ 폴더로 올려요');
    await expect(page.locator('#libraryDropStatus')).toHaveText('가상 A에 1개 올렸어요');
    expect(s.items.find(x=>x.document_id==='upload-4')?.folder_id).toBe('fa');
    // 칸 바로 아래(펼친 폴더 밖) 자료 줄은 지금처럼 그 칸의 지금 폴더 — 맨 위라 폴더 밖, 표시는 칸 상자.
    const before=s.items.length;
    r=await dropFilesAt(page,`${pane(1)} [data-lu-document="a-2"]`,['e-보도자료.pdf']);
    expect(r.hint).toBe('놓으면 바로 올려요');expect(r.paneCls).toContain('lu-drop-place');
    await expect(page.locator('#libraryDropStatus')).toHaveText('1개 올렸어요');
    expect(s.uploads.length).toBe(5);expect(s.items.length).toBe(before);
    expect(errors).toEqual([]);
  });
});
