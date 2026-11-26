import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {screenFind} from './helpers/screen-find.mjs';
// LIB-위쪽한줄(요청함 11/09 11:01, 명진 PC 'B' 11:24 · 폰 '가안' 11:28, 시안 docs/design/mockups/library-top-pc.html·library-top-phone.html):
// 폰·PC 경계는 사업 보고 위쪽과 같은 760px.
// - PC·펼친 폴드(761px~): 위 한 줄 = [폴더 ▾][분류: 전체 ▾] + 오른쪽 끝 [+][⋯] 작은 아이콘(S71-59, 찾기는 상단 줄 칸).
// - 폰(~760px): 첫 줄 = 제목 '자료실' + ⌕·+·⋯, 둘째 줄 = [폴더 ▾][분류: 전체 ▾]. ⌕ → 첫 줄이 [찾기 칸][✕], ✕로 닫음.
// 분류 칩 줄·'✎ 분류 수정' 줄 끝 버튼·묶기 칩 탭·아래 알약·떠 있는 동그란 [+]는 없다. 이름은 지어낸 것.
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A'}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const ITEMS=[{document_id:'a-1',folder_id:'fa'}];
const DOCS=[libDoc('a-1','top-a',{category:'정책',title:'가상 요구안'}),libDoc('a-2','top-a',{category:'투쟁',title:'가상 결의문'}),libDoc('m-1',null,{category:'회의'}),libDoc('n-1',null,{category:'교육',title:'가상 교육 자료'})];
const pick=page=>page.locator('#libraryCategoryPick');
const sheet=page=>page.locator('#libraryCategorySheet');
const row=(page,value)=>sheet(page).locator(`[data-sheet-value="${value}"]`);
const shownDocs=async page=>{await page.locator('#documentList details[data-lu-node]').evaluateAll(xs=>xs.forEach(x=>x.open=true));return page.locator('#documentList [data-lu-document]').evaluateAll(xs=>xs.map(x=>x.dataset.luDocument).sort())};
// 위쪽 칸들의 자리·높이를 한 번에 잰다(그려진 뒤 evaluate 한 번). S70-54: [+]·⋯는 맨 위 줄 단추 자리(.sf-tools), 찾기는 맨 위 칸.
const TOP=['#libraryGroupBy','#libraryCategoryPick','#newDocumentBtn','#libraryTopMenuBtn','#gsTopInput','#gsScreenInput','.mobile-shell-header .sf-open','.mobile-shell-header [data-mobile-view-name]'];
const measure=page=>page.evaluate(sels=>{
  const out={};for(const sel of sels){const el=document.querySelector(sel);if(!el){out[sel]=null;continue}const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    out[sel]={shown:!!el.getClientRects().length&&cs.visibility!=='hidden'&&r.width>1,x:r.x,right:r.right,mid:r.top+r.height/2,h:Math.round(r.height),pos:cs.position,text:el.textContent.trim()}}
  const bar=document.querySelector('#libraryView .lu-search-row').getBoundingClientRect();
  out.bar={x:bar.x,right:bar.right,top:bar.top,bottom:bar.bottom};
  out.fixed=[...document.querySelectorAll('#libraryView *')].filter(el=>el.getClientRects().length&&getComputedStyle(el).position==='fixed'&&!el.closest('.modal,[role="dialog"]')).map(el=>el.id||el.className);
  out.overflow=document.documentElement.scrollWidth-innerWidth;
  return out;
},TOP);

