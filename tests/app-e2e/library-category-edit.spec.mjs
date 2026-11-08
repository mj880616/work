import {test,expect} from '@playwright/test';
import {bootLibrary,libDoc} from './helpers/library-folder-server.mjs';
// S51-28 LIB-화면정리 ②(요청 11/06 01:26, 명진 'ㅇㅋ', 시안 docs/design/mockups/library-category-edit.html): 자료실 [편집] = '분류 고치기 n개' 창.
// 공용 '목록 고치기' 모양(list-edit.mjs): 맨 위 '새 분류 이름 [추가]', 줄 = ⠿ · 이름(누르면 그 자리 고침) · 자료 수 · ⋯([+ 소분류]·[이름 바꾸기]·[지우기]),
// 큰 버튼·빨강·긴 안내문 없음, '기타'는 맨 아래 자물쇠 '고정', ⠿ 끌기 = 분류 칩 순서(서버 저장), 창이 아래 탭에 가리지 않음. 이름은 지어낸 것.
const CATS=['교섭','투쟁','교육','선전','정책','회의','주간보고','주간보고›확정본','주간보고›개인본','공문','양식','기타'];
const DOCS=[libDoc('a',null,{category:'정책'}),libDoc('b',null,{category:'투쟁'}),libDoc('c',null,{category:'주간보고›확정본'})];
const modal=page=>page.locator('#libraryManageModal');
const row=(page,name)=>modal(page).locator(`[data-le-row="${name}"]`);
const box=l=>l.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom}});
async function openEditor(page,width){
  if(width<1200){await page.locator('#libraryCategoryPick').click();await page.locator('#libraryCategorySheet [data-lu-cat-edit]').click();}
  else await page.locator('#manageLibraryBtn').click();
  await expect(modal(page)).toBeVisible();await expect(row(page,'교섭')).toBeVisible();
}

