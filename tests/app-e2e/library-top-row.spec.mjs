import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
// LIB-위쪽한줄(요청함 11/09 11:01, 명진 PC 'B' 11:24 · 폰 '가안' 11:28, 시안 docs/design/mockups/library-top-pc.html·library-top-phone.html):
// 폰·PC 경계는 사업 보고 위쪽과 같은 760px.
// - PC·펼친 폴드(761px~): 위 한 줄 = [폴더 ▾][분류: 전체 ▾][찾기 칸] + 오른쪽 끝 [+][⋯] 작은 아이콘.
// - 폰(~760px): 첫 줄 = 제목 '자료실' + ⌕·+·⋯, 둘째 줄 = [폴더 ▾][분류: 전체 ▾]. ⌕ → 첫 줄이 [찾기 칸][✕], ✕로 닫음.
// 분류 칩 줄·'✎ 분류 수정' 줄 끝 버튼·묶기 칩 탭·아래 알약·떠 있는 동그란 [+]는 없다. 이름은 지어낸 것.
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A'}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const ITEMS=[{document_id:'a-1',folder_id:'fa'}];
const DOCS=[libDoc('a-1','top-a',{category:'정책',title:'가상 요구안'}),libDoc('a-2','top-a',{category:'투쟁',title:'가상 결의문'}),libDoc('m-1',null,{category:'회의'}),libDoc('n-1',null,{category:'교육',title:'가상 교육 자료'})];
const pick=page=>page.locator('#libraryCategoryPick');
const sheet=page=>page.locator('#libraryCategorySheet');
const row=(page,value)=>sheet(page).locator(`[data-sheet-value="${value}"]`);
const shownDocs=async page=>{await page.locator('#documentList details[data-lu-node]').evaluateAll(xs=>xs.forEach(x=>x.open=true));return page.locator('#documentList [data-lu-document]').evaluateAll(xs=>xs.map(x=>x.dataset.luDocument).sort())};
// 위쪽 칸들의 자리·높이를 한 번에 잰다(그려진 뒤 evaluate 한 번).
const TOP=['.lu-top-title','#libraryGroupBy','#libraryCategoryPick','#documentSearch','#librarySearchOpen','#librarySearchClose','#newDocumentBtn','#libraryTopMenuBtn'];
const measure=page=>page.evaluate(sels=>{
  const out={};for(const sel of sels){const el=document.querySelector('#libraryView '+sel);if(!el){out[sel]=null;continue}const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    out[sel]={shown:!!el.getClientRects().length&&cs.visibility!=='hidden'&&r.width>1,x:r.x,right:r.right,mid:r.top+r.height/2,h:Math.round(r.height),pos:cs.position,text:el.textContent.trim()}}
  const card=document.querySelector('#libraryListCard').getBoundingClientRect(),bar=document.querySelector('#libraryView .lu-search-row').getBoundingClientRect();
  out.card={x:card.x,right:card.right};out.bar={x:bar.x,right:bar.right,top:bar.top,bottom:bar.bottom};
  out.fixed=[...document.querySelectorAll('#libraryView *')].filter(el=>el.getClientRects().length&&getComputedStyle(el).position==='fixed'&&!el.closest('.modal,[role="dialog"]')).map(el=>el.id||el.className);
  out.overflow=document.documentElement.scrollWidth-innerWidth;
  return out;
},TOP);

