import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
import {pinch} from './helpers/pinch.mjs';
// S55-11 LIB-두칸보기(시안 docs/design/mockups/library-two-pane.html, 명진 11/09 18:16 'ㅇ'): PC·펼친 폴드 폴더 묶기 = 양쪽 다 폴더 + 자료 두 칸.
// 칸마다 위치·폴더 들어가기, 칸 사이·같은 칸 폴더 줄 끌어 옮기기(실제 브라우저 끌기), 자기 안 막음, Tab·F6, [▥ 두 칸] 켬/끔(서버 기억),
// 경계 폭(split_ratio.library, 서버 기억), 폰은 한 칸. 흡수한 나무 접수(폴더 밖·나무로 끌기·나무 넘침·접기·폭)는 두 칸에서 같은 결과로 본다. 이름은 지어낸 것.
const FOLDERS=[
  libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),
  libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0}),
  libFolder('fn',null,{name:'가상 N',sort_order:2048}),
  libFolder('fz',null,{name:'가상 Z',sort_order:3072})
];
const ITEMS=[{document_id:'a-1',folder_id:'fc'},{document_id:'n-1',folder_id:'fa'}];
const pane=i=>`#documentList [data-lu-pane-i="${i}"]`;
const folderIn=(i,id)=>`${pane(i)} [data-lu-nav="${id}"]`;
// S56-40 LIB-두칸폴더펼치기: 폴더 줄 누르기 = 그 칸 안 펼치기·접기. 그 폴더로 들어가기는 우클릭 [이 폴더로 들어가기].
const enterIn=async(page,i,id)=>{await page.locator(folderIn(i,id)).click({button:'right'});await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click()};
const docIn=(i,id)=>`${pane(i)} [data-lu-document="${id}"]`;
const line=page=>page.locator('#libraryFolderStatusLine');
const folderOf=(s,doc)=>s.items.find(x=>x.document_id===doc)?.folder_id||null;
const parentOf=(s,id)=>s.folders.find(f=>f.id===id)?.parent_id||null;
const boot=(page,width,init={})=>bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:null,...init}});

for(const width of [1440,884])test.describe(`자료실 ${width} 두 칸`,()=>{
  test('기본 두 칸: 양쪽 다 폴더 + 자료, 칸마다 따로 들어가기(나무 없음), 맨 위는 폴더 밖 자료도',async({page})=>{
    const {errors}=await boot(page,width);
    await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
    await expect(page.locator('#libraryFolderNav')).toHaveCount(0);
    await expect(page.locator('#libraryPath')).toHaveCount(0);
    await expect(page.locator('#libraryTwoBtn')).toHaveAttribute('aria-pressed','true');
    for(const i of [0,1]){
      for(const id of ['fa','fn','fz'])await expect(page.locator(folderIn(i,id))).toBeVisible();
      // LIB-나무폴더밖 흡수: 맨 위 칸에 폴더 밖 자료가 바로 보인다.
      for(const id of ['a-2','a1-1'])await expect(page.locator(docIn(i,id))).toBeVisible();
      await expect(page.locator(`${pane(i)} .lu-pane-here`)).toHaveText('자료실');
    }
    // 오른쪽 칸에서 가상 A로 들어간다 → 왼쪽은 그대로.
    await enterIn(page,1,'fa');
    await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('가상 A');
    await expect(page.locator(folderIn(1,'fc'))).toBeVisible();
    await expect(page.locator(docIn(1,'n-1'))).toBeVisible();
    await expect(page.locator(docIn(1,'a-2'))).toHaveCount(0);
    await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('자료실');
    await expect(page.locator(pane(1))).toHaveClass(/lu-pane-cur/);
    // 왼쪽 칸에서 가상 A › 가상 C로 들어갔다가 위치 줄로 맨 위.
    await enterIn(page,0,'fa');await enterIn(page,0,'fc');
    await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('가상 C');
    await expect(page.locator(docIn(0,'a-1'))).toBeVisible();
    await expect(page.locator(pane(0))).toHaveClass(/lu-pane-cur/);
    await page.locator(`${pane(0)} [data-lu-pane-up]`).click();
    await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('가상 A');
    await page.locator(`${pane(0)} [data-lu-pane-go=""]`).click();
    await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('자료실');
    // 정렬: 이름순이면 가상 A·N·Z 폴더 다음 자료 이름순.
    await page.locator(`${pane(0)} [data-lu-pane-sort]`).selectOption('name');
    await expect(page.locator(`${pane(0)} [data-lu-prow]`).first()).toHaveAttribute('data-lu-prow','f:fa');
    expect(errors).toEqual([]);
  });

  test('끌어 옮기기: 왼쪽 자료 → 오른쪽 칸 빈 자리(그 칸 폴더), 폴더 → 반대 칸 폴더 줄, 같은 칸 폴더 줄, 자기 안 막음',async({page})=>{
    test.setTimeout(90000);
    const {s,errors}=await boot(page,width);
    await enterIn(page,1,'fa');
    await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('가상 A');
    // 왼쪽(맨 위) 자료 → 오른쪽 칸 빈 자리 = 가상 A.
    await page.locator(docIn(0,'a-2')).dragTo(page.locator(`${pane(1)} .lu-pane-head`));
    await expect.poll(()=>folderOf(s,'a-2')).toBe('fa');
    await expect(line(page)).toContainText('가상 A 폴더');await expect(line(page).locator('.lu-undo')).toHaveText('되돌리기');
    await expect(page.locator(docIn(1,'a-2'))).toBeVisible();
    // 같은 칸 폴더 줄: 왼쪽 자료 a1-1 → 왼쪽 가상 Z.
    await page.locator(docIn(0,'a1-1')).dragTo(page.locator(folderIn(0,'fz')));
    await expect.poll(()=>folderOf(s,'a1-1')).toBe('fz');
    // 옮기기가 끝나 목록을 다시 읽은 뒤에 안내가 뜬다(그 전에 다음 끌기를 놓으면 폴더 부품이 바쁜 동안이라 받지 않는다).
    await expect(line(page)).toContainText('가상 Z 폴더');
    // 폴더 → 반대 칸 폴더 줄: 왼쪽 가상 N → 오른쪽 가상 C.
    await page.locator(folderIn(0,'fn')).dragTo(page.locator(folderIn(1,'fc')));
    await expect.poll(()=>parentOf(s,'fn')).toBe('fc');
    await expect(line(page)).toContainText('폴더를 옮겼어요 → 가상 C 폴더');
    // 자기 안 막음: 왼쪽 가상 A → 오른쪽 칸(가상 A 안) 빈 자리 — 쓰기 없음.
    await page.waitForLoadState('networkidle');const n=s.writes.length;
    await page.locator(folderIn(0,'fa')).dragTo(page.locator(`${pane(1)} .lu-pane-head`));
    await page.waitForLoadState('networkidle');expect(s.writes.length).toBe(n);
    expect(parentOf(s,'fa')).toBeNull();
    expect(errors).toEqual([]);
  });
});

