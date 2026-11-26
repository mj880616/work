import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {treeEnter} from './helpers/tree-enter.mjs';
// S69-28 LIB-한칸탐색기 · LIB-보기두칸 · 깨짐 고치기(사용자 11/24): 자료실 폴더 묶기 한 칸 = 윈도우 탐색기처럼 왼쪽 폴더 나무 | 오른쪽 그 폴더 내용.
// ① 나무를 길게 펼치면 흰 카드가 같이 늘어나고(나무 칸 안 스크롤 없음) 접으면 다시 줄어든다.
// ② 왼쪽 폴더 → 오른쪽은 그 폴더 바로 안의 하위 폴더 줄 + 자료 줄만(나무를 다시 그리지 않음, 지금 폴더 제목 줄 없음).
// ③ (S69-68, 사용자 11/24 20:09) 오른쪽 하위 폴더 누르기 = 그 자리 펼치기·접기(왼쪽 나무 그대로). 들어가기는 왼쪽 나무 — 들어가면 나무가 따라 펼침·강조. [‹] = 위 폴더.
// ④ [한 칸 | 두 칸] 붙은 단추(눌린 표시·서버 기억). ⑤ 폰: 폴더 이름 누르기 = 내용 화면, 뒤로가기 = 나무. ⑥ 왼쪽 나무 폴더에 자료 끌어 놓기.
// 이름은 모두 지어낸 것이다.
const TOPS=5,KIDS=9;
const FOLDERS=[];
for(let i=0;i<TOPS;i++){FOLDERS.push(libFolder('t'+i,null,{name:'가상 묶음 '+i,sort_order:1024*(i+1)}));for(let j=0;j<KIDS;j++)FOLDERS.push(libFolder(`c${i}_${j}`,null,{name:`가상 칸 ${i}-${j}`,parent_id:'t'+i,sort_order:j}))}
FOLDERS.push(libFolder('g1',null,{name:'가상 손주',parent_id:'c1_2',sort_order:0}));
const DOCS=[libDoc('d1',null),libDoc('d2',null),libDoc('d3',null),libDoc('d4',null)];
const ITEMS=[{document_id:'d1',folder_id:'c1_2'},{document_id:'d2',folder_id:'c1_2'},{document_id:'d4',folder_id:'t1'}];
const nav=id=>`#libraryFolderNav [data-lu-nav="${id}"]`;
const navTog=id=>`#libraryFolderNav [data-lu-nav-tog="${id}"]`;
const rightKeys=page=>page.locator('#documentList > details.lu-node').evaluateAll(xs=>xs.map(x=>x.dataset.luNode));
// 보이는 자료 줄만(S69-68: 오른쪽 폴더 줄도 펼치는 줄이라 접힌 폴더 안 줄도 그려 둔다).
const rightDocs=page=>page.locator('#documentList > [data-lu-document], #documentList > .lu-row, #documentList [data-lu-document]').evaluateAll(xs=>[...new Set(xs.filter(x=>x.checkVisibility()).map(x=>x.dataset.luDocument||x.querySelector('[data-lu-document]')?.dataset.luDocument).filter(Boolean))]);
const card=page=>page.locator('#libraryListCard');
const bottom=loc=>loc.evaluate(e=>e.getBoundingClientRect().bottom);
async function boot(page,width,opt={}){
  const r=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS,init:{viewPrefs:{library_two:false}},...opt});
  await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
  return r;
}

