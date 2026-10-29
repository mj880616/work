import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';

// UI-바구니거르기2: 바구니 [분류] 아래 분류된 곳 칩 중 [담당조직]·[프로젝트]는 그 아래 한 줄에 이름 칩
// ([모든 ○○ N] + 연결된 메모가 있는 곳만, 많은 순), [자료실]은 자료 분류 7개 칩. [전체]·[할 일]은 그 줄이 없다.
// 이미 읽는 확정 연결 기록·[자료로 넣기] 자료만으로 정한다. Supabase REST 경계만 합성이고 화면은 실제 앱이다.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z';
const reviewDir=process.env.UI_REVIEW_DIR||'';
const id=n=>'10000000-0000-4000-8000-0000000000'+String(n).padStart(2,'0');
const ORG_A1=id(1),ORG_A2=id(2),ORG_B=id(3),PROJ_X=id(4),FILED=id(5),DOC_T=id(6),DOC_M=id(7),TASK=id(8),PLAIN=id(9);
const OA='30000000-0000-4000-8000-00000000000a',OB='30000000-0000-4000-8000-00000000000b';
const PX='20000000-0000-4000-8000-00000000000a',PY='20000000-0000-4000-8000-00000000000b';
const ORGS=['합성 한빛지부','합성 두리지부','합성 세움지부','합성 나래지부','합성 다온지부','합성 마루지부','합성 바다지부'];
const matching=(rows,query)=>rows.filter(row=>[...query].every(([key,value])=>['select','order','limit','offset'].includes(key)||(value.startsWith('eq.')?String(row[key]??'')===value.slice(3):value.startsWith('in.(')?value.slice(4,-1).split(',').includes(String(row[key])):true)));

