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
