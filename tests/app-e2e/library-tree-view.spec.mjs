import { appOrigin } from './helpers/test-origin.mjs';
// LIB-토글트리 ②(docs/design/library-tree.md 5절): 자료실 토글 트리 보기. 폴더 표는 읽기만(편집은 다음 단계).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {libraryNode,libraryNodeHead} from './helpers/library-tree.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const doc=(id,project_id,extra={})=>({id,workspace_id:'workspace-1',project_id,title:'자료 '+id,file_name:id+'.pdf',category:'정책자료',tags:[],document_date:null,created_at:'2026-10-01T00:00:00Z',...extra});
function treeState({folders=[],items=[]}={}){
  const s=baseState();
  s.spaces.find(p=>p.id==='top-a').metadata.color='blue';
  s.docs=[
    doc('a-1','top-a',{document_date:'2026-10-05',file_name:'a.hwp'}),
    doc('a1-1','child-a1',{document_date:'2026-09-02',category:'교섭자료'}),
    doc('a1-2','child-a1',{document_date:'2026-10-03',file_name:'b.xlsx'}),
    doc('none-1',null,{document_date:'2026-08-01',organization_id:'org-1'}),
    ...Array.from({length:23},(_,i)=>doc('b-'+String(i).padStart(2,'0'),'top-b',{document_date:`2026-07-${String(i+1).padStart(2,'0')}`}))
  ];
  s.folders=folders;s.items=items;s.folderReads=0;s.orgs=[{id:'org-1',name:'가상 지부',active:true}];
  return s;
}
async function boot(page,width,opts={}){
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const s=treeState(opts);await mockApp(page,s);
  // 폴더 표(app_library_folders·_items)와 담당조직은 이 시험에서만 따로 답한다. folders가 null이면 표가 아직 없는 운영 상태(404).
  await page.route(`${SB}/rest/v1/app_library_folder*`,route=>{
    const path=new URL(route.request().url()).pathname;s.folderReads++;
    if(opts.folders===null)return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'42P01',message:'relation does not exist'})});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(path.endsWith('_items')?s.items:s.folders)});
  });
  await page.route(`${SB}/rest/v1/app_suborganizations*`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(s.orgs)}));
  await signIn(page,`${appOrigin}/app/?view=library`);
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
  await expect(libraryNode(page,'p:top-a')).toBeAttached();
  return {s,errors};
}
const tops=page=>page.locator('#documentList > details').evaluateAll(xs=>xs.map(x=>x.dataset.luNode));
const visibleRows=page=>page.locator('#documentList .lu-row:visible').evaluateAll(xs=>xs.map(x=>x.dataset.luDocument));
const noScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280])test(`프로젝트 트리: 맨 위 단만, 자료 수·종류 점·색, 펼치면 하위 → 파일(날짜순), 20개 넘으면 N건 더, 모두 펴기·접기 ${width}`,async({page},info)=>{
  const {errors}=await boot(page,width);
  // 1단 프로젝트(프로젝트 화면 차례) → 보관·옛 공간·확인 불가 → 맨 아래 '프로젝트 없음'. 처음엔 모두 접힘(결정 D13).
  expect(await tops(page)).toEqual(['p:top-a','p:top-b','p:orphan-1','p:none']);
  await expect(page.locator('#documentList details[open]')).toHaveCount(0);
  await expect(page.locator('.lu-row:visible')).toHaveCount(0);
  // 접힌 줄: 이름 · 자료 수(아래 단 포함) · 종류 색 점(HWP·PDF·XLS 순) · 프로젝트 색 점.
  const a=libraryNodeHead(page,'p:top-a');
  await expect(a.locator('.lu-node-name')).toHaveText('공공기관 기능개혁 대응');await expect(a.locator('.lu-node-count')).toHaveText('3');
  await expect(a.locator('.lu-node-count')).toHaveAttribute('aria-label','자료 3건');
  expect(await a.locator('.lu-kdot').evaluateAll(xs=>xs.map(x=>x.dataset.luKind))).toEqual(['hwp','pdf','xls']);
  await expect(a.locator('.lu-pdot')).toHaveAttribute('data-color','blue');
  await expect(libraryNodeHead(page,'p:top-b').locator('.lu-node-count')).toHaveText('23');
  await expect(libraryNodeHead(page,'p:orphan-1').locator('.lu-node-count')).toHaveText('0');
  // 자료가 없는 하위(산자부 대응)는 숨긴다.
  await expect(libraryNode(page,'p:child-a2')).toHaveCount(0);
  // 접힌 줄은 36px 얇은 줄(LIB-목록간격 ②: 32 → 36px, 줄 간격 조금 넓게), 누르는 범위 44px.
  expect(Math.round((await a.boundingBox()).height)).toBe(36);
  // 펼치기: 하위 프로젝트 토글이 먼저, 그다음 이 단의 파일. 하위의 색 점은 같은 색의 연한 톤.
  await a.click();await expect(libraryNode(page,'p:top-a')).toHaveAttribute('open','');
  await expect(libraryNodeHead(page,'p:child-a1').locator('.lu-pdot')).toHaveAttribute('data-tone','soft');
  expect(await page.locator('#documentList details[data-lu-node="p:top-a"] > .lu-node-body > *').evaluateAll(xs=>xs.map(x=>x.dataset.luNode||x.dataset.luDocument))).toEqual(['p:child-a1','a-1']);
  await libraryNodeHead(page,'p:child-a1').click();
  // 토글 안 파일은 날짜 최신순, 단마다 들여쓰기.
  expect(await visibleRows(page)).toEqual(['a1-2','a1-1','a-1']);
  const indent=async id=>parseFloat(await page.locator(`[data-lu-document="${id}"]`).evaluate(el=>getComputedStyle(el).paddingLeft));
  expect(await indent('a1-1')).toBeGreaterThan(await indent('a-1'));
  // 파일 줄은 지금 줄 그대로(종류 태그·분류 태그·날짜·⋯).
  await expect(page.locator('[data-lu-document="a1-2"] .lu-file-kind')).toHaveText('XLS');await expect(page.locator('[data-lu-document="a1-2"] .lu-row-date')).toHaveText('10.03');
  // N건 더: 20개 넘는 토글은 20개만, [3건 더]를 누르면 그 토글만 전부.
  await libraryNodeHead(page,'p:top-b').click();
  const b=page.locator('#documentList details[data-lu-node="p:top-b"] > .lu-node-body');
  await expect(b.locator(':scope > .lu-row')).toHaveCount(20);await expect(b.locator(':scope > .lu-more-files')).toHaveText('3건 더');
  await expect(b.locator(':scope > .lu-row').first()).toHaveAttribute('data-lu-document','b-22');
  if(width===390)await page.screenshot({path:info.outputPath('tree-390.png'),fullPage:true});else await page.screenshot({path:info.outputPath('tree-1280.png'),fullPage:true});
  await b.locator(':scope > .lu-more-files').click();await expect(b.locator(':scope > .lu-row')).toHaveCount(23);await expect(b.locator('.lu-more-files')).toHaveCount(0);
  // 펼침 상태는 다시 그려도 남는다.
  await page.evaluate(()=>window.KPTULibrary.render());await expect(libraryNode(page,'p:child-a1')).toHaveAttribute('open','');await expect(b.locator(':scope > .lu-row')).toHaveCount(23);
  // 모두 펴기 ↔ 모두 접기(작은 글자 버튼).
  const all=page.locator('#libraryExpandAll');await expect(all).toHaveText('모두 펴기');
  await all.click();await expect(page.locator('#documentList details:not([open])')).toHaveCount(0);await expect(all).toHaveText('모두 접기');
  await all.click();await expect(page.locator('#documentList details[open]')).toHaveCount(0);await expect(all).toHaveText('모두 펴기');
  // 키보드: 토글 머리에 초점 → Enter로 펴기, 다시 Enter로 접기.
  await a.focus();await page.keyboard.press('Enter');await expect(libraryNode(page,'p:top-a')).toHaveAttribute('open','');
  await page.keyboard.press('Enter');await expect(libraryNode(page,'p:top-a')).not.toHaveAttribute('open','');
  // 다른 화면에 갔다 오면 다시 맨 위 단만.
  await a.click();await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('library'));await expect(page.locator('#documentList details[open]')).toHaveCount(0);
  expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`검색·종류 거르기: 맞는 토글만 펼침, 수는 거른 수, 풀면 직전 펼침으로 ${width}`,async({page})=>{
  const {errors}=await boot(page,width);
  await libraryNodeHead(page,'p:top-b').click();
  await page.locator('#documentSearch').fill('a1-');
  // 맞는 자료가 든 토글만 남고(위 단까지) 펼쳐진다. 맞지 않는 토글·'프로젝트 없음'은 숨는다.
  expect(await tops(page)).toEqual(['p:top-a']);
  await expect(libraryNode(page,'p:top-a')).toHaveAttribute('open','');await expect(libraryNode(page,'p:child-a1')).toHaveAttribute('open','');
  expect(await visibleRows(page)).toEqual(['a1-2','a1-1']);
  await expect(libraryNodeHead(page,'p:top-a').locator('.lu-node-count')).toHaveText('2');
  // 거르는 중 사용자가 접은 토글은 그대로 접혀 있다.
  await libraryNodeHead(page,'p:child-a1').click();await expect(page.locator('.lu-row:visible')).toHaveCount(0);
  await page.evaluate(()=>window.KPTULibrary.render());await expect(libraryNode(page,'p:child-a1')).not.toHaveAttribute('open','');
  // 거르기를 풀면 직전 펼침(top-b만 열림)으로 돌아간다.
  await page.locator('#documentSearch').fill('');
  expect(await tops(page)).toEqual(['p:top-a','p:top-b','p:orphan-1','p:none']);
  await expect(libraryNode(page,'p:top-b')).toHaveAttribute('open','');await expect(libraryNode(page,'p:top-a')).not.toHaveAttribute('open','');
  // 종류 칩으로 거르면 같은 규칙.
  const chip=name=>page.locator(`#libraryCategoryFilter [data-lu-category="${name}"]`);
  for(const name of ['투쟁','교육','선전','정책','기타'])await chip(name).click();
  expect(await tops(page)).toEqual(['p:top-a']);expect(await visibleRows(page)).toEqual(['a1-1']);
  // LIB-거르기전체: 일부 켜짐에서 [전체] 한 번 = 모두 켬(거르기 풀림), 한 번 더 = 모두 끔(빈 목록 한 줄), 또 한 번 = 모두 켬.
  await chip('all').click();
  expect(await tops(page)).toEqual(['p:top-a','p:top-b','p:orphan-1','p:none']);
  await chip('all').click();expect(await tops(page)).toEqual([]);await expect(page.locator('#documentList .empty')).toHaveText('고른 분류 없음');
  await chip('all').click();
  expect(await tops(page)).toEqual(['p:top-a','p:top-b','p:orphan-1','p:none']);
  // 맞는 자료가 없으면 빈 안내.
  await page.locator('#documentSearch').fill('없는 검색어');await expect(page.locator('#documentList .empty')).toHaveText('자료가 없습니다.');await expect(page.locator('#libraryExpandAll')).toBeDisabled();
  expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`묶기 전환: 담당조직·종류·월별은 같은 얇은 토글(폴더 없음), 바꾸면 접힌 채 ${width}`,async({page})=>{
  const {errors}=await boot(page,width,{folders:[{id:'f-1',project_id:'top-a',parent_id:null,name:'가상 폴더',sort_order:1024,created_at:'2026-10-01T00:00:00Z'}],items:[]});
  const group=page.locator('#libraryGroupBy');
  await expect(group).toHaveAttribute('role','radiogroup');await expect(group.getByRole('radio')).toHaveText(['폴더','사업영역','담당조직','분류','월별']);
  await expect(group.getByRole('radio',{name:'사업영역'})).toHaveAttribute('aria-checked','true');
  await expect(group.getByRole('radio').first()).toHaveCSS('height','32px');
  await libraryNodeHead(page,'p:top-a').click();
  await group.getByRole('radio',{name:'월별'}).click();
  expect(await tops(page)).toEqual(['m:2026-10','m:2026-09','m:2026-08','m:2026-07']);
  await expect(page.locator('#documentList details[open]')).toHaveCount(0);
  await expect(libraryNodeHead(page,'m:2026-10').locator('.lu-node-name')).toHaveText('2026년 10월');await expect(libraryNodeHead(page,'m:2026-10').locator('.lu-node-count')).toHaveText('2');
  await expect(page.locator('#documentList [data-lu-node-kind="folder"]')).toHaveCount(0);
  await group.getByRole('radio',{name:'분류'}).click();
  await expect(page.locator('#documentList > details > summary .lu-node-name')).toHaveText(['교섭','정책']);
  await group.getByRole('radio',{name:'담당조직'}).click();
  await expect(page.locator('#documentList > details > summary .lu-node-name')).toHaveText(['가상 지부','조직 없음']);
  await libraryNodeHead(page,'o:org-1').click();expect(await visibleRows(page)).toEqual(['none-1']);
  // 키보드로 묶기 칩을 옮긴다(공용 알약 칩: 화살표).
  await group.getByRole('radio',{name:'담당조직'}).focus();await page.keyboard.press('ArrowLeft');await expect(group.getByRole('radio',{name:'사업영역'})).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#documentList [data-lu-node-kind="folder"]')).toHaveCount(1);
  expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`폴더(읽기만): 프로젝트 안 3단 폴더, 빈 폴더 보임, '프로젝트 없음' 안에도, 어긋난 연결은 프로젝트 바로 아래 ${width}`,async({page})=>{
  const folders=[
    {id:'f-a',project_id:'top-a',parent_id:null,name:'가상 회의록',sort_order:2048,created_at:'2026-10-01T00:00:00Z'},
    {id:'f-a0',project_id:'top-a',parent_id:null,name:'가상 빈 폴더',sort_order:1024,created_at:'2026-10-01T00:00:00Z'},
    {id:'f-a-1',project_id:'top-a',parent_id:'f-a',name:'가상 1차',sort_order:0,created_at:'2026-10-01T00:00:00Z'},
    {id:'f-a-1-1',project_id:'top-a',parent_id:'f-a-1',name:'가상 세부',sort_order:0,created_at:'2026-10-01T00:00:00Z'},
    {id:'f-n',project_id:null,parent_id:null,name:'가상 정리함',sort_order:0,created_at:'2026-10-01T00:00:00Z'}
  ];
  const items=[{document_id:'a-1',folder_id:'f-a-1-1'},{document_id:'none-1',folder_id:'f-n'},{document_id:'a1-1',folder_id:'f-a'}];
  const {s,errors}=await boot(page,width,{folders,items});
  await page.locator('#libraryExpandAll').click();
  // 폴더는 하위 프로젝트 다음, 파일 앞. 같은 상위 안 차례는 sort_order.
  expect(await page.locator('#documentList details[data-lu-node="p:top-a"] > .lu-node-body > *').evaluateAll(xs=>xs.map(x=>x.dataset.luNode||x.dataset.luDocument))).toEqual(['p:child-a1','f:f-a0','f:f-a']);
  await expect(page.locator('#documentList details[data-lu-node="f:f-a"] details[data-lu-node="f:f-a-1"] details[data-lu-node="f:f-a-1-1"] [data-lu-document="a-1"]')).toBeVisible();
  await expect(libraryNodeHead(page,'f:f-a0').locator('.lu-node-count')).toHaveText('0');await expect(libraryNodeHead(page,'f:f-a0').locator('.lu-folder-icon')).toBeVisible();
  // 자료의 프로젝트(child-a1)와 폴더의 틀(top-a)이 어긋난 연결은 없는 것으로 보고, 자료의 프로젝트 토글 바로 아래에 둔다.
  await expect(page.locator('#documentList details[data-lu-node="p:child-a1"] > .lu-node-body > [data-lu-document="a1-1"]')).toBeVisible();
  await expect(page.locator('#documentList details[data-lu-node="p:none"] details[data-lu-node="f:f-n"] [data-lu-document="none-1"]')).toBeVisible();
  // 프로젝트 토글의 ⋯는 '폴더 만들기'뿐이다(사업영역 추가·이름·순서는 프로젝트 화면에서만, 요구 ②·결정 D8). 보관·옛 공간·확인 불가 토글에는 ⋯가 없다.
  await expect(libraryNodeHead(page,'p:top-a').locator('[data-lu-node-menu]')).toHaveAttribute('aria-label','폴더 만들기: 공공기관 기능개혁 대응');
  await expect(page.locator('#documentList details[data-lu-node="p:none"] > summary [data-lu-node-menu]')).toHaveCount(1);
  // 폴더 표는 읽기만: 쓰기 요청이 없다.
  expect(s.folderReads).toBeGreaterThanOrEqual(2);
  expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
});

test('폴더 표가 아직 없으면(404) 폴더 없이 그대로 그린다',async({page})=>{
  const {errors}=await boot(page,1280,{folders:null});
  expect(await tops(page)).toEqual(['p:top-a','p:top-b','p:orphan-1','p:none']);
  await expect(page.locator('#documentList [data-lu-node-kind="folder"]')).toHaveCount(0);
  // 404 응답은 브라우저 콘솔에 "Failed to load resource"로 남는다. 앱 오류는 없다.
  expect(errors.filter(e=>!/Failed to load resource/.test(e))).toEqual([]);
});