// S56-40 LIB-두칸폴더펼치기(명진 11/10 18:25): 폴더 줄 누르기 = 그 칸 안에서 나무처럼 펼치기·접기(들어가지 않음),
// 들어가기는 우클릭 [이 폴더로 들어가기](메뉴를 연 칸에서), 손가락 화면은 두 손가락 벌리기 = 그 폴더만, 오므리기 = 한 단계 위.
for(const width of [1440,884])test(`자료실 ${width} 두 칸: 폴더 누르기 = 그 칸 안 펼치기·접기, 우클릭 [이 폴더로 들어가기]`,async({page})=>{
  const {errors}=await boot(page,width);
  const fa=page.locator(folderIn(0,'fa'));
  await expect(fa).toHaveAttribute('aria-expanded','false');
  await expect(page.locator(folderIn(0,'fc'))).toHaveCount(0);
  await fa.click();
  // 들어가지 않는다: 위치 줄은 그대로 '자료실', 그 아래 하위 폴더·자료가 들여 보인다.
  await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('자료실');
  await expect(fa).toHaveAttribute('aria-expanded','true');
  await expect(page.locator(folderIn(0,'fc'))).toBeVisible();
  await expect(page.locator(`${pane(0)} [data-lu-pane-sub="fa"] [data-lu-document="n-1"]`)).toBeVisible();
  const x=async sel=>(await page.locator(sel).boundingBox()).x;
  expect(await x(`${folderIn(0,'fc')} .ft-name`)).toBeGreaterThan(await x(`${folderIn(0,'fa')} .ft-name`)+10);
  expect(await x(`${pane(0)} [data-lu-pane-sub="fa"] [data-lu-document="n-1"]`)).toBeGreaterThan(await x(docIn(0,'a-2'))+10);
  await expect(fa).toBeFocused();
  // 한 단 더: 가상 C를 펼치면 그 안 자료.
  await page.locator(folderIn(0,'fc')).click();
  await expect(page.locator(`${pane(0)} [data-lu-pane-sub="fc"] [data-lu-document="a-1"]`)).toBeVisible();
  // 다시 누르면 접힌다(안쪽도 함께 안 보임).
  await fa.click();
  await expect(fa).toHaveAttribute('aria-expanded','false');
  await expect(page.locator(folderIn(0,'fc'))).toHaveCount(0);
  await expect(page.locator(`${pane(0)} [data-lu-document="n-1"]`)).toHaveCount(0);
  // 빈 폴더는 눌러도 그대로.
  await page.locator(folderIn(0,'fz')).click();
  await expect(page.locator(folderIn(0,'fz'))).toHaveAttribute('aria-expanded','false');
  // 오른쪽 칸은 왼쪽과 상관없이 그대로 맨 위.
  await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('자료실');
  // 펼친 상태로 [이 폴더로 들어가기] → 그 칸만 그 폴더.
  await fa.click();
  await fa.click({button:'right'});
  await expect(page.locator('#luFolderMenu [data-lu-folder-action="toggle"]')).toHaveText('접기');
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('가상 A');
  await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('자료실');
  await expect(page.locator(folderIn(0,'fc'))).toBeVisible();
  // 펼침 기억은 한 칸 목록과 같은 곳: 앞에서 펼친 가상 C는 펼친 채. 메뉴 [접기]도 같은 펼침(칸 안).
  await expect(page.locator(`${pane(0)} [data-lu-pane-sub="fc"] [data-lu-document="a-1"]`)).toBeVisible();
  await page.locator(folderIn(0,'fc')).click({button:'right'});
  await expect(page.locator('#luFolderMenu [data-lu-folder-action="toggle"]')).toHaveText('접기');
  await page.locator('#luFolderMenu [data-lu-folder-action="toggle"]').click();
  await expect(page.locator(`${pane(0)} [data-lu-document="a-1"]`)).toHaveCount(0);
  await expect(page.locator(folderIn(0,'fc'))).toHaveAttribute('aria-expanded','false');
  await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('가상 A');
  expect(errors).toEqual([]);
});