for(const width of [390,884,1440])test(`자료실 ${width}: 찾기는 맨 위 칸 하나, [+]·⋯는 폰 머리 줄·PC 본문 첫 줄 끝, 본문 첫 줄은 [사업영역 ▾][분류 ▾] · 칩 줄·알약·떠 있는 [+] 없음`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS});
  await expect(pick(page)).toHaveText('분류: 회의 빼고');
  // 없앤 것: 분류 칩 줄·줄 끝 [✎ 분류 수정]·묶기 칩 탭(⑤)·이름표. S70-54: 화면 안 찾기 칸·⌕·✕·화면 안 제목 줄도 없다(자리째).
  await expect(page.locator('#libraryCategoryFilter,#manageLibraryBtn,#libraryView .library-filter-toolbar .ds-seg,#libraryView [data-lu-group-chip]')).toHaveCount(0);
  await expect(page.locator('#documentSearch,#librarySearchOpen,#librarySearchClose,#libraryView .lu-top-title')).toHaveCount(0);
  await expect(page.locator('#libraryView .lu-filter-label:visible')).toHaveCount(0);
  await expect(page.locator('#libraryGroupBy option')).toHaveText(['폴더','사업영역','담당조직','분류','월별']);
  await expect(page.locator('#libraryGroupBy option:checked')).toHaveText('사업영역');
  // S56-11: [폴더 ▾]에 공용 ▾ 그림이 보인다(사업 보고 [목록 ▾]·사진 [사진 ▾]와 같은 고르기 상자). 바탕 줄임 표기로 지워지지 않게.
  expect(await page.locator('#libraryGroupBy').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
  // S56-11: [분류 ▾] 단추도 같은 공용 ▾ 그림·자리·바탕·선이다(글자 ▾ 없음).
  const look=sel=>page.locator(sel).evaluate(el=>{const c=getComputedStyle(el);return [c.backgroundImage,c.backgroundPosition,c.backgroundSize,c.backgroundColor,c.borderTopColor,c.borderTopWidth,c.borderRadius,c.height,c.paddingRight].join('|')});
  expect(await look('#libraryView .lu-cat-pick')).toBe(await look('#libraryGroupBy'));
  expect(await page.locator('#libraryView .lu-cat-pick').textContent()).not.toContain('▾');
  // [+]·⋯는 맨 위 줄 단추 자리 안.
  await expect(page.locator('.sf-tools:not([hidden]) #newDocumentBtn')).toBeVisible();await expect(page.locator('.sf-tools:not([hidden]) #libraryTopMenuBtn')).toBeVisible();
  await expect(page.locator(width>760?'#gsTopInput':'.mobile-shell-header .sf-open')).toBeVisible();
  const m=await measure(page);
  // 화면에 떠 있는 것(fixed) 없음: 아래 알약·동그란 [+] 모두 없다. 가로 넘침 없음.
  expect(m.fixed).toEqual([]);expect(m.overflow).toBeLessThanOrEqual(1);
  // 모든 칸은 같은 작은 높이(32px), [+]·⋯은 글자 없는 작은 아이콘.
  for(const sel of ['#libraryGroupBy','#libraryCategoryPick','#newDocumentBtn','#libraryTopMenuBtn'])expect(m[sel].h,sel).toBe(32);
  expect(m['#newDocumentBtn'].text).toBe('');await expect(page.locator('#newDocumentBtn')).toHaveAccessibleName('자료 등록');
  const same=(a,b)=>expect(Math.abs(m[a].mid-m[b].mid),`${a}·${b} 같은 줄`).toBeLessThan(3);
  // 본문 첫 줄 = [사업영역 ▾][분류 ▾](왼쪽 끝부터).
  same('#libraryGroupBy','#libraryCategoryPick');expect(Math.abs(m['#libraryGroupBy'].x-m.bar.x)).toBeLessThan(2);expect(m['#libraryGroupBy'].right).toBeLessThanOrEqual(m['#libraryCategoryPick'].x);
  if(width<=760){
    // 폰: 앱 머리 줄 = 제목 '자료실' ……… ⌕ + ⋯. 고르기 줄은 그 아래.
    await expect(page.locator('#appView > .mobile-shell-header')).toBeVisible();
    const head='.mobile-shell-header [data-mobile-view-name]',open='.mobile-shell-header .sf-open';
    expect(m[head].text).toBe('자료실');
    for(const sel of [open,'#newDocumentBtn','#libraryTopMenuBtn'])same(head,sel);
    expect(m[open].right).toBeLessThanOrEqual(m['#newDocumentBtn'].x);expect(m['#newDocumentBtn'].right).toBeLessThanOrEqual(m['#libraryTopMenuBtn'].x);
    expect(m['#libraryGroupBy'].mid).toBeGreaterThan(m[head].mid+16);
    // ⌕ → 머리 줄에 '자료실에서 찾기' 칸. 쓰는 글자로 목록을 거르고, Esc는 글자를 비운다.
    const find=await screenFind(page);
    await expect(find).toBeVisible();await expect(find).toBeFocused();await expect(find).toHaveAttribute('placeholder','자료실에서 찾기');
    const fb=await find.boundingBox(),mb=await page.locator('#libraryTopMenuBtn').boundingBox();expect(Math.abs((fb.y+fb.height/2)-(mb.y+mb.height/2))).toBeLessThan(3);expect(fb.x+fb.width).toBeLessThanOrEqual(mb.x);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await find.fill('결의');expect(await shownDocs(page)).toEqual(['a-2']);
    await find.press('Escape');await expect(find).toHaveValue('');
    expect(await shownDocs(page)).toEqual(['a-1','a-2','n-1']);
  }else{
    // PC 틀(S71-59 UI-화면메뉴안으로): 찾기는 상단 줄 칸, [+][⋯]는 맨 위 줄이 아니라 본문 첫 줄 [사업영역 ▾][분류 ▾] …… [+][⋯] 오른쪽 끝.
    const find=await screenFind(page);await expect(find).toHaveAttribute('placeholder','자료실에서 찾기');
    for(const sel of ['#newDocumentBtn','#libraryTopMenuBtn'])same('#libraryGroupBy',sel);
    await expect(page.locator('#appView>.app-topline :is(#newDocumentBtn,#libraryTopMenuBtn)')).toHaveCount(0);
    expect(m['#libraryCategoryPick'].right).toBeLessThanOrEqual(m['#newDocumentBtn'].x);expect(m['#newDocumentBtn'].right).toBeLessThanOrEqual(m['#libraryTopMenuBtn'].x);
    expect(m.bar.right-m['#libraryTopMenuBtn'].right).toBeLessThanOrEqual(2);
    expect(m['#libraryGroupBy'].mid).toBeGreaterThan(m['#gsTopInput'].mid+16);
    await find.fill('결의');expect(await shownDocs(page)).toEqual(['a-2']);await find.fill('');
  }
  // [폴더 ▾]: 고르면 묶기가 바뀌고 서버에 기억(지금처럼 library_view.group_by).
  await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
  await expect(page.locator('#libraryGroupBy option:checked')).toHaveText('폴더');
  await expect(page.locator('#documentList details[data-lu-node="f:fa"]')).toHaveCount(1);
  await expect.poll(()=>s.libraryView?.group_by).toBe('folder');
  await page.locator('#libraryGroupBy').selectOption({label:'사업영역'});
  expect(await shownDocs(page)).toEqual(['a-1','a-2','n-1']);
  // [분류 ▾] → 창(폰·PC 모두 단추 아래 작은 창): 지금 켜진 분류가 체크, 회의는 빈 칸, 줄마다 자료 수. [모두 풀기] → 정책·투쟁 → [적용].
  await pick(page).click();
  await expect(sheet(page)).toBeVisible();
  const pb=await pick(page).boundingBox(),sb=await sheet(page).boundingBox();expect(sb.y).toBeGreaterThanOrEqual(pb.y+pb.height-1);
  await expect(row(page,'회의')).toHaveAttribute('aria-pressed','false');await expect(row(page,'정책')).toHaveAttribute('aria-pressed','true');
  await expect(row(page,'정책').locator('[data-lu-cat-count]')).toHaveText('1');await expect(row(page,'회의').locator('[data-lu-cat-count]')).toHaveText('1');await expect(row(page,'교섭').locator('[data-lu-cat-count]')).toHaveText('0');
  await sheet(page).locator('[data-lu-cat-clear]').click();
  await expect(row(page,'all')).toHaveAttribute('aria-pressed','true');await expect(row(page,'정책')).toHaveAttribute('aria-pressed','false');
  await row(page,'정책').click();await row(page,'투쟁').click();
  await expect(sheet(page).locator('[data-sheet-count]')).toHaveText('2개 선택됨');
  if(width<=760){const tabs=await page.locator('.mobile-tabs').boundingBox(),now=await sheet(page).boundingBox();expect(now.y+now.height).toBeLessThanOrEqual(tabs.y+1)}
  await sheet(page).locator('[data-sheet-save]').click();
  await expect(sheet(page)).toBeHidden();
  await expect(pick(page)).toHaveText('분류: 투쟁 외 1');
  expect(await shownDocs(page)).toEqual(['a-1','a-2']);
  await expect.poll(()=>s.libraryView?.categories_off?.length).toBeGreaterThan(0);
  expect(s.libraryView.categories_off).not.toContain('정책');expect(s.libraryView.categories_off).not.toContain('투쟁');expect(s.libraryView.categories_off).toContain('회의');
  // [취소]는 바꾸지 않는다. [전체] 줄 = 모두.
  await pick(page).click();await row(page,'all').click();await sheet(page).locator('[data-sheet-cancel]').click();
  await expect(pick(page)).toHaveText('분류: 투쟁 외 1');
  await pick(page).click();await row(page,'all').click();await sheet(page).locator('[data-sheet-save]').click();
  await expect(pick(page)).toHaveText('분류: 전체');
  await expect.poll(()=>s.libraryView?.categories_off).toEqual([]);
  // '✎ 분류 수정' = 분류 수정 창(창 아래 줄 하나뿐).
  await pick(page).click();await expect(sheet(page).getByRole('button',{name:'분류 수정',exact:true})).toHaveCount(1);
  await sheet(page).locator('[data-lu-cat-edit]').click();
  await expect(sheet(page)).toBeHidden();await expect(page.locator('#libraryManageModal')).toBeVisible();
  await page.locator('#libraryManageClose').click();await expect(page.locator('#libraryManageModal')).toBeHidden();
  // 작은 [+] = 지금 자료 등록 창 그대로.
  if(width<=760)await expect(page.locator('#newDocumentBtn')).toBeVisible();
  await page.locator('#newDocumentBtn').click();await expect(page.locator('#documentModal')).toBeVisible();
  await page.screenshot({path:`test-results/library-top-row-${width}.png`});
  expect(errors).toEqual([]);
});

