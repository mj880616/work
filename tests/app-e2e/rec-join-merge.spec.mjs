// REC-한회의로잇기 PR-4(S59-16, 설계 docs/design/rec-join.md 4절 PR-4 줄·3-3·3-5절, 시안 docs/design/mockups/rec-join.html ④): 이미 따로 저장한 두 보고를 하나로.
// ① PC: 보고 ⋯ [다른 보고에 합치기](목록 우클릭·달력 우클릭·상세 ⋯ 세 곳에 같은 항목) → 어느 보고에 합칠지 고르기(같은 날 녹음으로 쓴 보고부터) →
//    고른 보고 id + 이 보고 id만 보낸다 → 맨 위 '○○에 합치는 중' → '○○ 보고에 합쳤어요. 11:05 보고는 휴지통으로 옮겼어요 [열기][되돌리기]' →
//    보던 이 보고 창은 닫힘 → 합친 보고 ⋯ [두 보고로 되돌리기](통째로) → 두 보고가 다시.
// ② 폰 412: 거절(회의록 전문 없음)은 이유 한 줄, 다시 고르면 합치고 끝 줄 [되돌리기]로 통째로 되돌린다.
// ③ 서버가 잇기를 모르면(옛 Edge·표 적용 전) 메뉴에 [다른 보고에 합치기]를 그리지 않는다(지금 메뉴 그대로).
// 실제 서버는 쓰지 않는다(가짜 Supabase, helpers/rec-join-server.mjs). KPTU_SHOTS=1이면 docs/design/screens/s59-16/에 화면 사진을 남긴다(PR 첨부용).
import {test,expect} from '@playwright/test';
import {M1,M2,M4,JJ,RESULT,BEFORE_RESULT,FIRST_NOTES,LATER_RESULT,LATER_NOTES,makeState,signIn,calls,joinLine} from './helpers/rec-join-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SHOTS=process.env.KPTU_SHOTS==='1';
const shot=async(page,name)=>{if(SHOTS){await page.waitForTimeout(250);await page.screenshot({path:`docs/design/screens/s59-16/${name}.png`})}};
const more=page=>page.locator('#mrdMoreMenu');
const pick=page=>page.locator('.kptu-ask.kptu-ask-choice');
const known=page=>page.waitForFunction(m=>window.KPTUMeetingJoin.canMerge({id:m,activity_kind:'meeting'}),M4);
const meeting=(s,id)=>s.meetings.find(m=>m.id===id);

