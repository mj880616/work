// REC-한회의로잇기 PR-5(S59-16, 설계 docs/design/rec-join.md 4절 PR-5 줄·3-3절 (다)(라)): 나머지 두 길에도 같은 물음.
// (다) 회의자료 그 자리 전사(보고 창 자료 ⋯ [전사해서 결과에 넣기] → 서버 정리 kind attached): 그 회의에 회의록 전문이 이미 있을 때만
//      '이 보고에 회의록 전문이 이미 있어요…' [수정 창에 넣기] [그 보고에 잇기]. 잇기면 수정 창 없이 서버가 뒤에서, 넣기면 지금처럼 수정 창(저장은 사람이).
// (라) [회의] 입력 창의 [녹음·전사 넣기] → [녹음 요약하기]: 같은 날 회의록 전문이 있는 [회의] 보고가 있으면 PR-3과 같은 세 버튼 물음.
//      [그 보고에 잇기] = join_text(전사 글 그대로 + 고른 보고 id 머리글) 뒤 입력 창을 닫고, [새로 만들기]는 지금처럼 화면 요약(같은 창에서 다시 묻지 않음).
// 서버가 잇기를 모르면 두 길 모두 묻지 않고 지금 길. 실제 서버는 쓰지 않는다(가짜 Supabase, helpers/rec-join-server.mjs).
// KPTU_SHOTS=1이면 docs/design/screens/s59-16/에 화면 사진을 남긴다(PR 첨부용).
import {test,expect} from '@playwright/test';
import {id,M1,M2,M4,JOBA,RESULT,FIRST_NOTES,makeState,signIn,calls,joinLine} from './helpers/rec-join-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SHOTS=process.env.KPTU_SHOTS==='1';
const shot=async(page,name)=>{if(SHOTS){await page.waitForTimeout(250);await page.screenshot({path:`docs/design/screens/s59-16/${name}.png`})}};
const askBox=page=>page.locator('.kptu-ask.rec-join-ask');
const known=page=>page.waitForFunction(m=>window.KPTUMeetingJoin.canMerge({id:m,activity_kind:'meeting'}),M4);
const ATTACHED_TEXT='예시 자료 녹음 전사 글입니다.';
const PASTED='예시 셋째 전사 글입니다.';
// 회의자료 녹음 하나를 서버가 그 자리에서 전사·요약한 결과(kind attached — 어느 회의인지 정해진 길).
function attached(s,meetingId,docN=1){
  s.serverJobs[JOBA]={id:JOBA,kind:'attached',status:'done',stage:'done',meeting_id:meetingId,document_id:id('e',docN),created_at:'2026-11-11T02:28:00Z',
    parts:[],jobs:[],step_no:1,step_total:1,transcript_text:ATTACHED_TEXT,draft:{decisions:'예시 자료 녹음 결정',information:'',actions:[],attendees:[]}};
}
const transcribe=(page,meetingId,docN=1)=>page.evaluate(([m,d])=>window.KPTUMeetingRecorder.transcribeAttached({documentId:d,meetingId:m}),[meetingId,id('e',docN)]);
const openReport=async(page,meetingId)=>{await page.evaluate(m=>window.KPTUMeetingRoundDetail.open(m),meetingId);await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('data-meeting-id',meetingId,{timeout:15000})};
// 새 [회의] 입력 창 → [녹음·전사 넣기]에 글 붙여 넣기.
async function pasteTranscript(page,text=PASTED){
  await page.evaluate(()=>window.KPTUReportEntry.open({kind:'meeting',at:'2026-11-11T11:20'}));
  await expect(page.locator('#meetingModal')).toBeVisible({timeout:15000});
  await page.locator('#mtdOpen').click();
  await page.locator('#mtdText').fill(text);
}

