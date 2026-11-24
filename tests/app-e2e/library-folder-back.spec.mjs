import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,menuButton,folderMenuItem} from './helpers/library-folder-server.mjs';
import {pinch} from './helpers/pinch.mjs';
// S69-19(명진 11/24 08:35 '자료실 특정 폴더로 들어왔을 때 다시 목록으로 돌아가는게 쉬워야함'):
// 위치 줄 앞 칸은 링크 모양(색·마우스 올리면 밑줄), 길면 가운데 '…'(누르면 가려진 단계 목록), Backspace = 한 단계 위,
// 뒤로가기(PC 직전 폴더·폰 한 단계 위), 빈 폴더는 '빈 폴더' 옆 작은 [위 폴더로]. 두 칸 보기·한 칸 보기·폰 모두. 이름은 지어낸 것.
const FOLDERS=[
  libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),
  libFolder('fb','top-a',{name:'가상 B',parent_id:'fa',sort_order:0}),
  libFolder('fc','top-a',{name:'가상 C',parent_id:'fb',sort_order:0}),
  libFolder('fd','top-a',{name:'가상 D',parent_id:'fc',sort_order:0}),
  libFolder('fz',null,{name:'가상 Z',sort_order:2048})
];
const ITEMS=[{document_id:'a-1',folder_id:'fb'},{document_id:'n-1',folder_id:'fc'}];
const pane=i=>`#documentList [data-lu-pane-i="${i}"]`;
const enterIn=async(page,i,id)=>{await page.locator(`${pane(i)} [data-lu-nav="${id}"]`).click({button:'right'});await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click()};
const here=(page,i)=>page.locator(`${pane(i)} .lu-pane-here`);
const shown=loc=>loc.evaluateAll(els=>els.filter(e=>!e.hidden&&e.getClientRects().length).map(e=>e.textContent.trim()));

test('PC 1440 두 칸: 앞 칸 링크 모양 · Backspace 한 단계 위 · 자료실 = 맨 위 · 길면 … · 빈 폴더 [위 폴더로] · 뒤로가기 직전 폴더',async({page})=>{
  const {errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:null}});
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  await enterIn(page,1,'fa');await enterIn(page,1,'fb');
  await expect(here(page,1)).toHaveText('가상 B');
  const root=page.locator(`${pane(1)} [data-lu-pane-go=""]`);
  // 앞 칸은 링크 색 + 옅은 밑줄, 마우스를 올리면 진한 밑줄(글자 색). ‹는 공용 아이콘 단추(32px).
  const look=await root.evaluate(b=>{const s=getComputedStyle(b),link=getComputedStyle(document.documentElement).getPropertyValue('--kptu-link').trim();const p=document.createElement('span');p.style.color=link;document.body.append(p);const want=getComputedStyle(p).color;p.remove();return {color:s.color,want,deco:s.textDecorationLine,line:s.textDecorationColor}});
  expect(look.color).toBe(look.want);expect(look.deco).toBe('underline');expect(look.line).not.toBe(look.color);
  await root.hover();
  await expect.poll(()=>root.evaluate(b=>getComputedStyle(b).textDecorationColor===getComputedStyle(b).color)).toBe(true);
  const up=page.locator(`${pane(1)} [data-lu-pane-up]`);
  const ub=await up.boundingBox();expect(ub.width).toBeGreaterThanOrEqual(28);expect(ub.height).toBeGreaterThanOrEqual(28);
  await page.screenshot({path:'test-results/s69-19-pc-two-path.png'});
  // Backspace = 한 단계 위(지금 칸).
  await page.locator(`${pane(1)} [data-lu-prow]`).first().focus();
  await page.keyboard.press('Backspace');
  await expect(here(page,1)).toHaveText('가상 A');
  // 위치 줄 '자료실' = 맨 위.
  await root.click();
  await expect(here(page,1)).toHaveText('자료실');
  // 네 단계 들어가면 가운데는 '…'.
  await enterIn(page,1,'fa');await enterIn(page,1,'fb');await enterIn(page,1,'fc');await enterIn(page,1,'fd');
  await expect(here(page,1)).toHaveText('가상 D');
  expect(await shown(page.locator(`${pane(1)} .lu-pane-path > *:not(.lu-pane-sep)`))).toEqual(['자료실','…','가상 C','가상 D']);
  // 빈 폴더: '빈 폴더' 옆 작은 [위 폴더로].
  const empty=page.locator(`${pane(1)} .lu-empty-up`);
  await expect(empty).toHaveText(/빈 폴더\s*위 폴더로/);
  await page.screenshot({path:'test-results/s69-19-pc-two-deep.png'});
  await empty.getByRole('button',{name:'위 폴더로'}).click();
  await expect(here(page,1)).toHaveText('가상 C');
  // … 누르면 가려진 단계 목록 → 고르면 그 폴더.
  await enterIn(page,1,'fd');
  await page.locator(`${pane(1)} [data-fp-more]`).click();
  const menu=page.locator('#fpMoreMenu');
  await expect(menu.locator('button')).toHaveText(['가상 A','가상 B']);
  await page.screenshot({path:'test-results/s69-19-pc-two-more.png'});
  await menu.getByRole('button',{name:'가상 A'}).click();
  await expect(here(page,1)).toHaveText('가상 A');
  // 뒤로가기(Alt+←와 같은 브라우저 뒤로) = 직전 폴더(NAV-PC뒤로직전2 그대로).
  await page.goBack();
  await expect(here(page,1)).toHaveText('가상 D');
  // 왼쪽 칸도 같은 머리 줄: 들어가서 Backspace.
  await enterIn(page,0,'fa');await enterIn(page,0,'fb');
  await expect(here(page,0)).toHaveText('가상 B');
  await page.locator(`${pane(0)} [data-lu-prow]`).first().focus();
  await page.keyboard.press('Backspace');
  await expect(here(page,0)).toHaveText('가상 A');
  await expect(here(page,1)).toHaveText('가상 D');
  expect(errors).toEqual([]);
});

