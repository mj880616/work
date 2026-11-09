import { appOrigin } from './helpers/test-origin.mjs';
// LIB-목록간격(줄 여백·종류 꼬리표·폴더 줄 글자·폰 두 줄) · LIB-거르기전체([분류 ▾] 창 [전체]·'선택한 분류 없음') · LIB-보기기억(묶기·종류 칩을 프로필 칸에 서버 저장, PC와 폰이 같게 열림).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {expandLibraryTree} from './helpers/library-tree.mjs';
import {toggleLibraryCategory,pickLibraryCategories,readLibraryCategories} from './helpers/library-categories.mjs';

const OPEN=`${appOrigin}/tests/app-e2e/library-open-fixture.html`;
const doc=(id,title,category,date,file,pid='top-a',extra={})=>({id,workspace_id:'workspace-1',project_id:pid,title,file_name:file,category,document_date:date,tags:[],drive_url:OPEN,created_at:'2026-10-01T00:00:00Z',...extra});
const folder=(id,name,parent,project='top-a',order=1)=>({id,workspace_id:'workspace-1',project_id:project,parent_id:parent,name,sort_order:order,created_at:`2026-10-01T00:00:0${order}Z`});
function state(extra={}){
  const s=baseState();
  s.docs=[
    doc('d1','단체교섭 요구안','교섭','2026-10-15','a.hwp'),
    doc('d2','보도자료 초안','선전','2026-10-14','b.pdf'),
    doc('d3','예산 집행 현황표','정책','2026-10-12','c.xlsx'),
    doc('d4','국토부 면담 결과','정책','2026-10-10','d.docx','child-a1'),
    doc('d5','산자부 회의 자료','회의','2026-10-09','e.pptx','child-a2'),
    doc('d6','폴더 속 자료 하나','정책','2026-10-06','h.hwp'),
    doc('d7','폴더 속 자료 둘','정책','2026-10-05','i.pdf'),
    doc('d8','참고 압축 파일','기타','2026-10-07','g.zip',null)
  ];
  s.folders=[folder('f1','교섭 자료',null),folder('f2','본교섭','f1'),folder('f3','임시 보관',null,null)];
  s.folderItems=[{document_id:'d6',folder_id:'f1'},{document_id:'d7',folder_id:'f2'},{document_id:'d8',folder_id:'f3'}];
  return Object.assign(s,extra);
}
async function boot(page,width,{s=state(),expand=true}={}){
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text())});
  await mockApp(page,s);await signIn(page,`${appOrigin}/app/?view=library`);
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
  await page.evaluate(()=>window.__KPTU_LIBRARY_UPLOAD_READY__);
  if(expand){await expandLibraryTree(page);await expect(page.locator('#documentList .lu-row').first()).toBeVisible()}
  return {s,errors};
}
const rows=page=>page.locator('#documentList [data-lu-document]');
const ids=page=>rows(page).evaluateAll(els=>els.map(el=>el.dataset.luDocument).sort());
// LIB-위쪽한줄(11/09 명진 B·가안): 분류 칩 줄은 없고 위 줄 [분류: … ▾] 하나. 상태는 단추 글자(늘 보임)로 보고, 바꾸기는 그 창에서 한다.
const pick=page=>page.locator('#libraryCategoryPick');
const sheet=page=>page.locator('#libraryCategorySheet');
const sheetRow=(page,value)=>sheet(page).locator(`[data-sheet-value="${value}"]`);
const px=(el,prop)=>el.evaluate((e,p)=>parseFloat(getComputedStyle(e)[p]),prop);
const css=(el,prop)=>el.evaluate((e,p)=>getComputedStyle(e)[p],prop);
// 서버 저장이 끝날 때까지(0.4초 모음 뒤 PATCH) 기다린다.
const saved=(s,n)=>expect.poll(()=>(s.profilePatches||[]).length,{timeout:5000}).toBe(n);

