import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
test.use({hasTouch:true});
import {clickView} from './helpers/shell-navigation.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
export function chipState(){const s=baseState();s.meetingWrites=[];s.meetings=['궤도협의회','노사협의회','안전위원회','정책회의','현안회의','후속회의',''].map((name,i)=>({id:`meeting-${i}`,workspace_id:s.workspace.id,title:name,series_name:name,round_no:i+1,meeting_at:'2026-10-11T01:00:00Z',transcript_text:'원문',created_by:s.user.id}));s.docs.push({id:'meeting-doc',workspace_id:s.workspace.id,project_id:'child-a1',title:'회의 연결 자료',meeting_id:'meeting-0',category:'회의자료'});return s}
// UI-PC회의: PC(≥1024) 회의는 유형별 열이고 위쪽 칩은 "보일 열 고르기"(meeting-columns.spec.mjs). 회의명 필터는 1024 미만에서 본다.
for(const width of [390,1000])test(`공용 알약 필터·2단 프로젝트·키보드·터치 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const s=chipState();await mockApp(page,s);await signIn(page,'http://127.0.0.1:8123/app/?view=meetings');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  const group=page.locator('#meetingTypeFilter');await expect(group).toHaveAttribute('role','radiogroup');
  await expect(group.getByRole('radio')).toHaveText(['전체','궤도협의회','노사협의회','안전위원회','정책회의','현안회의','후속회의','회의명 미지정']);
  await group.getByRole('radio',{name:'회의명 미지정',exact:true}).click();await expect(page.locator('.meeting-list-row')).toHaveCount(1);
  await group.getByRole('radio',{name:'궤도협의회',exact:true}).click();await expect(page.locator('.meeting-list-row')).toHaveCount(1);
  // UI-디자인기준 3/3(8-9e-1): the meeting color is the dot before the name (it was the row's left stripe).
  const color=await page.locator('.meeting-list-row').evaluate(e=>getComputedStyle(e.querySelector('.meeting-list-title'),'::before').backgroundColor);
  expect(await group.locator('[data-filter-value="궤도협의회"] .filter-chip-dot').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(color);
  await page.keyboard.press('ArrowRight');await expect(group.getByRole('radio',{name:'노사협의회',exact:true})).toBeFocused();await page.keyboard.press('Space');
  await expect(page.locator('.meeting-list-row h3')).toHaveText('노사협의회');
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');await expect(page.locator('.meeting-list-row h3')).toHaveText('궤도협의회');
  await group.getByRole('radio',{name:'전체',exact:true}).click();await expect(page.locator('.meeting-list-row')).toHaveCount(s.meetings.length);
  const namedColors=await page.locator('.meeting-list-row').evaluateAll(rows=>rows.slice(0,3).map(e=>getComputedStyle(e.querySelector('.meeting-list-title'),'::before').backgroundColor));expect(new Set(namedColors).size).toBe(3);
  if(width===390){
    await group.getByRole('radio',{name:'후속회의',exact:true}).tap();expect(await group.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);
    await page.evaluate(async()=>{document.querySelector('#meetingTypeFilter').value='회의명 미지정';await window.__KPTU_RELOAD_MEETINGS__()});
    const geometry=await group.evaluate(e=>{const b=e.querySelector('[aria-checked=true]'),r=b.getBoundingClientRect(),lane=e.getBoundingClientRect();return {height:r.height,touch:getComputedStyle(b,'::after').content,wrap:getComputedStyle(e).flexWrap,inside:r.left>=lane.left-1&&r.right<=lane.right+1}});
    // UI-버튼크기: filters are 32px pill chips; a 44px touch extender (::after) stays inside the scroll lane.
    expect(geometry).toEqual({height:32,touch:'""',wrap:'nowrap',inside:true});
    expect(await group.evaluate(e=>{const b=e.querySelector('[aria-checked=true]'),p=getComputedStyle(b,'::after');return [parseFloat(p.height),getComputedStyle(b).borderRadius,e.getBoundingClientRect().height]})).toEqual([44,'999px',44]);
  }
  await clickView(page,'library');await page.waitForFunction(()=>window.KPTUViewLoader.isLoaded('library'));
  // UI-바구니거르기: the [일반 자료|회의자료만] row is gone; meeting documents list with the rest and the [회의] category chip narrows to them.
  await expect(page.locator('#libraryViewFilter')).toHaveCount(0);await expect(page.locator('.lu-row')).toHaveCount(7);
  const category=page.locator('#libraryCategoryFilter');await category.locator('[data-filter-value="회의"]').click();await expect(page.locator('.lu-row')).toHaveCount(1);
  await expect(page.locator('[data-lu-document="meeting-doc"]')).toBeVisible();await category.locator('[data-filter-value="all"]').click();
  const project=page.locator('#documentProject');
  await project.locator('[data-filter-value="top-a"]').click();await expect(page.locator('.lu-row')).toHaveCount(1);
  await expect(project.locator('.filter-chips-small')).toBeVisible();await expect(project.locator('.filter-chips-small').getByRole('radio')).toHaveText(['전체(이 프로젝트)','국토부 대응','산자부 대응']);
  // UI-버튼크기: the second (child project) row uses the same 32px chip height.
  await expect(project.locator('.filter-chips-small [role=radio]').first()).toHaveCSS('height','32px');
  await project.locator('[data-filter-value="child-a1"]').click();await expect(page.locator('.lu-row')).toHaveCount(2);
  await expect(page.locator('[data-lu-document="doc-a1"]')).toBeVisible();
  await category.locator('[data-filter-value="회의"]').click();await expect(page.locator('.lu-row')).toHaveCount(1);
  await expect(page.locator('[data-lu-document="meeting-doc"]')).toBeVisible();
  await page.locator('#documentSearch').fill('회의');await expect(page.locator('.lu-row')).toHaveCount(1);
  await category.locator('[data-filter-value="정책"]').click();await expect(page.locator('.lu-row')).toHaveCount(0);
  await category.locator('[data-filter-value="all"]').click();
  await page.locator('#documentSearch').fill('');await project.locator('[data-filter-value="all"]').click();await expect(project.locator('.filter-chips-small')).toBeHidden();await expect(page.locator('.lu-row')).toHaveCount(7);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
});
for(const timezoneId of ['Europe/Rome','Asia/Seoul','UTC'])test.describe(timezoneId,()=>{test.use({timezoneId});test('회의 표시·새 입력·수정 왕복 한국 고정',async({page})=>{
  const s=chipState();await mockApp(page,s);await signIn(page,'http://127.0.0.1:8123/app/?view=meetings');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));await expect(page.locator('[data-mrd-meeting="meeting-0"] :is(p,.mcol-when)')).toContainText('10:00');
  await page.locator('[data-mrd-meeting="meeting-0"]').click();await expect(page.locator('#mrdMeta')).toContainText('10:00');await page.locator('#mrdEdit').click();await expect(page.locator('#mrdEditAt')).toHaveValue('2026-10-11T10:00');
  await fillDateTime(page,'#mrdEditAt','2026-10-11T00:30');await page.locator('#mrdSaveEdit').click();await expect.poll(()=>s.meetingWrites[0]?.meeting_at).toBe('2026-10-10T15:30:00.000Z');await page.locator('#mrdEdit').click();await expect(page.locator('#mrdEditAt')).toHaveValue('2026-10-11T00:30');await page.locator('#mrdClose').click();
  await page.locator('#newMeetingBtn').click();await page.locator('#meetingNameSelect').selectOption('궤도협의회');await fillDateTime(page,'#meetingAt','2026-10-11T10:00');await page.locator('#meetingTranscript').fill('새 원문');await page.locator('#saveMeetingBtn').click();await expect.poll(()=>s.meetingWrites.at(-1)?.meeting_at).toBe('2026-10-11T01:00:00.000Z');
})});

test('프로젝트 자료 전체 보기는 하위 알약과 같은 필터 결과로 이동',async({page})=>{
  const s=chipState(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await mockApp(page,s);await signIn(page,'http://127.0.0.1:8123/app/?view=projects');
  await page.locator('[data-ps3-project="child-a1"]').first().click();await expect(page.locator('#ps3DetailModal')).toBeVisible();await page.locator('[data-ps3-library]').click();
  await expect(page.locator('#libraryView')).toBeVisible();await expect(page.locator('#libraryViewFilter')).toHaveCount(0);await expect(page.locator('#documentProject')).toHaveJSProperty('value','child-a1');await expect(page.locator('.lu-row')).toHaveCount(2);await expect(page.locator('[data-lu-document="meeting-doc"]')).toBeVisible();await expect(page.locator('[data-lu-document="doc-a1"]')).toBeVisible();expect(errors).toEqual([]);
});