test('① (다) PC: 회의록 전문이 있는 보고의 그 자리 전사는 먼저 묻고, [그 보고에 잇기]는 수정 창 없이 서버가 뒤에서 잇는다',async({page})=>{
  test.setTimeout(120000);
  const s=makeState();attached(s,M1);
  await signIn(page,s);
  await known(page);
  await openReport(page,M1);
  await transcribe(page,M1);
  await expect(askBox(page)).toBeVisible({timeout:20000});
  await expect(askBox(page).locator('.kptu-ask-text')).toHaveText('이 보고에 회의록 전문이 이미 있어요. 같은 회의를 이어서 녹음했나요?');
  await expect(askBox(page).locator('.kptu-ask-note')).toHaveText('10:02 예시 집행위 · [그 보고에 잇기]는 두 전사 전체로 다시 요약해 저장해요');
  await expect(askBox(page).getByRole('button')).toHaveText(['수정 창에 넣기','그 보고에 잇기']);
  await expect(askBox(page).getByRole('button',{name:'그 보고에 잇기'})).toBeFocused();
  await expect(page.locator('#recBand .rec-label')).toHaveText('정리 끝');
  expect(calls(s,'join_candidates')).toEqual([]); // 어느 보고인지 정해진 길 — 후보를 묻지 않는다
  await shot(page,'pc-1280-attached-ask');
  // [그 보고에 잇기]: 그 보고 id + 그 전사 작업 id만. 수정 창은 열리지 않고 띠는 바로 닫힌다.
  await askBox(page).getByRole('button',{name:'그 보고에 잇기'}).click();
  await expect.poll(()=>calls(s,'join_start').map(c=>c.body)).toEqual([{target_meeting_id:M1,source:{job_id:JOBA}}]);
  await expect(page.locator('#recBand')).toBeHidden();
  await expect(page.locator('#mrdEditor')).toBeHidden();
  await expect(joinLine(page)).toContainText('예시 집행위에 잇는 중');
  s.applyNow=true;
  await expect(joinLine(page)).toContainText('예시 집행위 보고에 이어 붙였어요',{timeout:15000});
  await expect(page.locator('#meetingRoundDetailModal #mrdResult')).toContainText('두 전사 전체로 다시 요약한 예시 결정',{timeout:15000});
  expect(calls(s,'job_opened')).toEqual([]); // '열었음 + 그 보고'는 서버 apply가 적는다
  expect(s.meetingWrites).toEqual([]);
  await shot(page,'pc-1280-attached-joined');
});

test('② (다) 폰 412: [수정 창에 넣기]는 지금 그대로(수정 창에 전문·요약, 저장은 사람이)',async({page})=>{
  test.setTimeout(120000);
  const s=makeState();attached(s,M1);
  await signIn(page,s,{width:412});
  await known(page);
  await openReport(page,M1);
  await transcribe(page,M1);
  await expect(askBox(page)).toBeVisible({timeout:20000});
  await shot(page,'phone-412-attached-ask');
  await askBox(page).getByRole('button',{name:'수정 창에 넣기'}).click();
  await expect(page.locator('#mrdEditor')).toBeVisible({timeout:15000});
  await expect(page.locator('#mrdEditNotes')).toHaveValue(new RegExp(`${FIRST_NOTES}[\\s\\S]*${ATTACHED_TEXT}`));
  await expect(page.locator('#mrdEditTranscript')).toHaveValue(/예시 자료 녹음 결정/);
  await expect.poll(()=>calls(s,'job_opened').map(c=>c.body)).toEqual([{job_id:JOBA}]);
  expect(calls(s,'join_start')).toEqual([]);
  expect(s.meetingWrites).toEqual([]);
});