test('자료실 폰 412: [분류 ▾] 창 소분류는 들여 쓴 줄, 선택하면 그 소분류만',async({page})=>{
  test.setTimeout(60000);
  const docs=[libDoc('w-1',null,{category:'주간보고›확정본'}),libDoc('w-2',null,{category:'주간보고›개인본'}),libDoc('p-1',null,{category:'정책'})];
  const {errors}=await bootLibrary(page,412,{docs});
  await page.evaluate(async()=>{const m=await import('./document-categories.js');m.setDocumentCategories(['교섭','투쟁','교육','선전','정책','회의','주간보고','주간보고›확정본','주간보고›개인본','기타'])});
  await pick(page).click();
  const sub=row(page,'sub:주간보고›확정본');await expect(sub).toBeVisible();await expect(sub).toHaveAttribute('data-depth','1');
  await sub.click();
  await expect(row(page,'주간보고')).toHaveAttribute('aria-pressed','true');await expect(row(page,'정책')).toHaveAttribute('aria-pressed','false');
  await sheet(page).locator('[data-sheet-save]').click();
  await expect(pick(page)).toHaveText('분류: 주간보고 › 확정본');
  expect(await shownDocs(page)).toEqual(['w-1']);
  expect(errors).toEqual([]);
});

test('자료실 폰 390: 머리 줄 ⌕로 찾기 칸을 펼치고, 비운 채 Esc면 접힘, 다른 화면이 자료실을 조직으로 걸러 열면 찾기 글자는 빔',async({page})=>{
  test.setTimeout(60000);
  const {errors}=await bootLibrary(page,390,{folders:FOLDERS,items:ITEMS,docs:DOCS});
  const head=page.locator('#appView > .mobile-shell-header'),open=head.locator('.sf-open'),name=head.locator('[data-mobile-view-name]');
  await expect(page.locator('#gsScreenInput')).toBeHidden();await expect(name).toHaveText('자료실');
  let find=await screenFind(page);await find.fill('요구');
  expect(await shownDocs(page)).toEqual(['a-1']);await expect(name).toBeHidden();
  // 글자를 지워도 칸에 있는 동안은 펼친 채.
  await find.fill('');await expect(find).toBeVisible();
  await page.keyboard.press('Escape');await expect(find).toBeHidden();await expect(open).toBeVisible();await expect(name).toBeVisible();
  // 다른 화면이 자료실을 조직으로 걸러 열면 찾기 글자는 빈다.
  find=await screenFind(page);await find.fill('가상');
  await page.evaluate(()=>window.KPTURouter.go('home'));await page.evaluate(()=>{window.KPTULibrary.showOrganization('org-1','가상 지부');window.KPTURouter.go('library')});
  await expect(page.locator('#gsScreenInput')).toHaveValue('');
  expect(errors).toEqual([]);
});
