import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
test.use({hasTouch:true});
import {clickView} from './helpers/shell-navigation.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import {openMeetingResult,mrdMenu,closeMeetingResult} from './helpers/meeting-open.mjs';
import {expandLibraryTree,focusLibraryProject,libraryNodeHead} from './helpers/library-tree.mjs';
export function chipState(){const s=baseState();s.meetingWrites=[];s.meetings=['궤도협의회','노사협의회','안전위원회','정책회의','현안회의','후속회의',''].map((name,i)=>({id:`meeting-${i}`,workspace_id:s.workspace.id,title:name,series_name:name,round_no:i+1,meeting_at:'2026-10-11T01:00:00Z',transcript_text:'원문',created_by:s.user.id}));s.docs.push({id:'meeting-doc',workspace_id:s.workspace.id,project_id:'child-a1',title:'회의 연결 자료',meeting_id:'meeting-0',category:'회의자료'});return s}
// UI-PC회의: PC(≥1024) 회의는 유형별 열이고 위쪽 칩은 "보일 열 고르기"(meeting-columns.spec.mjs). 회의명 필터는 1024 미만에서 본다.
for(const width of [390,1000])test(`공용 알약 필터·2단 프로젝트·키보드·터치 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const s=chipState();await mockApp(page,s);await signIn(page,`${appOrigin}/app/?view=meetings`);await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  const group=page.locator('#meetingTypeFilter');await expect(group).toHaveAttribute('role','radiogroup');
  await expect(group.getByRole('radio')).toHaveText(['전체','궤도협의회','노사협의회','안전위원회','정책회의','현안회의','후속회의','회의명 미지정']);
  await group.getByRole('radio',{name:'회의명 미지정',exact:true}).click();await expect(page.locator('.meeting-list-row')).toHaveCount(1);
  await group.getByRole('radio',{name:'궤도협의회',exact:true}).click();await expect(page.locator('.meeting-list-row')).toHaveCount(1);
  // UI-화면폭넘침: 줄 앞 색 점은 없다(색은 필터 칩 점만).
  expect(await page.locator('.meeting-list-row').evaluate(e=>getComputedStyle(e.querySelector('.meeting-list-title'),'::before').content)).toBe('none');
  await page.keyboard.press('ArrowRight');await expect(group.getByRole('radio',{name:'노사협의회',exact:true})).toBeFocused();await page.keyboard.press('Space');
  await expect(page.locator('.meeting-list-row h3')).toHaveText('노사협의회');
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');await expect(page.locator('.meeting-list-row h3')).toHaveText('궤도협의회');
  await group.getByRole('radio',{name:'전체',exact:true}).click();await expect(page.locator('.meeting-list-row')).toHaveCount(s.meetings.length);
  if(width===390){
    await group.getByRole('radio',{name:'후속회의',exact:true}).tap();expect(await group.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);
    await page.evaluate(async()=>{document.querySelector('#meetingTypeFilter').value='회의명 미지정';await window.__KPTU_RELOAD_MEETINGS__()});
    const geometry=await group.evaluate(e=>{const b=e.querySelector('[aria-checked=true]'),r=b.getBoundingClientRect(),lane=e.getBoundingClientRect();return {height:r.height,touch:getComputedStyle(b,'::after').content,wrap:getComputedStyle(e).flexWrap,inside:r.left>=lane.left-1&&r.right<=lane.right+1}});
    // UI-버튼크기: filters are 32px pill chips; a 44px touch extender (::after) stays inside the scroll lane.
    expect(geometry).toEqual({height:32,touch:'""',wrap:'nowrap',inside:true});
    expect(await group.evaluate(e=>{const b=e.querySelector('[aria-checked=true]'),p=getComputedStyle(b,'::after');return [parseFloat(p.height),getComputedStyle(b).borderRadius,e.getBoundingClientRect().height]})).toEqual([44,'999px',44]);
  }
  await clickView(page,'library');await page.waitForFunction(()=>window.KPTUViewLoader.isLoaded('library'));
  // UI-바구니거르기: the [일반 자료|회의자료만] row is gone; meeting documents list with the rest.
  // UI-PC자료실 C: 분류 칩은 여러 개 켜고 끄는 토글이고, 들어올 때는 [회의]만 꺼져 있다(회의 자료 1건 숨김).
  await expect(page.locator('#libraryViewFilter')).toHaveCount(0);await expect(page.locator('.lu-row')).toHaveCount(6);
  const category=page.locator('#libraryCategoryFilter');await expect(category).toHaveAttribute('role','group');
  await expect(category.locator('[data-lu-category="회의"]')).toHaveAttribute('aria-pressed','false');await expect(page.locator('[data-lu-document="meeting-doc"]')).toHaveCount(0);
  await category.locator('[data-lu-category="회의"]').click();await expect(page.locator('.lu-row')).toHaveCount(7);
  await expect(page.locator('[data-lu-document="meeting-doc"]')).toBeAttached();
  // LIB-토글트리: 프로젝트 칩 줄 대신 트리. 1단 토글의 자료 수는 그 아래 2·3단 자료까지 센다(PRJ-3단 결정 2와 같은 범위).
  await expect(libraryNodeHead(page,'p:top-a').locator('.lu-node-count')).toHaveText('3');
  await libraryNodeHead(page,'p:top-a').click();await expect(libraryNodeHead(page,'p:child-a1')).toBeVisible();await expect(libraryNodeHead(page,'p:child-a1').locator('.lu-node-count')).toHaveText('2');
  // 머리 줄은 36px 얇은 줄(LIB-목록간격: 32 → 36px), 누르는 범위 44px.
  expect(Math.round((await libraryNodeHead(page,'p:top-a').boundingBox()).height)).toBe(36);
  expect(await libraryNodeHead(page,'p:top-a').evaluate(n=>parseFloat(getComputedStyle(n,'::after').height))).toBe(44);
  // 키보드: 토글 머리에서 Enter로 펴고 접는다.
  await libraryNodeHead(page,'p:child-a1').focus();await page.keyboard.press('Enter');await expect(page.locator('[data-lu-document="doc-a1"]')).toBeVisible();await expect(page.locator('[data-lu-document="meeting-doc"]')).toBeVisible();
  // 다른 화면(프로젝트 상세)에서 큰 프로젝트로 걸러 열면 그 아래 프로젝트 자료도 함께, 맞는 토글만 펼쳐져 보인다.
  const project=page.locator('#documentProject');
  await focusLibraryProject(page,'top-a');await expect(page.locator('.lu-row')).toHaveCount(3);await expect(page.locator('.lu-row:visible')).toHaveCount(3);
  await focusLibraryProject(page,'child-a1');await expect(page.locator('.lu-row')).toHaveCount(2);
  await expect(page.locator('[data-lu-document="doc-a1"]')).toBeVisible();
  // [정책]을 끄면 회의 자료만 남고, 검색 중 [회의]를 끄면 목록 아래 안내와 [켜기]가 나온다.
  await category.locator('[data-lu-category="정책"]').click();await expect(page.locator('.lu-row')).toHaveCount(1);
  await expect(page.locator('[data-lu-document="meeting-doc"]')).toBeVisible();
  await page.locator('#documentSearch').fill('회의');await expect(page.locator('.lu-row')).toHaveCount(1);
  await category.locator('[data-lu-category="회의"]').click();await expect(page.locator('.lu-row')).toHaveCount(0);
  await expect(page.locator('.lu-off-hint')).toHaveText('회의 분류 1건은 꺼져 있어요 켜기');
  await page.locator('.lu-off-hint button').click();await expect(page.locator('.lu-row')).toHaveCount(1);await expect(page.locator('.lu-off-hint')).toHaveCount(0);
  await category.locator('[data-lu-category="all"]').click();await expect(category.locator('[aria-pressed="false"]')).toHaveCount(0);
  await page.locator('#documentSearch').fill('');await focusLibraryProject(page,'all');await expect(project).toBeHidden();await expect(page.locator('.lu-row')).toHaveCount(7);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
});
for(const timezoneId of ['Europe/Rome','Asia/Seoul','UTC'])test.describe(timezoneId,()=>{test.use({timezoneId});test('회의 표시·새 입력·수정 왕복 한국 고정',async({page})=>{
  const s=chipState();await mockApp(page,s);await signIn(page,`${appOrigin}/app/?view=meetings`);await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  // MEET-결과정리 ⑤ → MEET-결과3단: PC는 왼쪽에서 고른 회의 종류의 차수만 가운데에 보이므로 궤도협의회를 고른다(폰은 한 줄 목록 그대로).
  if(await page.locator('#meetingList [data-meeting-kind]').count())await page.locator('#meetingList [data-meeting-kind="궤도협의회"]').click();
  if(await page.locator('#meetingList [data-meeting-round="meeting-0"]').count())await expect(page.locator('#meetingList [data-meeting-round="meeting-0"]')).toContainText('10.11');else await expect(page.locator('#meetingList [data-mrd-meeting="meeting-0"] p')).toContainText('10:00');
  await openMeetingResult(page,'meeting-0');await expect(page.locator('#mrdMeta')).toContainText('10:00');await mrdMenu(page,'edit');await expect(page.locator('#mrdEditAt')).toHaveValue('2026-10-11T10:00');
  await fillDateTime(page,'#mrdEditAt','2026-10-11T00:30');await page.locator('#mrdSaveEdit').click();await expect.poll(()=>s.meetingWrites[0]?.meeting_at).toBe('2026-10-10T15:30:00.000Z');await mrdMenu(page,'edit');await expect(page.locator('#mrdEditAt')).toHaveValue('2026-10-11T00:30');await closeMeetingResult(page);
  await page.locator('#newMeetingBtn').click();await page.locator('#meetingNameSelect').selectOption('궤도협의회');await fillDateTime(page,'#meetingAt','2026-10-11T10:00');await page.locator('#meetingTranscript').fill('새 원문');await page.locator('#saveMeetingBtn').click();await expect.poll(()=>s.meetingWrites.at(-1)?.meeting_at).toBe('2026-10-11T01:00:00.000Z');
})});

test('프로젝트 자료 전체 보기는 하위 알약과 같은 필터 결과로 이동',async({page})=>{
  const s=chipState(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await mockApp(page,s);await signIn(page,`${appOrigin}/app/?view=projects`);
  await page.locator('[data-ps3-project="child-a1"]').first().click();await expect(page.locator('#ps3DetailModal')).toBeVisible();await page.locator('[data-ps3-library]').click();
  await expect(page.locator('#libraryView')).toBeVisible();await expect(page.locator('#libraryViewFilter')).toHaveCount(0);await expect(page.locator('#documentProject')).toHaveJSProperty('value','child-a1');
  // UI-PC자료실 C: 프로젝트에서 들어와도 자료실 기본 상태([회의] 꺼짐)로 시작한다. [회의]를 켜면 그 프로젝트의 회의 자료가 같이 보인다.
  await expect(page.locator('.lu-row')).toHaveCount(1);await expect(page.locator('[data-lu-document="doc-a1"]')).toBeVisible();
  await page.locator('#libraryCategoryFilter [data-lu-category="회의"]').click();await expect(page.locator('.lu-row')).toHaveCount(2);await expect(page.locator('[data-lu-document="meeting-doc"]')).toBeVisible();expect(errors).toEqual([]);
});
