import {test,expect} from '@playwright/test';
import {expandLibraryTree} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
// LIB-폴더끌어순서(S61-14): 자료실 폴더를 끌어 위치·순서 바꾸기. 폴더 줄 위쪽 끝 = 그 앞, 아래쪽 끝 = 그 뒤(가는 선), 가운데 = 안으로.
// 같은 단·다른 단 모두(다른 단이면 그 단으로 옮기며 그 자리에). '… · 되돌리기'와 Ctrl+Z. 한 칸 목록 머리·왼쪽 나무 줄 같음. 키보드는 Alt+↑·Alt+↓.
// 판정은 노트 나무와 같은 공용 규칙(folder-look-model.mjs dropZone·folderDropPlan). 이름은 지어낸 것.
const FOLDERS=[
  libFolder('pub',null,{name:'가상 공공팀',sort_order:1024}),
  libFolder('pol',null,{name:'가상 정책 자료',sort_order:2048}),
  libFolder('sub','child-a1',{name:'가상 하위',parent_id:'pol',sort_order:1024}),
  libFolder('box',null,{name:'가상 잡동사니',sort_order:3072})
];
const head=key=>`#documentList details[data-lu-node="${key}"] > summary`;
const navRow=id=>`#libraryFolderNav [data-lu-nav="${id}"]`;
const line=page=>page.locator('#libraryFolderStatusLine');
const topOrder=s=>s.folders.filter(f=>!f.parent_id).sort((a,b)=>a.sort_order-b.sort_order).map(f=>f.id);
// from 줄을 끌어 to 줄의 위 끝·가운데·아래 끝에 놓는다. rect = 자리를 재는 줄(나무는 .ft-row).
async function dragTo(page,from,to,{edge='middle',rect=null}={}){
  await page.evaluate(({from,to,edge,rect})=>{
    const src=document.querySelector(from),dst=document.querySelector(to),box=(rect?dst.closest(rect):dst)||dst,dt=new DataTransfer(),r=box.getBoundingClientRect();
    const y=edge==='top'?r.top+2:edge==='bottom'?r.bottom-2:r.top+r.height/2,x=r.left+Math.min(r.width/2,60);
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});dst.dispatchEvent(over);
    window.__luDrop={allowed:over.defaultPrevented,cls:box.className};
    dst.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));
    src.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
  },{from,to,edge,rect});
  return page.evaluate(()=>window.__luDrop);
}