test.describe('PC 1280 한 칸 탐색기',()=>{
  test('① 긴 나무(폴더 50개 펼침)면 카드가 같이 늘어나고 접으면 줄어든다 — 나무 칸 안 스크롤 없음',async({page})=>{
    const {errors}=await boot(page,1280);
    await expect(page.locator('#libraryFolderNav')).toBeVisible();
    const h0=await card(page).evaluate(e=>e.getBoundingClientRect().height);
    for(let i=0;i<TOPS;i++)await page.locator(navTog('t'+i)).click();
    await expect(page.locator('#libraryFolderNav [data-lu-nav]')).toHaveCount(2+TOPS+TOPS*KIDS); // 자료실 전체 + 폴더 밖 + 폴더 50
    const last=page.locator(nav(`c${TOPS-1}_${KIDS-1}`));
    const cb=await bottom(card(page)),lb=await bottom(last.locator('xpath=ancestor::div[contains(@class,"ft-row")][1]'));
    expect(lb).toBeLessThanOrEqual(cb);
    // 나무 칸(안쪽 상자 포함)은 따로 굴러가지 않는다.
    const scrolls=await page.locator('#libraryFolderNav, #libraryFolderNav .lu-fnav-in').evaluateAll(xs=>xs.map(x=>({o:getComputedStyle(x).overflowY,more:x.scrollHeight-x.clientHeight})));
    for(const s of scrolls){expect(['visible','clip']).toContain(s.o);expect(s.more).toBeLessThanOrEqual(1)}
    const h1=await card(page).evaluate(e=>e.getBoundingClientRect().height);
    expect(h1).toBeGreaterThan(h0+600);
    // 나무 아래 끝까지 카드 안(카드 밖 회색 바탕에 그려지는 줄 없음).
    const outside=await page.locator('#libraryFolderNav .ft-row').evaluateAll((rows,cbot)=>rows.filter(r=>r.getBoundingClientRect().bottom>cbot+0.5).length,cb);
    expect(outside).toBe(0);
    for(let i=0;i<TOPS;i++)await page.locator(navTog('t'+i)).click();
    await expect(page.locator('#libraryFolderNav [data-lu-nav]')).toHaveCount(2+TOPS);
    const h2=await card(page).evaluate(e=>e.getBoundingClientRect().height);
    expect(h2).toBeLessThan(h1-500);
    expect(errors).toEqual([]);
  });

  test('② 왼쪽 폴더 → 오른쪽은 바로 안 하위 폴더·자료만 / ③ 오른쪽 하위 폴더 → 그 자리 펼치기, 왼쪽 나무로 들어가면 따라 펼침·강조',async({page})=>{
    const {errors,s}=await boot(page,1280);
    // 맨 위(자료실 전체): 맨 위 폴더들 + 폴더 밖 자료.
    expect(await rightKeys(page)).toEqual(['f:t0','f:t1','f:t2','f:t3','f:t4']);
    await expect(page.locator('#documentList [data-lu-document="d3"]')).toBeVisible();
    await expect(page.locator('#documentList [data-lu-node="x:out"]')).toHaveCount(0);
    // 왼쪽 '가상 묶음 1' 이름 누르기 = 그 폴더 내용.
    await treeEnter(page.locator(nav('t1')));
    await expect(page.locator('#libraryPath')).toContainText('가상 묶음 1');
    expect(await rightKeys(page)).toEqual(Array.from({length:KIDS},(_,j)=>`f:c1_${j}`));
    expect(await rightDocs(page)).toEqual(['d4']); // 손주 폴더 안 자료(d1·d2)는 보이지 않는다
    await expect(page.locator('#documentList details[open]')).toHaveCount(0); // 오른쪽에 나무를 다시 그리지 않음
    await expect(page.locator('#documentList [data-lu-node="f:t1"]')).toHaveCount(0); // 지금 폴더 제목 줄 없음(위치 줄과 겹침)
    await expect(page.locator(nav('t1')).locator('xpath=..')).toHaveClass(/ft-current/);
    // ③ 오른쪽 '가상 칸 1-2' 누르기 = 그 자리 펼치기(안의 손주 폴더·자료가 들여 보임), 왼쪽 나무·위치 줄 그대로. 다시 누르면 접힘.
    const c12=page.locator('#documentList details[data-lu-node="f:c1_2"]');
    await c12.locator(':scope > summary').click();
    await expect(c12).toHaveAttribute('open','');
    await expect(c12.locator('details[data-lu-node="f:g1"]')).toBeVisible();
    expect((await rightDocs(page)).sort()).toEqual(['d1','d2','d4']);
    await expect(page.locator(nav('t1')).locator('xpath=..')).toHaveClass(/ft-current/);
    await expect(page.locator('#libraryPath')).not.toContainText('가상 칸 1-2');
    await c12.locator(':scope > summary').click();
    await expect(c12).not.toHaveAttribute('open','');
    // 들어가기는 왼쪽 나무. 왼쪽 나무는 그 폴더까지 펼치고 강조.
    await treeEnter(page.locator(nav('c1_2')));
    await expect(page.locator('#libraryPath')).toContainText('가상 칸 1-2');
    expect(await rightKeys(page)).toEqual(['f:g1']);
    expect((await rightDocs(page)).sort()).toEqual(['d1','d2']);
    await expect(page.locator(nav('c1_2')).locator('xpath=..')).toHaveClass(/ft-current/);
    await expect(page.locator(nav('g1'))).toBeVisible();
    // [‹] = 위 폴더(가상 묶음 1), 한 번 더 = 자료실 전체.
    await page.locator('#libraryPath [data-lu-path-back]').click();
    await expect(page.locator(nav('t1')).locator('xpath=..')).toHaveClass(/ft-current/);
    expect(await rightKeys(page)).toContain('f:c1_2');
    await page.locator('#libraryPath [data-lu-path-back]').click();
    await expect(page.locator('#libraryPath')).toHaveCount(0);
    await expect(page.locator('#libraryFolderNav .lu-fnav-root')).toHaveClass(/ft-current/);
    // 나무 그림(아이콘)은 펼치기·접기만(오른쪽 그대로).
    await page.locator(navTog('t3')).click();
    await expect(page.locator(nav('c3_0'))).toBeVisible();
    await expect(page.locator('#libraryPath')).toHaveCount(0);
    expect(s.writes).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('④ [한 칸 | 두 칸] 붙은 단추 — 눌린 표시·서버 기억·두 칸은 지금 동작 그대로',async({page})=>{
    const {errors,s}=await boot(page,1280);
    const seg=page.locator('#libraryViewSeg');
    await expect(seg).toHaveClass(/ds-seg/);
    await expect(page.locator('#libraryOneBtn')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#libraryTwoBtn')).toHaveAttribute('aria-pressed','false');
    for(const b of ['#libraryOneBtn','#libraryTwoBtn'])expect((await page.locator(b).boundingBox()).height).toBeLessThanOrEqual(34);
    await page.locator('#libraryOneBtn').click(); // 이미 한 칸: 그대로
    await expect(page.locator('#libraryFolderNav')).toBeVisible();
    await page.locator('#libraryTwoBtn').click();
    await expect(page.locator('#libraryTwoBtn')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#libraryOneBtn')).toHaveAttribute('aria-pressed','false');
    await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
    await expect(page.locator('#libraryFolderNav')).toHaveCount(0);
    await expect.poll(()=>s.viewPrefs?.library_two).toBe(true);
    await page.locator('#libraryOneBtn').click();
    await expect(page.locator('#documentList [data-lu-two]')).toHaveCount(0);
    await expect(page.locator('#libraryFolderNav')).toBeVisible();
    await expect.poll(()=>s.viewPrefs?.library_two).toBe(false);
    expect(errors).toEqual([]);
  });

  test('⑥ 오른쪽 자료를 왼쪽 나무 폴더에 끌어 놓기 · 오른쪽 하위 폴더 줄에 끌어 놓기',async({page})=>{
    const {errors,s}=await boot(page,1280);
    await page.locator('#documentList [data-lu-document="d3"]').dragTo(page.locator(nav('t2')));
    await expect.poll(()=>s.items.find(x=>x.document_id==='d3')?.folder_id||null).toBe('t2');
    await expect(page.locator('#documentList [data-lu-document="d3"]')).toBeHidden(); // 옮긴 자료는 접힌 '가상 묶음 2' 안(보이지 않음)
    await treeEnter(page.locator(nav('t2')));
    await page.locator('#documentList [data-lu-document="d3"]').dragTo(page.locator('#documentList details[data-lu-node="f:c2_4"] > summary'));
    await expect.poll(()=>s.items.find(x=>x.document_id==='d3')?.folder_id||null).toBe('c2_4');
    expect(errors).toEqual([]);
  });
});

test('두 칸 보기 1280: 긴 칸도 카드 밖으로 넘치지 않는다',async({page})=>{
  const {errors}=await boot(page,1280,{init:{viewPrefs:{library_two:true}}});
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  for(let i=0;i<TOPS;i++){const h=page.locator(`[data-lu-pane-i="0"] [data-lu-nav="t${i}"]`);await h.click()}
  const cb=await bottom(card(page));
  const over=await page.locator('#documentList [data-lu-pane-i]').evaluateAll((xs,c)=>xs.filter(x=>x.getBoundingClientRect().bottom>c+0.5).length,cb);
  expect(over).toBe(0);
  expect(errors).toEqual([]);
});

// UI-폴더이름펼치기(사용자 11/24 18:09): 폰 나무 폴더 이름 누르기도 그림 누르기처럼 그 자리 펼치기·접기. 그 폴더 내용 화면은 ⋯ 첫 줄 [이 폴더로 들어가기].
test('폰 412 ⑤: 폴더 이름·그림 누르기 = 그 자리 펼치기 · ⋯ [이 폴더로 들어가기] = 그 폴더 내용(바로 안만), 뒤로가기 = 나무',async({page})=>{
  const {errors}=await boot(page,412);
  await expect(page.locator('#libraryFolderNav')).toHaveCount(0);
  await expect(page.locator('#libraryOneBtn')).toHaveCount(0);
  // 그림 누르기 = 그 자리 펼치기(들어가지 않음).
  const ico=await page.locator('#documentList details[data-lu-node="f:t0"] > summary .lu-folder-emoji').boundingBox();
  await page.mouse.click(ico.x+ico.width/2,ico.y+ico.height/2);
  await expect(page.locator('#documentList details[data-lu-node="f:t0"]')).toHaveAttribute('open','');
  await expect(page.locator('#libraryPath')).toHaveCount(0);
  // 이름 누르기도 그 자리 펼치기(들어가지 않음), 다시 누르면 접힘.
  await page.locator('#documentList details[data-lu-node="f:t1"] > summary .lu-node-name').click({force:true});
  await expect(page.locator('#documentList details[data-lu-node="f:t1"]')).toHaveAttribute('open','');
  await expect(page.locator('#libraryPath')).toHaveCount(0);
  await page.locator('#documentList details[data-lu-node="f:t1"] > summary .lu-node-name').click({force:true});
  await expect(page.locator('#documentList details[data-lu-node="f:t1"]')).not.toHaveAttribute('open','');
  // 그 폴더 내용 화면 = ⋯ 첫 줄 [이 폴더로 들어가기].
  await page.locator('#documentList details[data-lu-node="f:t1"] > summary [data-lu-node-menu]').click();
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(page.locator('#libraryPath')).toContainText('가상 묶음 1');
  await expect(page.locator('#libraryPath .lu-focus-here')).toHaveText('가상 묶음 1');
  expect(await rightKeys(page)).toEqual(Array.from({length:KIDS},(_,j)=>`f:c1_${j}`));
  expect(await rightDocs(page)).toEqual(['d4']);
  // 안의 하위 폴더 누르기 = 그 자리 펼치기(S69-68), 한 단계 더는 ⋯ [이 폴더로 들어가기]. 뒤로가기 = 한 단계 위, 또 뒤로가기 = 나무.
  await page.locator('#documentList details[data-lu-node="f:c1_2"] > summary').click();
  await expect(page.locator('#documentList details[data-lu-node="f:c1_2"]')).toHaveAttribute('open','');
  await expect(page.locator('#libraryPath .lu-focus-here')).toHaveText('가상 묶음 1');
  await page.locator('#documentList details[data-lu-node="f:c1_2"] > summary [data-lu-node-menu]').click();
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(page.locator('#libraryPath .lu-focus-here')).toHaveText('가상 칸 1-2');
  await page.goBack();
  await expect(page.locator('#libraryPath .lu-focus-here')).toHaveText('가상 묶음 1');
  await page.goBack();
  await expect(page.locator('#libraryPath')).toHaveCount(0);
  await expect(page.locator('#documentList details[data-lu-node="x:out"]')).toHaveCount(1); // 나무 화면(폴더 밖 묶음 포함)
  await expect(page).toHaveURL(/view=library/);
  expect(errors).toEqual([]);
});