async function fixture(page,{width=390,scheme='light',manyOrgs=false}={}){
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:scheme});
 await openHome(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const note=(nid,raw,extra={})=>({id:nid,workspace_id:'w',kind:'basket',occurred_at:stamp,updated_at:stamp,raw_text:raw,ai_export_allowed:true,archived_at:null,attachments:[],metadata:{},...extra});
 const link=(lid,nid,extra)=>({id:lid,workspace_id:'w',note_id:nid,status:'confirmed',project_id:null,organization_id:null,meeting_id:null,document_id:null,...extra});
 const tables={
  app_notes:[
   note(ORG_A1,'합성 한빛 첫 메모'),note(ORG_A2,'합성 한빛 둘째 메모'),note(ORG_B,'합성 두리 메모'),
   note(PROJ_X,'합성 임단협 메모'),
   note(FILED,'',{attachments:[{drive_file_id:'drive-hwp',file_name:'합성 궤도 정책.hwp',mime_type:'application/x-hwp',size_bytes:2048}]}),
   note(DOC_T,'합성 교섭 자료 메모'),note(DOC_M,'합성 회의 자료 메모'),
   note(TASK,'합성 할 일 만든 메모',{metadata:{tasks:[{task_id:'g-task-1',task_list_id:'@default',title:'합성 회신',created_at:'2026-10-06T02:00:00.000Z'}]}}),
   note(PLAIN,'합성 아직 안 나눈 메모'),
  ],
  app_record_links:[
   link('l1',ORG_A1,{organization_id:OA,organization:{name:'합성 한빛지부'}}),
   link('l2',ORG_A2,{organization_id:OA,organization:{name:'합성 한빛지부'}}),
   link('l3',ORG_B,{organization_id:OB,organization:{name:'합성 두리지부'}}),
   link('l4',PROJ_X,{project_id:PX,project:{name:'합성 임단협'}}),
   link('l5',DOC_T,{document_id:'doc-t',document:{title:'합성 요구안',category:'교섭자료'}}),
   link('l6',DOC_M,{document_id:'doc-m',document:{title:'합성 회의 결과',category:'회의결과'}}),
   // A stored suggestion is not a place yet.
   {...link('l7',PLAIN,{organization_id:OB,organization:{name:'합성 두리지부'}}),status:'suggested'},
  ],
  app_documents:[{id:'doc-hwp',workspace_id:'w',project_id:PY,meeting_id:null,title:'합성 궤도 정책',file_id:'drive-hwp',file_name:'합성 궤도 정책.hwp',category:'정책',created_at:'2026-09-14T01:00:00Z'}],
  app_spaces:[{id:PY,workspace_id:'w',owner_id:'home-test',name:'합성 궤도',status:'active',visibility:'private',sort_order:10,parent_id:null,created_at:stamp,updated_at:stamp,metadata:{project_system:'v2'}}],
 };
 if(manyOrgs)ORGS.slice(2).forEach((name,i)=>{const nid=id(20+i);tables.app_notes.push(note(nid,`합성 ${name} 메모`));tables.app_record_links.push(link('lm'+i,nid,{organization_id:'30000000-0000-4000-8000-0000000001'+String(i).padStart(2,'0'),organization:{name}}));});
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
async function tap(page,locator,width){await locator.scrollIntoViewIfNeeded();await expect(locator).toBeVisible();if(width<761){const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();}
const shown=page=>page.locator('#basketView [data-basket-row]').evaluateAll(els=>els.map(el=>el.dataset.basketRow));
async function capture(page,info,name){
 const path=reviewDir?`${reviewDir}/${name}.png`:info.outputPath(name+'.png');
 if(reviewDir)mkdirSync(reviewDir,{recursive:true});
 await page.screenshot({path,fullPage:false});
}
async function enter(page,width){
 await tap(page,page.locator('.mobile-tabs [data-view="basket"]:visible,.app-nav [data-view="basket"]:visible'),width);
 await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('#basketView [data-basket-row]').first()).toBeVisible();await expect(page.locator('[data-basket-list-status]')).toHaveText('');
 await tap(page,page.locator('#basketView [data-basket-filter="classified"]'),width);
}

for(const width of [390,1280])for(const scheme of ['light','dark'])test(`[분류] second row: organization and project names, 7 categories ${width} ${scheme}`,async({page},info)=>{
 const f=await fixture(page,{width,scheme});await enter(page,width);
 const places=page.locator('[data-basket-place-filter]'),subs=page.locator('[data-basket-sub-filter]');
 const place=label=>places.getByRole('radio',{name:label,exact:true}),subChip=label=>subs.getByRole('radio',{name:label,exact:true});
 // [전체] has no second row.
 await expect(places.locator('[aria-checked="true"]')).toHaveText('전체');await expect(subs).toBeHidden();
 expect(await shown(page)).toEqual([ORG_A1,ORG_A2,ORG_B,PROJ_X,FILED,DOC_T,DOC_M,TASK]);

 // ① [담당조직] → [모든 조직 3] + organizations with a memo, most first (the suggested-only link makes no extra count).
 await tap(page,place('담당조직'),width);
 await expect(subs).toBeVisible();await expect(subs).toHaveAttribute('role','radiogroup');await expect(subs).toHaveAttribute('aria-label','조직');
 await expect(subs.getByRole('radio')).toHaveText(['모든 조직 3','합성 한빛지부','합성 두리지부']);
 await expect(subs.locator('[aria-checked="true"]')).toHaveText('모든 조직 3');
 // Same pill as the rows above (32px, 44px touch), sitting right below the place row and above the list.
 const look=l=>l.evaluate(el=>({h:el.getBoundingClientRect().height,touch:parseFloat(getComputedStyle(el,'::after').height),bg:getComputedStyle(el).backgroundColor}));
 const gray=await page.evaluate(()=>{const p=document.createElement('i');p.style.color='var(--ds-select-bg)';document.querySelector('#appView').append(p);const c=getComputedStyle(p).color;p.remove();return c;});
 const first=subs.getByRole('radio').first();expect((await look(first)).h).toBe(32);expect((await look(first)).touch).toBe(44);expect((await look(first)).bg).toBe(gray);
 const pb=await places.boundingBox(),sb=await subs.boundingBox(),lb=await page.locator('#basketView [data-basket-rows]').boundingBox();
 expect(sb.y).toBeGreaterThanOrEqual(pb.y+pb.height-1);expect(sb.y+sb.height).toBeLessThanOrEqual(lb.y+1);
 expect(await shown(page)).toEqual([ORG_A1,ORG_A2,ORG_B]);
 await capture(page,info,`basket-sub-organization-${width}-${scheme}`);
 await tap(page,subChip('합성 두리지부'),width);await expect.poll(()=>shown(page)).toEqual([ORG_B]);
 expect((await look(subChip('합성 두리지부'))).bg).toBe(gray);
 await tap(page,subChip('합성 한빛지부'),width);await expect.poll(()=>shown(page)).toEqual([ORG_A1,ORG_A2]);
 // Keyboard: arrows move along the names (shared filter-chips.js).
 await subs.locator('[aria-checked="true"]').focus();await page.keyboard.press('ArrowRight');
 await expect(subs.locator('[aria-checked="true"]')).toHaveText('합성 두리지부');await expect.poll(()=>shown(page)).toEqual([ORG_B]);

 // ② Changing the place starts its own row at [모든 ○○]. [프로젝트]: a link's project and a [자료로 넣기] project.
 await tap(page,place('사업영역'),width);await expect(subs).toHaveAttribute('aria-label','사업영역');
 await expect(subs.getByRole('radio')).toHaveText(['모든 사업영역 2','합성 궤도','합성 임단협']);
 await expect(subs.locator('[aria-checked="true"]')).toHaveText('모든 사업영역 2');expect(await shown(page)).toEqual([PROJ_X,FILED]);
 await tap(page,subChip('합성 궤도'),width);await expect.poll(()=>shown(page)).toEqual([FILED]);
 await capture(page,info,`basket-sub-project-${width}-${scheme}`);

 // ③ [자료실]: [모든 자료 N] + the 7 categories; old names map in (교섭자료→교섭, 회의결과→회의).
 await tap(page,place('자료실'),width);await expect(subs).toHaveAttribute('aria-label','자료 분류');
 await expect(subs.getByRole('radio')).toHaveText(['모든 자료 3','교섭','투쟁','교육','선전','정책','회의','기타']);
 expect(await shown(page)).toEqual([FILED,DOC_T,DOC_M]);
 for(const [label,want] of [['교섭',[DOC_T]],['회의',[DOC_M]],['정책',[FILED]],['투쟁',[]]]){
  await tap(page,subChip(label),width);await expect(subs.locator('[aria-checked="true"]')).toHaveText(label);
  await expect.poll(()=>shown(page),label).toEqual(want);
  if(label==='회의')await capture(page,info,`basket-sub-library-${width}-${scheme}`);
 }
 await expect(page.locator('[data-basket-list-status]')).toHaveText('업데이트 없음');

 // ④ [할 일] has no second row; [전체] neither.
 await tap(page,place('할 일'),width);await expect(subs).toBeHidden();await expect.poll(()=>shown(page)).toEqual([TASK]);
 await tap(page,place('전체'),width);await expect(subs).toBeHidden();

 // ⑤ Choosing another segment hides both rows; coming back starts at [전체] with no second row.
 await tap(page,place('담당조직'),width);await tap(page,subChip('합성 두리지부'),width);
 await tap(page,page.locator('#basketView [data-basket-filter="unclassified"]'),width);await expect(places).toBeHidden();await expect(subs).toBeHidden();
 expect(await shown(page)).toEqual([PLAIN]);
 await tap(page,page.locator('#basketView [data-basket-filter="classified"]'),width);await expect(subs).toBeHidden();
 await tap(page,place('담당조직'),width);await expect(subs.locator('[aria-checked="true"]')).toHaveText('모든 조직 3');
 // Opening a memo hides the rows; closing brings them back with the same choice.
 await tap(page,subChip('합성 두리지부'),width);await tap(page,page.locator(`[data-basket-row="${ORG_B}"]`),width);
 await expect(page.locator('[data-basket-read-text]')).toBeVisible();await expect(subs).toBeHidden();await expect(places).toBeHidden();
 await tap(page,page.locator('[data-basket-close]'),width);
 await expect(subs).toBeVisible();await expect(subs.locator('[aria-checked="true"]')).toHaveText('합성 두리지부');await expect.poll(()=>shown(page)).toEqual([ORG_B]);
 // Leaving the basket and coming back starts again at [미분류].
 await page.evaluate(()=>window.KPTURouter.go('home'));
 await tap(page,page.locator('.mobile-tabs [data-view="basket"]:visible,.app-nav [data-view="basket"]:visible'),width);
 await expect(page.locator('#basketView [data-basket-filter="unclassified"]')).toHaveAttribute('aria-pressed','true');await expect(subs).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

// ⑥ Phone: a long row of names stays one line and slides sideways like the other chip rows; the page never scrolls sideways.
test('phone: many organization names slide sideways in one line',async({page},info)=>{
 const f=await fixture(page,{width:390,manyOrgs:true});await enter(page,390);
 const places=page.locator('[data-basket-place-filter]'),subs=page.locator('[data-basket-sub-filter]');
 await tap(page,places.getByRole('radio',{name:'담당조직',exact:true}),390);
 await expect(subs.getByRole('radio')).toHaveCount(8);
 await expect(subs.getByRole('radio').first()).toHaveText('모든 조직 8');await expect(subs.getByRole('radio').nth(1)).toHaveText('합성 한빛지부');
 const box=await subs.evaluate(el=>({sw:el.scrollWidth,cw:el.clientWidth,ox:getComputedStyle(el).overflowX,wrap:getComputedStyle(el).flexWrap,tops:[...el.children].map(c=>Math.round(c.getBoundingClientRect().top))}));
 expect(box.sw).toBeGreaterThan(box.cw);expect(box.ox).toBe('auto');expect(box.wrap).toBe('nowrap');expect(new Set(box.tops).size).toBe(1);
 // Same scroll setup as the place row above.
 expect(await places.evaluate(el=>getComputedStyle(el).overflowX)).toBe('auto');
 // Choosing the last chip brings it into view (filter-chips.js reveal) and narrows the list.
 const last=subs.getByRole('radio').last();await last.scrollIntoViewIfNeeded();await tap(page,last,390);
 await expect(last).toHaveAttribute('aria-checked','true');await expect.poll(()=>subs.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
 await expect.poll(()=>shown(page)).toHaveLength(1);
 await capture(page,info,'basket-sub-organization-many-390-light');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
