import {test,expect} from '@playwright/test';
import {expandLibraryTree,revealLibraryRow} from './helpers/library-tree.mjs';
import {mkdirSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// UI-바구니거르기: 바구니 [메모] 거르기 [미분류 N][분류][보류] + [분류] 아래 분류된 곳 칩 [전체][담당조직][프로젝트][자료실][할 일].
// 분류된 곳은 이미 읽는 것만으로 정한다: 확정 연결 기록(app_record_links)의 대상 종류, [자료로 넣기](app_documents.project_id,
// 프로젝트·자료실 양쪽), 메모로 만든 Google 할 일(metadata.tasks). Supabase REST 경계만 합성이고 화면은 실제 앱이다.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z';
const reviewDir=process.env.UI_REVIEW_DIR||'';
const filterChip=(page,value)=>page.locator(`#basketView [data-basket-filter="${value}"]`);
const id=n=>'10000000-0000-4000-8000-00000000000'+n;
const ORG=id(1),PROJ=id(2),FILED=id(3),TASK=id(4),DOC=id(5),PLAIN=id(6),HELD=id(7),SUGGEST=id(8);
const P='20000000-0000-4000-8000-000000000001',O='30000000-0000-4000-8000-000000000001';
const task={task_id:'g-task-1',task_list_id:'@default',title:'합성 회신 보내기',created_at:'2026-10-06T02:00:00.000Z'};
const matching=(rows,query)=>rows.filter(row=>[...query].every(([key,value])=>['select','order','limit','offset'].includes(key)||(value.startsWith('eq.')?String(row[key]??'')===value.slice(3):value.startsWith('in.(')?value.slice(4,-1).split(',').includes(String(row[key])):true)));

async function fixture(page,{width=390,scheme='light'}={}){
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:scheme});
 await openHome(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const note=(nid,raw,extra={})=>({id:nid,workspace_id:'w',kind:'basket',occurred_at:stamp,updated_at:stamp,raw_text:raw,ai_export_allowed:true,archived_at:null,attachments:[],metadata:{},...extra});
 const tables={
  app_notes:[
   note(ORG,'합성 조직 기록 메모'),note(PROJ,'합성 프로젝트 기록 메모'),
   note(FILED,'',{attachments:[{drive_file_id:'drive-hwp',file_name:'합성 요구안.hwp',mime_type:'application/x-hwp',size_bytes:2048}]}),
   note(TASK,'합성 할 일 만든 메모',{metadata:{tasks:[task]}}),note(DOC,'합성 자료실 기록 메모'),
   note(PLAIN,'합성 아직 안 나눈 메모'),note(SUGGEST,'합성 제안만 있는 메모'),note(HELD,'합성 보류한 메모',{archived_at:stamp}),
  ],
  app_record_links:[
   {id:'l1',workspace_id:'w',note_id:ORG,status:'confirmed',organization_id:O,organization:{name:'합성 한빛지부'}},
   {id:'l2',workspace_id:'w',note_id:PROJ,status:'confirmed',project_id:P,project:{name:'합성 임단협'}},
   {id:'l3',workspace_id:'w',note_id:DOC,status:'confirmed',document_id:'doc-x',document:{title:'합성 공문'}},
   {id:'l4',workspace_id:'w',note_id:SUGGEST,status:'suggested',project_id:P,project:{name:'합성 임단협'}},
  ],
  app_documents:[{id:'doc-hwp',workspace_id:'w',project_id:P,meeting_id:null,title:'합성 요구안',file_id:'drive-hwp',file_name:'합성 요구안.hwp',category:'교섭자료',created_at:'2026-09-14T01:00:00Z'}],
  app_spaces:[{id:P,workspace_id:'w',owner_id:'home-test',name:'합성 임단협',status:'active',visibility:'private',sort_order:10,parent_id:null,created_at:stamp,updated_at:stamp,metadata:{project_system:'v2'}}],
 };
 const writes=[];
 await page.route(SB+'/rest/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop();
  if(!Object.hasOwn(tables,table))return route.fallback();
  if(req.method()!=='GET'){writes.push({table,method:req.method()});return route.fulfill({status:403,json:{message:'읽기 전용 시험'}});}
  if(table==='app_record_links'&&!url.searchParams.has('note_id'))return route.fallback();
  const offset=Number(url.searchParams.get('offset')||0);
  return route.fulfill({json:matching(tables[table],url.searchParams).slice(offset)});
 });
 return {errors,writes};
}
// REF-참고묶음: with [참고] the place row is wider than a 390px phone and slides sideways (filter-chips.css); bring the chip into view first, as a finger would.
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();}
const rows=page=>page.locator('#basketView [data-basket-row]');
const shown=page=>rows(page).evaluateAll(els=>els.map(el=>el.dataset.basketRow));
async function capture(page,info,name){
 const path=reviewDir?`${reviewDir}/${name}.png`:info.outputPath(name+'.png');
 if(reviewDir)mkdirSync(reviewDir,{recursive:true});
 await page.screenshot({path,fullPage:false});
}
async function enter(page,width){
 await tap(page,page.locator('.mobile-tabs [data-view="basket"]:visible,.app-nav [data-view="basket"]:visible'),width);
 await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-list-status]')).toHaveText(/개 업데이트/);
}

