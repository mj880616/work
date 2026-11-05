import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// ORG-기록첨부(S50-22): 담당조직 기록 칸에 그림·파일(📎·끌어 놓기·Ctrl+V) → 업데이트 첨부와 같은 길로 저장(이 조직 연결 + 조직 자료).
// 글 없이 파일만이면 서버 AI 한 줄(library-files mode=record_line)이 연결 요약이 되고, AI가 안 되면 파일 이름 줄. 글이 있으면 글이 기록.
// 기록 목록에는 연결 줄 아래 그림(작게)·파일(이름)이 보인다.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const pasteInto=(locator,files)=>locator.evaluate((el,files)=>{const dt=new DataTransfer();for(const f of files)dt.items.add(new File([new Uint8Array([137,80,78,71,13,10])],f.name,{type:f.type}));el.focus();const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});el.dispatchEvent(ev);return ev.defaultPrevented},files);

async function fixture(page,width,{aiLine='합성 공문 사진 · 교섭 일정 안내임.',aiFail=false}={}){
 await page.setViewportSize({width,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const home=await openHome(page),s={uploads:0,lines:[],confirms:[],orgPosts:[],docPatches:[],links:[]};
 const note={id:'up-1',workspace_id:'w',kind:'basket',raw_text:'',doc:null,occurred_at:'2026-10-06T01:00:00Z',created_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:01Z',archived_at:null,ai_export_allowed:true,attachments:[{drive_file_id:'drv1',file_name:'캡처.png',mime_type:'image/png',size_bytes:6}],metadata:{}};
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',r=>{if(r.request().method()!=='POST')return r.fallback();s.uploads++;return r.fulfill({json:{ok:true,note_id:'up-1',attachments:note.attachments}})});
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/library-files',r=>{if(r.request().method()!=='POST')return r.fallback();const body=r.request().postDataBuffer()?.toString('utf8')||'';s.lines.push(/name="mode"\r\n\r\nrecord_line/.test(body));return aiFail?r.fulfill({status:500,json:{error:'x'}}):r.fulfill({json:{ok:true,line:aiLine}})});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{const q=new URL(r.request().url()).searchParams;if(r.request().method()==='GET'&&q.get('id')==='eq.up-1')return r.fulfill({json:[note]});return r.fallback()});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_basket_confirm_links',r=>{const body=r.request().postDataJSON();s.confirms.push(body);s.links=[{id:'l1',workspace_id:'w',summary:body.p_targets[0].summary??null,note_id:'up-1',organization_id:'o',project_id:null,status:'confirmed',note:{...note,kind:'basket',title:null}}];return r.fulfill({json:{ok:true,created:1,existing:0}})});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>r.request().method()==='GET'?r.fulfill({json:s.links}):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/document-actions',r=>r.fulfill({json:{ok:true,result:'created',document:{id:'doc1',title:'캡처'}}}));
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_documents',r=>{if(r.request().method()==='PATCH'){const b=r.request().postDataJSON();s.docPatches.push(b);return r.fulfill({json:[{id:'doc1',project_id:null,organization_id:b.organization_id,file_id:'drv1'}]})}return r.fallback()});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>r.request().method()==='POST'?(s.orgPosts.push(r.request().postDataJSON()),r.fulfill({status:201,json:[{id:'u1'}]})):r.fallback());
 await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();
 await expect(page.locator('#wdModal')).toBeVisible();
 await expect(page.locator('#wdInboxClip [data-basket-clip]')).toBeVisible();
 return {...home,errors,s};
}

for(const width of [412,1440]){
 test(`그림만 붙여 넣고 저장: AI 한 줄이 기록 줄, 그림은 조직 자료로, 목록에 작은 그림 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  expect(await pasteInto(page.locator('#wdInboxText'),[{name:'image.png',type:'image/png'}])).toBe(true);
  await expect(page.locator('#wdInboxFiles [data-basket-file]')).toHaveCount(1);
  await expect(page.locator('#wdInboxFiles')).toBeVisible();
  await page.locator('#wdInboxSave').click();
  await expect(page.locator('#wdInboxState')).toHaveText('저장했습니다.');
  expect(f.s.uploads).toBe(1);expect(f.s.lines).toEqual([true]);
  expect(f.s.confirms[0].p_targets).toEqual([{kind:'organization',target_id:'o',reason:'직접 연결',summary:'합성 공문 사진 · 교섭 일정 안내임.'}]);
  expect(f.s.docPatches.map(p=>p.organization_id)).toEqual(['o']);expect(f.s.orgPosts).toEqual([]);
  const row=page.locator('#wdUpdates [data-basket-link="l1"]');
  await expect(row.locator('[data-link-summary-text]')).toHaveText('합성 공문 사진 · 교섭 일정 안내임.');
  await expect(row.locator('[data-record-photo="drv1"]')).toBeVisible();
  await expect(page.locator('#wdInboxFiles [data-basket-file]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });
}

test('AI가 안 되면 파일 이름 줄로 저장(저장은 막지 않음)',async({page})=>{
 const f=await fixture(page,412,{aiFail:true});
 await pasteInto(page.locator('#wdInboxText'),[{name:'image.png',type:'image/png'}]);
 await page.locator('#wdInboxSave').click();
 await expect(page.locator('#wdInboxState')).toHaveText('저장했습니다.');
 expect(f.s.confirms[0].p_targets[0].summary).toMatch(/^그림 1장 · 붙여넣은 그림 \d\d-\d\d \d\d:\d\d\.png$/);
});

test('글을 쓰고 파일을 붙이면 글이 기록(AI 부르지 않음), 글만이면 예전처럼 조직 기록 표',async({page})=>{
 const f=await fixture(page,1440);
 await page.locator('#wdInboxText').fill('교섭 통화 메모');
 await pasteInto(page.locator('#wdInboxText'),[{name:'image.png',type:'image/png'}]);
 await page.locator('#wdInboxSave').click();
 await expect(page.locator('#wdInboxState')).toHaveText('저장했습니다.');
 expect(f.s.lines).toEqual([]);expect(f.s.confirms[0].p_targets).toEqual([{kind:'organization',target_id:'o',reason:'직접 연결'}]);
 await page.locator('#wdInboxText').fill('글만 쓴 기록');await page.locator('#wdInboxSave').click();
 await expect.poll(()=>f.s.orgPosts.length).toBe(1);expect(f.s.orgPosts[0].raw_text).toBe('글만 쓴 기록');
});