for(const width of [1280,390])test(`LIB-목록간격: 자료 줄 여백 절반·종류 꼬리표·폴더 줄 글자와 들여쓰기 ${width}`,async({page})=>{
  const {errors}=await boot(page,width);
  const row=rows(page).first(),kind=row.locator('.lu-file-kind'),title=row.locator('.lu-row-title');
  // ① 위아래 여백은 예전(9px)의 절반, 글자 크기는 그대로(이름 13px·날짜 12px 이하), 최소 높이 44px 상자 없음.
  expect(await px(row,'paddingTop')).toBeCloseTo(4.5,1);expect(await px(row,'paddingBottom')).toBeCloseTo(4.5,1);
  await expect(title).toHaveCSS('font-size','13px');
  // 순서: 종류 · 분류 · 제목 · 날짜 (PC는 한 줄 가로, 폰은 아래 줄 [종류 분류 · 날짜]).
  const order=await row.evaluate(el=>[...el.children].filter(c=>/lu-(file-kind|row-tag|row-title|row-date)/.test(c.className)).map(c=>c.className.split(' ')[0]));
  expect(order).toEqual(['lu-file-kind','lu-row-tag','lu-row-title','lu-row-date']);
  if(width>=761){
    // 종류는 36px 상자가 아니라 작은 꼬리표(높이 18px 이하), 줄은 한 줄 높이(40px 안).
    expect((await kind.boundingBox()).height).toBeLessThanOrEqual(20);expect((await kind.boundingBox()).width).toBeLessThan(48);
    expect((await row.boundingBox()).height).toBeLessThanOrEqual(36);
    const tops=await row.evaluate(el=>[...el.querySelectorAll('.lu-file-kind,.lu-row-tag,.lu-row-title,.lu-row-date')].map(c=>Math.round(c.getBoundingClientRect().top+c.getBoundingClientRect().height/2)));
    expect(Math.max(...tops)-Math.min(...tops)).toBeLessThanOrEqual(2);
  }else{
    // ③ 폰: 위 이름, 아래 작은 글씨 '분류 · 날짜'. 이름이 날짜보다 위, 날짜는 분류 오른쪽 같은 줄, '·' 구분.
    const t=await title.boundingBox(),k=await kind.boundingBox(),tag=await row.locator('.lu-row-tag').boundingBox(),d=await row.locator('.lu-row-date').boundingBox();
    const mid=b=>b.y+b.height/2;expect(k.y).toBeGreaterThan(t.y+t.height-2);expect(Math.abs(mid(tag)-mid(k))).toBeLessThanOrEqual(3);expect(Math.abs(mid(d)-mid(tag))).toBeLessThanOrEqual(3);expect(d.x).toBeGreaterThan(tag.x+tag.width-1);
    expect(await row.locator('.lu-row-date').evaluate(e=>getComputedStyle(e,'::before').content)).toBe('"·"');
    await expect(row.locator('.lu-row-tag .doc-category-tag')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    expect(await px(row.locator('.lu-row-date'),'fontSize')).toBeLessThanOrEqual(12);expect(await px(row.locator('.lu-row-tag .doc-category-tag'),'fontSize')).toBeLessThanOrEqual(12);
  }
  // 줄 안 단추는 작게 보이지만 누르는 범위는 44px.
  const more=row.locator('.lu-more-trigger');expect((await more.boundingBox()).height).toBeLessThanOrEqual(width>=761?24:32);
  expect(await more.evaluate(e=>parseFloat(getComputedStyle(e,'::after').height))).toBe(44);
  // ② 폴더 줄: 자료 줄 이름과 같은 글자 크기, 맨 위 단(프로젝트·'프로젝트 없음')만 굵게, 하위·폴더는 보통 굵기, 단마다 들여 쓰기, 줄 간격은 예전(32px)보다 넓음.
  const head=key=>page.locator(`#documentList details[data-lu-node="${key}"] > summary`);
  const titleSize=await px(title,'fontSize');
  for(const key of ['p:top-a','p:none','p:child-a1','f:f1','f:f2','f:f3']){await expect(head(key)).toBeVisible();expect(await px(head(key),'fontSize')).toBe(titleSize)}
  for(const key of ['p:top-a','p:top-b','p:none'])expect(Number(await css(head(key),'fontWeight'))).toBeGreaterThanOrEqual(700);
  for(const key of ['p:child-a1','f:f1','f:f2','f:f3'])expect(Number(await css(head(key),'fontWeight'))).toBe(400);
  const step=width>=761?16:12;
  expect(await px(head('p:top-a'),'paddingLeft')).toBe(0);expect(await px(head('p:child-a1'),'paddingLeft')).toBe(step);
  expect(await px(head('f:f1'),'paddingLeft')).toBe(step);expect(await px(head('f:f2'),'paddingLeft')).toBe(step*2);
  expect((await head('f:f1').boundingBox()).height).toBeGreaterThanOrEqual(36);expect((await head('p:top-a').boundingBox()).height).toBeGreaterThanOrEqual(36);
  // 지금 파일 줄 자체는 바뀌지 않음: 열면 여전히 같은 열기 길(줄 role=button).
  await expect(row).toHaveAttribute('role','button');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

// LIB-위쪽한줄: [분류 ▾] 창(공용 고르기 창)은 PC 폭에서도 단추 아래 작은 창. 줄마다 자료 수, [전체]·[모두 풀기], 아무것도 안 고르면 전체.
for(const width of [1280,884])test(`LIB-거르기전체: [분류 ▾] 창 [전체]·자료 수·여러 개 선택과 '선택한 분류 없음' ${width}`,async({page})=>{
  const {errors}=await boot(page,width);
  // 처음: [회의]만 꺼짐.
  await expect(pick(page)).toHaveText('분류: 회의 빼고');expect(await ids(page)).not.toContain('d5');
  await pick(page).click();await expect(sheet(page)).toBeVisible();
  await expect(sheetRow(page,'all')).toHaveAttribute('aria-pressed','false');await expect(sheetRow(page,'회의')).toHaveAttribute('aria-pressed','false');await expect(sheetRow(page,'정책')).toHaveAttribute('aria-pressed','true');
  // 줄 끝 자료 수: 분류로 거르기 전 수(꺼 둔 [회의]도 1), 0도 보인다. [전체]는 합.
  await expect(sheetRow(page,'정책').locator('[data-lu-cat-count]')).toHaveText('4');await expect(sheetRow(page,'회의').locator('[data-lu-cat-count]')).toHaveText('1');
  await expect(sheetRow(page,'투쟁').locator('[data-lu-cat-count]')).toHaveText('0');await expect(sheetRow(page,'all').locator('[data-lu-cat-count]')).toHaveText('8');
  // 창은 단추 바로 아래.
  const b=await pick(page).boundingBox(),w=await sheet(page).boundingBox();expect(w.y).toBeGreaterThanOrEqual(b.y+b.height-1);expect(w.y-(b.y+b.height)).toBeLessThan(16);
  // [전체] 줄 → 모두 켬.
  await sheetRow(page,'all').click();await expect(sheetRow(page,'all')).toHaveAttribute('aria-pressed','true');
  await sheet(page).locator('[data-sheet-save]').click();await expect(sheet(page)).toBeHidden();
  await expect(pick(page)).toHaveText('분류: 전체');expect(await ids(page)).toContain('d5');await expect(rows(page)).toHaveCount(8);
  // 정책 하나만 → 그 분류만.
  await pickLibraryCategories(page,['정책']);await expect(pick(page)).toHaveText('분류: 정책');expect(await ids(page)).toEqual(['d3','d4','d6','d7']);
  // 검색어가 있으면 꺼진 분류 안내('꺼져 있어요')는 그대로 따로 나온다.
  await page.locator('#documentSearch').fill('보도');
  await expect(page.locator('.lu-off-hint')).toContainText('선전 분류 1건은 꺼져 있어요');
  // 없는 자료를 찾는 평소 빈 목록은 예전 문구 그대로.
  await pickLibraryCategories(page,[]);await page.locator('#documentSearch').fill('없는검색어zzz');await expect(page.locator('#documentList [data-wait-empty]')).toHaveText('없음');
  // 키보드: 단추·창 줄은 버튼이라 Enter로 열고 고르고, [적용]도 Enter.
  await page.locator('#documentSearch').fill('');await pick(page).focus();await page.keyboard.press('Enter');await expect(sheet(page)).toBeVisible();
  await sheetRow(page,'교섭').focus();await page.keyboard.press('Enter');await expect(sheetRow(page,'교섭')).toHaveAttribute('aria-pressed','true');
  await sheet(page).locator('[data-sheet-save]').focus();await page.keyboard.press('Enter');await expect(pick(page)).toHaveText('분류: 교섭');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

for(const width of [1280,884])test(`LIB-보기기억: 묶기·분류를 프로필 칸에 서버 저장하고 다음에 같게 열림(PC와 폰 같은 상태) ${width}`,async({page,browser})=>{
  const s=state();
  const {errors}=await boot(page,width,{s});
  // 처음 열 때 서버에서 읽는다(내 프로필 행 하나, library_view 칸). 비어 있으면 기본.
  await expect.poll(()=>(s.profileReads||[]).some(q=>/select=library_view/.test(q))).toBe(true);
  await expect(pick(page)).toHaveText('분류: 회의 빼고');await expect(page.locator('#libraryGroupBy option:checked')).toHaveText('사업영역');
  expect(s.profilePatches||[]).toEqual([]);
  // 분류를 고르면 서버에 꺼 둔 분류 이름 목록만 저장(묶기는 건드리지 않음).
  await toggleLibraryCategory(page,'회의');await expect(pick(page)).toHaveText('분류: 전체');await saved(s,1);
  expect(s.profilePatches[0]).toEqual({library_view:{categories_off:[]}});
  await toggleLibraryCategory(page,'교섭');await saved(s,2);
  expect(s.profilePatches[1]).toEqual({library_view:{categories_off:['교섭']}});
  // 묶기를 바꾸면 묶기 칸을 더하고 분류는 기억해 둔 값 그대로.
  await page.locator('#libraryGroupBy').selectOption('category');await saved(s,3);
  expect(s.profilePatches[2]).toEqual({library_view:{group_by:'category',categories_off:['교섭']}});
  // 창 안에서 여러 번 눌러도 [적용] 때의 마지막 상태 하나만 저장된다.
  await pick(page).click();for(const n of ['정책','기타','정책'])await sheetRow(page,n).click();await sheet(page).locator('[data-sheet-save]').click();await saved(s,4);
  expect(s.profilePatches[3]).toEqual({library_view:{group_by:'category',categories_off:['교섭','기타']}});
  // 검색어·펼침은 기억하지 않는다: 저장 값에 그 칸이 없다.
  expect(Object.keys(s.libraryView).sort()).toEqual(['categories_off','group_by']);
  // 브라우저 기기 저장소에는 아무것도 남기지 않는다.
  expect(await page.evaluate(()=>Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter(k=>/library|group|categor|filter/i.test(k)))).toEqual([]);
  // 새로 열면(다른 기기 = 새 브라우저) 같은 묶기·같은 분류 상태. 서버 값만 읽는다.
  for(const w of [1280,390]){
    const other=await browser.newPage();await other.emulateMedia({colorScheme:'light'});
    const o=await boot(other,w,{s,expand:false});
    await expect(other.locator('#libraryGroupBy option:checked')).toHaveText('분류');
    await expect(pick(other)).toHaveText('분류: 교섭·기타 빼고');
    const st=await readLibraryCategories(other);expect(st.names.filter(n=>!st.on.includes(n))).toEqual(['교섭','기타']);
    expect(o.errors).toEqual([]);await other.close();
  }
  expect(errors).toEqual([]);
});

test('LIB-보기기억: 같은 화면에 머물며 열어도 다른 기기에서 바꾼 값을 읽어 맞춘다(선택하는 중이면 덮지 않음)',async({page})=>{
  const s=state({libraryView:{group_by:'month',categories_off:['정책']}});
  await boot(page,1280,{s,expand:false});
  await expect(page.locator('#libraryGroupBy option:checked')).toHaveText('월별');await expect(pick(page)).toHaveText('분류: 정책 빼고');
  // 다른 기기가 서버 값을 바꾼 뒤 이 화면에 다시 들어오면 맞춘다.
  s.libraryView={group_by:'organization',categories_off:['기타']};
  await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('library'));
  await expect(page.locator('#libraryGroupBy option:checked')).toHaveText('담당조직');await expect(pick(page)).toHaveText('분류: 기타 빼고');
  expect(s.profilePatches||[]).toEqual([]);
  // 서버 값이 비면(null) 기본으로 돌아온다.
  s.libraryView=null;await page.evaluate(()=>window.KPTURouter.go('home'));await page.evaluate(()=>window.KPTURouter.go('library'));
  await expect(page.locator('#libraryGroupBy option:checked')).toHaveText('사업영역');await expect(pick(page)).toHaveText('분류: 회의 빼고');
  // 읽는 중에 사용자가 이미 분류를 바꿨으면 서버 값으로 덮지 않는다.
  s.libraryView={categories_off:['기타']};await page.evaluate(()=>window.KPTURouter.go('home'));
  await page.route('**/rest/v1/app_profiles?*select=library_view*',async route=>{await new Promise(r=>setTimeout(r,1500));await route.fallback()});
  await page.evaluate(()=>window.KPTURouter.go('library'));await pick(page).click();await sheetRow(page,'all').click();await sheetRow(page,'교육').click();await sheet(page).locator('[data-sheet-save]').click();
  await expect(pick(page)).toHaveText('분류: 교육');await page.waitForTimeout(1800);await expect(pick(page)).toHaveText('분류: 교육');
});

test('LIB-보기기억: 다른 화면이 담당조직으로 열면 모두 켠 채 열리고 그 상태는 저장하지 않는다',async({page})=>{
  const s=state({libraryView:{categories_off:['정책']}});
  await boot(page,1280,{s,expand:false});
  await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();
  await page.evaluate(()=>{window.KPTULibrary.showOrganization('org-1','가상 지부');window.KPTURouter.go('library')});
  await expect(page.locator('#libraryOrganizationFilter')).toBeVisible();await expect(pick(page)).toHaveText('분류: 전체');
  await page.waitForTimeout(800);expect(s.profilePatches||[]).toEqual([]);expect(s.libraryView).toEqual({categories_off:['정책']});
  // 그다음 평소처럼 들어오면 기억해 둔 상태.
  await page.evaluate(()=>window.KPTURouter.go('home'));await page.evaluate(()=>window.KPTURouter.go('library'));
  await expect(pick(page)).toHaveText('분류: 정책 빼고');
});

test('LIB-보기기억: 칸이 아직 없는 서버(적용 전)나 저장 실패에서도 기본값으로 그대로 동작한다',async({page})=>{
  const s=state({libraryViewMissing:true});
  const {errors}=await boot(page,1280,{s});
  await expect(pick(page)).toHaveText('분류: 회의 빼고');await expect(page.locator('#libraryGroupBy option:checked')).toHaveText('사업영역');
  await toggleLibraryCategory(page,'회의');await expect(pick(page)).toHaveText('분류: 전체');expect(await ids(page)).toContain('d5');
  await page.locator('#libraryGroupBy').selectOption('month');await expect(page.locator('#libraryGroupBy option:checked')).toHaveText('월별');
  await page.waitForTimeout(900);
  // 저장 실패(서버 500)도 화면은 그대로.
  s.libraryViewMissing=false;s.libraryViewFail=true;const before=(s.profilePatches||[]).length;
  await toggleLibraryCategory(page,'교섭');await expect(pick(page)).toHaveText('분류: 교섭 빼고');await saved(s,before+1);
  await page.waitForTimeout(300);await expect(pick(page)).toHaveText('분류: 교섭 빼고');
  expect(errors).toEqual([]);
});

test('LIB-보기기억: 프로젝트 상세에서 자료 전체 보기로 들어와도 기억해 둔 분류 상태로 열린다',async({page})=>{
  const s=state({libraryView:{categories_off:['정책']}});
  await boot(page,1280,{s,expand:false});
  await expect(pick(page)).toHaveText('분류: 정책 빼고');
  await page.evaluate(()=>window.KPTURouter.go('projects'));await expect(page.locator('#projectsView')).toBeVisible();
  await page.locator('[data-ps3-project="top-a"]').first().click();
  await page.locator('[data-ps3-library]').click();
  await expect(page.locator('#libraryView')).toBeVisible();await expect(page.locator('#documentProject')).toHaveJSProperty('value','top-a');
  await expect(pick(page)).toHaveText('분류: 정책 빼고');
  expect(s.profilePatches||[]).toEqual([]);
});

// LIB-폴더보기 묶기 순서(2026-10-28 08:25 ②, 11:53 결정 ①) → LIB-위쪽한줄(11/09): 묶기 칩 탭은 고르기 상자 [폴더 ▾]로 바뀌어 끌어 옮기기는 없어졌다.
// 처음 순서는 [폴더] 맨 앞이고, 서버(library_view.group_order)에 기억해 둔 순서는 상자 안 순서로 그대로 쓴다(다른 기기도 같다). 고른 묶기는 그대로.
const groupOptions=page=>page.locator('#libraryGroupBy option');
test('LIB-폴더보기 묶기 순서: 처음은 [폴더] 맨 앞, 기억해 둔 순서는 [폴더 ▾] 안 순서 그대로',async({page,browser})=>{
  const {errors}=await boot(page,1280);
  await expect(groupOptions(page)).toHaveText(['폴더','사업영역','담당조직','분류','월별']);
  const s=state({libraryView:{group_by:'organization',group_order:['month','folder','project','organization','category']}});
  for(const w of [1280,390]){
    const other=await browser.newPage();const o=await boot(other,w,{s,expand:false});
    await expect(groupOptions(other)).toHaveText(['월별','폴더','사업영역','담당조직','분류']);
    await expect(other.locator('#libraryGroupBy option:checked')).toHaveText('담당조직');
    expect(o.errors).toEqual([]);await other.close();
  }
  expect(errors).toEqual([]);
});
