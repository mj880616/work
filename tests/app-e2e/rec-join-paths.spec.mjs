// REC-한회의로잇기 PR-5(S59-16, 설계 docs/design/rec-join.md 4절 PR-5 줄·3-3절 (다)(라)): 나머지 두 길에도 같은 물음.
// (다) 회의자료 그 자리 전사(보고 창 자료 ⋯ [전사해서 결과에 넣기] → 서버 정리 kind attached): 그 회의에 회의록 전문이 이미 있을 때만
//      '이 보고에 회의록 전문이 이미 있어요…' [수정 창에 넣기] [그 보고에 잇기]. 잇기면 수정 창 없이 서버가 뒤에서, 넣기면 지금처럼 수정 창(저장은 사람이).
// (라) [회의] 입력 창의 전사 글 물음은 S61-24(REC-요약단추삭제)에서 화면과 함께 뺐다(지금은 없음 — tests/app-e2e/rec-summary-removed.spec.mjs).
// 서버가 잇기를 모르면 두 길 모두 묻지 않고 지금 길. 실제 서버는 쓰지 않는다(가짜 Supabase, helpers/rec-join-server.mjs).
import {test,expect} from '@playwright/test';
import {M1,M4,makeState,signIn} from './helpers/rec-join-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SHOTS=process.env.KPTU_SHOTS==='1';
const known=page=>page.waitForFunction(m=>window.KPTUMeetingJoin.canMerge({id:m,activity_kind:'meeting'}),M4);
const openReport=async(page,meetingId)=>{await page.evaluate(m=>window.KPTUMeetingRoundDetail.open(m),meetingId);await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('data-meeting-id',meetingId,{timeout:15000})};
// OPS-빠진일2차 4(S59-22, 명진 11/11 14:55 "제안대로 전부"): AI 단추 이름 — 회의 보고 창 [할 일 후보 찾기], 회의 입력 창 [사업영역 추천].
// S61-5 REC-전사삭제(명진 11/13): 자료 녹음 ⋯ [녹음 글로 옮기고 요약하기]는 지금은 없다(⋯에 없음을 확인).
// KPTU_SHOTS=1이면 docs/design/screens/s59-22/에 PC 1280·폰 412 사진을 남긴다(가짜 자료만).
const shot22=async(page,name)=>{if(SHOTS){await page.waitForTimeout(250);await page.screenshot({path:`docs/design/screens/s59-22/${name}.png`})}};
for(const [width,label] of [[1280,'pc-1280'],[412,'phone-412']])test(`⑦ ${label}: AI 단추 이름 — 보고 창 [할 일 후보 찾기], 자료 녹음 ⋯에 전사 항목 없음`,async({page})=>{
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
  await expect(dlg.locator('#mrdMaterials [data-mrd-transcribe]')).toHaveCount(0);
  await expect(dlg.locator('#mrdMaterials').getByText('녹음 글로 옮기고 요약하기')).toHaveCount(0);
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
