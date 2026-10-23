// MTG-사업보고 4단계(docs/design/business-report.md 5·8.1절): 칸 칩 줄·칩별 거르기·[회의]만 회의명 칩·[+] 칸 고르기·저장 본문 activity_kind·
// [칸 바꾸기] PATCH·PC [회의] 3단 / 다른 칸·[전체] 2단. 모든 이름·글은 합성 값.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

test.use({timezoneId:'Asia/Seoul'});
const CHIPS=['전체','회의','정책','교섭','언론','국회','투쟁','교육','기타'];

// 회의 3건(칸 없음 1건 = 옛 응답, 'meeting' 2건), 언론 1건, 정책 1건, 모르는 칸 1건(→ 기타로 보임).
function kindState(){
  const s=baseState();s.meetingWrites=[];
  const row=(id,name,at,extra={})=>({id,workspace_id:s.workspace.id,title:name,series_name:name,round_no:null,meeting_at:at,transcript_text:'합성 결과 '+id,created_by:s.user.id,...extra});
  s.meetings=[
    row('m-old','합성 정기 회의','2026-10-01T01:00:00Z',{round_no:1}),
    row('m-1','합성 정기 회의','2026-10-08T01:00:00Z',{round_no:2,activity_kind:'meeting'}),
    row('m-2','합성 운영 회의','2026-10-09T01:00:00Z',{round_no:5,activity_kind:'meeting'}),
    row('p-1','합성 출정 기자회견','2026-10-21T01:00:00Z',{activity_kind:'press'}),
    row('q-1','합성 정책 토론회','2026-10-15T05:00:00Z',{activity_kind:'policy'}),
    row('x-1','합성 알 수 없는 칸','2026-10-02T01:00:00Z',{activity_kind:'future_kind'})
  ];
  return s;
}
async function open(page,s,width){
  await page.setViewportSize({width,height:900});await mockApp(page,s);
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();
}
const chips=page=>page.locator('#reportKindFilter');
const chip=(page,name)=>chips(page).getByRole('radio',{name,exact:true});
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

