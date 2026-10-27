import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {typeInto} from './helpers/note-editor.mjs';
// ED③ 기록(설계 11.4 순서 5): 담당조직 기록의 서식. 서식이 있는 기록(doc)은 목록에서 서식 그대로 보이고, [수정]은 새 큰 창에서만 연다.
// 서식이 없는 옛 기록은 글자로 보이고, 인라인 칸의 ⤢로 새 창을 열어 저장하면 글자와 서식(doc)이 한 번에 저장된다(doc이 없는 줄에만 쓰기).
// 저장 직전 그 기록을 다시 읽어 그사이 다른 곳에서 바뀌었으면 거절한다. 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const org={id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp};
const DOC={v:'ed1',doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'굵게 쓴 기록',marks:[{type:'strong'}]}]}]}};
async function fixture(page){
 await page.setViewportSize({width:1280,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const state={reads:[],patches:[],
  updates:[
   {id:'u-doc',organization_id:'oa',raw_text:'굵게 쓴 기록',detail_text:null,occurred_at:'2026-09-30T02:00:00Z',doc:DOC},
   {id:'u-old',organization_id:'oa',raw_text:'옛 글자 기록',detail_text:null,occurred_at:'2026-09-29T02:00:00Z',doc:null}]};
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return route.fulfill({json:id?[org].filter(o=>'eq.'+o.id===id):[org]})});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>route.fulfill({json:[{user_id:owner,organization_id:'oa'}]}));
 await page.route(SB+'/rest/v1/app_notes?**',route=>route.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_record_links?**',route=>route.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>{
  const req=route.request(),url=new URL(req.url()),q=url.searchParams,id=(q.get('id')||'').replace(/^eq\./,'');
  if(req.method()==='PATCH'){
   const body=req.postDataJSON();state.patches.push({url:req.url(),body});
   const row=state.updates.find(u=>u.id===id);
   if(!row||(q.get('doc')==='is.null'&&row.doc))return route.fulfill({json:[]});
   Object.assign(row,body);return route.fulfill({json:[row]});
  }
  if(req.method()!=='GET')return route.fallback();
  if(id){state.reads.push(id);return route.fulfill({json:state.updates.filter(u=>u.id===id)})}
  return route.fulfill({json:state.updates.filter(u=>q.get('organization_id')==='eq.'+u.organization_id)});
 });
 return {state,errors};
}
const recordMenu=async(page,rec,name)=>{await rec.locator('[data-wd-up-menu]').click();await page.locator('#wdUpMenu').getByRole('button',{name}).click()};

test('서식이 있는 기록은 목록에서 서식 그대로, 서식 없는 옛 기록은 글자로 보인다',async({page})=>{
 const {errors}=await fixture(page);
 await clickView(page,'team');await expect(page.locator('#wdTitle')).toHaveText('합성 가 지부');
 const doc=page.locator('#wdUpdates [data-wd-up="u-doc"]'),old=page.locator('#wdUpdates [data-wd-up="u-old"]');
 await expect(doc.locator('[data-rec-doc] strong')).toHaveText('굵게 쓴 기록');
 await expect(old.locator('[data-rec-doc]')).toHaveCount(0);await expect(old.locator('.wd-log-main p')).toContainText('옛 글자 기록');
 expect(errors).toEqual([]);
});

test('서식 있는 기록 [수정]은 새 큰 창에서만 열리고, 저장하면 글자와 서식이 한 번에 저장된다',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'team');const rec=page.locator('#wdUpdates [data-wd-up="u-doc"]');await expect(rec).toBeVisible();
 await recordMenu(page,rec,'수정');
 const win=page.locator('#edWindow'),text=win.locator('.ed-window-body .ProseMirror');
 await expect(win).toBeVisible();await expect(text.locator('strong')).toHaveText('굵게 쓴 기록');
 await expect(rec.locator('[data-wd-up-edit]')).toHaveCount(0);
 // Opening alone writes nothing, and an unchanged close does not either.
 expect(state.patches).toEqual([]);
 await typeInto(page,text,'고친 기록');
 await win.locator('[data-edw-save]').click();await expect(win).toHaveCount(0);
 expect(state.patches).toHaveLength(1);
 expect(state.patches[0].body).toMatchObject({raw_text:'고친 기록'});expect(state.patches[0].body.doc).toMatchObject({v:'ed1'});
 expect(state.patches[0].url).not.toContain('doc=is.null');
 await expect(page.locator('#wdUpdates [data-wd-up="u-doc"] .wd-log-main')).toContainText('고친 기록');
 expect(errors).toEqual([]);
});

test('서식 없는 옛 기록: 인라인 칸의 ⤢로 새 창을 열어 저장하면 글자와 서식이 함께 저장되고(doc 없는 줄에만), 칸이 닫힌다',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'team');const rec=page.locator('#wdUpdates [data-wd-up="u-old"]');await expect(rec).toBeVisible();
 await recordMenu(page,rec,'수정');
 await rec.locator('[data-wd-field-big]').click();
 const win=page.locator('#edWindow'),text=win.locator('.ed-window-body .ProseMirror');
 await expect(win).toBeVisible();await expect(text).toContainText('옛 글자 기록');expect(state.patches).toEqual([]);
 await typeInto(page,text,'새 창에서 고친 옛 기록');
 await win.locator('[data-edw-save]').click();await expect(win).toHaveCount(0);
 expect(state.patches).toHaveLength(1);
 expect(state.patches[0].url).toContain('doc=is.null');
 expect(state.patches[0].body).toMatchObject({raw_text:'새 창에서 고친 옛 기록'});expect(state.patches[0].body.doc).toMatchObject({v:'ed1'});
 await expect(rec.locator('[data-wd-up-edit]')).toHaveCount(0);
 await expect(page.locator('#wdUpdates [data-wd-up="u-old"] .wd-log-main')).toContainText('새 창에서 고친 옛 기록');
 expect(errors).toEqual([]);
});

test('그사이 다른 곳에서 바뀐 기록은 덮어쓰지 않고 안내한다',async({page})=>{
 const {state,errors}=await fixture(page);
 await clickView(page,'team');const rec=page.locator('#wdUpdates [data-wd-up="u-doc"]');await expect(rec).toBeVisible();
 await recordMenu(page,rec,'수정');
 const win=page.locator('#edWindow'),text=win.locator('.ed-window-body .ProseMirror');await expect(win).toBeVisible();
 state.updates.find(u=>u.id==='u-doc').raw_text='다른 기기에서 고친 글';
 await typeInto(page,text,'내가 고친 글');
 await win.locator('[data-edw-save]').click();
 await expect(win.locator('.ed-window-status')).toContainText('다른 곳에서 바뀐 기록이에요');
 expect(state.patches).toEqual([]);await expect(win).toBeVisible();
 expect(errors).toEqual([]);
});
