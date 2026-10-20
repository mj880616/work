// MEET-파일로만들기: 회의 [+] → [파일·글로 만들기]. 파일 여러 개(HWP·PDF)와 붙여 넣은 결과 글을 회의별로 묶어 미리보기 표로
// 보이고 [만들기]로 한 번에 만든다. 결과(글 또는 파일)가 없는 묶음은 만들지 않고, 같은 종류·차수 회의가 있으면 결과·자료만 더하며,
// 처음 보는 회의명은 "새 종류로 만들기" 확인을 받는다. 저장은 기존 app_meetings REST·meeting-files Edge만 쓴다.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {servePagesCors} from './helpers/hwp-editor.mjs';
import {tinyPdf} from './helpers/tiny-pdf.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

test.use({timezoneId:'Asia/Seoul'});
test.setTimeout(120000);
const BASE=process.env.APP_E2E_ORIGIN||testOrigin;
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const REVIEW=process.env.UI_REVIEW_DIR||'';
const hwpSample=readFileSync(new URL('../fixtures/hwp-lab/sample.hwp',import.meta.url));
const pdf=(name,lines=['material'])=>({name,mimeType:'application/pdf',buffer:tinyPdf(lines)});

async function fixture(page,{width=1280,scheme='light',failUpload=()=>false,extraKinds=[]}={}){
  await page.setViewportSize({width,height:width<761?844:900});
  await page.emulateMedia({colorScheme:scheme});
  await servePagesCors(page);
  const f={meetings:[
    {id:'m-cc4',workspace_id:'ws',project_id:null,title:'중앙집행위원회',series_name:'중앙집행위원회',round_no:4,meeting_at:'2025-09-10T05:00:00Z',transcript_text:'4차 결과',created_by:'u1'},
    {id:'m-op3',workspace_id:'ws',project_id:null,title:'본부 운영위원회',series_name:'본부 운영위원회',round_no:3,meeting_at:'2025-09-03T06:00:00Z',transcript_text:'기존 결과',created_by:'u1'},
  ...extraKinds.map((k,i)=>({id:'m-x'+i,workspace_id:'ws',project_id:null,title:k,series_name:k,round_no:1,meeting_at:'2025-08-01T05:00:00Z',transcript_text:'결과',created_by:'u1'}))],posts:[],patches:[],uploads:[],uploadAttempts:[],errors:[]};
  let n=0;
  page.on('pageerror',e=>f.errors.push(e.message));
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'a',refresh_token:'r',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'u1'}});
    if(path==='/auth/v1/user')return ok({id:'u1',email:'qa@example.org',user_metadata:{display_name:'QA'}});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'ws',user_id:'u1',role:'owner',email:'qa@example.org',workspace:{id:'ws',name:'QA'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws',name:'QA'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'u1',display_name:'QA'}]);
    if(path==='/rest/v1/app_spaces')return ok([]);
    if(path==='/rest/v1/app_meetings'){
      if(method==='POST'){const body=req.postDataJSON();const row={...body,id:'new-'+(++n)};f.posts.push(body);f.meetings.unshift(row);return ok([row])}
      const id=url.searchParams.get('id')?.replace(/^eq\./,'');
      if(method==='PATCH'){const body=req.postDataJSON();f.patches.push({id,body});const row=f.meetings.find(m=>m.id===id);Object.assign(row,body);return ok([{id}])}
      if(id)return ok(f.meetings.filter(m=>m.id===id));
      return ok(f.meetings);
    }
    if(path==='/functions/v1/meeting-files'){
      const body=req.postDataBuffer()?.toString('latin1')||'';
      const meeting=body.match(/name="meeting_id"\r\n\r\n([^\r]+)/)?.[1];
      const file=Buffer.from(body.match(/filename="([^"]+)"/)?.[1]||'','latin1').toString('utf8');
      f.uploadAttempts.push({meeting,file});
      if(failUpload(file,f.uploadAttempts.filter(a=>a.file===file).length))return ok({error:'Drive 업로드 실패'},400);
      f.uploads.push({meeting,file});
      return ok({ok:true,document:{id:'d'+f.uploads.length,meeting_id:meeting,file_name:file}});
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(BASE+'/app/?view=meetings')}`);
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#meetingsView')).toBeVisible({timeout:15000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await page.locator('[data-meeting-mode="files"]').click();
  await expect(page.locator('#mffPanel')).toBeVisible();
  return f;
}
const rows=page=>page.locator('#mffList .mff-row');
const row=(page,text)=>rows(page).filter({hasText:text});
const create=page=>page.locator('#mffCreate');

test('the meeting [+] window switches between writing by hand and files·text; the hand form is unchanged',async({page})=>{
  const f=await fixture(page);
  await expect(page.locator('.meeting-create-modes button')).toHaveText(['직접 쓰기','파일·글로 만들기']);
  await expect(page.locator('[data-meeting-mode="files"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#meetingModal fieldset.meeting-entry-section').first()).toBeHidden();
  await expect(page.locator('#saveMeetingBtn')).toBeHidden();
  await expect(create(page)).toBeDisabled();
  await page.locator('[data-meeting-mode="manual"]').click();
  await expect(page.locator('#mffPanel')).toBeHidden();
  await expect(page.locator('#meetingTranscript')).toBeVisible();
  await expect(page.locator('#saveMeetingBtn')).toBeVisible();
  // Reopening starts on the hand form with an empty files panel.
  await page.locator('[data-meeting-mode="files"]').click();
  await page.locator('#mffText').fill('제9차 중앙집행위원회 결과 2025.12.10\n- 승인');
  await expect(rows(page)).toHaveCount(1);
  await page.locator('#meetingModal [data-close="meetingModal"]').click();
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('[data-meeting-mode="manual"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-meeting-mode="files"]').click();
  await expect(page.locator('#mffText')).toHaveValue('');
  await expect(rows(page)).toHaveCount(0);
  expect(f.posts).toEqual([]);expect(f.errors).toEqual([]);
});

test('four cases, a result-less bundle, an existing meeting and a new kind are grouped and created at once',async({page})=>{
  const f=await fixture(page);
  await page.locator('#mffFiles').setInputFiles([
    pdf('251015 제5차 중앙집행위원회 회의자료.pdf'),            // ① 자료 파일 + 결과 글
    pdf('250910 제2차 본부 운영위원회 안건.pdf'),               // ② 자료 파일 + 결과 파일
    pdf('250910 제2차 본부 운영위원회 결과.pdf',['Op committee result','Budget approved']),
    {name:'제6차 중앙집행위원회 회의록 251112.hwp',mimeType:'application/octet-stream',buffer:hwpSample}, // ③ 결과 파일만(HWP 본문)
    pdf('251201 제7차 중앙집행위원회 자료.pdf'),                // 결과 없음
    pdf('제3차 본부 운영위원회 결과.pdf',['Third result']),      // 기존 회의에 더하기
  ]);
  // ④ 결과 글만(제목 줄로 나뉨) + 처음 보는 회의명.
  await page.locator('#mffText').fill('제5차 중앙집행위원회 결과 (2025.10.15)\n1. 안건 승인\n\n제1차 대의원대회 결과 2025.08.20\n- 규약 개정');
  await expect(rows(page)).toHaveCount(6);
  await expect(create(page)).toHaveText('회의 4건 만들기',{timeout:30000});

  const cc5=row(page,'5차');
  await expect(cc5.locator('summary')).toHaveAttribute('aria-label','2025-10-15, 중앙집행위원회, 5차, 자료 1개, 결과 있음, 새로 만들기');
  await expect(row(page,'2차').locator('.mff-count')).toHaveText('1');
  await expect(row(page,'2차').locator('.mff-result')).toHaveText('있음');
  await expect(row(page,'6차').locator('.mff-result')).toHaveText('있음');
  await expect(row(page,'6차').locator('.mff-date')).toHaveText('25.11.12');
  const none=row(page,'7차');
  await expect(none).toHaveAttribute('data-state','no-result');
  await expect(none.locator('.mff-note')).toHaveText('결과를 더해 주세요');
  await expect(none.locator('.mff-result')).toHaveText('없음');
  await expect(row(page,'3차')).toHaveAttribute('data-state','ready');
  await expect(row(page,'3차').locator('.mff-note')).toHaveText('기존 회의에 결과·자료 더하기');
  const fresh=row(page,'대의원대회');
  await expect(fresh).toHaveAttribute('data-state','new-kind');
  await expect(fresh).toHaveCSS('border-top-color','rgb(224, 123, 31)');
  await fresh.locator('[data-mff-confirm]').click();
  await expect(fresh).toHaveAttribute('data-state','ready');
  await expect(create(page)).toHaveText('회의 5건 만들기');

  await create(page).click();
  // 결과가 없는 묶음은 남겨 두고 창을 닫지 않는다(결과를 더하면 그 묶음만 만들 수 있음).
  await expect(page.locator('#mffStatus')).toHaveText('회의 5건 완료 · 확인이 필요한 1건은 남겨 두었어요',{timeout:30000});
  await expect(page.locator('#mffList .mff-row[data-state="done"]')).toHaveCount(5);
  await expect(row(page,'7차')).toHaveAttribute('data-state','no-result');
  await expect(create(page)).toBeDisabled();

  const post=name=>f.posts.find(p=>p.series_name===name.series&&p.round_no===name.round);
  expect(f.posts).toHaveLength(4);
  const p5=post({series:'중앙집행위원회',round:5});
  expect(p5).toMatchObject({workspace_id:'ws',title:'중앙집행위원회',project_id:null,result_status:'final',created_by:'u1',meeting_at:'2025-10-14T15:00:00.000Z'});
  expect(p5.transcript_text).toBe('제5차 중앙집행위원회 결과 (2025.10.15)\n1. 안건 승인');
  expect(post({series:'본부 운영위원회',round:2}).transcript_text).toBe('Op committee result\nBudget approved');
  expect(post({series:'중앙집행위원회',round:6}).transcript_text).toBe('HWP 편집기 시험 문서입니다. 이 문장을 고쳐 보세요.');
  expect(post({series:'대의원대회',round:1}).transcript_text).toMatch(/^제1차 대의원대회 결과 2025\.08\.20\n- 규약 개정$/);
  expect(f.posts.some(p=>p.round_no===7)).toBe(false);
  // 기존 3차 회의: 새로 만들지 않고 결과를 뒤에 더한다.
  expect(f.patches).toEqual([{id:'m-op3',body:{transcript_text:'기존 결과\n\nThird result',updated_at:expect.any(String)}}]);
  const id=p=>f.meetings.find(m=>m.series_name===p.series_name&&m.round_no===p.round_no).id;
  expect(f.uploads).toEqual(expect.arrayContaining([
    {meeting:id(p5),file:'251015 제5차 중앙집행위원회 회의자료.pdf'},
    {meeting:id(post({series:'본부 운영위원회',round:2})),file:'250910 제2차 본부 운영위원회 안건.pdf'},
    {meeting:id(post({series:'본부 운영위원회',round:2})),file:'250910 제2차 본부 운영위원회 결과.pdf'},
    {meeting:id(post({series:'중앙집행위원회',round:6})),file:'제6차 중앙집행위원회 회의록 251112.hwp'},
    {meeting:'m-op3',file:'제3차 본부 운영위원회 결과.pdf'},
  ]));
  expect(f.uploads).toHaveLength(5);
  expect(f.uploads.some(u=>u.file.includes('7차'))).toBe(false);
  // MEET-결과정리 ⑤: PC 목록은 왼쪽 회의 종류(건수) + 고른 종류의 차수만 보이므로, 종류별 건수로 6건 모두 들어왔는지 본다.
  await expect(page.locator('#meetingList [data-meeting-kind]')).toHaveCount(3);
  await expect.poll(()=>page.locator('#meetingList [data-meeting-kind]').evaluateAll(list=>Object.fromEntries(list.map(b=>[b.querySelector('.mcol-name').textContent,Number(b.querySelector('.mcol-count').textContent)])))).toEqual({'중앙집행위원회':3,'본부 운영위원회':2,'대의원대회':1});
  await expect(page.locator('#meetingList .mcol-detail [data-mrd-meeting]')).toHaveCount(3);
  expect(f.errors).toEqual([]);
});

test('a file the name cannot place is orange until its role is chosen; a result-less group is never created',async({page})=>{
  const f=await fixture(page);
  // 정보가 없는 결과 글 하나뿐이면 종류·날짜를 직접 고른다.
  await page.locator('#mffText').fill('결정 사항\n- 승인');
  const loose=()=>rows(page).filter({has:page.locator('.mff-text-line')});
  await expect(loose()).toHaveCount(1);
  await expect(loose()).toHaveAttribute('data-state','pick');
  await expect(loose()).toHaveAttribute('open','');
  await expect(loose().locator('.mff-note')).toHaveText('회의 종류를 골라 주세요');
  await loose().locator('[data-mff-field="name"]').fill('본부 운영위원회');
  await loose().locator('[data-mff-field="name"]').press('Tab');
  await expect(loose().locator('.mff-note')).toHaveText('날짜를 골라 주세요');
  await loose().locator('[data-mff-field="date"]').fill('2025-10-01');
  await expect(loose()).toHaveAttribute('data-state','ready');
  await expect(loose().locator('.mff-note')).toHaveText('새로 만들기');
  // 이름으로 결과/자료를 알 수 없는 파일은 주황 줄에서 직접 고른다.
  await page.locator('#mffFiles').setInputFiles([pdf('제8차 중앙집행위원회.pdf',['Eighth result'])]);
  const pick=()=>row(page,'8차');
  await expect(pick()).toHaveAttribute('data-state','pick');
  await expect(pick()).toHaveAttribute('open','');
  await expect(pick().locator('.mff-note')).toHaveText('결과인지 자료인지 골라 주세요');
  await expect(create(page)).toHaveText('회의 1건 만들기');
  await pick().locator('[data-mff-role]').selectOption('material');
  await expect(pick()).toHaveAttribute('data-state','no-result');
  await expect(pick().locator('.mff-note')).toHaveText('결과를 더해 주세요');
  await expect(page.locator('#mffStatus')).toHaveText('확인이 필요한 1건은 만들지 않아요');
  await pick().locator('[data-mff-role]').selectOption('result');
  // 새 회의에 날짜가 없으면(파일 이름·본문 모두) 날짜를 직접 고른다.
  await expect(pick().locator('.mff-note')).toHaveText('날짜를 골라 주세요',{timeout:30000});
  await expect(pick()).toHaveAttribute('data-state','pick');
  await pick().locator('[data-mff-field="date"]').fill('2025-12-20');
  await expect(pick()).toHaveAttribute('data-state','ready');
  await expect(create(page)).toHaveText('회의 2건 만들기');
  await create(page).click();
  await expect(page.locator('#meetingModal')).toBeHidden({timeout:30000});
  await expect(page.locator('#toast')).toHaveText('회의 2건을 만들었어요.');
  expect(f.posts.map(p=>[p.series_name,p.round_no,p.meeting_at,p.transcript_text]).sort()).toEqual([
    ['본부 운영위원회',null,'2025-09-30T15:00:00.000Z','결정 사항\n- 승인'],
    ['중앙집행위원회',8,'2025-12-19T15:00:00.000Z','Eighth result'],
  ]);
  expect(f.errors).toEqual([]);
});

test('a failed upload keeps the meetings already made and retries only the failed bundle',async({page})=>{
  const f=await fixture(page,{failUpload:(file,attempt)=>file.includes('2차')&&attempt===1});
  await page.locator('#mffFiles').setInputFiles([
    pdf('250910 제2차 본부 운영위원회 안건.pdf'),
    pdf('251015 제5차 중앙집행위원회 회의자료.pdf'),
  ]);
  await page.locator('#mffText').fill('제2차 본부 운영위원회 결과 2025.09.10\n- 예산\n\n제5차 중앙집행위원회 결과 2025.10.15\n- 승인');
  await expect(create(page)).toHaveText('회의 2건 만들기');
  await create(page).click();
  await expect(page.locator('#mffStatus')).toHaveText('회의 1건 완료 · 1건 실패. 실패한 묶음만 다시 만들 수 있어요.',{timeout:30000});
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(row(page,'5차')).toHaveAttribute('data-state','done');
  await expect(row(page,'2차')).toHaveAttribute('data-state','ready');
  await expect(row(page,'2차').locator('.mff-note')).toContainText('실패');
  await expect(create(page)).toHaveText('회의 1건 다시 만들기');
  expect(f.posts).toHaveLength(2);
  await create(page).click();
  await expect(page.locator('#meetingModal')).toBeHidden({timeout:30000});
  // 다시 만들기는 이미 만든 회의를 다시 만들지 않고, 결과 글도 다시 더하지 않으며, 실패한 파일만 다시 올린다.
  expect(f.posts).toHaveLength(2);
  expect(f.patches).toEqual([]);
  expect(f.uploadAttempts.map(a=>a.file).sort()).toEqual(['250910 제2차 본부 운영위원회 안건.pdf','250910 제2차 본부 운영위원회 안건.pdf','251015 제5차 중앙집행위원회 회의자료.pdf']);
  expect(f.errors).toEqual([]);
});

if(REVIEW){
  for(const scheme of ['light','dark'])for(const width of [390,1280]){
    test(`캡처 ${width} ${scheme}`,async({page})=>{
      await fixture(page,{width,scheme});
      await page.locator('#mffFiles').setInputFiles([
        pdf('251015 제5차 중앙집행위원회 회의자료.pdf'),
        pdf('250910 제2차 본부 운영위원회 안건.pdf'),
        pdf('250910 제2차 본부 운영위원회 결과.pdf',['Op committee result']),
        pdf('251201 제7차 중앙집행위원회 자료.pdf'),
        pdf('제8차 중앙집행위원회.pdf'),
      ]);
      await page.locator('#mffText').fill('제5차 중앙집행위원회 결과 (2025.10.15)\n1. 안건 승인\n\n제1차 대의원대회 결과 2025.08.20\n- 규약 개정');
      await expect(create(page)).toHaveText(/만들기/,{timeout:30000});
      await expect(rows(page)).toHaveCount(5);
      await page.locator('#mffList').scrollIntoViewIfNeeded();
      await page.screenshot({path:`${REVIEW}/preview-${width}-${scheme}.png`});
    });
  }
}

// MEET-파일이름인식: 파일 이름 속 회의 이름의 띄어쓰기·기호·꼬리말 차이를 무시하고 등록된 종류와 맞춘다.
test('a file name with different spacing and tail words is matched to the registered kind without a new-kind prompt',async({page})=>{
  const f=await fixture(page);
  await page.locator('#mffFiles').setInputFiles([pdf('261020_26-38차 중앙 집행위원회 회의결과.pdf',['Result body'])]);
  const r=rows(page);
  await expect(r).toHaveCount(1);
  await expect(create(page)).toHaveText('회의 1건 만들기',{timeout:30000});
  await expect(r).toHaveAttribute('data-state','ready');
  await expect(r.locator('summary')).toHaveAttribute('aria-label','2026-10-20, 중앙집행위원회, 38차, 자료 0개, 결과 있음, 새로 만들기');
  await expect(r.locator('[data-mff-confirm]')).toHaveCount(0);
  await create(page).click();
  await expect(page.locator('#toast')).toHaveText('회의 1건을 만들었어요.',{timeout:30000});
  expect(f.posts.map(p=>[p.series_name,p.round_no,p.meeting_at])).toEqual([['중앙집행위원회',38,'2026-10-19T15:00:00.000Z']]);
  expect(f.errors).toEqual([]);
});

test('two registered kinds that both fit a file name are never auto-picked; the candidates are shown to choose',async({page})=>{
  const f=await fixture(page,{extraKinds:['운영위원회']});
  await page.locator('#mffFiles').setInputFiles([pdf('261020_26-38차 본부운영위원회 회의결과.pdf',['Result body'])]);
  const r=rows(page);
  await expect(r).toHaveCount(1);
  await expect(r).toHaveAttribute('data-state','pick',{timeout:30000});
  await expect(r).toHaveAttribute('open','');
  await expect(r.locator('.mff-note')).toHaveText('회의 종류 후보가 여럿이에요. 골라 주세요');
  await expect(r.locator('[data-mff-candidate]')).toHaveText(['본부 운영위원회','운영위원회']);
  await expect(r.locator('[data-mff-field="name"]')).toHaveValue('');
  await expect(create(page)).toBeDisabled();
  await r.locator('[data-mff-candidate]').first().click();
  await expect(r).toHaveAttribute('data-state','ready');
  await expect(r.locator('[data-mff-field="name"]')).toHaveValue('본부 운영위원회');
  await expect(r.locator('[data-mff-field="round"]')).toHaveValue('38');
  await expect(r.locator('[data-mff-field="date"]')).toHaveValue('2026-10-20');
  await expect(r.locator('[data-mff-candidate]')).toHaveCount(0);
  await create(page).click();
  await expect(page.locator('#toast')).toHaveText('회의 1건을 만들었어요.',{timeout:30000});
  expect(f.posts.map(p=>[p.series_name,p.round_no])).toEqual([['본부 운영위원회',38]]);
  expect(f.errors).toEqual([]);
});

test('a material file is matched the same way, joins its result file, and the kind field can still be corrected by hand',async({page})=>{
  const f=await fixture(page,{extraKinds:['본부 집행위']});
  await page.locator('#mffFiles').setInputFiles([
    pdf('261020 제38차 본부집행위 회의자료.pdf'),
    pdf('261020_38차 본부 집행위 회의결과.pdf',['Result body']),
  ]);
  const r=rows(page);
  await expect(r).toHaveCount(1);
  await expect(create(page)).toHaveText('회의 1건 만들기',{timeout:30000});
  await expect(r.locator('summary')).toHaveAttribute('aria-label','2026-10-20, 본부 집행위, 38차, 자료 1개, 결과 있음, 새로 만들기');
  await r.locator('summary').click();
  const kind=r.locator('[data-mff-field="name"]');
  await expect(kind).toHaveValue('본부 집행위');
  await kind.fill('본부 운영위원회');await kind.press('Tab');
  await expect(r.locator('summary')).toHaveAttribute('aria-label','2026-10-20, 본부 운영위원회, 38차, 자료 1개, 결과 있음, 새로 만들기');
  expect(f.errors).toEqual([]);
});