test('① PC: 보고 ⋯ [다른 보고에 합치기]는 세 곳에 같고, 고른 보고에 뒤에서 합치고, 합친 보고 ⋯ [두 보고로 되돌리기]로 두 보고로',async({page})=>{
  test.setTimeout(120000);
  const s=makeState();
  await signIn(page,s);
  await known(page);
  const detail=page.locator('#meetingRoundDetailModal');
  const openM4=async()=>{await page.evaluate(m=>window.KPTUMeetingRoundDetail.open(m),M4);await expect(detail).toHaveAttribute('data-meeting-id',M4,{timeout:15000})};
  await openM4();
  // 목록 우클릭(오른쪽 칸 보고의 ⋯ 메뉴).
  await page.locator(`#meetingList [data-meeting-round="${M4}"]`).click({button:'right'});
  await expect(more(page)).toBeVisible({timeout:15000});
  await expect(more(page).locator('button')).toHaveText(['수정','종류 바꾸기','다른 보고에 합치기','삭제']);
  await page.keyboard.press('Escape');await expect(more(page)).toBeHidden();
  // 달력 우클릭(창 밖 메뉴 — 같은 항목).
  await page.locator('#reportViewSelect').selectOption({label:'달력'});
  const title=page.locator(`#meetingList .rv-cal .rv-cell.rv-now [data-mrd-meeting="${M4}"]`);
  await title.click({button:'right'});
  await expect(more(page)).toBeVisible();
  await expect(more(page).locator('button')).toHaveText(['수정','종류 바꾸기','다른 보고에 합치기','삭제']);
  await page.keyboard.press('Escape');await expect(more(page)).toBeHidden();
  await page.locator('#reportViewSelect').selectOption({label:'목록'});
  // 상세 ⋯(시안 ④): 11:05 보고를 연 채 [다른 보고에 합치기].
  await openM4();
  await detail.locator('#mrdMore').click();
  await expect(more(page).locator('button')).toHaveText(['수정','종류 바꾸기','다른 보고에 합치기','삭제']);
  await shot(page,'pc-1280-menu');
  await more(page).locator('[data-mrd-more="merge"]').click();
  // 고르기: 같은 날 녹음으로 쓴 보고(서버 후보) → 내 목록의 다른 [회의] 보고. 이 보고는 빠진다.
  await expect(pick(page).locator('.kptu-ask-text')).toHaveText('어느 보고에 합칠까요? · 같은 날 보고부터');
  await expect(pick(page).locator('.kptu-ask-pick-t b')).toHaveText(['예시 집행위','예시 간담회','예시 집행위']);
  await expect(pick(page).locator('.kptu-ask-pick-t small')).toHaveText(['10:02 · 녹음 38분','15:00','11.4. 10:00']);
  await expect(pick(page).locator('.kptu-ask-foot')).toContainText('합치면 이 보고는 휴지통으로 옮기고');
  expect(calls(s,'join_candidates').map(c=>c.body)).toEqual([{meeting_id:M4}]);
  await shot(page,'pc-1280-pick');
  // 고른 보고 id + 이 보고 id만(작업공간·소유 값은 서버가 로그인으로 정함). 창은 열린 채, 맨 위 줄에 진행.
  await pick(page).locator(`[data-ask-pick="${M1}"]`).click();
  await expect.poll(()=>calls(s,'join_start').map(c=>c.body)).toEqual([{target_meeting_id:M1,source:{meeting_id:M4}}]);
  await expect(joinLine(page)).toContainText('10:02 예시 집행위에 합치는 중 · 전체 다시 요약 · 화면을 옮겨도 계속돼요');
  await shot(page,'pc-1280-merging');
  // 서버가 합침 → 끝 줄. 이 보고(휴지통으로 감)를 보던 창은 닫히고, 화면은 보고를 직접 쓰지 않았다(저장은 서버 한 곳).
  s.applyNow=true;
  await expect(joinLine(page)).toContainText('10:02 예시 집행위 보고에 합쳤어요. 11:05 보고는 휴지통으로 옮겼어요',{timeout:15000});
  await expect(joinLine(page).getByRole('button')).toHaveText(['열기','되돌리기','✕']);
  await expect(detail).not.toHaveAttribute('data-meeting-id',M4);
  await expect(page.locator(`#meetingList [data-meeting-round="${M4}"]`)).toHaveCount(0);
  expect(s.meetingWrites).toEqual([]);
  expect(s.calls.some(c=>c.action==='google-tasks:create')).toBe(false); // 할 일은 저절로 만들지 않는다(후보로만)
  await shot(page,'pc-1280-merged');
  // [열기] → 합친 보고: 다시 요약한 회의 결과·옮겨 온 녹음. ⋯에 [두 보고로 되돌리기].
  await joinLine(page).getByRole('button',{name:'열기'}).click();
  await expect(detail.locator('#mrdResult')).toContainText('두 전사 전체로 다시 요약한 예시 결정',{timeout:15000});
  await expect(detail.locator('#mrdMaterials')).toContainText('녹음 11-05.webm');
  await expect(detail.locator('#mrdJoinTools button')).toHaveText('합치기 전 글로 되돌리기');
  await detail.locator('#mrdMore').click();
  await expect(more(page).locator('button')).toHaveText(['수정','종류 바꾸기','다른 보고에 합치기','두 보고로 되돌리기','삭제']);
  await shot(page,'pc-1280-unmerge-menu');
  await more(page).locator('[data-mrd-more="unmerge"]').click();
  await expect.poll(()=>calls(s,'join_undo').map(c=>c.body)).toEqual([{job_id:JJ(1),scope:'all'}]);
  await expect(page.locator('#kptuNotice')).toContainText('두 보고로 되돌렸어요');
  await expect(detail.locator('#mrdResult')).toContainText('예시 앞 녹음 결정',{timeout:15000});
  await expect(page.locator(`#meetingList [data-meeting-round="${M4}"]`)).toHaveCount(1);
  expect([meeting(s,M1).transcript_text,meeting(s,M1).notes,meeting(s,M4).deleted_at]).toEqual([BEFORE_RESULT,FIRST_NOTES,null]);
  expect(s.meetingWrites).toEqual([]);
});

