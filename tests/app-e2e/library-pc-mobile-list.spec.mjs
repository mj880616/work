import { appOrigin } from './helpers/test-origin.mjs';
// UI-PC자료실: PC 줄(B안 펼치기), 분류 칩 여러 개 고르기(기본 회의 꺼짐), 폰 줄(M2 이름 다듬기), 꺼진 칩 흐림, 거르기 세 줄(이름표).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {expandLibraryTree} from './helpers/library-tree.mjs';

const OPEN=`${appOrigin}/tests/app-e2e/library-open-fixture.html`;
const LONG='가상 예시 자료 — 아주 긴 이름이 줄 끝을 넘어갈 때 잘리는지 확인하기 위한 시험용 제목 '.repeat(4).trim();
const doc=(id,title,category,date,extra={})=>({id,workspace_id:'workspace-1',project_id:'top-a',title,file_name:id+'.pdf',category,document_date:date,tags:[],drive_url:OPEN,created_at:'2026-10-01T00:00:00Z',...extra});
function state(extra=[]){
  const s=baseState();
  s.docs=[
    doc('long',LONG,'교섭','2026-10-15',{file_name:'long.hwp'}),
    doc('short','예시 안내문','선전','2026-10-14'),
    doc('meeting','가상 회의 결과','회의결과','2026-10-12'),
    doc('policy','시험용 표 자료','정책','2026-10-10',{file_name:'table.xlsx'}),
    doc('prefixed','261009_가상노조_교섭_본교섭_3차_요구안.hwp','교섭',null,{file_name:'p.hwp'}),
    doc('dated-prefix','260901_가상기관_보도자료_예시','선전','2026-10-08'),
    doc('plain','참고 자료 목록 (가나다순)','기타','2026-10-07'),
    doc('not-a-date','123456_시험용_묶음','기타','2026-10-06')
  ];
  s.docs.push(...extra);
  // 하위가 없는 프로젝트(세부 줄 숨김 확인용).
  s.spaces.push({...s.spaces.find(p=>p.id==='top-a'),id:'solo-1',name:'가상 단독 프로젝트',sort_order:80});
  return s;
}
async function boot(page,width,{scheme='light',extra=[]}={}){
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:scheme});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const s=state(extra);await mockApp(page,s);await signIn(page,`${appOrigin}/app/?view=library`);
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
  // LIB-토글트리: 들어올 때는 맨 위 단만 보이므로 줄을 보는 시험은 모두 편다.
  await expandLibraryTree(page);await expect(page.locator('#documentList .lu-row').first()).toBeVisible();
  return {s,errors};
}
const rows=page=>page.locator('#documentList [data-lu-document]');
const ids=page=>rows(page).evaluateAll(els=>els.map(el=>el.dataset.luDocument));
const chip=(page,name)=>page.locator(`#libraryCategoryFilter [data-lu-category="${name}"]`);