for(const width of [412,884,1280])test(`분류 수정 ${width}: 한 줄 모양 · 그 자리 이름 수정 · ⋯ 메뉴 · 삭제 한 번 묻기 · ⠿ 순서 서버 저장`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,width,{docs:DOCS,init:{documentCategories:[...CATS]}});
  await openEditor(page,width);
  // 제목·수, 긴 안내문·큰 버튼·빨강 없음.
  await expect(modal(page).locator('h2')).toHaveText('분류 수정12개');
  await expect(modal(page).locator('.dce-note,.danger,[data-dce-delete],[data-dce-add-sub]')).toHaveCount(0);
  await expect(modal(page).locator('.le-row:not(.le-editing) button:not(.le-handle):not(.le-name):not(.le-more)')).toHaveCount(0);
  // 줄: ⠿ · 이름 · 수 · ⋯. 소분류는 들여 쓴 줄, 큰 분류는 '수 · 소분류 n'.
  await expect(row(page,'정책').locator('.le-meta')).toHaveText('1');
  await expect(row(page,'주간보고').locator('.le-meta')).toHaveText('1 · 소분류 2');
  await expect(row(page,'주간보고›확정본')).toHaveClass(/le-sub/);await expect(row(page,'주간보고›확정본').locator('.le-name')).toHaveText('확정본');
  // '기타'는 맨 아래 자물쇠 '고정'(이름 고치기·메뉴 없음).
  await expect(modal(page).locator('.le-list > .le-row').last()).toHaveAttribute('data-le-row','기타');
  await expect(row(page,'기타').locator('.le-lock')).toHaveText('고정');await expect(row(page,'기타').locator('.le-lock svg')).toHaveCount(1);await expect(row(page,'기타').locator('button')).toHaveCount(0);
  // '새 분류 이름 [추가]'가 맨 위, 창이 아래 탭에 가리지 않는다.
  const add=modal(page).locator('form[data-dce-add]');
  expect(await add.evaluate(el=>el.parentElement.firstElementChild===el)).toBe(true);
  if(width<=760){const tabs=await box(page.locator('.mobile-tabs')),card=await box(modal(page).locator('.modal-card')),a=await box(add);expect(card.bottom).toBeLessThanOrEqual(tabs.y+1);expect(a.bottom).toBeLessThanOrEqual(tabs.y);}
  await add.locator('input').fill('홍보');await add.locator('input').press('Enter');
  await expect(row(page,'홍보')).toBeVisible();await expect(modal(page).locator('[data-dce-status]')).toHaveText('‘홍보’ 분류를 추가했어요.');
  // 이름을 누르면 그 자리에서 고침, 엔터 = 완료.
  await row(page,'교육').locator('.le-name').click();
  const input=modal(page).locator('[data-dce-rename-input]');await expect(input).toBeFocused();await expect(input).toHaveValue('교육');
  await expect(modal(page).locator('.le-editing .le-done')).toHaveText('완료');
  await input.fill('교육·연수');await input.press('Enter');
  await expect(row(page,'교육·연수')).toBeVisible();await expect(row(page,'교육')).toHaveCount(0);
  // Esc = 그만.
  await row(page,'선전').locator('.le-name').click();await input.press('Escape');await expect(input).toHaveCount(0);await expect(row(page,'선전')).toBeVisible();
  // ⋯ 메뉴: [+ 소분류]·[이름 바꾸기]·[지우기](같은 색). 지우기는 한 번 묻고(빨강 없음) 지운다.
  await row(page,'투쟁').locator('.le-more').click();
  const menu=page.locator('#dceMenu');await expect(menu.getByRole('button')).toHaveText(['+ 소분류','이름 바꾸기','삭제']);
  await menu.getByRole('button',{name:'삭제'}).click();
  const ask=page.locator('.kptu-ask');await expect(ask).toBeVisible();await expect(ask.locator('.danger')).toHaveCount(0);
  await ask.locator('.kptu-ask-actions button').nth(1).click();
  await expect(row(page,'투쟁')).toHaveCount(0);
  // ⋯ → [+ 소분류]: 그 묶음 끝에 이름 칸.
  await row(page,'공문').locator('.le-more').click();await menu.getByRole('button',{name:'+ 소분류'}).click();
  const subInput=modal(page).locator('[data-dce-sub-input]');await expect(subInput).toBeFocused();await subInput.fill('수신');await subInput.press('Enter');
  await expect(row(page,'공문›수신')).toBeVisible();
  // ⠿ 순서: 키보드 위로 한 칸 → 서버 목록(소분류는 큰 분류 뒤, '기타'는 끝) = 분류 칩 순서.
  const before=s.documentCategories.slice();
  await row(page,'양식').locator('.le-handle').focus();await page.keyboard.press('ArrowUp');
  await expect.poll(()=>s.documentCategories.join('|')).not.toBe(before.join('|'));
  expect(s.documentCategories.slice(-1)).toEqual(['기타']);
  const ia=s.documentCategories.indexOf('양식'),ib=s.documentCategories.indexOf('공문');expect(ia).toBeLessThan(ib);expect(s.documentCategories[ib+1]).toBe('공문›수신');
  await expect(page.locator('#libraryCategoryFilter [data-lu-category]:not([data-lu-category="all"])')).toHaveText(s.documentCategories.filter(n=>!n.includes('›')));
  // PC: 손잡이를 마우스로 끌어 맨 위로.
  if(width>=761){
    const h=await box(row(page,'회의').locator('.le-handle')),top=await box(row(page,'교섭'));
    await page.mouse.move(h.x+h.w/2,h.y+h.h/2);await page.mouse.down();await page.mouse.move(h.x+h.w/2,h.y-10,{steps:4});await page.mouse.move(top.x+20,top.y+4,{steps:8});await page.mouse.up();
    await expect.poll(()=>s.documentCategories[0]).toBe('회의');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:`test-results/library-category-edit-${width}.png`});
  expect(errors).toEqual([]);
});

test('분류 수정: 다른 기기에서 목록이 바뀐 뒤 순서를 바꾸면 덮어쓰지 않고 최신 목록을 다시 그린다',async({page})=>{
  test.setTimeout(60000);
  const {s,errors}=await bootLibrary(page,1280,{docs:DOCS,init:{documentCategories:[...CATS]}});
  await openEditor(page,1280);
  s.documentCategories=[...CATS.slice(0,-1),'다른기기','기타'];
  await row(page,'양식').locator('.le-handle').focus();await page.keyboard.press('ArrowUp');
  await expect(modal(page).locator('[data-dce-status]')).toContainText('목록을 다시 불러왔어요');
  await expect(row(page,'다른기기')).toBeVisible();
  expect(s.documentCategories).toEqual([...CATS.slice(0,-1),'다른기기','기타']);
  expect(errors).toEqual([]);
});