test.describe('PC 1280 자료실 폴더 끌어 순서',()=>{
  test('위 끝 = 맨 앞(같은 단), 아래 끝 = 다른 단에서 그 뒤로, 가운데 = 안으로, 되돌리기·Ctrl+Z',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,group:'폴더'});
    await expandLibraryTree(page);
    // 잡동사니를 공공팀 위쪽 끝에: 가는 선(lu-drop-before) + 맨 위로. 옮긴 줄 하나만 저장한다.
    const n0=s.writes.length;
    let r=await dragTo(page,head('f:box'),head('f:pub'),{edge:'top'});expect(r.allowed).toBe(true);expect(r.cls).toContain('lu-drop-before');
    await expect.poll(()=>topOrder(s)).toEqual(['box','pub','pol']);
    expect(s.writes.slice(n0).map(w=>[w.method,w.id,w.body])).toEqual([['PATCH','box',{sort_order:0}]]);
    await expect(line(page)).toContainText('순서를 바꿨어요');
    // 줄의 [되돌리기]
    await line(page).locator('.lu-undo').click();await expect(line(page)).toContainText('되돌렸어요');
    await expect.poll(()=>topOrder(s)).toEqual(['pub','pol','box']);
    // 다른 단: 정책 자료 안의 '하위'를 공공팀 아래쪽 끝에 → 맨 위 단으로 옮기며 공공팀 바로 뒤.
    await expandLibraryTree(page);
    r=await dragTo(page,head('f:sub'),head('f:pub'),{edge:'bottom'});expect(r.allowed).toBe(true);expect(r.cls).toContain('lu-drop-after');
    await expect.poll(()=>s.folders.find(f=>f.id==='sub').parent_id).toBeNull();
    await expect.poll(()=>topOrder(s)).toEqual(['pub','sub','pol','box']);
    await expect(line(page)).toContainText('폴더를 옮겼어요 → 맨 위');
    // Ctrl+Z = 같은 되돌리기(이전 상위·순서로).
    await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('Control+z');
    await expect.poll(()=>s.folders.find(f=>f.id==='sub').parent_id).toBe('pol');
    await expect.poll(()=>s.folders.find(f=>f.id==='sub').sort_order).toBe(1024);
    // 가운데 = 그 안으로(지금 그대로).
    await expandLibraryTree(page);
    r=await dragTo(page,head('f:box'),head('f:pol'));expect(r.allowed).toBe(true);expect(r.cls).toContain('lu-drop-into');
    await expect.poll(()=>s.folders.find(f=>f.id==='box').parent_id).toBe('pol');
    await expect(line(page)).toContainText('폴더를 옮겼어요');
    // 자기 아래 폴더 줄의 끝에는 놓을 수 없다(정책 자료를 자기 안 '하위' 앞으로).
    await expandLibraryTree(page);
    const n1=s.writes.length;r=await dragTo(page,head('f:pol'),head('f:sub'),{edge:'top'});expect(r.allowed).toBe(false);expect(r.cls).toContain('lu-drop-no');expect(s.writes.length).toBe(n1);
    expect(errors).toEqual([]);
  });

  test('왼쪽 나무 줄도 위·아래 끝 = 앞·뒤(가는 선), 키보드 Alt+↑·Alt+↓, 메뉴에는 위로·아래로가 없다',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,group:'폴더'});
    await expect(page.locator(navRow('box'))).toBeVisible();
    let r=await dragTo(page,navRow('box'),navRow('pub'),{edge:'top',rect:'.ft-row'});expect(r.allowed).toBe(true);expect(r.cls).toContain('lu-drop-before');
    await expect.poll(()=>topOrder(s)).toEqual(['box','pub','pol']);
    await expect(line(page)).toContainText('순서를 바꿨어요');
    // 가운데는 안으로(나무 줄).
    r=await dragTo(page,navRow('pub'),navRow('pol'),{rect:'.ft-row'});expect(r.allowed).toBe(true);expect(r.cls).toContain('lu-drop-into');
    await expect.poll(()=>s.folders.find(f=>f.id==='pub').parent_id).toBe('pol');
    await expect(line(page)).toContainText('폴더를 옮겼어요');
    // 키보드: 나무 줄 초점 + Alt+↓ = 한 칸 아래, 초점은 그 줄에 남는다.
    await expect.poll(()=>topOrder(s)).toEqual(['box','pol']);
    await page.locator(navRow('box')).focus();await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(()=>topOrder(s)).toEqual(['pol','box']);
    // 끝 신호 = 상태 줄 글(저장 → 다시 읽기 → 초점 되돌림까지 끝난 뒤).
    await expect(line(page)).toContainText('순서를 바꿨어요');await expect(page.locator(navRow('box'))).toBeFocused();
    await page.keyboard.press('Alt+ArrowUp');await expect.poll(()=>topOrder(s)).toEqual(['box','pol']);
    // 폴더 ⋯ 메뉴에 [위로]·[아래로]가 없다.
    await expandLibraryTree(page);
    await page.locator(`${head('f:pol')} [data-lu-node-menu]`).click();await expect(page.locator('#luFolderMenu')).toBeVisible();
    await expect(page.locator('#luFolderMenu [data-lu-folder-action="up"],#luFolderMenu [data-lu-folder-action="down"]')).toHaveCount(0);
    await expect(page.locator('#luFolderMenu').getByRole('button',{name:'옮기기…'})).toBeVisible();
    expect(errors).toEqual([]);
  });
});