test('PC: 잘린 이름만 펼치기 버튼, 그 줄만 펼치고 열지 않음, 이름을 누르면 열림, 날짜 열 맞춤',async({page})=>{
  const {errors}=await boot(page,1440);
  const long=page.locator('[data-lu-document="long"]'),expand=long.locator('[data-lu-expand]'),title=long.locator('.lu-row-title');
  await expect(expand).toBeVisible();await expect(expand).toHaveAttribute('aria-expanded','false');await expect(expand).toHaveAttribute('aria-label','전체 이름 보기');
  await expect(page.locator('[data-lu-document="short"] [data-lu-expand]')).toBeHidden();
  expect(await title.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  // 꺾쇠가 없는 줄도 같은 자리를 비워 날짜가 한 세로줄에 선다.
  const dateX=await page.locator('#documentList .lu-row-date').evaluateAll(els=>[...new Set(els.map(el=>Math.round(el.getBoundingClientRect().right)))]);expect(dateX).toHaveLength(1);
  const url=page.url();
  await expand.click();await expect(expand).toHaveAttribute('aria-expanded','true');await expect(expand).toHaveAttribute('aria-label','이름 접기');
  await expect(long).toHaveClass(/lu-expanded/);await expect(title).toHaveCSS('white-space','normal');
  expect(await title.evaluate(el=>el.scrollWidth<=el.clientWidth&&el.scrollHeight<=el.clientHeight+1)).toBe(true);
  expect(await title.evaluate(el=>Math.round(el.getBoundingClientRect().height/parseFloat(getComputedStyle(el).lineHeight)))).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#documentList .lu-expanded')).toHaveCount(1);expect(page.url()).toBe(url);
  // 키보드로도 접고 편다. 버튼의 Enter는 자료를 열지 않는다.
  await expand.focus();await page.keyboard.press('Enter');await expect(expand).toHaveAttribute('aria-expanded','false');await expect(title).toHaveCSS('white-space','nowrap');expect(page.url()).toBe(url);
  expect(errors).toEqual([]);
  // FILE-누르면동작: 이 자료는 HWP이지만 자료 번호·Drive 파일 번호 없이 drive_url만 있어 내려받을 길이 없다 → 주소를 새 탭으로 연다. 이 화면은 그대로.
  const [tab]=await Promise.all([page.waitForEvent('popup'),title.click()]);await expect(tab).toHaveURL(/library-open-fixture/);await tab.close();expect(page.url()).toBe(url);
});

test('PC 중간 폭(900px)도 한 줄 배치·가로 넘침 없음',async({page})=>{
  const {errors}=await boot(page,900);
  await expect(page.locator('[data-lu-document="long"] [data-lu-expand]')).toBeVisible();await expect(page.locator('[data-lu-document="long"] .lu-row-title')).toHaveCSS('white-space','nowrap');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`분류 칩: 기본은 회의만 꺼짐, 여러 개 고르기, [전체] 두 번, 검색 안내와 [켜기] ${width}`,async({page})=>{
  const {errors}=await boot(page,width);
  const group=page.locator('#libraryCategoryFilter');await expect(group).toHaveAttribute('role','group');
  await expect(group.getByRole('button')).toHaveText(['전체','교섭','투쟁','교육','선전','정책','회의','기타']);
  // LIB-거르기전체: 처음엔 [회의]만 꺼져 [전체]는 일부 켜짐(mixed).
  await expect(group.locator('[aria-pressed="false"]')).toHaveText(['회의']);await expect(chip(page,'all')).toHaveAttribute('aria-pressed','mixed');
  expect(await ids(page)).not.toContain('meeting');await expect(rows(page)).toHaveCount(7);
  // 여러 개: 교섭·기타를 끄면 그 둘만 빠지고, 회의를 켜면 함께 보인다.
  await chip(page,'교섭').click();await chip(page,'기타').click();
  await expect(chip(page,'교섭')).toHaveAttribute('aria-pressed','false');await expect(chip(page,'기타')).toHaveAttribute('aria-pressed','false');
  expect((await ids(page)).sort()).toEqual(['dated-prefix','policy','short']);
  await chip(page,'회의').click();expect((await ids(page)).sort()).toEqual(['dated-prefix','meeting','policy','short']);
  // [전체](LIB-거르기전체): 일부 켜짐 → 누르면 모두 켬 → 다시 누르면 모두 끔(고른 분류 없음) → 누르면 모두 켬. 기본 상태는 [회의]를 다시 끄면 된다.
  await chip(page,'all').click();await expect(chip(page,'all')).toHaveAttribute('aria-pressed','true');await expect(group.locator('[aria-pressed="false"]')).toHaveCount(0);await expect(rows(page)).toHaveCount(8);
  await chip(page,'all').click();await expect(chip(page,'all')).toHaveAttribute('aria-pressed','false');await expect(group.locator('[aria-pressed="true"]')).toHaveCount(0);await expect(rows(page)).toHaveCount(0);await expect(page.locator('#documentList')).toHaveText('고른 분류 없음');
  await chip(page,'all').click();await expect(rows(page)).toHaveCount(8);
  await chip(page,'회의').click();await expect(group.locator('[aria-pressed="false"]')).toHaveText(['회의']);await expect(rows(page)).toHaveCount(7);
  // 검색은 칩을 따르고, 꺼진 분류에 걸린 자료는 목록 아래에 알린다. [켜기]는 그 분류만 켠다.
  await page.locator('#documentSearch').fill('가상');
  expect((await ids(page)).sort()).toEqual(['dated-prefix','long','prefixed']);
  const hint=page.locator('.lu-off-hint');await expect(hint).toHaveText('회의 분류 1건은 꺼져 있어요 켜기');await expect(hint).toHaveAttribute('role','status');
  await hint.getByRole('button',{name:'켜기'}).click();await expect(chip(page,'회의')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-lu-document="meeting"]')).toBeVisible();await expect(hint).toHaveCount(0);
  // 검색어가 없으면 안내도 없다.
  await chip(page,'회의').click();await page.locator('#documentSearch').fill('');await expect(page.locator('.lu-off-hint')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('분류 칩: 들어올 때는 서버에 기억해 둔 상태(없으면 기본), 다른 화면이 특정 자료·담당조직으로 열면 모두 켬(저장 안 함)',async({page})=>{
  const {errors}=await boot(page,1280);
  await chip(page,'all').click();await expect(chip(page,'회의')).toHaveAttribute('aria-pressed','true');
  // 자료실에 머문 채 다시 그리기(로그인 정보 갱신·같은 화면 다시 열기)는 들어오기가 아니므로 고른 칩을 지킨다.
  await page.evaluate(()=>window.KPTURouter.go('library',{source:'session',updateUrl:false}));await page.evaluate(()=>window.KPTURouter.go('library'));
  await expect(page.locator('#libraryCategoryFilter [aria-pressed="false"]')).toHaveCount(0);expect(await ids(page)).toContain('meeting');
  // LIB-보기기억: 다른 화면에 갔다 와도 마지막으로 고른 상태(모두 켬)가 서버 기억에서 돌아온다. 회의만 끄면 그 상태가 기억된다.
  await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('library'));await expect(chip(page,'회의')).toHaveAttribute('aria-pressed','true');expect(await ids(page)).toContain('meeting');
  await chip(page,'회의').click();await expect(chip(page,'회의')).toHaveAttribute('aria-pressed','false');
  await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('library'));await expect(chip(page,'회의')).toHaveAttribute('aria-pressed','false');expect(await ids(page)).not.toContain('meeting');
  // 다른 화면에서 회의 자료 하나를 짚어 열면(바구니 등): 그 자료가 보이도록 모두 켜고 그 줄에 초점.
  await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();
  await page.evaluate(async()=>{const m=await import('/app/basket-library-send.js');m.requestLibraryDocument('meeting');window.KPTURouter.go('library')});
  await expect(page.locator('[data-lu-document="meeting"]')).toBeFocused();await expect(page.locator('#libraryCategoryFilter [aria-pressed="false"]')).toHaveCount(0);
  // 담당조직으로 거른 자료실도 모든 분류가 켜진 채로 열린다.
  await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();
  await page.evaluate(()=>{window.KPTULibrary.showOrganization('org-1','가상 지부');window.KPTURouter.go('library')});
  await expect(page.locator('#libraryOrganizationFilter')).toBeVisible();await expect(page.locator('#libraryCategoryFilter [aria-pressed="false"]')).toHaveCount(0);
  // 그다음 평소처럼 들어오면 기억해 둔 상태(위에서 모두 켠 채 열린 것은 저장하지 않았으므로 [회의]만 꺼짐).
  await page.evaluate(()=>window.KPTURouter.go('home'));await page.evaluate(()=>window.KPTURouter.go('library'));await expect(page.locator('#libraryCategoryFilter [aria-pressed="false"]')).toHaveText(['회의']);
  expect(errors).toEqual([]);
});

const luminance=rgb=>{const [r,g,b]=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4});return 0.2126*r+0.7152*g+0.0722*b};
const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05)};
for(const scheme of ['light','dark'])test(`꺼진 분류 칩은 흐리게(글자·테두리), 대비 4.5:1 이상, 초점 표시 유지 ${scheme}`,async({page})=>{
  const {errors}=await boot(page,1280,{scheme});
  const look=locator=>locator.evaluate(el=>{const s=getComputedStyle(el);return {fg:s.color,bg:s.backgroundColor,border:s.borderTopColor,outline:s.outlineStyle,outlineWidth:s.outlineWidth}});
  const token=name=>page.evaluate(n=>{const p=document.createElement('span');p.style.color=`var(${n})`;document.querySelector('#libraryView').append(p);const c=getComputedStyle(p).color;p.remove();return c},name);
  const off=await look(chip(page,'회의')),on=await look(chip(page,'교섭'));
  await expect(chip(page,'회의')).toHaveAttribute('aria-pressed','false');
  expect(off.fg).toBe(await token('--kptu-muted'));expect(off.fg).not.toBe(on.fg);expect(off.border).not.toBe(on.border);
  expect(on.bg).toBe(await token('--ds-select-bg'));
  expect(contrast(off.fg,off.bg)).toBeGreaterThanOrEqual(4.5);
  // 키보드 초점은 꺼진 칩에서도 보인다.
  await chip(page,'정책').focus();await page.keyboard.press('Tab');await expect(chip(page,'회의')).toBeFocused();
  const focused=await look(chip(page,'회의'));expect(focused.outline).toBe('solid');expect(parseFloat(focused.outlineWidth)).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

// 날짜 우선순위는 폰·PC 같다: 자료 날짜 → 이름 앞 날짜 → 올린 날 + 올림.
for(const width of [1280,390])test(`날짜 우선순위(자료 날짜 → 이름 앞 날짜 → 올린 날 + 올림) ${width}`,async({page})=>{
  const {errors}=await boot(page,width,{extra:[doc('no-date','가상 날짜 없는 참고자료','기타',null,{file_name:'nd.pdf'})]});await chip(page,'all').click();
  const d=id=>page.locator(`[data-lu-document="${id}"] .lu-row-date`);
  // 1) 자료 날짜가 있으면 그 날짜(이름 앞 날짜가 있어도 자료 날짜가 이긴다).
  await expect(d('short')).toHaveText('10.14');await expect(d('short')).not.toHaveClass(/upload/);
  await expect(d('dated-prefix')).toHaveText('10.08');await expect(d('dated-prefix')).not.toHaveClass(/upload/);
  // 2) 자료 날짜가 없고 이름이 날짜로 시작하면 그 날짜, 올림 없음.
  await expect(d('prefixed')).toHaveText('10.09');await expect(d('prefixed')).not.toHaveClass(/upload/);await expect(d('prefixed').locator('small')).toHaveCount(0);
  // PC는 이름을 그대로 둔다(날짜만 같은 규칙).
  if(width===1280)await expect(page.locator('[data-lu-document="prefixed"] .lu-row-title')).toHaveText('261009_가상노조_교섭_본교섭_3차_요구안.hwp');
  // 3) 둘 다 없으면 올린 날을 흐리게 + 작은 올림.
  await expect(d('no-date')).toHaveText('10.01 올림');await expect(d('no-date')).toHaveClass(/upload/);await expect(d('no-date').locator('small')).toHaveText('올림');
  const color=l=>l.evaluate(el=>getComputedStyle(el).color);expect(await color(d('no-date'))).not.toBe(await color(d('short')));
  // 날짜 모양이 아닌 숫자 앞머리(123456)는 이름 앞 날짜로 보지 않는다 → 자료 날짜.
  await expect(d('not-a-date')).toHaveText('10.06');
  expect(errors).toEqual([]);
});

test('폰 M2: 이름 다듬기(날짜 앞머리 → 오른쪽 날짜, 밑줄 → 띄어쓰기, 확장자 빼기), 원본 이름은 그대로 검색',async({page})=>{
  const {s,errors}=await boot(page,390);
  await chip(page,'all').click();
  const name=id=>page.locator(`[data-lu-document="${id}"] .lu-row-title`),date=id=>page.locator(`[data-lu-document="${id}"] .lu-row-date`);
  // 자료 날짜가 없으면 이름 앞의 날짜를 오른쪽 날짜로 보인다.
  await expect(name('prefixed')).toHaveText('가상노조 교섭 본교섭 3차 요구안');await expect(date('prefixed')).toHaveText('10.09');
  // 자료 날짜가 있으면 그 날짜를 보이고, 이름 앞의 날짜는 이름에서만 뗀다.
  await expect(name('dated-prefix')).toHaveText('가상기관 보도자료 예시');await expect(date('dated-prefix')).toHaveText('10.08');
  // 날짜 앞머리가 없는 이름은 그대로.
  await expect(name('plain')).toHaveText('참고 자료 목록 (가나다순)');
  // 날짜가 아닌 숫자 앞머리(34월)는 떼지 않는다.
  await expect(name('not-a-date')).toHaveText('123456 시험용 묶음');
  // 줄 모양: 이름 위·종류/분류 아래, 펼치기 버튼 없음, 이름 2줄까지.
  const row=page.locator('[data-lu-document="prefixed"]'),kind=row.locator('.lu-file-kind'),tag=row.locator('.doc-category-tag');
  expect((await kind.boundingBox()).y).toBeGreaterThan((await name('prefixed').boundingBox()).y+10);expect(Math.abs((await kind.boundingBox()).y-(await tag.boundingBox()).y)).toBeLessThan(4);
  await expect(page.locator('#documentList [data-lu-expand]:visible')).toHaveCount(0);
  await expect(name('long')).toHaveCSS('-webkit-line-clamp','2');
  // 저장된 이름·메뉴 이름은 바뀌지 않는다.
  expect(s.docs.find(d=>d.id==='prefixed').title).toBe('261009_가상노조_교섭_본교섭_3차_요구안.hwp');
  await expect(row.locator('.lu-more-trigger')).toHaveAttribute('aria-label','자료 관리: 261009_가상노조_교섭_본교섭_3차_요구안.hwp');
  // 원본 이름(밑줄·날짜 포함)으로 검색된다.
  await page.locator('#documentSearch').fill('261009_가상노조');expect(await ids(page)).toEqual(['prefixed']);
  await page.locator('#documentSearch').fill('');
  // PC 폭으로 넓히면 원래 이름으로 다시 그린다.
  await page.setViewportSize({width:1280,height:900});await expect(name('prefixed')).toHaveText('261009_가상노조_교섭_본교섭_3차_요구안.hwp');
  await page.setViewportSize({width:390,height:844});await expect(name('prefixed')).toHaveText('가상노조 교섭 본교섭 3차 요구안');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

// UI-PC자료실 거르기 줄 → LIB-토글트리: [프로젝트]·[세부] 칩 줄은 트리가 대신하고, 검색칸 아래 [묶기](+ 모두 펴기) → [종류]가 한 줄씩, 줄마다 왼쪽 이름표.
const box=locator=>locator.boundingBox();
for(const scheme of ['light','dark'])test(`PC 거르기 줄: 이름표·차례(묶기 → 종류)·담당조직 줄·프로젝트 줄은 다른 화면에서 걸러 열 때만 ${scheme}`,async({page})=>{
  const {errors}=await boot(page,1280,{scheme});
  const labels=page.locator('#libraryView .library-filter-toolbar .lu-filter-label:visible'),group=page.locator('#libraryGroupBy'),category=page.locator('#libraryCategoryFilter');
  await expect(labels).toHaveText(['묶기','분류']);await expect(page.locator('#documentProject')).toBeHidden();
  await expect(group.getByRole('radio')).toHaveText(['폴더','사업영역','담당조직','분류','월별']);await expect(group.getByRole('radio',{name:'사업영역'})).toHaveAttribute('aria-checked','true');
  const search=await box(page.locator('#documentSearch')),top=await box(group),cat=await box(category);
  expect(top.y).toBeGreaterThanOrEqual(search.y+search.height-1);expect(cat.y).toBeGreaterThanOrEqual(top.y+top.height-1);
  const labelBoxes=await labels.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.left),right:r.right,mid:r.top+r.height/2}}));
  expect(new Set(labelBoxes.map(b=>b.x)).size).toBe(1);expect(Math.round(top.x)).toBe(Math.round(cat.x));expect(top.x).toBeGreaterThan(labelBoxes[0].right);
  expect(Math.abs(labelBoxes[0].mid-(top.y+top.height/2))).toBeLessThan(4);expect(Math.abs(labelBoxes[1].mid-(cat.y+cat.height/2))).toBeLessThan(4);
  // [모두 펴기/접기]는 묶기 칩 오른쪽 같은 줄의 작은 글자 버튼(28px, 누르는 범위 44px).
  const all=page.locator('#libraryExpandAll'),a=await box(all),lastChip=await box(group.getByRole('radio').last());
  expect(a.x).toBeGreaterThanOrEqual(lastChip.x+lastChip.width-1);expect(Math.abs((a.y+a.height/2)-(top.y+top.height/2))).toBeLessThan(4);
  expect(Math.round(a.height)).toBe(28);expect(await all.evaluate(n=>parseFloat(getComputedStyle(n,'::after').height))).toBe(44);
  // 칩 묶음의 이름(aria-label)은 그대로이고, 보이는 이름표는 읽기 도구에 겹쳐 읽히지 않는다.
  await expect(group).toHaveAttribute('aria-label','묶기');await expect(category).toHaveAttribute('aria-label','자료 분류 (여러 개 고르기)');
  expect(await page.locator('#libraryView .lu-filter-label').evaluateAll(els=>els.every(el=>el.getAttribute('aria-hidden')==='true'))).toBe(true);
  // 담당조직으로 걸러 들어오면 그 줄도 같은 모양(이름표 + 칩)으로 끼운다.
  await page.evaluate(()=>{window.KPTULibrary.showOrganization('org-1','가상 지부')});
  await expect(labels).toHaveText(['묶기','담당조직','분류']);await expect(page.locator('#libraryOrganizationFilter')).toBeVisible();
  await page.locator('#libraryOrganizationFilter [data-filter-value="all"]').click();await expect(labels).toHaveText(['묶기','분류']);
  // 프로젝트 상세의 자료 "전체 보기"처럼 다른 화면이 프로젝트 하나로 걸러 열면 [프로젝트] 줄([전체 | 그 프로젝트])이 묶기와 종류 사이에 생긴다.
  await page.evaluate(()=>{document.querySelector('#documentProject').value='child-a1';window.KPTULibrary.render()});
  await expect(labels).toHaveText(['묶기','사업영역','분류']);await expect(page.locator('#documentProject').getByRole('radio')).toHaveText(['전체','공공기관 기능개혁 대응 › 국토부 대응']);
  await page.locator('#documentProject [data-filter-value="all"]').click();await expect(labels).toHaveText(['묶기','분류']);await expect(page.locator('#documentProject')).toHaveJSProperty('value','all');
  await expect(page.locator('#newDocumentBtn')).toHaveClass(/\bprimary\b/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('폰 거르기 줄: 줄마다 이름표(묶기·종류) + 칩 두 줄(옆으로 밀지 않음, UI-칩줄두줄), 차례는 PC와 같음',async({page})=>{
  const {errors}=await boot(page,390);
  await expect(page.locator('#libraryView .lu-filter-label:visible')).toHaveText(['묶기','분류']);
  const group=page.locator('#libraryGroupBy'),category=page.locator('#libraryCategoryFilter');
  const top=await box(group),cat=await box(category);expect(cat.y).toBeGreaterThanOrEqual(top.y+top.height-1);
  for(const [b,n] of [[top,0],[cat,1]]){const l=await box(page.locator('#libraryView .lu-filter-label:visible').nth(n));expect(b.x).toBeGreaterThanOrEqual(l.x+l.width-1)}
  // UI-칩줄두줄: 묶기 줄(칩 + 모두 펴기)과 종류 줄(칩 + 편집)은 옆으로 밀지 않고, 칩 묶음이 줄바꿈으로 두 줄까지.
  for(const row of ['group','category']){const r=page.locator(`#libraryView .lu-filter-row[data-lu-filter-row="${row}"]`);await expect(r).toHaveCSS('overflow-x','visible')}
  for(const g of [group,category]){await expect(g).toHaveCSS('flex-wrap','wrap');await expect(g).toHaveCSS('overflow-x','visible');
    expect(await g.evaluate(el=>new Set([...el.children].filter(c=>c.getClientRects().length).map(c=>Math.round(c.getBoundingClientRect().top))).size)).toBeLessThanOrEqual(2)}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

// UI-자료실편집버튼(2026-10-21): [분류 수정]이 목록 머리에서 [종류] 칩 줄 맨 끝의 작은 [편집]으로 옮겨 갔다. 동작(분류 편집 창 열기)은 그대로, 접근성 이름은 "분류 편집".
for(const width of [1280,390])test(`종류 칩 줄 맨 끝 [편집] ${width}: 칩 오른쪽 같은 줄, 머리에는 [+ 자료 등록]만, 누르면 분류 편집 창`,async({page})=>{
  const {errors}=await boot(page,width);
  const edit=page.getByRole('button',{name:'분류 편집',exact:true}),category=page.locator('#libraryCategoryFilter');
  await expect(edit).toHaveCount(1);await expect(edit).toBeVisible();await expect(edit).toHaveText('편집');await expect(edit).toHaveAttribute('id','manageLibraryBtn');
  // UI-전수디자인점검 F11: 목록 칸 머리에는 버튼이 없고, [+ 자료 등록]은 검색 칸 오른쪽 하나.
  expect(await page.locator('#libraryListCard .add-list-head button').count()).toBe(0);
  expect(await page.locator('#libraryView .lu-search-row button').evaluateAll(xs=>xs.map(x=>x.id))).toEqual(['newDocumentBtn']);
  // 종류 칩 줄 안, 칩 묶음 바로 다음(맨 끝). 칩 묶음의 버튼에는 섞이지 않는다(칩 개수·이름 그대로).
  expect(await edit.evaluate(el=>el.previousElementSibling?.id==='libraryCategoryFilter'&&!el.nextElementSibling&&el.parentElement.dataset.luFilterRow==='category')).toBe(true);
  await expect(category.getByRole('button')).toHaveText(['전체','교섭','투쟁','교육','선전','정책','회의','기타']);
  const e=await box(edit),c=await box(category);
  // PC는 칩 줄 가운데, 폰(칩이 두 줄일 수 있음)은 첫 줄 칩 가운데와 같은 높이(UI-칩줄두줄).
  if(width>=761)expect(Math.abs((e.y+e.height/2)-(c.y+c.height/2))).toBeLessThan(4);
  else{const first=await box(category.locator('[data-lu-category]').first());expect(Math.abs((e.y+e.height/2)-(first.y+first.height/2))).toBeLessThan(4);}
  if(width>=761){const lastChip=await box(category.locator('[data-lu-category]').last());expect(e.x).toBeGreaterThanOrEqual(lastChip.x+lastChip.width-1);}
  // 폰에서도 화면 안에 보이고(칩이 많아도 [편집]은 줄 끝에 남음) 보이는 높이는 작은 버튼 32px, 누르는 범위는 44px.
  // 폰: 칩 묶음은 두 줄까지 줄바꿈하고 [편집]은 그 오른쪽(칩과 겹치지 않음).
  if(width<761){const lastChip=await box(category.locator('[data-lu-category]').last());expect(e.x).toBeGreaterThanOrEqual(lastChip.x+lastChip.width-1);await edit.scrollIntoViewIfNeeded();const e2=await box(edit);expect(e2.x+e2.width).toBeLessThanOrEqual(width+1);}
  expect(Math.round(e.height)).toBe(32);
  expect(await edit.evaluate(n=>parseFloat(getComputedStyle(n,'::after').height))).toBe(44);
  await edit.click();await expect(page.locator('#libraryManageModal')).toBeVisible();
  await page.locator('#libraryManageClose').click();await expect(page.locator('#libraryManageModal')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