test('③ (라) PC: 같은 날 회의록 전문이 있는 보고가 있으면 [녹음 요약하기] 전에 묻고, [그 보고에 잇기]는 전사 글을 서버로 보내고 입력 창을 닫는다',async({page})=>{
  test.setTimeout(120000);
  const s=makeState();
  s.refuse[M4]={status:409,code:'busy',error:'다른 녹음을 전사하는 중이에요. 끝난 뒤 다시 눌러 주세요.'};
  await signIn(page,s);
  await known(page);
  await pasteTranscript(page);
  await page.locator('#mtdRun').click();
  await expect(askBox(page)).toBeVisible({timeout:15000});
  await expect(askBox(page).locator('.kptu-ask-text')).toHaveText('오늘 회의록 전문이 있는 보고가 있어요. 같은 회의인가요?');
  await expect(askBox(page).locator('.kptu-ask-note')).toHaveText('11:05 예시 집행위');
  await expect(askBox(page).getByRole('button')).toHaveText(['다른 보고 선택','새로 만들기','그 보고에 잇기']);
  await shot(page,'pc-1280-text-ask');
  // 그 보고가 지금 잇는 중이면 서버가 거절 → 이유 한 줄, 입력 창·글은 그대로(요약도 하지 않음).
  await askBox(page).getByRole('button',{name:'그 보고에 잇기'}).click();
  await expect(page.locator('#kptuNotice')).toContainText('그 보고는 지금 잇는 중이에요.');
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#mtdText')).toHaveValue(PASTED);
  await expect(page.locator('#mtdStatus')).toContainText('전사 글은 그대로 있어요');
  expect(s.draftCalls).toBe(0);
  // 다시 [녹음 요약하기] → 다시 묻고 [다른 보고 선택]: 같은 날 전문이 있는 보고(가까운 순) → 다른 보고.
  await page.locator('#mtdRun').click();
  await askBox(page).getByRole('button',{name:'다른 보고 선택'}).click();
  const pick=page.locator('.kptu-ask.kptu-ask-choice');
  await expect(pick.locator('.kptu-ask-pick-t small')).toHaveText(['11:05','10:02','15:00','11.4. 10:00']);
  await shot(page,'pc-1280-text-pick');
  await pick.locator(`[data-ask-pick="${M1}"]`).click();
  // join_text: 몸통 = 전사 글 그대로(JSON 아님), 머리글 = 고른 보고 id. 작업공간 값은 싣지 않는다.
  await expect.poll(()=>s.texts.length).toBe(2);
  expect(s.texts.map(t=>[t.target,t.type,t.body,t.records,t.workspace])).toEqual([[M4,'text/plain;charset=utf-8',PASTED,'',''],[M1,'text/plain;charset=utf-8',PASTED,'','']]);
  await expect(page.locator('#meetingModal')).toBeHidden();
  await expect(joinLine(page)).toContainText('예시 집행위에 잇는 중');
  await shot(page,'pc-1280-text-joining');
  s.applyNow=true;
  await expect(joinLine(page)).toContainText('예시 집행위 보고에 이어 붙였어요',{timeout:15000});
  expect(s.meetings.find(m=>m.id===M1).notes).toContain(PASTED);
  expect(s.draftCalls).toBe(0); // 화면 요약은 부르지 않는다(서버가 전체로 다시 요약)
  expect(s.meetingWrites).toEqual([]); // 새 보고를 만들지 않았다
  expect(RESULT).toContain('다시 요약');
});

test('④ (라) 폰 412: [새로 만들기]는 지금처럼 화면 요약이고, 같은 창에서는 다시 묻지 않는다',async({page})=>{
  test.setTimeout(120000);
  const s=makeState();
  await signIn(page,s,{width:412});
  await known(page);
  await pasteTranscript(page);
  await page.locator('#mtdRun').click();
  await expect(askBox(page)).toBeVisible({timeout:15000});
  await shot(page,'phone-412-text-ask');
  await askBox(page).getByRole('button',{name:'새로 만들기'}).click();
  await expect(page.locator('#meetingTranscript')).toHaveValue(/화면이 요약한 예시 결정/,{timeout:15000});
  await expect(page.locator('#meetingNotes')).toHaveValue(PASTED);
  expect(s.draftCalls).toBe(1);
  await page.locator('#mtdOpen').click();
  await page.locator('#mtdRun').click();
  await expect.poll(()=>s.draftCalls).toBe(2);
  await expect(askBox(page)).toHaveCount(0);
  expect(s.texts).toEqual([]);
});

test('⑤ 회의록 전문이 없는 보고의 그 자리 전사는 묻지 않고 지금처럼 수정 창',async({page})=>{
  test.setTimeout(90000);
  const s=makeState();attached(s,M2);
  await signIn(page,s);
  await known(page);
  await openReport(page,M2);
  await transcribe(page,M2);
  await expect(page.locator('#mrdEditor')).toBeVisible({timeout:20000});
  await expect(page.locator('#mrdEditNotes')).toHaveValue(ATTACHED_TEXT);
  await expect(askBox(page)).toHaveCount(0);
  expect(calls(s,'join_start')).toEqual([]);
});

