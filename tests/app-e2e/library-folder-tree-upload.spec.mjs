import {test,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
// S69-23 LIB-폴더째올리기 (2026-11-24 명진 "자료실에 폴더째로도 업로드 가능하게"): 탐색기 폴더를 끌어 놓거나 [폴더 올리기]로 고르면
// 앱 폴더를 같은 구조로 만들고 파일을 각 폴더에 올린다(같은 library-files 길 + 자료 연결 표 한 줄). 가짜 서버만 쓴다(실제 Supabase·Drive 없음).
const FOLDERS=[libFolder('fw',null,{name:'주간보고',sort_order:1024}),libFolder('fk',null,{name:'교섭',sort_order:2048}),libFolder('fk6',null,{name:'2026',parent_id:'fk',sort_order:0})];
const head=key=>`#documentList details[data-lu-node="${key}"] > summary`;
const dock='#uploadDock:not([hidden])';
// 흉내 폴더 항목(webkitGetAsEntry)을 실은 끌기. tree: [{name, kids:[…]}|{name, text}]. 브라우저가 만든 DataTransfer에는 폴더를 넣을 수 없어
// 항목 읽기만 바꿔 끼운다(놓는 순간에만 읽는 화면 규칙은 그대로). readEntries는 크롬처럼 나눠 준다.
const dropTree=(page,to,tree)=>page.evaluate(({to,tree})=>{
  const mk=n=>n.kids?{isDirectory:true,isFile:false,name:n.name,createReader(){let i=0;return {readEntries(ok){const part=n.kids.slice(i,i+2).map(mk);i+=part.length;setTimeout(()=>ok(part),0)}}}}
    :{isDirectory:false,isFile:true,name:n.name,file(ok){setTimeout(()=>ok(new File([n.text??'PK synthetic'],n.name,{type:'application/octet-stream'})),0)}};
  const dst=document.querySelector(to),dt=new DataTransfer(),map=new Map(),r=dst.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  for(const n of tree){dt.items.add(new File([''],n.name));map.set(n.name,mk(n))}
  const was=DataTransferItem.prototype.webkitGetAsEntry;
  DataTransferItem.prototype.webkitGetAsEntry=function(){return map.get(this.getAsFile()?.name)||null};
  const fire=type=>{const ev=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});dst.dispatchEvent(ev);return ev};
  try{fire('dragenter');fire('dragover');fire('drop')}finally{DataTransferItem.prototype.webkitGetAsEntry=was}
},{to,tree});
const TREE=[{name:'회의록',kids:[{name:'2026',kids:[{name:'상반기',kids:[{name:'a.hwp'},{name:'b.pdf'}]},{name:'c.txt'}]},{name:'d.xlsx'},{name:'.DS_Store'},{name:'e.pdf'}]}];
const folderOf=(s,docId)=>s.items.find(x=>x.document_id===docId)?.folder_id;
const named=(s,name,parent)=>s.folders.find(f=>f.name===name&&(f.parent_id||null)===(parent||null));