for(const width of [390,1280])for(const scheme of ['light','dark'])test(`[미분류][분류][보류] segment and [분류] place chips ${width} ${scheme}`,async({page},info)=>{
 const f=await fixture(page,{width,scheme});await enter(page,width);
 // ① three segments, default [미분류] (gray), with the unclassified count; [전체] is gone and [보관] reads [보류].
 const seg=page.locator('#basketView [data-basket-filter]');
 await expect(seg).toHaveText(['미분류 2','분류 완료','보류']);
 await expect(page.locator('#basketView [data-basket-filter="all"]')).toHaveCount(0);
 const unclassified=filterChip(page,'unclassified'),classified=filterChip(page,'classified'),held=filterChip(page,'archived');
 await expect(unclassified).toHaveAttribute('aria-pressed','true');
 const look=l=>l.evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,fg:s.color,h:el.getBoundingClientRect().height,touch:parseFloat(getComputedStyle(el,'::after').height)};});
 const token=name=>page.evaluate(n=>{const p=document.createElement('i');p.style.color=`var(${n})`;document.querySelector('#appView').append(p);const c=getComputedStyle(p).color;p.remove();return c;},name);
 const gray=await token('--ds-select-bg');
 expect((await look(unclassified)).bg).toBe(gray);expect((await look(classified)).bg).not.toBe(gray);
 expect((await look(unclassified)).h).toBe(32);expect((await look(unclassified)).touch).toBe(44);
 expect(await shown(page)).toEqual([PLAIN,SUGGEST]);
 await expect(page.locator(`[data-basket-row="${SUGGEST}"]`)).toContainText('정리 제안 있음');
 await expect(page.locator('[data-basket-place-filter]')).toBeHidden();
 await capture(page,info,`basket-unclassified-${width}-${scheme}`);

 // ② [분류] → one row of place chips right below; every place filters by where the memo went.
 await tap(page,classified,width);await expect(classified).toHaveAttribute('aria-pressed','true');expect((await look(classified)).bg).toBe(gray);
 const places=page.locator('[data-basket-place-filter]');await expect(places).toBeVisible();
 await expect(places).toHaveAttribute('role','radiogroup');await expect(places).toHaveAttribute('aria-label','분류된 곳');
 await expect(places.getByRole('radio')).toHaveText(['전체','담당조직','사업영역','참고','자료실','할 일','업무일지']);
 await expect(places.locator('[aria-checked="true"]')).toHaveText('전체');
 // It sits right under the segment row, and above the list.
 const segBox=await seg.first().boundingBox(),placeBox=await places.boundingBox(),listBox=await page.locator('#basketView [data-basket-rows]').boundingBox();
 expect(placeBox.y).toBeGreaterThan(segBox.y+segBox.height-1);expect(placeBox.y+placeBox.height).toBeLessThanOrEqual(listBox.y+1);
 expect(await shown(page)).toEqual([ORG,PROJ,FILED,TASK,DOC]);
 // Each row names where it went in one line (existing link chips, "○○ · 자료", tasks).
 await expect(page.locator(`[data-basket-row-item="${ORG}"] .basket-row-links`)).toContainText('합성 한빛지부');
 await expect(page.locator(`[data-basket-row-item="${PROJ}"] .basket-row-links`)).toContainText('합성 임단협');
 await expect(page.locator(`[data-basket-row-item="${FILED}"] .basket-row-links`)).toContainText('합성 임단협 · 자료');
 await expect(page.locator(`[data-basket-row-item="${TASK}"] .basket-row-links`)).toHaveText('할 일 1개');
 await expect(page.locator(`[data-basket-row="${TASK}"]`)).toContainText('할 일 만듦');
 await expect(page.locator(`[data-basket-row-item="${DOC}"] .basket-row-links`)).toContainText('합성 공문');
 await capture(page,info,`basket-classified-${width}-${scheme}`);
 for(const [label,want] of [['담당조직',[ORG]],['사업영역',[PROJ,FILED]],['자료실',[FILED,DOC]],['할 일',[TASK]],['전체',[ORG,PROJ,FILED,TASK,DOC]]]){
  await tap(page,places.getByRole('radio',{name:label,exact:true}),width);
  await expect(places.locator('[aria-checked="true"]')).toHaveText(label);
  await expect.poll(()=>shown(page),label).toEqual(want);
  if(label==='사업영역')await capture(page,info,`basket-classified-project-${width}-${scheme}`);
 }
 // Keyboard: arrows move along the place chips (shared filter-chips.js).
 await places.locator('[aria-checked="true"]').focus();await page.keyboard.press('ArrowRight');
 await expect(places.locator('[aria-checked="true"]')).toHaveText('담당조직');await expect.poll(()=>shown(page)).toEqual([ORG]);

 // ③ [보류] = archived memos; place chips hide; choosing a segment resets the place to [전체].
 await tap(page,held,width);await expect(held).toHaveAttribute('aria-pressed','true');await expect(places).toBeHidden();
 expect(await shown(page)).toEqual([HELD]);
 await tap(page,classified,width);await expect(places.locator('[aria-checked="true"]')).toHaveText('전체');
 // Leaving and coming back starts again at [미분류] (no stored choice).
 await page.evaluate(()=>window.KPTURouter.go('home'));await enter(page,width);
 await expect(unclassified).toHaveAttribute('aria-pressed','true');await expect(places).toBeHidden();expect(await shown(page)).toEqual([PLAIN,SUGGEST]);
 // Opening a memo hides both rows; closing brings the list back.
 await tap(page,classified,width);await tap(page,page.locator(`[data-basket-row="${TASK}"]`),width);
 await expect(page.locator('[data-basket-read-text]')).toBeVisible();await expect(places).toBeHidden();await expect(seg.first()).toBeHidden();
 await expect(page.locator('[data-basket-detail] .basket-note-meta')).toContainText('할 일 만듦');
 await tap(page,page.locator('[data-basket-close]'),width);await expect(places).toBeVisible();await expect(classified).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

