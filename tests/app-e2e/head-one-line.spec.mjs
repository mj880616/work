import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {start,openFiles} from './helpers/files-server.mjs';
// S71-28 FILES-머리한줄(명진 11/26 "파일도 한줄로" / "자료실도"): 폰 머리 줄 한 줄.
// - [파일] 폰: [W] 파일 · 출처 아이콘(작게) …… [□|⊟] · 찾기. 출처·보기 단추가 따로 된 둘째 줄에 있지 않다.
// - [자료실] 폰·폴드: [W] 자료실 · [폴더 ▾] · [분류 ▾](고른 값만) …… ⋯ · 찾기 · [+]([+] 맨 오른쪽). 고르기 줄이 따로 된 둘째 줄에 있지 않다.
// - PC: [파일] 위쪽 도구 줄·[자료실] 본문 첫 줄 고르기는 그대로, 자료실 상단 줄은 [찾기][⋯][+].
// 이름·자료는 모두 가짜.
const HEAD='#appView > .mobile-shell-header';
// 고르개마다 상자(보이는 것만). 머리 줄 높이·가로 넘침도 함께.
const boxes=(page,sels)=>page.evaluate(({sels,HEAD})=>{
  const out={};for(const sel of sels){const el=document.querySelector(sel);const r=el?.getBoundingClientRect();out[sel]=el&&el.getClientRects().length&&r.width>1?{x:r.x,right:r.right,top:r.top,bottom:r.bottom,mid:r.top+r.height/2}:null}
  const h=document.querySelector(HEAD).getBoundingClientRect();out.head={top:h.top,bottom:h.bottom,h:h.height,right:h.right};out.overflow=document.documentElement.scrollWidth-innerWidth;return out;
},{sels,HEAD});
// 차례대로 왼쪽 → 오른쪽, 모두 머리 줄 안 같은 줄(가운데 높이 3px 안).
function oneLine(m,order){
  for(const sel of order)expect(m[sel],`${sel} 보임`).not.toBeNull();
  for(const sel of order){expect(Math.abs(m[sel].mid-m[order[0]].mid),`${sel} 같은 줄`).toBeLessThan(3);expect(m[sel].top).toBeGreaterThanOrEqual(m.head.top-1);expect(m[sel].bottom).toBeLessThanOrEqual(m.head.bottom+1)}
  for(let i=1;i<order.length;i++)expect(m[order[i-1]].right,`${order[i-1]} → ${order[i]}`).toBeLessThanOrEqual(m[order[i]].x+0.5);
  expect(m[order.at(-1)].right).toBeLessThanOrEqual(m.head.right+0.5);
  expect(m.head.h).toBeLessThanOrEqual(44);
  expect(m.overflow).toBeLessThanOrEqual(0);
}

for(const width of [344,390,690])test(`자료실 ${width}: 머리 줄 한 줄 [이름][폴더 ▾][분류 ▾] …… ⋯ 찾기 [+], 둘째 줄 없음, 단추 동작`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,width,{folders:[libFolder('fa',null,{name:'가상 A'})],items:[{document_id:'a-1',folder_id:'fa'}],docs:[libDoc('a-1',null,{category:'정책',title:'가상 요구안'}),libDoc('m-1',null,{category:'회의'})]});
  const find=width<600?`${HEAD} .sf-open`:'#gsScreenInput';
  const order=[`${HEAD} [data-mobile-view-name]`,'#libraryGroupBy','#libraryCategoryPick','#libraryTopMenuBtn',find,'#newDocumentBtn'];
  await expect(page.locator('#libraryCategoryPick')).toHaveAccessibleName('분류: 회의 빼고');
  await expect(page.locator(find)).toBeVisible();
  oneLine(await boxes(page,order),order);
  // 따로 된 고르기 줄 없음: 본문(#libraryView)에 고르기 상자가 없다(요소째 머리 줄로 옮김). 본문 첫 줄은 자리도 없다.
  await expect(page.locator('#libraryView :is(#libraryGroupBy,#libraryCategoryPick,.lu-pick-row)')).toHaveCount(0);
  await expect(page.locator('#libraryView .lu-search-row')).toBeHidden();
  // [분류 ▾]는 좁은 머리 줄에서 지금 고른 값만 보인다('분류: '는 읽기 프로그램용 글자).
  expect(await page.locator('#libraryCategoryPick .lu-cat-pick-text').evaluate(el=>[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(''))).toBe('회의 빼고');
  await expect(page.locator('#libraryCategoryPick .a11y-only')).toHaveText('분류: ');
  // 단추 동작: [폴더 ▾] 고르기 → 묶기 바뀜·서버 기억.
  await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
  await expect.poll(()=>s.libraryView?.group_by).toBe('folder');
  await expect(page.locator('#documentList details[data-lu-node="f:fa"]')).toHaveCount(1);
  // [분류 ▾] → 고르기 창.
  await page.locator('#libraryCategoryPick').click();
  await expect(page.locator('#libraryCategorySheet')).toBeVisible();
  await page.locator('#libraryCategorySheet [data-sheet-cancel]').click();
  await expect(page.locator('#libraryCategorySheet')).toBeHidden();
  // ⋯ → 자료실 메뉴.
  await page.locator('#libraryTopMenuBtn').click();
  await expect(page.locator('#libraryTopMenuBtn')).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#libraryTopMenuBtn')).toHaveAttribute('aria-expanded','false');
  // 찾기: 폰은 ⌕ → 같은 줄에 칸(⋯와 [+] 사이), 폴드는 칸이 늘 같은 줄. 치면 거른다.
  if(width<600)await page.locator(`${HEAD} .sf-open`).click();
  const input=page.locator('#gsScreenInput');await expect(input).toBeVisible();
  const fb=await input.boundingBox(),mb=await page.locator('#libraryTopMenuBtn').boundingBox(),ab=await page.locator('#newDocumentBtn').boundingBox();
  expect(Math.abs((fb.y+fb.height/2)-(mb.y+mb.height/2))).toBeLessThan(3);expect(fb.x).toBeGreaterThanOrEqual(mb.x+mb.width-0.5);expect(fb.x+fb.width).toBeLessThanOrEqual(ab.x+0.5);
  await input.fill('요구안');
  await expect(page.locator('#documentList [data-lu-document="m-1"]')).toHaveCount(0);
  await input.fill('');
  // [+] → 자료 등록 창.
  await page.locator('#newDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeVisible();
  expect(errors).toEqual([]);
});