test('⑥ 서버가 잇기를 모르면 (라)(다) 모두 묻지 않고 지금 길',async({page})=>{
  test.setTimeout(120000);
  const s=makeState();s.unknown=true;attached(s,M1);
  await signIn(page,s);
  await page.waitForTimeout(500); // join_list의 400 답을 받아 '모름'으로 둘 때까지
  // (라): 묻지 않고 바로 화면 요약.
  await pasteTranscript(page);
  await page.locator('#mtdRun').click();
  await expect(page.locator('#meetingTranscript')).toHaveValue(/화면이 요약한 예시 결정/,{timeout:15000});
  await expect(askBox(page)).toHaveCount(0);
  expect(s.texts).toEqual([]);
  await page.keyboard.press('Escape');
  await page.locator('.kptu-ask').getByRole('button',{name:'닫기'}).click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  // (다): 전문이 있는 보고여도 묻지 않고 수정 창.
  await openReport(page,M1);
  await transcribe(page,M1);
  await expect(page.locator('#mrdEditor')).toBeVisible({timeout:20000});
  await expect(page.locator('#mrdEditNotes')).toHaveValue(new RegExp(ATTACHED_TEXT));
  await expect(askBox(page)).toHaveCount(0);
  expect(calls(s,'join_start')).toEqual([]);
});

// OPS-빠진일2차 4(S59-22, 명진 11/11 14:55 "제안대로 전부"): AI 단추 이름 — 회의 보고 창 [할 일 후보 찾기]·자료 녹음 ⋯ [녹음 글로 옮기고 요약하기],
// 회의 입력 창 [사업영역 추천]. KPTU_SHOTS=1이면 docs/design/screens/s59-22/에 PC 1280·폰 412 사진을 남긴다(가짜 자료만).
const shot22=async(page,name)=>{if(SHOTS){await page.waitForTimeout(250);await page.screenshot({path:`docs/design/screens/s59-22/${name}.png`})}};
for(const [width,label] of [[1280,'pc-1280'],[412,'phone-412']])test(`⑦ ${label}: AI 단추 이름 — 보고 창 [할 일 후보 찾기]·자료 녹음 ⋯ [녹음 글로 옮기고 요약하기]`,async({page})=>{
  test.setTimeout(120000);
  const s=makeState();
  await signIn(page,s,{width});
  await known(page);
  await openReport(page,M1);
  const dlg=page.locator('#meetingRoundDetailModal');
  await dlg.locator('#mrdAddTask').click();
  await expect(dlg.locator('#mrdMakeTodos')).toBeVisible();
  await expect(dlg.locator('#mrdMakeTodos')).toHaveText('할 일 후보 찾기');
  await shot22(page,`${label}-todo-candidates-button`);
  await dlg.locator('#mrdAddTask').click();
  await dlg.locator('#mrdMaterials summary[aria-label^="파일 메뉴"]').first().click();
  const item=dlg.locator('#mrdMaterials [data-mrd-transcribe]').first();
  await expect(item).toBeVisible();
  await expect(item).toHaveText('녹음 글로 옮기고 요약하기');
  await item.scrollIntoViewIfNeeded();
  await shot22(page,`${label}-attached-transcribe-menu`);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
// 회의 입력 창의 사업영역 칸: [AI 추천] → [사업영역 추천]
for(const [width,label] of [[1280,'pc-1280'],[412,'phone-412']])test(`⑧ ${label}: 회의 입력 창 사업영역 칸 [사업영역 추천]`,async({page})=>{
  test.setTimeout(120000);
  const s=makeState();
  await signIn(page,s,{width});
  await known(page);
  await page.evaluate(()=>window.KPTUReportEntry.open({kind:'meeting',at:'2026-11-11T11:20'}));
  const entry=page.locator('#meetingModal');
  await expect(entry).toBeVisible({timeout:15000});
  const area=entry.locator('[data-biz-area-ai]');
  await area.scrollIntoViewIfNeeded();
  await expect(area).toHaveText('사업영역 추천');
  await shot22(page,`${label}-area-suggest-button`);
});