test('PC 1440 한 칸(나무 | 목록): 위치 줄 링크 · Backspace 한 단계 위 · 자료실 = 맨 위 · 길면 …',async({page})=>{
  const {errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:null}});
  await page.locator('#libraryTwoBtn').click();
  await expect(page.locator('#libraryFolderNav')).toBeVisible();
  const path=page.locator('#libraryPath');
  const head=key=>page.locator(`#documentList details[data-lu-node="${key}"] > summary`);
  await menuButton(page,'f:fa').click();await folderMenuItem(page,'이 폴더로 들어가기').click();
  await expect(path.locator('.fp-here')).toHaveText('가상 A');
  await head('f:fb').dblclick();
  await expect(path.locator('.fp-here')).toHaveText('가상 B');
  await page.locator('#documentList [data-lu-document]').first().focus();
  await page.keyboard.press('Backspace');
  await expect(path.locator('.fp-here')).toHaveText('가상 A');
  await head('f:fb').dblclick();await head('f:fc').dblclick();await head('f:fd').dblclick();
  await expect(path.locator('.fp-here')).toHaveText('가상 D');
  expect(await shown(path.locator('> *:not(.fp-sep)'))).toEqual(['‹','자료실','…','가상 C','가상 D']);
  await page.screenshot({path:'test-results/s69-19-pc-one-deep.png'});
  await path.locator('[data-fp-more]').click();
  await page.locator('#fpMoreMenu').getByRole('button',{name:'가상 B'}).click();
  await expect(path.locator('.fp-here')).toHaveText('가상 B');
  await path.locator('[data-lu-path=""]').click();
  await expect(path).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('폰 412: 두 단계 들어간 폴더 → 위치 줄 자료실 = 맨 위 · Backspace·뒤로가기 = 한 단계 위 · 길면 …',async({page})=>{
  const {errors}=await bootLibrary(page,412,{folders:FOLDERS,items:ITEMS});
  await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
  const head=key=>page.locator(`#documentList details[data-lu-node="${key}"] > summary`);
  const path=page.locator('#libraryPath');
  await pinch(page,head('f:fa'),'out');
  await head('f:fb').dblclick();
  await expect(path).toHaveText('‹자료실›가상 A›');
  await page.screenshot({path:'test-results/s69-19-phone-path.png'});
  // 자료실 = 맨 위(나무).
  await path.locator('[data-lu-path=""]').click();
  await expect(path).toBeHidden();
  // Backspace = 한 단계 위.
  await pinch(page,head('f:fa'),'out');await head('f:fb').dblclick();
  await expect(path).toHaveText('‹자료실›가상 A›');
  await page.keyboard.press('Backspace');
  await expect(path).toHaveText('‹자료실›');
  // 폰 뒤로가기 = 한 단계 위.
  await head('f:fb').dblclick();
  await expect(path).toHaveText('‹자료실›가상 A›');
  await page.goBack();
  await expect(path).toHaveText('‹자료실›');
  // 깊으면 가운데 '…'.
  await head('f:fb').dblclick();await head('f:fc').dblclick();await head('f:fd').dblclick();
  expect(await shown(path.locator('> *:not(.ft-focus-sep)'))).toEqual(['‹','자료실','…','가상 C']);
  await page.screenshot({path:'test-results/s69-19-phone-deep.png'});
  await path.locator('[data-fp-more]').click();
  await expect(page.locator('#fpMoreMenu button')).toHaveText(['가상 A','가상 B']);
  await page.locator('#fpMoreMenu').getByRole('button',{name:'가상 A'}).click();
  await expect(path).toHaveText('‹자료실›');
  expect(errors).toEqual([]);
});