test('자료실 PC 1280: 고르기 줄은 본문 첫 줄 그대로, 상단 줄은 [찾기][⋯][+]',async({page})=>{
  test.setTimeout(60000);
  const {errors}=await bootLibrary(page,1280,{docs:[libDoc('a-1',null,{category:'정책'})]});
  await expect(page.locator('#libraryView .lu-pick-row #libraryGroupBy')).toBeVisible();
  await expect(page.locator('#libraryCategoryPick')).toHaveText('분류: 회의 빼고');
  await expect(page.locator('#gsTopInput')).toBeVisible();
  const m=await page.evaluate(()=>Object.fromEntries(['#gsTopInput','#libraryTopMenuBtn','#newDocumentBtn'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,{x:r.x,right:r.right,mid:r.top+r.height/2}]})));
  expect(m['#gsTopInput'].right).toBeLessThanOrEqual(m['#libraryTopMenuBtn'].x);expect(m['#libraryTopMenuBtn'].right).toBeLessThanOrEqual(m['#newDocumentBtn'].x);
  expect(Math.abs(m['#libraryTopMenuBtn'].mid-m['#newDocumentBtn'].mid)).toBeLessThan(3);
  expect(errors).toEqual([]);
});

for(const width of [344,390])test(`파일 ${width}: 머리 줄 한 줄 [이름][출처 아이콘] …… [□|⊟] 찾기, 둘째 줄 없음, 단추 동작`,async({page})=>{
  test.setTimeout(90000);
  const {errors}=await start(page,width);
  await openFiles(page,width);
  const order=[`${HEAD} [data-mobile-view-name]`,'[data-fx-src="od"]','[data-fx-src="gd"]','[data-fx-view-seg]',`${HEAD} .sf-open`];
  await expect(page.locator('[data-fx-src="gd"]')).toBeVisible();
  await expect(page.locator(`${HEAD} .sf-open`)).toBeVisible();
  oneLine(await boxes(page,order),order);
  await expect(page.locator(`${HEAD} [data-mobile-view-name]`)).toHaveText('파일');
  // 따로 된 둘째 줄 없음: 화면 안 위쪽 줄에 출처·보기 단추가 없고, 첫 화면(나무)에서는 그 줄 자리도 없다.
  await expect(page.locator('#filesRoot :is([data-fx-srcs],[data-fx-view-seg])')).toHaveCount(0);
  await expect(page.locator('#filesRoot .fx-top')).toBeHidden();
  // 아이콘 단추는 읽기 이름이 있다.
  for(const sel of ['[data-fx-src="od"]','[data-fx-src="gd"]','button[data-fx-one]','button[data-fx-two]'])await expect(page.locator(sel)).toHaveAttribute('aria-label',/.+/);
  // [두 칸] → 두 칸, [한 칸] → 한 칸.
  await page.locator('button[data-fx-two]').click();
  await expect(page.locator('#filesRoot [data-fx-pane-i="1"]')).toHaveCount(1);
  await expect(page.locator('button[data-fx-two]')).toHaveAttribute('aria-pressed','true');
  await page.locator('button[data-fx-one]').click();
  await expect(page.locator('#filesRoot [data-fx-pane-i="1"]')).toHaveCount(0);
  // 출처 아이콘: 구글 드라이브 끄기 → 꺼짐, 다시 켜기.
  const gd=page.locator('[data-fx-src="gd"]');
  await expect(gd).toHaveAttribute('aria-pressed','true');
  await gd.click();await expect(gd).toHaveAttribute('aria-pressed','false');
  await gd.click();await expect(gd).toHaveAttribute('aria-pressed','true');
  // 찾기: ⌕ → 같은 줄에 칸.
  await page.locator(`${HEAD} .sf-open`).click();
  const input=page.locator('#gsScreenInput');await expect(input).toBeVisible();
  const ib=await input.boundingBox(),hb=await page.locator(HEAD).boundingBox();
  expect(ib.y).toBeGreaterThanOrEqual(hb.y-1);expect(ib.y+ib.height).toBeLessThanOrEqual(hb.y+hb.height+1);
  expect(errors).toEqual([]);
});

test('파일 PC 1280: 출처·보기 단추는 화면 위쪽 도구 줄 그대로',async({page})=>{
  test.setTimeout(60000);
  const {errors}=await start(page,1280);
  await openFiles(page,1280);
  await expect(page.locator('#filesRoot .fx-top [data-fx-srcs] [data-fx-src="od"]')).toBeVisible();
  await expect(page.locator('#filesRoot .fx-top [data-fx-view-seg]')).toBeVisible();
  await page.locator('button[data-fx-two]').click();
  await expect(page.locator('#filesRoot [data-fx-pane-i="1"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