test.describe('펼친 폴드 884 손가락 두 칸',()=>{
  test.use({hasTouch:true});
  test('두 손가락 벌리기 = 그 칸에서 그 폴더만, 오므리기 = 한 단계 위',async({page})=>{
    const {errors}=await boot(page,884);
    await page.locator(folderIn(1,'fa')).click();
    await expect(page.locator(folderIn(1,'fc'))).toBeVisible();
    await pinch(page,page.locator(folderIn(1,'fa')),'out');
    await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('가상 A');
    await expect(page.locator(`${pane(0)} .lu-pane-here`)).toHaveText('자료실');
    await pinch(page,page.locator(`${pane(1)} .lu-pane-list`),'in');
    await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('자료실');
    expect(errors).toEqual([]);
  });
});

test('PC 1440: Tab 칸 바꾸기 · F6 = 포커스 자료를 반대 칸 폴더로 · 고르면 [→ 오른쪽 폴더로 옮기기]',async({page})=>{
  const {s,errors}=await boot(page,1440);
  await enterIn(page,1,'fz');
  await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('가상 Z');
  await page.locator(docIn(0,'a-2')).focus();
  await expect(page.locator(pane(0))).toHaveClass(/lu-pane-cur/);
  await page.keyboard.press('F6');
  await expect.poll(()=>folderOf(s,'a-2')).toBe('fz');
  await expect(line(page)).toContainText('가상 Z 폴더');
  await page.locator(docIn(0,'a1-1')).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(pane(1))).toHaveClass(/lu-pane-cur/);
  await expect(page.locator(pane(0))).not.toHaveClass(/lu-pane-cur/);
  expect(errors).toEqual([]);
});

test('PC 1440: [▥ 두 칸] 끄면 지금 한 칸(나무 | 목록), 서버에 기억 · 다시 켜기',async({page})=>{
  const {s,errors}=await boot(page,1440);
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  await page.locator('#libraryTwoBtn').click();
  await expect(page.locator('#libraryTwoBtn')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#documentList [data-lu-two]')).toHaveCount(0);
  await expect(page.locator('#libraryFolderNav')).toBeVisible();
  await expect.poll(()=>s.viewPrefs?.library_two).toBe(false);
  await page.locator('#libraryTwoBtn').click();
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  await expect.poll(()=>s.viewPrefs?.library_two).toBe(true);
  expect(errors).toEqual([]);
});

test('PC 1440: 가운데 경계를 키보드로 옮기면 폭이 바뀌고 서버(split_ratio.library)에 기억',async({page})=>{
  const {s,errors}=await boot(page,1440);
  const handle=page.locator('#documentList [data-lu-two] > .split-resize-handle');
  await expect(handle).toBeVisible();
  const w0=await page.locator(pane(0)).evaluate(e=>e.getBoundingClientRect().width);
  await handle.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await expect.poll(()=>page.locator(pane(0)).evaluate(e=>e.getBoundingClientRect().width)).toBeGreaterThan(w0+10);
  await expect.poll(()=>s.viewPrefs?.split_ratio?.library||0).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

test('PC 1440: 폭을 기억한 서버면 다시 열어도 그 폭(다른 PC에서도 같은 값)',async({page})=>{
  const {errors}=await boot(page,1440,{viewPrefs:{split_ratio:{library:0.3}}});
  const box=await page.locator('#documentList [data-lu-two]').evaluate(e=>e.getBoundingClientRect().width);
  const w0=await page.locator(pane(0)).evaluate(e=>e.getBoundingClientRect().width);
  expect(w0/box).toBeLessThan(0.36);expect(w0/box).toBeGreaterThan(0.24);
  expect(errors).toEqual([]);
});

test('폰 390: 두 칸 없음 · [▥ 두 칸] 단추 없음(지금 한 칸 목록)',async({page})=>{
  const {errors}=await boot(page,390);
  await expect(page.locator('#documentList summary.lu-node-head').first()).toBeVisible();
  await expect(page.locator('#documentList [data-lu-two]')).toHaveCount(0);
  await expect(page.locator('#libraryTwoBtn')).toHaveCount(0);
  expect(errors).toEqual([]);
});