// ④ BASKET-전환줄하단: on phones the pane switch [업데이트 n | 챙길 것 n] sits in the row right above the bottom tabs; the segment and place rows sit at the top.
test('phone: [업데이트 | 챙길 것] switch is right above the bottom tabs while the segment and place rows sit at the top',async({page},info)=>{
 const f=await fixture(page,{width:390});await enter(page,390);
 await tap(page,filterChip(page,'classified'),390);
 const sw=page.locator('#basketView .inbox-pane-switch'),places=await page.locator('[data-basket-place-filter]').boundingBox(),seg=await filterChip(page,'unclassified').boundingBox();
 const s=await sw.boundingBox();
 const tabs=await page.locator('.mobile-tabs').boundingBox();
 expect(Math.round(tabs.y-(s.y+s.height))).toBe(6);expect(Math.abs(s.x+s.width/2-195)).toBeLessThanOrEqual(1);
 expect(seg.y).toBeLessThan(200);expect(places.y).toBeLessThan(250);
 await expect(sw.getByRole('button')).toHaveText([/^업데이트/,/^챙길 것/]);
 await tap(page,sw.locator('[data-inbox-pane="todo"]'),390);await expect(page.locator('[data-basket-place-filter]')).toBeHidden();await expect(filterChip(page,'classified')).toBeHidden();await expect(page.locator('[data-inbox-chip="open"]')).toBeVisible();
 // Back on [업데이트] the earlier choice is kept within the visit, with its place row.
 await tap(page,sw.locator('[data-inbox-pane="update"]'),390);await expect(filterChip(page,'classified')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-basket-place-filter]')).toBeVisible();
 expect(f.errors).toEqual([]);
});