test('폰 390: 칸 칩 한 줄은 옆으로 밀리고 페이지는 넘치지 않는다 / 칩별 거르기 / [회의]만 회의명 칩',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=kindState();await open(page,s,390);
  await expect(chips(page)).toHaveAttribute('role','radiogroup');await expect(chips(page)).toHaveAttribute('aria-label','칸');
  await expect(chips(page).getByRole('radio')).toHaveText(CHIPS);
  // 처음은 [회의]: 지금 기록은 모두 회의라 첫 화면이 그대로다. 칸이 없는 옛 행도 회의다.
  await expect(chip(page,'회의')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(3);
  await expect(page.locator('#meetingTypeFilter')).toBeVisible();
  await expect(page.locator('#meetingTypeFilter').getByRole('radio')).toHaveText(['전체','합성 운영 회의','합성 정기 회의','회의명 미지정']);
  // 칩 줄은 한 줄(높이 그대로)이고 칸 안에서만 옆으로 넘어간다.
  const lane=await chips(page).evaluate(el=>{const b=[...el.children].map(c=>c.getBoundingClientRect());return {oneLine:new Set(b.map(r=>Math.round(r.top))).size===1,scrolls:el.scrollWidth>el.clientWidth,right:el.getBoundingClientRect().right}});
  expect(lane.oneLine).toBe(true);expect(lane.scrolls).toBe(true);expect(lane.right).toBeLessThanOrEqual(390);
  expect(await noSideScroll(page)).toBe(true);
  // [언론]: 그 칸만, 회의명 칩 줄은 숨는다.
  await chip(page,'언론').click();
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(1);await expect(page.locator('#meetingList .meeting-list-row h3')).toHaveText('합성 출정 기자회견');
  await expect(page.locator('#meetingTypeFilter')).toBeHidden();
  // 끝 쪽 칩으로 가도 페이지는 넘치지 않는다(칩 줄만 밀림).
  await chip(page,'기타').click();await expect(page.locator('#meetingList .meeting-list-row h3')).toHaveText('합성 알 수 없는 칸');
  expect(await chip(page,'기타').evaluate(el=>{const r=el.getBoundingClientRect(),h=el.parentElement.getBoundingClientRect();return r.right<=h.right+1&&r.left>=h.left-1})).toBe(true);
  expect(await noSideScroll(page)).toBe(true);
  await chip(page,'교육').click();await expect(page.locator('#meetingList .empty')).toHaveText('이 칸에 사업 보고가 없습니다.');
  // [전체]: 전부, 줄에 칸 이름.
  await chip(page,'전체').click();await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(6);
  await expect(page.locator('#meetingList [data-mrd-meeting="p-1"] p')).toContainText('언론');
  await expect(page.locator('#meetingTypeFilter')).toBeHidden();
  // 키보드: 칩 줄 안 화살표로 옮겨 고른다.
  await chip(page,'전체').focus();await page.keyboard.press('ArrowRight');await expect(chip(page,'회의')).toBeFocused();await expect(chip(page,'회의')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#meetingTypeFilter')).toBeVisible();
  expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`${width}: [전체]에서 [+] → 칸 고르기 → 칸 채워진 창, 저장 본문에 activity_kind / 칩에서 [+]는 칸 자동`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=kindState();await open(page,s,width);
  await chip(page,'전체').click();
  await page.locator('#newMeetingBtn').click();
  const sheet=page.locator('#reportKindSheet');await expect(sheet).toBeVisible();
  await expect(sheet.locator('h2')).toHaveText('어느 칸에 남길까요?');
  await expect(sheet.locator('[data-sheet-value]')).toHaveText(CHIPS.slice(1));
  // Esc는 고르기만 닫고 입력 창은 열지 않는다.
  await page.keyboard.press('Escape');await expect(sheet).toBeHidden();await expect(page.locator('#meetingModal')).toBeHidden();
  await page.locator('#newMeetingBtn').click();await expect(sheet).toBeVisible();
  await sheet.locator('[data-sheet-value="press"]').click();
  await expect(sheet).toBeHidden();await expect(page.locator('#meetingModal')).toBeVisible();
  const pick=page.locator('#meetingKindPick');
  await expect(pick.getByRole('radio',{name:'언론',exact:true})).toHaveAttribute('aria-checked','true');
  // 회의가 아닌 칸에서는 차수 칸이 접힌다.
  await expect(page.locator('#meetingRoundNo')).toBeHidden();
  if(width<=760)expect(await noSideScroll(page)).toBe(true);
  // 창 안에서 칸을 바꿀 수 있다.
  await pick.getByRole('radio',{name:'국회',exact:true}).click();await expect(pick.getByRole('radio',{name:'국회',exact:true})).toHaveAttribute('aria-checked','true');
  // MTG-사업보고말바꾸기: 회의가 아닌 칸은 '제목'·'원문'·'자료' 말을 쓰고 회의명 고르기·차수·짧은 이름이 없다.
  await expect(page.locator('#meetingNameSelect')).toBeHidden();await expect(page.locator('#meetingShortName')).toBeHidden();
  await expect(page.locator('#meetingTitleLabel')).toHaveText('제목');await expect(page.locator('#meetingResultLegend')).toHaveText('내용');
  await expect(page.locator('#meetingMaterialsHead')).toHaveText('자료');await expect(page.locator('.meeting-create-modes')).toBeHidden();
  await page.locator('#meetingTitle').fill('합성 의원실 면담');await fillDateTime(page,'#meetingAt','2026-10-22T10:00');
  await page.locator('#meetingTranscript').fill('합성 면담 결과');await page.locator('#saveMeetingBtn').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.activity_kind).toBe('assembly');
  expect(s.meetingWrites.at(-1)).toMatchObject({series_name:'합성 의원실 면담',transcript_text:'합성 면담 결과'});
  await expect(page.locator('#meetingModal')).toBeHidden();
  // 칩에서 [+]: 칸 고르기 없이 그 칸이 채워진 창.
  await chip(page,'교육').click();await page.locator('#newMeetingBtn').click();
  await expect(sheet).toBeHidden();await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingKindPick').getByRole('radio',{name:'교육',exact:true})).toHaveAttribute('aria-checked','true');
  await page.locator('[data-close="meetingModal"]').click();
  // [회의] 칩의 [+]: 회의 칸, 차수 칸 보임(지금과 같음).
  await chip(page,'회의').click();await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingKindPick').getByRole('radio',{name:'회의',exact:true})).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#meetingRoundNo')).toBeVisible();
  await expect(page.locator('#meetingTitleLabel')).toHaveText('회의명');await expect(page.locator('#meetingResultLegend')).toHaveText('회의 결과');await expect(page.locator('#meetingTextLabel')).toHaveText('회의 결과 원문');
  expect(errors).toEqual([]);
});

