import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// ORG-기록첨부(S50-22): 담당조직 기록 칸에 그림·파일(📎·끌어 놓기·Ctrl+V) → 업데이트 첨부와 같은 길로 저장(이 조직 연결 + 조직 자료).
// 글 없이 파일만이면 서버 AI 한 줄(library-files mode=record_line)이 연결 요약이 되고, AI가 안 되면 파일 이름 줄. 글이 있으면 글이 기록.
// 기록 목록에는 연결 줄 아래 그림(작게)·파일(이름)이 보인다.
// BIZ-저장먼저닫기 2차(S59-10): [저장]은 글 저장·연결만 기다린다(글이 있으면 그 글이 먼저 업데이트로). 입력칸은 바로 비고, 그림·파일은 뒤에서
// 그 업데이트로 올라간 뒤(글이 없으면 첫 파일이 업데이트를 만든 뒤) AI 한 줄로 기록이 이어지고 조직 자료로 들어간다.
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
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{const q=new URL(r.request().url()).searchParams;if(r.request().method()==='GET'&&q.get('id')==='eq.up-1')return r.fulfill({json:[note]});if(r.request().method()==='POST'){s.notePosts=(s.notePosts||0)+1;return r.fulfill({status:201,json:[{...note,attachments:[],raw_text:r.request().postDataJSON().raw_text}]})}return r.fallback()});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_basket_confirm_links',r=>{const body=r.request().postDataJSON();s.confirms.push(body);s.links=[{id:'l1',workspace_id:'w',summary:body.p_targets[0].summary??null,note_id:'up-1',organization_id:'o',project_id:null,status:'confirmed',note:{...note,kind:'basket',title:null}}];return r.fulfill({json:{ok:true,created:1,existing:0}})});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>r.request().method()==='GET'?r.fulfill({json:s.links}):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/document-actions',r=>r.fulfill({json:{ok:true,result:'created',document:{id:'doc1',title:'캡처'}}}));
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_documents',r=>{if(r.request().method()==='PATCH'){const b=r.request().postDataJSON();s.docPatches.push(b);return r.fulfill({json:[{id:'doc1',project_id:null,organization_id:b.organization_id,file_id:'drv1'}]})}return r.fallback()});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>r.request().method()==='POST'?(s.orgPosts.push(r.request().postDataJSON()),r.fulfill({status:201,json:[{id:'u1'}]})):r.fallback());
 await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();
 await expect(page.locator('#wdModal')).toBeVisible();
 await expect(page.locator('#wdInboxClip [data-basket-clip]')).toBeVisible();
 // STAB-갈래4흔들림: 📎는 창을 만들 때부터 보이지만, 붙여넣기·끌어 놓기는 그 조직을 다 읽은 뒤(수정 권한이 정해진 뒤)부터 받는다.
 // 조직 읽기가 끝났다는 신호(#wdState의 기다림 표시가 사라짐)를 기다린다 — 읽기가 늦으면 붙여넣기가 그냥 지나가던 경쟁.
 await expect(page.locator('#wdState [data-wait]')).toHaveCount(0);
 await expect(page.locator('#wdState')).toHaveText('');
 return {...home,errors,s};
}