for(const width of [390,884,1440])test(`자료실 ${width}: ${width<=760?'폰 두 줄(제목 ⌕ + ⋯ / [폴더 ▾][분류 ▾])':'한 줄([폴더 ▾][분류 ▾][찾기] + ⋯)'} · 칩 줄·알약·떠 있는 [+] 없음`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS});
  await expect(pick(page)).toHaveText('분류: 회의 빼고');
  // 없앤 것: 분류 칩 줄·줄 끝 [✎ 분류 수정]·묶기 칩 탭(⑤)·이름표.
  await expect(page.locator('#libraryCategoryFilter,#manageLibraryBtn,#libraryView .library-filter-toolbar .ds-seg,#libraryView [data-lu-group-chip]')).toHaveCount(0);
  await expect(page.locator('#libraryView .lu-filter-label:visible')).toHaveCount(0);
  await expect(page.locator('#libraryGroupBy option')).toHaveText(['폴더','사업영역','담당조직','분류','월별']);
  await expect(page.locator('#libraryGroupBy option:checked')).toHaveText('사업영역');
  // S56-11: [폴더 ▾]에 공용 ▾ 그림이 보인다(사업 보고 [목록 ▾]·사진 [사진 ▾]와 같은 고르기 상자). 바탕 줄임 표기로 지워지지 않게.
  expect(await page.locator('#libraryGroupBy').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
  const m=await measure(page);
  // 화면에 떠 있는 것(fixed) 없음: 아래 알약·동그란 [+] 모두 없다. 가로 넘침 없음.
  expect(m.fixed).toEqual([]);expect(m.overflow).toBeLessThanOrEqual(1);
  // 모든 칸은 같은 작은 높이(32px), [+]·⋯은 글자 없는 작은 아이콘.
  for(const sel of ['#libraryGroupBy','#libraryCategoryPick','#newDocumentBtn','#libraryTopMenuBtn'])expect(m[sel].h,sel).toBe(32);
  expect(m['#newDocumentBtn'].text).toBe('');await expect(page.locator('#newDocumentBtn')).toHaveAccessibleName('자료 등록');
  const same=(a,b)=>expect(Math.abs(m[a].mid-m[b].mid),`${a}·${b} 같은 줄`).toBeLessThan(3);
  if(width<=760){
    // 폰: 앱 머리줄은 숨고 첫 줄이 제목. 제목 ……… ⌕ + ⋯ (오른쪽 끝), 둘째 줄 [폴더 ▾][분류 ▾](왼쪽 끝).
    await expect(page.locator('#appView > .mobile-shell-header')).toBeHidden();
    expect(m['.lu-top-title'].shown).toBe(true);expect(m['.lu-top-title'].text).toBe('자료실');
    expect(m['#documentSearch'].shown).toBe(false);expect(m['#librarySearchClose'].shown).toBe(false);expect(m['#librarySearchOpen'].h).toBe(32);
    for(const sel of ['#librarySearchOpen','#newDocumentBtn','#libraryTopMenuBtn'])same('.lu-top-title',sel);
    expect(m['.lu-top-title'].right).toBeLessThanOrEqual(m['#librarySearchOpen'].x);expect(m['#librarySearchOpen'].right).toBeLessThanOrEqual(m['#newDocumentBtn'].x);expect(m['#newDocumentBtn'].right).toBeLessThanOrEqual(m['#libraryTopMenuBtn'].x);
    expect(Math.abs(m.bar.right-m['#libraryTopMenuBtn'].right)).toBeLessThan(2);
    same('#libraryGroupBy','#libraryCategoryPick');expect(m['#libraryGroupBy'].mid).toBeGreaterThan(m['.lu-top-title'].mid+16);
    expect(Math.abs(m['#libraryGroupBy'].x-m.bar.x)).toBeLessThan(2);expect(m['#libraryGroupBy'].right).toBeLessThanOrEqual(m['#libraryCategoryPick'].x);
    // ⌕ → 첫 줄이 [찾기 칸][✕]. 쓰는 글자로 목록을 거르고, ✕는 글자를 비우고 닫는다.
    await page.locator('#librarySearchOpen').click();
    await expect(page.locator('#documentSearch')).toBeVisible();await expect(page.locator('#documentSearch')).toBeFocused();
    await expect(page.locator('#librarySearchClose')).toBeVisible();await expect(page.locator('.lu-top-title')).toBeHidden();await expect(page.locator('#librarySearchOpen')).toBeHidden();
    const f=await measure(page);same('#documentSearch','#librarySearchClose');expect(f['#documentSearch'].h).toBe(32);
    expect(f['#documentSearch'].mid).toBeLessThan(f['#libraryGroupBy'].mid-16);expect(f.overflow).toBeLessThanOrEqual(1);
    await page.locator('#documentSearch').fill('결의');expect(await shownDocs(page)).toEqual(['a-2']);
    await page.locator('#librarySearchClose').click();
    await expect(page.locator('#documentSearch')).toBeHidden();await expect(page.locator('#documentSearch')).toHaveValue('');await expect(page.locator('.lu-top-title')).toBeVisible();
    await expect(page.locator('#librarySearchOpen')).toBeFocused();
    expect(await shownDocs(page)).toEqual(['a-1','a-2','n-1']);
  }else{
    // PC·펼친 폴드: 한 줄. [폴더 ▾][분류 ▾][찾기 칸 ……][+][⋯], 제목은 읽기 프로그램용(위쪽 경로 줄이 이름을 보임), ⌕·✕ 없음.
    expect(m['.lu-top-title'].shown).toBe(false);await expect(page.getByRole('heading',{name:'자료실'}).first()).toBeAttached();
    expect(m['#librarySearchOpen'].shown).toBe(false);expect(m['#librarySearchClose'].shown).toBe(false);
    for(const sel of ['#libraryCategoryPick','#documentSearch','#newDocumentBtn','#libraryTopMenuBtn'])same('#libraryGroupBy',sel);
    expect(m['#documentSearch'].h).toBe(32);
    const order=['#libraryGroupBy','#libraryCategoryPick','#documentSearch','#newDocumentBtn','#libraryTopMenuBtn'];
    for(let i=1;i<order.length;i++)expect(m[order[i-1]].right,`${order[i-1]} → ${order[i]}`).toBeLessThanOrEqual(m[order[i]].x);
    expect(Math.abs(m['#libraryGroupBy'].x-m.bar.x)).toBeLessThan(2);expect(Math.abs(m.bar.right-m['#libraryTopMenuBtn'].right)).toBeLessThan(2);
    // 찾기 칸은 남는 폭을 쓴다.
    expect(m['#documentSearch'].right-m['#documentSearch'].x).toBeGreaterThan(width>=1200?400:200);
    await page.locator('#documentSearch').fill('결의');expect(await shownDocs(page)).toEqual(['a-2']);await page.locator('#documentSearch').fill('');
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

test('자료실 폰 390: 찾는 글자가 들어 있으면 찾기 칸은 열린 채, 화면을 다시 들어오면 닫힌 첫 줄',async({page})=>{
  test.setTimeout(60000);
  const {errors}=await bootLibrary(page,390,{folders:FOLDERS,items:ITEMS,docs:DOCS});
  await page.locator('#librarySearchOpen').click();await page.locator('#documentSearch').fill('요구');
  expect(await shownDocs(page)).toEqual(['a-1']);
  // 글자를 지워도 ✕를 누르기 전에는 열린 채(찾는 중).
  await page.locator('#documentSearch').fill('');await expect(page.locator('#documentSearch')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#documentSearch')).toBeHidden();await expect(page.locator('.lu-top-title')).toBeVisible();
  // 다른 화면이 자료실을 조직으로 걸러 열면 찾기 글자는 비고 첫 줄은 제목.
  await page.locator('#librarySearchOpen').click();await page.locator('#documentSearch').fill('가상');
  await page.evaluate(()=>window.KPTURouter.go('home'));await page.evaluate(()=>{window.KPTULibrary.showOrganization('org-1','가상 지부');window.KPTURouter.go('library')});
  await expect(page.locator('#documentSearch')).toHaveValue('');await expect(page.locator('#documentSearch')).toBeHidden();await expect(page.locator('.lu-top-title')).toBeVisible();
  expect(errors).toEqual([]);
});