test('PC 1280: 칸 칩 한 줄 / [회의] 3단, 다른 칸·[전체] 2단(목록 | 결과), 결과에 칸 표시',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=kindState();await open(page,s,1280);
  const boxes=await chips(page).getByRole('radio').evaluateAll(els=>els.map(e=>e.getBoundingClientRect()).map(r=>({top:Math.round(r.top),right:r.right})));
  expect(new Set(boxes.map(b=>b.top)).size).toBe(1);
  expect(await chips(page).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await noSideScroll(page)).toBe(true);
  // [회의]: 지금 3단 그대로(회의 칸 행만).
  await expect(page.locator('#meetingList .mcol-kinds')).toBeVisible();
  await expect(page.locator('#meetingList .mcol-kinds .mcol-name')).toHaveText(['합성 운영 회의','합성 정기 회의']);
  await expect(page.locator('#meetingTypeFilter')).toBeHidden();
  await expect(page.locator('#meetingList #mcolResult [data-report-kind-label]')).toHaveText('회의 칸');
  // [언론]: 종류 단이 접히고 2단.
  await chip(page,'언론').click();
  await expect(page.locator('#meetingList .mcol-kinds')).toHaveCount(0);await expect(page.locator('#meetingList .mcol-two')).toBeVisible();
  await expect(page.locator('#meetingList .mcol-rounds .mcol-card')).toHaveCount(1);
  await expect(page.locator('#meetingList #mcolResult')).toHaveAttribute('data-meeting-result','p-1');
  await expect(page.locator('#meetingList #mcolResult [data-report-kind-label]')).toHaveText('언론 칸');
  await expect(page.locator('#meetingList #mcolResult .mcol-text').first()).toHaveText('합성 결과 p-1');
  const cols=await page.evaluate(()=>{const l=document.querySelector('#meetingList .mcol-rounds').getBoundingClientRect(),r=document.querySelector('#meetingList #mcolResult').getBoundingClientRect();return {l:l.width,r:r.width,side:l.right<=r.left,top:Math.abs(l.top-r.top)}});
  expect(cols.side).toBe(true);expect(cols.top).toBeLessThanOrEqual(1);expect(cols.r/cols.l).toBeGreaterThan(1.5);
  await expect(page.locator('#meetingList .split-resize-handle')).toHaveCount(1);
  // [전체]: 모든 칸, 최신 위, 줄에 칸 이름, 줄을 누르면 오른쪽만 바뀐다.
  await chip(page,'전체').click();
  await expect(page.locator('#meetingList .mcol-rounds .mcol-card .mcol-round')).toHaveText(['합성 출정 기자회견','합성 정책 토론회','합성 운영 회의','합성 정기 회의','합성 알 수 없는 칸','합성 정기 회의']);
  await expect(page.locator('#meetingList [data-meeting-round="q-1"] .mcol-kind-tag').first()).toHaveText('정책');
  await page.locator('#meetingList [data-meeting-round="x-1"]').click();
  await expect(page.locator('#meetingList #mcolResult')).toHaveAttribute('data-meeting-result','x-1');
  await expect(page.locator('#meetingList #mcolResult [data-report-kind-label]')).toHaveText('기타 칸');
  await expect(page.locator('#meetingList [data-meeting-round="x-1"]')).toBeFocused();
  await page.keyboard.press('ArrowUp');await expect(page.locator('#meetingList [data-meeting-round="m-1"]')).toBeFocused();
  await expect(page.locator('#meetingModal')).toBeHidden();
  // 다시 [회의]: 3단으로 돌아온다.
  await chip(page,'회의').click();await expect(page.locator('#meetingList .mcol-kinds')).toBeVisible();await expect(page.locator('#meetingList .mcol-two')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('PC 1280: 결과 ⋯ → [칸 바꾸기] PATCH activity_kind, 바꾼 건은 그 칸 칩에서 계속 보인다',async({page})=>{
  const s=kindState();await open(page,s,1280);
  await page.locator('#meetingList [data-meeting-kind="합성운영회의"]').click();
  await expect(page.locator('#meetingList #mcolResult')).toHaveAttribute('data-meeting-result','m-2');
  await page.locator('#meetingList [data-meeting-more]').click();await page.locator('#mcolMenu [data-meeting-menu="kind"]').click();
  const sheet=page.locator('#reportKindSheet');await expect(sheet).toBeVisible();await expect(sheet.locator('h2')).toHaveText('칸 바꾸기');
  await expect(sheet.locator('[data-sheet-value="meeting"]')).toHaveAttribute('aria-pressed','true');
  await sheet.locator('[data-sheet-value="struggle"]').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.activity_kind).toBe('struggle');
  expect(Object.keys(s.meetingWrites.at(-1)).sort()).toEqual(['activity_kind','updated_at']);
  await expect(chip(page,'투쟁')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#meetingList .mcol-two')).toBeVisible();
  await expect(page.locator('#meetingList #mcolResult')).toHaveAttribute('data-meeting-result','m-2');
  await expect(page.locator('#meetingList #mcolResult [data-report-kind-label]')).toHaveText('투쟁 칸');
});

test('폰 390: 결과 창에 칸 표시·[칸 바꾸기] PATCH, 뒤로가기는 고르기 창부터 닫는다',async({page})=>{
  const s=kindState();await open(page,s,390);
  await chip(page,'언론').click();await page.locator('#meetingList [data-mrd-meeting="p-1"]').click();
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();await expect(page.locator('#mrdMeta')).toContainText('언론 칸');
  await page.locator('#mrdKind').click();const sheet=page.locator('#reportKindSheet');await expect(sheet).toBeVisible();
  const box=await sheet.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(391);
  await page.goBack();await expect(sheet).toBeHidden();await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
  await page.locator('#mrdKind').click();await sheet.locator('[data-sheet-value="education"]').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.activity_kind).toBe('education');
  await expect(page.locator('#mrdMeta')).toContainText('교육 칸');await expect(page.locator('#mrdStatus')).toContainText('교육');
  await page.locator('#mrdClose').click();
  await expect(chip(page,'교육')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#meetingList [data-mrd-meeting="p-1"]')).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
});