for(const width of [412,1440]){
 test(`그림만 붙여 넣고 저장: AI 한 줄이 기록 줄, 그림은 조직 자료로, 목록에 작은 그림 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  expect(await pasteInto(page.locator('#wdInboxText'),[{name:'image.png',type:'image/png'}])).toBe(true);
  await expect(page.locator('#wdInboxFiles [data-basket-file]')).toHaveCount(1);
  await expect(page.locator('#wdInboxFiles')).toBeVisible();
  await page.locator('#wdInboxSave').click();
  await expect(page.locator('#wdInboxState')).toHaveText(''); // UX-알림하나로: 진행은 하단바 위 한 줄 하나
  await expect(page.locator('#wdInboxFiles [data-basket-file]')).toHaveCount(0);
  await expect.poll(()=>f.s.docPatches.map(p=>p.organization_id)).toEqual(['o']);
  expect(f.s.uploads).toBe(1);expect(f.s.lines).toEqual([true]);expect(f.s.notePosts||0).toBe(0);
  expect(f.s.confirms[0].p_targets).toEqual([{kind:'organization',target_id:'o',reason:'직접 연결',summary:'합성 공문 사진 · 교섭 일정 안내임.'}]);
  expect(f.s.orgPosts).toEqual([]);
  const row=page.locator('#wdUpdates [data-basket-link="l1"]');
  await expect(row.locator('[data-link-summary-text]')).toHaveText('합성 공문 사진 · 교섭 일정 안내임.');
  // LIB-사진숨김(S60-10): 사진은 접힌 [사진 1] 하나로 보이고, 누르면 그 자리에 작은 그림.
  await expect(row.locator('[data-record-photo="drv1"]')).toBeHidden();
  await row.locator('[data-record-photos] > summary').click();
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
 await expect(page.locator('#wdInboxState')).toHaveText(''); // UX-알림하나로: 진행은 하단바 위 한 줄 하나
 await expect.poll(()=>f.s.confirms.length).toBe(1);
 expect(f.s.confirms[0].p_targets[0].summary).toMatch(/^그림 1장 · 붙여넣은 그림 \d\d-\d\d \d\d:\d\d\.png$/);
});

test('글을 쓰고 파일을 붙이면 글이 기록(AI 부르지 않음), 글만이면 예전처럼 조직 기록 표',async({page})=>{
 const f=await fixture(page,1440);
 await page.locator('#wdInboxText').fill('교섭 통화 메모');
 await pasteInto(page.locator('#wdInboxText'),[{name:'image.png',type:'image/png'}]);
 await page.locator('#wdInboxSave').click();
 await expect(page.locator('#wdInboxState')).toHaveText('저장했어요.');
 expect(f.s.notePosts).toBe(1);expect(f.s.lines).toEqual([]);expect(f.s.confirms[0].p_targets).toEqual([{kind:'organization',target_id:'o',reason:'직접 연결'}]);
 await expect.poll(()=>f.s.docPatches.map(p=>p.organization_id)).toEqual(['o']);expect(f.s.uploads).toBe(1);
 await page.locator('#wdInboxText').fill('글만 쓴 기록');await page.locator('#wdInboxSave').click();
 await expect.poll(()=>f.s.orgPosts.length).toBe(1);expect(f.s.orgPosts[0].raw_text).toBe('글만 쓴 기록');
});

// UI-PC손맛묶음 ⑥(S56-52): PC에서 기록 표(#wdLog)에 파일을 놓으면 먼저 묻고(기록으로 남길까요?), 고르면 뒤에서 파일마다 기록 한 줄
// (기록 입력칸 첨부와 같은 저장 길: 올리기 → 이 조직 연결 + 조직 자료, 글이 없으니 AI 한 줄). 취소면 아무것도 올리지 않는다.
const dropOnLog=(page,files,types=['dragenter','dragover','drop'])=>page.evaluate(({files,types})=>{const dt=new DataTransfer();for(const f of files)dt.items.add(new File([new Uint8Array([37,80,68,70,45])],f,{type:'application/pdf'}));const el=document.querySelector('#wdUpdates')||document.querySelector('#wdLog');for(const type of types)el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));return document.querySelector('#wdLog').classList.contains('drop-active')},{files,types});
test('PC 1440 ⑥: 기록 표에 파일 놓기 → 먼저 묻고, 남기기면 파일마다 기록 한 줄(조직 연결·조직 자료)',async({page})=>{
 const f=await fixture(page,1440);
 await expect.poll(()=>dropOnLog(page,['공문.pdf'],['dragenter','dragover'])).toBe(true); // 조직을 다 읽은 뒤에 놓는 자리가 된다
 await dropOnLog(page,['공문.pdf','회의록.pdf'],['drop']);
 const ask=page.locator('.kptu-ask');await expect(ask).toBeVisible();
 await expect(ask.locator('.kptu-ask-text')).toHaveText(/기록으로 남길까요\?$/);await expect(ask.locator('.kptu-ask-note')).toHaveText('공문.pdf, 회의록.pdf');
 expect(f.s.uploads).toBe(0); // 묻는 동안은 아무것도 올리지 않는다
 await ask.getByRole('button',{name:'기록 남기기'}).click();
 await expect.poll(()=>f.s.confirms.length).toBe(2);
 expect(f.s.uploads).toBe(2);expect(f.s.lines).toEqual([true,true]);
 for(const c of f.s.confirms)expect(c.p_targets).toEqual([{kind:'organization',target_id:'o',reason:'직접 연결',summary:'합성 공문 사진 · 교섭 일정 안내임.'}]);
 // 조직 연결(자료 PATCH)은 기록 줄 저장 뒤에 따로 가서, 둘째 파일 것은 조금 늦게 올 수 있다 — 다 올 때까지 기다려 비교한다(같은 값 그대로).
 await expect.poll(()=>f.s.docPatches.map(p=>p.organization_id)).toEqual(['o','o']);expect(f.s.orgPosts).toEqual([]);
 await expect(page.locator('#kptuNotice .kptu-notice-text')).toContainText('파일 2개를 기록으로 남겼어요');
 await expect(page.locator('#wdUpdates [data-basket-link="l1"]')).toBeVisible();
 expect(f.errors).toEqual([]);
});
test('PC 1440 ⑥: [취소]면 올리지 않고, 남기기 뒤 다른 화면으로 옮겨도 끝까지 남긴다',async({page})=>{
 const f=await fixture(page,1440);
 await expect.poll(()=>dropOnLog(page,['취소할.pdf'],['dragenter','dragover'])).toBe(true);
 await dropOnLog(page,['취소할.pdf'],['drop']);
 await page.locator('.kptu-ask').getByRole('button',{name:'취소'}).click();
 await page.waitForTimeout(300);expect(f.s.uploads).toBe(0);
 let release;const gate=new Promise(r=>release=r);
 await page.route(u=>u.pathname==='/functions/v1/basket-files',async r=>{await gate;return r.fallback()});
 await dropOnLog(page,['남길.pdf']);
 await page.locator('.kptu-ask').getByRole('button',{name:'기록 남기기'}).click();
 await clickView(page,'meetings');await expect(page.locator('#wdUpdates')).toBeHidden(); // 다른 화면으로 옮겨도
 release();
 await expect.poll(()=>f.s.confirms.length).toBe(1);expect(f.s.uploads).toBe(1);
});

// ORG-기록첨부안됨(S60-1b): 창을 연 직후 📎가 켜져 있고 누르면 파일 고르기가 뜬다. 끌어 놓기도 바로 받는다.
// (창을 열 때 첨부 부품을 조직을 읽기 전에 다시 그려 꺼진 채 남던 것 — 조직을 다 읽은 뒤의 한 그리기가 다시 그린다.)
for(const width of [412,1280]){
 test(`창을 연 직후 📎가 켜지고 누르면 파일 고르기, 끌어 놓기도 받는다 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  const clip=page.locator('#wdInboxClip [data-basket-clip]');
  await expect(clip).toBeEnabled();
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),clip.click()]);
  await chooser.setFiles({name:'공문.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-')});
  await expect(page.locator('#wdInboxFiles [data-basket-file]')).toHaveCount(1);
  await page.locator('#wdInbox').evaluate(el=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array([137,80,78,71])],'끌어.png',{type:'image/png'}));for(const type of ['dragenter','dragover','drop'])el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}))});
  await expect(page.locator('#wdInboxFiles [data-basket-file]')).toHaveCount(2);
  expect(await pasteInto(page.locator('#wdInboxText'),[{name:'image.png',type:'image/png'}])).toBe(true);
  await expect(page.locator('#wdInboxFiles [data-basket-file]')).toHaveCount(3);
  expect(f.errors).toEqual([]);
 });
}
