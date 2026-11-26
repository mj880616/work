import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectDetail} from './helpers/project-detail.mjs';
// RECORD-기록하나로(S71-71, 사용자 결정 2026-11-26 "조직 보고로 한 번 편입되면 걍 조직 기록이야 / 업데이트고 잊지말기고 원문이고 뭐고 없어
// 걍 메뉴도 다 통일 / 수정 / 날짜 수정 - 이건 수정에 넣어 / 메모 / 삭제"): 직접 쓴 기록·통화에서 옮긴 기록·사진 기록·파일 기록·업데이트(잊지 말기)에서
// 연결한 기록·노트에서 연결한 기록이 모두 같은 줄 모양(글자색·굵기·날짜 칸·꺾쇠 자리, 출처 표시 없음)이고 ⋯ 메뉴는 [수정][메모][삭제] 셋.
// 직접 쓴 기록의 [수정] 칸에서 날짜와 글을 함께 고쳐 저장하고, 연결 기록의 [수정]·[삭제]는 원문(app_notes)을 건드리지 않는다. 자료는 모두 가짜.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const LONG=Array.from({length:8},(_,i)=>`가짜 긴 기록 ${i+1}번째 줄`).join('\n');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const ph={drive_file_id:'drvOne1',file_name:'가짜 사진.jpg',mime_type:'image/jpeg',size_bytes:1000};
const PDF={drive_file_id:'drvOnePdf',file_name:'가짜 공문.pdf',mime_type:'application/pdf',size_bytes:2000};
const link=(id,summary,at,{attachments=[],kind='basket',title=null,place='o',raw=null}={})=>({id,workspace_id:'w',summary,origin:kind==='basket'?'basket':null,note_id:'n-'+id,organization_id:place==='o'?'o':null,project_id:place==='p'?'p':null,status:'confirmed',note:{id:'n-'+id,workspace_id:'w',occurred_at:at,raw_text:raw??(summary||''),kind,title,metadata:null,attachments}});
const links=place=>[
 link('l-upd',null,'2026-10-05T03:00:00Z',{place,raw:'가짜 업데이트에서 연결한 기록'}),
 link('l-photo','','2026-10-04T03:00:00Z',{attachments:[ph],place}),
 link('l-file','가짜 공문 기록','2026-10-03T03:00:00Z',{attachments:[PDF],place}),
 link('l-note',null,'2026-10-02T03:00:00Z',{kind:'note',title:'가짜 노트 제목',place,raw:'가짜 노트 글'}),
];
async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 const home=await openHome(page);
 let ups=[
  {id:'u-direct',organization_id:'o',raw_text:'가짜 직접 쓴 기록',occurred_at:'2026-10-06T03:00:00Z',end_day:null,day_none:false,source_kind:null,source_id:null,created_at:'2026-10-06T03:00:00Z'},
  {id:'u-call',organization_id:'o',raw_text:LONG,occurred_at:'2026-10-05T05:00:00Z',end_day:null,day_none:false,source_kind:'feed',source_id:'f-1',created_at:'2026-10-05T05:00:00Z'},
 ];
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>{
  const req=r.request(),u=new URL(req.url());
  if(req.method()==='DELETE'){writes.push({method:'DELETE',path:u.pathname,query:u.search});return r.fulfill({json:[{id:(u.searchParams.get('id')||'').replace(/^eq\./,'')}]})}
  if(req.method()!=='GET'||Number(u.searchParams.get('offset')||0))return r.fulfill({json:[]});
  const place=u.searchParams.get('organization_id')==='in.(o)'?'o':u.searchParams.get('project_id')==='in.(p)'?'p':null;
  const one=(u.searchParams.get('id')||'').replace(/^eq\./,'');
  const rows=place?links(place):one?links('o').filter(x=>x.id===one):[];
  return r.fulfill({json:rows});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>{
  const req=r.request(),u=new URL(req.url());
  if(req.method()==='PATCH'){const body=req.postDataJSON(),id=(u.searchParams.get('id')||'').replace(/^eq\./,'');writes.push({method:'PATCH',path:u.pathname,body});ups=ups.map(x=>x.id===id?{...x,...body}:x);return r.fulfill({json:ups.filter(x=>x.id===id)})}
  if(req.method()!=='GET')return r.fallback();
  return r.fulfill({json:ups});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_basket_update_link_summary',r=>{writes.push({method:'POST',path:'rpc/app_basket_update_link_summary',body:r.request().postDataJSON()});return r.fulfill({json:{ok:true}})});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{if(r.request().method()!=='GET')writes.push({method:r.request().method(),path:'app_notes'});return r.request().method()==='GET'?r.fulfill({json:[]}):r.fulfill({status:500,json:{}})});
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',r=>r.request().method()==='GET'?r.fulfill({status:200,contentType:'image/png',body:PNG}):r.fallback());
 return {...home,errors,writes};
}
const ORG={rows:['u-direct','u-call','l-upd','l-photo','l-file','l-note'],row:id=>`#wdUpdates [data-wd-up="${id}"],#wdUpdates [data-basket-link="${id}"]`,
 text:'.wd-log-main>:is(p,.wd-doc):first-child,[data-link-summary-text]',more:'[data-wd-up-menu],[data-basket-link-menu]',menu:id=>id.startsWith('u-')?'#wdUpMenu':'#basketLinkMenu',
 open:async page=>{await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();await expect(page.locator('#wdModal')).toBeVisible();}};
const PRJ={rows:['l-upd','l-photo','l-file','l-note'],row:id=>`#ps3Body [data-ps3-records]>[data-basket-link="${id}"]`,text:'.ps3-rec-text',more:'[data-ps3-record-menu]',menu:()=>'#ps3RecordMenu',
 open:async page=>{await clickView(page,'projects');await page.locator('#projectGrid .ps3-plist [data-ps3-project="p"]').click();await expectProjectDetail(page,'p');}};
const look=(page,s,id)=>page.locator(s.row(id)).evaluate((el,sel)=>{const t=el.querySelector(sel),cs=getComputedStyle(t);return {color:cs.color,weight:cs.fontWeight,size:cs.fontSize,links:el.querySelectorAll('a[href]').length,marks:el.querySelectorAll('[data-record-mark],.basket-link-mark,.ps3-rec-mark').length,label:/잊지 말기|노트 연결|업데이트 연결|원래 (글|통화|업데이트)/.test(el.textContent)}},s.text);

for(const width of [390,1280])for(const [name,s] of [['조직 관리',ORG],['사업 관리',PRJ]]){
 test(`${name} 기록: 출처가 다른 줄이 모두 같은 모양 · ⋯ = [수정][메모][삭제] ${width}`,async({page})=>{
  const f=await fixture(page,width);await s.open(page);
  for(const id of s.rows)await expect(page.locator(s.row(id))).toBeVisible();
  const looks=[];for(const id of s.rows)looks.push(await look(page,s,id));
  for(const [i,l] of looks.entries()){
   expect(l.links,s.rows[i]).toBe(0);expect(l.marks,s.rows[i]).toBe(0);expect(l.label,s.rows[i]).toBe(false);
   expect([l.color,l.weight,l.size],s.rows[i]).toEqual([looks[0].color,looks[0].weight,looks[0].size]);
  }
  for(const id of s.rows){
   await page.locator(s.row(id)).locator(s.more).click();
   const menu=page.locator(s.menu(id));await expect(menu).toBeVisible();
   await expect(menu.locator('button')).toHaveText([/^수정$/,/^메모( \d+)?$/,/^삭제$/]);
   await page.keyboard.press('Escape');await expect(menu).toBeHidden();
  }
  // 노트에서 연결된 줄의 글을 눌러도 노트로 가지 않는다
  await page.locator(s.row('l-note')).locator(s.text).click();await page.waitForTimeout(150);
  await expect(page.locator('#kptuRecordSheet')).toBeHidden();expect(await page.evaluate(()=>window.KPTURouter.current)).not.toBe('basket');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });
}

for(const width of [390,1280])test(`조직 관리 직접 쓴 기록 [수정]: 날짜(달력)와 글을 함께 고쳐 저장 · 다시 열어도 유지 ${width}`,async({page})=>{
 const f=await fixture(page,width);await ORG.open(page);
 const row=page.locator(ORG.row('u-direct'));
 await row.locator('[data-wd-up-menu]').click();await page.locator('#wdUpMenu').getByRole('button',{name:'수정',exact:true}).click();
 const form=row.locator('[data-wd-up-edit]');await expect(form).toBeVisible();
 const day=form.locator('[data-wdue-field="day"]');await expect(day).toHaveValue('2026-10-06');await expect(day).toHaveAttribute('type','date');
 await expect(form.locator('[data-wdue-mode="day"]')).toHaveAttribute('aria-pressed','true');
 await day.fill('2026-10-01');await form.locator('textarea').fill('가짜 고친 기록');
 await form.locator('[data-wd-up-save]').click();await expect(form).toHaveCount(0);
 const patch=f.writes.filter(w=>w.method==='PATCH');expect(patch).toHaveLength(1);
 expect(patch[0].body.raw_text).toBe('가짜 고친 기록');expect(String(patch[0].body.occurred_at)).toMatch(/^2026-10-01/);
 await expect(row.locator('.wd-log-day')).toHaveText('10.1.');await expect(row).toContainText('가짜 고친 기록');
 // 다시 열면 고친 날짜·글 그대로
 await row.locator('[data-wd-up-menu]').click();await page.locator('#wdUpMenu').getByRole('button',{name:'수정',exact:true}).click();
 await expect(row.locator('[data-wdue-field="day"]')).toHaveValue('2026-10-01');await expect(row.locator('[data-wd-up-edit] textarea')).toHaveValue('가짜 고친 기록');
 await row.locator('[data-wd-up-cancel]').click();await expect(row.locator('[data-wd-up-edit]')).toHaveCount(0);
 expect(f.writes.filter(w=>w.path==='app_notes')).toEqual([]);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`연결 기록 [수정]은 기록 글만 · [삭제]는 이 기록만 — 원문(업데이트·노트)은 그대로 ${width}`,async({page})=>{
 const f=await fixture(page,width);await ORG.open(page);
 const row=page.locator(ORG.row('l-upd'));
 await row.locator('[data-basket-link-menu]').click();await page.locator('#basketLinkMenu').getByRole('button',{name:'수정',exact:true}).click();
 const form=row.locator('[data-link-summary-form]');await expect(form).toBeVisible();
 await expect(form).not.toContainText('원문');await expect(form.locator('textarea')).toHaveValue('가짜 업데이트에서 연결한 기록');
 await form.locator('textarea').fill('가짜 기록 글 고침');await form.locator('button[type="submit"]').click();
 await expect.poll(()=>f.writes.filter(w=>w.path==='rpc/app_basket_update_link_summary').length).toBe(1);
 const rpc=f.writes.find(w=>w.path==='rpc/app_basket_update_link_summary');expect(rpc.body).toMatchObject({p_link_id:'l-upd',p_summary:'가짜 기록 글 고침'});
 // 삭제: 한 번 묻고 그 연결 줄 하나만 지운다(원문 노트 쓰기 없음)
 const other=page.locator(ORG.row('l-file'));
 await other.locator('[data-basket-link-menu]').click();await page.locator('#basketLinkMenu').getByRole('button',{name:'삭제',exact:true}).click();
 const ask=page.getByRole('alertdialog').or(page.getByRole('dialog').filter({hasText:'이 기록을 삭제할까요?'}));await expect(ask.first()).toContainText('이 기록을 삭제할까요?');
 await ask.first().getByRole('button',{name:'삭제',exact:true}).click();
 await expect.poll(()=>f.writes.filter(w=>w.method==='DELETE').length).toBe(1);
 expect(f.writes.find(w=>w.method==='DELETE').query).toContain('id=eq.l-file');
 expect(f.writes.filter(w=>w.path==='app_notes')).toEqual([]);
 expect(f.errors).toEqual([]);
});