// ⑤ 자료실: the [일반 자료|회의자료만] row is gone; the project and category chip rows stay; [회의] narrows to meeting documents.
for(const width of [390,1280])for(const scheme of ['light','dark'])test(`library has no [일반 자료|회의자료만] row and [회의] shows meeting documents ${width} ${scheme}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:scheme});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const state=baseState(),made=new Date().toISOString();
 state.docs.push({id:'meeting-doc',workspace_id:'workspace-1',project_id:'top-a',meeting_id:'meeting-1',title:'합성 회의 결과',category:'회의결과',tags:[],created_at:made},
  {id:'meeting-doc-2',workspace_id:'workspace-1',project_id:null,meeting_id:'meeting-2',title:'합성 회의 자료',category:'회의자료',tags:[],created_at:made});
 await mockApp(page,state);await signIn(page,testOrigin+'/app/?view=library');
 await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
 const docRows=page.locator('#documentList [data-lu-document]');
 await expect(page.locator('#libraryViewFilter')).toHaveCount(0);
 await expect(page.locator('#libraryView')).not.toContainText('회의자료만');
 // LIB-토글트리: 프로젝트 칩 줄은 트리가 대신하고, 그 자리에 [묶기] 줄이 있다.
 await expect(page.locator('#libraryGroupBy .filter-chips, #libraryGroupBy.filter-chips').first()).toBeVisible();await expect(page.locator('#documentProject')).toBeHidden();
 // UI-PC자료실 C: 분류 칩은 여러 개 켜고 끄는 토글(aria-pressed). 들어올 때는 [회의]만 꺼져 회의 자료가 숨는다.
 const category=page.locator('#libraryCategoryFilter');await expect(category.getByRole('button')).toHaveText(['전체','교섭','투쟁','교육','선전','정책','회의','기타']);
 await expect(page.locator('[data-lu-document="meeting-doc"]')).toHaveCount(0);await expandLibraryTree(page);await expect(docRows.first()).toBeVisible();
 await capture(page,info,`library-all-${width}-${scheme}`);
 const meetingChip=category.getByRole('button',{name:'회의',exact:true});await expect(meetingChip).toHaveAttribute('aria-pressed','false');await meetingChip.scrollIntoViewIfNeeded();
 await tap(page,meetingChip,width);await expect(meetingChip).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('[data-lu-document="meeting-doc"]')).toBeVisible();await expect(page.locator('[data-lu-document="meeting-doc-2"]')).toBeVisible();
 // 다른 분류를 모두 끄면 회의 자료만 남는다.
 for(const name of ['교섭','투쟁','교육','선전','정책','기타']){const chip=category.getByRole('button',{name,exact:true});await chip.scrollIntoViewIfNeeded();await tap(page,chip,width);await expect(chip).toHaveAttribute('aria-pressed','false')}
 await expect.poll(()=>docRows.evaluateAll(els=>els.map(el=>el.dataset.luDocument).sort())).toEqual(['meeting-doc','meeting-doc-2']);
 await capture(page,info,`library-meeting-${width}-${scheme}`);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

// STAB-간헐3: a segment tap while the list is still loading must not say "no updates"; the row appears once the read answers.
test('a segment tap during the first basket read keeps the loading line and then shows the memo',async({page})=>{
 const f=await fixture(page,{width:1280});
 let release;const gate=new Promise(resolve=>{release=resolve});
 await page.route(SB+'/rest/v1/app_notes?**',async route=>{await gate;return route.fallback();});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 const status=page.locator('[data-basket-list-status]');
 await expect(status).toHaveText('불러오는 중…');
 for(const segment of ['classified','unclassified']){
  await filterChip(page,segment).click();await expect(filterChip(page,segment)).toHaveAttribute('aria-pressed','true');
  await expect(status).toHaveText('불러오는 중…');await expect(status).not.toHaveAttribute('data-basket-empty','');
 }
 release();
 await expect(page.locator(`[data-basket-row="${PLAIN}"]`)).toBeVisible();
 await expect(status).toHaveText('2개 업데이트');
 expect(f.errors).toEqual([]);
});