test.describe('PC 1440 폴더째 올리기',()=>{
  test('폴더를 주간보고 폴더 줄에 놓으면 하위 2단 구조·파일 5개가 그대로 들어가고 숨김 파일은 건너뛴다',async({page})=>{
    const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,group:'폴더'});
    await dropTree(page,head('f:fw'),TREE);
    await expect(page.locator(`${dock} .up-dock-text`)).toHaveText('회의록에 5개 올렸어요 · 폴더 3개 만들었어요');
    await expect(page.locator(`${dock} .up-dock-note`)).toHaveText('숨김·빈 파일 1개는 건너뛰었어요');
    const top=named(s,'회의록','fw'),y=named(s,'2026',top?.id),h=named(s,'상반기',y?.id);
    expect([!!top,!!y,!!h]).toEqual([true,true,true]);
    expect(s.uploads.length).toBe(5);
    expect(s.uploads.map(u=>folderOf(s,u.id))).toEqual([h.id,h.id,y.id,top.id,top.id]);
    // 폴더는 위 폴더부터 만들고, 안쪽 폴더는 위 폴더의 사업영역(없음)을 그대로 쓴다.
    expect(s.writes.filter(w=>w.table==='folders'&&w.method==='POST').map(w=>[w.body.name,w.body.parent_id])).toEqual([['회의록','fw'],['2026',top.id],['상반기',y.id]]);
    expect(errors).toEqual([]);
  });

  test('같은 이름 폴더가 있으면 한 번 묻고 [합치기]는 있는 폴더 안에, [새로 만들기]는 ‘교섭 (2)’',async({page})=>{
    const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,group:'폴더'});
    const tree=[{name:'교섭',kids:[{name:'2026',kids:[{name:'a.pdf'}]},{name:'새',kids:[{name:'b.pdf'}]}]}];
    // S69-28 LIB-한칸탐색기: PC 한 칸 맨 위는 '폴더 밖' 묶음 머리가 없다 — 목록 빈 곳(맨 위 = 폴더 밖)에 놓는다.
    await dropTree(page,'#documentList',tree);
    const ask=page.locator('.kptu-ask-text');
    await expect(ask).toHaveText('같은 이름 폴더가 이미 있어요 · ‘교섭’');
    await page.locator('[data-ask-action="merge"]').click();
    await expect(page.locator(`${dock} .up-dock-text`)).toHaveText('교섭에 2개 올렸어요 · 폴더 1개 만들었어요');
    expect(folderOf(s,'upload-1')).toBe('fk6');expect(folderOf(s,'upload-2')).toBe(named(s,'새','fk').id);
    await dropTree(page,'#documentList',tree);
    await page.locator('[data-ask-action="new"]').click();
    await expect(page.locator(`${dock} .up-dock-text`)).toHaveText('교섭 (2)에 2개 올렸어요 · 폴더 3개 만들었어요');
    const k2=named(s,'교섭 (2)',null);expect(!!k2).toBe(true);
    expect(folderOf(s,'upload-3')).toBe(named(s,'2026',k2.id).id);
    expect(errors).toEqual([]);
  });

  test('중간에 하나가 실패하면 [다시 업로드]가 못 올린 파일만 같은 폴더로 다시 올린다',async({page})=>{
    const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,group:'폴더',init:{uploadFailures:[null,{status:500,body:{message:'boom'}}]}});
    await dropTree(page,head('f:fw'),TREE);
    await expect(page.locator(`${dock} .up-dock-text`)).toHaveText('회의록에 4개 올렸어요 · 1개 못 올렸어요 · 폴더 3개 만들었어요');
    expect(s.uploads.length).toBe(4);
    await page.locator(`${dock} button`,{hasText:'다시 업로드'}).click();
    await expect(page.locator(`${dock} .up-dock-text`)).toHaveText('회의록에 1개 올렸어요');
    const top=named(s,'회의록','fw'),h=named(s,'상반기',named(s,'2026',top.id).id);
    expect(folderOf(s,'upload-5')).toBe(h.id); // 실패한 b.pdf는 상반기 폴더로
    expect(s.folders.filter(f=>f.name==='회의록').length).toBe(1); // 다시 올려도 폴더를 또 만들지 않는다
    expect(errors).toEqual([]);
  });

  test('⋯ [폴더 업로드]로 고른 폴더도 들어가 있는 폴더 안에 같은 구조로',async({page})=>{
    const root=mkdtempSync(join(tmpdir(),'lu-folder-')),base=join(root,'pack'); // Playwright는 한글 폴더 이름을 넣지 못해(멈춤) 영문 이름으로 고른다
    mkdirSync(join(base,'inner'),{recursive:true});writeFileSync(join(base,'a.pdf'),'PK a');writeFileSync(join(base,'inner','b.pdf'),'PK b');writeFileSync(join(base,'Thumbs.db'),'x');
    const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,group:'폴더'});
    // 탐색기 창은 띄우지 않고(input.click만 막음) 같은 input에 폴더를 넣는다 — 브라우저가 주는 webkitRelativePath 그대로.
    await page.evaluate(()=>{const c=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.id==='libraryFolderInput'){window.__luPicked=true;return}return c.call(this)}});
    await page.locator('#libraryTopMenuBtn').click();
    await page.locator('#luTopMenu [data-lu-top="folder-upload"]').click();
    expect(await page.evaluate(()=>window.__luPicked&&document.querySelector('#libraryFolderInput').webkitdirectory)).toBe(true);
    await page.setInputFiles('#libraryFolderInput',base);
    await expect(page.locator(`${dock} .up-dock-text`)).toHaveText('pack에 2개 올렸어요 · 폴더 2개 만들었어요');
    const top=named(s,'pack',null);expect(!!top).toBe(true);
    expect(s.uploads.map(u=>folderOf(s,u.id)).sort()).toEqual([top.id,named(s,'inner',top.id).id].sort());
    rmSync(root,{recursive:true,force:true});
    expect(errors).toEqual([]);
  });
});

// 두 칸 보기: 오른쪽 칸의 폴더 줄에 놓으면 그 폴더 안에(파일 놓기와 같은 놓을 곳 판정 — library-drop.js paneDropAt·폴더 줄).
test('1440 두 칸 보기 칸 안 폴더 줄에 폴더를 놓으면 그 폴더 안에 같은 구조로',async({page})=>{
  const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,group:'폴더',init:{viewPrefs:null}});
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  await dropTree(page,'#documentList [data-lu-pane-i="1"] [data-lu-nav="fw"]',[{name:'사진묶음',kids:[{name:'안',kids:[{name:'p.pdf'}]},{name:'q.pdf'}]}]);
  await expect(page.locator(`${dock} .up-dock-text`)).toHaveText('사진묶음에 2개 올렸어요 · 폴더 2개 만들었어요');
  const top=named(s,'사진묶음','fw');expect(!!top).toBe(true);
  expect([folderOf(s,'upload-1'),folderOf(s,'upload-2')]).toEqual([named(s,'안',top.id).id,top.id]);
  expect(errors).toEqual([]);
});