test('② 폰 412: 거절되면 이유 한 줄(보고는 그대로), 다시 골라 합치고 끝 줄 [되돌리기]는 통째로 두 보고로',async({page})=>{
  test.setTimeout(120000);
  const s=makeState();
  s.refuse[M2]={status:422,code:'no_first_transcript',error:'회의록 전문이 없는 보고에는 이어 붙일 수 없어요.'};
  await signIn(page,s,{width:412});
  await known(page);
  const detail=page.locator('#meetingRoundDetailModal');
  await page.evaluate(m=>window.KPTUMeetingRoundDetail.open(m),M4);
  await expect(detail).toBeVisible({timeout:15000});
  await detail.locator('#mrdMore').click();
  await expect(more(page).locator('button')).toHaveText(['수정','종류 바꾸기','다른 보고에 합치기','삭제']);
  await shot(page,'phone-412-menu');
  await more(page).locator('[data-mrd-more="merge"]').click();
  await expect(pick(page)).toBeVisible();
  await shot(page,'phone-412-pick');
  // 회의록 전문이 없는 보고 → 서버가 거절, 바뀐 것 없음.
  await pick(page).locator(`[data-ask-pick="${M2}"]`).click();
  await expect(page.locator('#kptuNotice')).toContainText('회의록 전문이 없는 보고에는 이어 붙일 수 없어요.');
  await expect(joinLine(page)).toHaveCount(0);
  expect([meeting(s,M4).transcript_text,meeting(s,M4).deleted_at]).toEqual([LATER_RESULT,null]);
  // 다시: 같은 날 앞 보고에 합친다.
  await detail.locator('#mrdMore').click();
  await more(page).locator('[data-mrd-more="merge"]').click();
  await pick(page).locator(`[data-ask-pick="${M1}"]`).click();
  await expect(joinLine(page)).toContainText('10:02 예시 집행위에 합치는 중');
  await shot(page,'phone-412-merging');
  s.applyNow=true;
  await expect(joinLine(page)).toContainText('10:02 예시 집행위 보고에 합쳤어요. 11:05 보고는 휴지통으로 옮겼어요',{timeout:15000});
  await expect(detail).toBeHidden(); // 휴지통으로 간 이 보고의 창은 닫는다
  await shot(page,'phone-412-merged');
  // 끝 줄 [되돌리기] = 통째로: 합친 보고의 두 글을 합치기 전으로, 옮긴 녹음을 제자리로, 휴지통의 보고를 꺼냄.
  await joinLine(page).getByRole('button',{name:'되돌리기'}).click();
  await expect.poll(()=>calls(s,'join_undo').map(c=>c.body)).toEqual([{job_id:JJ(1),scope:'all'}]);
  await expect(joinLine(page)).toHaveCount(0);
  await expect(page.locator('#kptuNotice')).toContainText('두 보고로 되돌렸어요');
  expect([meeting(s,M1).transcript_text,meeting(s,M1).notes,meeting(s,M4).deleted_at,meeting(s,M4).notes]).toEqual([BEFORE_RESULT,FIRST_NOTES,null,LATER_NOTES]);
  expect(s.docs.find(d=>d.file_name==='녹음 11-05.webm').meeting_id).toBe(M4);
  expect(calls(s,'join_start').map(c=>c.body.target_meeting_id)).toEqual([M2,M1]);
  expect(s.meetingWrites).toEqual([]);
  expect(RESULT).toContain('두 전사');
});

test('③ 서버가 잇기를 모르면 메뉴에 [다른 보고에 합치기]를 그리지 않는다(상세 ⋯·달력 우클릭)',async({page})=>{
  test.setTimeout(90000);
  const s=makeState();s.unknown=true;
  await signIn(page,s);
  await page.waitForTimeout(500); // join_list의 400 답을 받아 '모름'으로 둘 때까지
  const detail=page.locator('#meetingRoundDetailModal');
  await page.evaluate(m=>window.KPTUMeetingRoundDetail.open(m),M4);
  await expect(detail).toHaveAttribute('data-meeting-id',M4,{timeout:15000});
  await detail.locator('#mrdMore').click();
  await expect(more(page).locator('button')).toHaveText(['수정','종류 바꾸기','삭제']);
  await page.keyboard.press('Escape');
  await page.locator('#reportViewSelect').selectOption({label:'달력'});
  await page.locator(`#meetingList .rv-cal .rv-cell.rv-now [data-mrd-meeting="${M4}"]`).click({button:'right'});
  await expect(more(page)).toBeVisible();
  await expect(more(page).locator('button')).toHaveText(['수정','종류 바꾸기','삭제']);
  expect(calls(s,'join_candidates')).toEqual([]);
  expect(calls(s,'join_start')).toEqual([]);
});
