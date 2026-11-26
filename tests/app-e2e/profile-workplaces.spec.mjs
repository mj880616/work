import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';

// PROFILE-화면정리: 내 프로필 화면. 맡은 프로젝트 칸·안내문 없음.
// S71-35 ORG-조직관리로모으기(2026-11-26 사용자 결정): '담당조직 현황' 체크 칸과 '내 묶음' 칸은 없다(그리기째).
// 담당 추가·보관·삭제·내 묶음은 조직 관리(org-manage-gather.spec.mjs가 본다).
// S71-36 PROFILE-설정화면: 첫 화면은 한 줄 메뉴, 이름은 '이름' 장에서 바꾸면 바로 저장(저장 단추 없음).
const url=`${appOrigin}/tests/app-e2e/profile-workplaces-fixture.html`;

async function openProfile(page){
  await page.goto(url);
  await expect(page.locator('#userBadge')).toBeVisible();
  await page.click('#userBadge');
  await expect(page.locator('#psRoot')).toBeVisible();
  await expect(page.locator('#psName')).toHaveValue('테스터');
}
// '이름' 장 열기(첫 화면 '이름 ›').
async function openName(page){
  await page.locator('#psRoot [data-ps-open="name"]').click();
  await expect(page.locator('#psName')).toBeVisible();
}
// AI-사람별한도: 프로필 '사용 현황' 칸의 AI 한도 한 줄 읽기(ai-assist kind=ai_month, 쓰기 아님)는 저장 순서 대조에서 뺀다.
const calls=page=>page.evaluate(()=>window.__state.calls.filter(x=>x.body?.kind!=='ai_month').map(x=>`${x.method} ${x.path.split('?')[0]}`));

for(const [label,width] of [['폰 390',390],['폴드 880',880],['PC 1280',1280]]){
  test(`${label}: 내 프로필에 '담당조직 현황'·'내 묶음' 칸·줄이 없고, 조직·담당·묶음을 읽지도 쓰지도 않는다`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize({width,height:900});
    await openProfile(page);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#psWorkplacePanel,#psWorkplaceList,#psCollabPanel,.ps-collab,[data-ps-org-check],.ps-legacy-wrap,#psRoot [data-ps-open="org"],#psRoot [data-ps-open="groups"]')).toHaveCount(0);
    await expect(page.locator('#profileView')).not.toContainText('담당조직 현황');
    await expect(page.locator('#profileView')).not.toContainText('내 묶음');
    await expect(page.locator('#profileView')).not.toContainText('묶음 만들기');
    // 맨 아래 큰 [저장]도 없다(S71-36).
    await expect(page.locator('#psSave,#profileView .save-row,#profileView button.primary')).toHaveCount(0);
    const all=await calls(page);
    expect(all.filter(c=>/app_suborganization|app_profile_workplaces|app_collab/.test(c))).toEqual([]);
    expect(await page.evaluate(()=>window.__state.collabCalls||[])).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
  });
}

test('이름 저장이 실패하면 알리고 고친 이름은 칸에 남는다, 다시 Enter로 저장된다',async({page})=>{
  await openProfile(page);
  await page.evaluate(()=>{window.__state.fail.push({method:'PATCH',path:'/rest/v1/app_profiles'})});
  await openName(page);
  await page.fill('#psName','실패이름');
  await page.locator('#psName').press('Enter');
  await expect(page.locator('#psNameState')).toHaveText('저장하지 못했어요. 다시 해 주세요.');
  await expect(page.locator('#psName')).toHaveValue('실패이름');
  expect(await page.evaluate(()=>window.__state.profile[0].display_name)).toBe('테스터');
  await page.evaluate(()=>{window.__state.fail.length=0});
  await page.locator('#psName').press('Enter');
  await expect(page.locator('#psNameState')).toHaveText('저장했어요');
  expect(await page.evaluate(()=>window.__state.profile[0].display_name)).toBe('실패이름');
});

// S71-35: 옛 초대 링크(?view=profile&join=…)로 내 프로필이 열리면 '내 묶음'이 옮겨 간 조직 관리로 넘긴다(주소의 join은 그대로 둔다).
test('옛 초대 링크로 내 프로필이 열리면 조직 관리로 넘긴다(join은 주소에 그대로)',async({page})=>{
  await openProfile(page);
  const token='a'.repeat(64);
  await page.evaluate(t=>history.replaceState(null,'',location.pathname+'?view=profile&join='+t),token);
  await page.evaluate(()=>window.KPTURouter.go('profile'));
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('team');
  expect(new URL(page.url()).searchParams.get('join')).toBe(token);
});

test('이름: 바꾸면 바로 저장(저장 단추 없음), 이름이 비면 저장하지 않고 되돌린다',async({page})=>{
  await openProfile(page);
  await openName(page);
  await expect(page.locator('#profileView [data-ps-page="name"] button.primary')).toHaveCount(0);
  await page.fill('#psName','');
  await page.locator('#psName').press('Enter');
  await expect(page.locator('#psNameState')).toHaveText('이름을 입력해 주세요.');
  await expect(page.locator('#psName')).toHaveValue('테스터');
  expect((await calls(page)).some(c=>c.startsWith('PATCH'))).toBeFalsy();
  await page.fill('#psName','이름만');
  await page.locator('#psName').press('Enter');
  await expect(page.locator('#psNameState')).toHaveText('저장했어요');
  const state=await page.evaluate(()=>window.__state);
  expect(state.profile[0].display_name).toBe('이름만');
  // S71-34: 직책은 보내지 않는다 — 이미 저장된 값은 서버에 그대로.
  expect(state.profile[0].job_title).toBe('국장');
  expect((await calls(page)).filter(c=>c.startsWith('POST')||c.startsWith('DELETE'))).toEqual([]);
  // 첫 화면 '이름' 줄 요약도 바뀐다.
  await page.locator('#profileView [data-ps-page="name"] [data-ps-back]').click();
  await expect(page.locator('#psRoot [data-ps-open="name"] .sl-sum')).toHaveText('이름만');
});

// S71-34 PROFILE-이름만(사용자 11/26 결정): 기본 정보는 이름(닉네임) 하나. 저장 요청에 소속·부서·직책이 없고, 이미 저장된 값은 지우지 않는다.
// PROFILE-주간캘린더칸삭제: '주간 정리 일정 캘린더' 칸도 없다.
for(const [label,width] of [['폰 390',390],['폴드 880',880],['PC 1280',1280]]){
  test(`${label}: 이름 장은 입력칸 하나 — 저장 요청은 이름만, 다시 열어도 그대로, 주간 캘린더 칸 없음`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await openProfile(page);
    await page.evaluate(()=>{window.__state.profile[0].union_name='가상노동조합 샘플지부';window.__state.profile[0].department_name='샘플사업팀'});
    await openName(page);
    const inputs=page.locator('#profileView [data-ps-page="name"] input');
    await expect(inputs).toHaveCount(1);
    expect(await inputs.evaluateAll(xs=>xs.map(x=>x.id))).toEqual(['psName']);
    await expect(page.locator('#psName')).toHaveAttribute('aria-label','이름');
    await expect(page.locator('#profileView [data-ps-page="name"] .sl-note')).toHaveText('닉네임 써도 돼요');
    await expect(page.locator('#psReportPanel,#psReportCalendar,[data-ps-report-summary]')).toHaveCount(0);
    await expect(page.locator('#profileView')).not.toContainText('일정 캘린더');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.fill('#psName','  새닉네임 ');
    await page.locator('#psName').blur();
    await expect(page.locator('#psNameState')).toHaveText('저장했어요');
    const st=await page.evaluate(()=>window.__state);
    const patch=st.calls.filter(c=>c.method==='PATCH'&&c.path.includes('/app_profiles?'));
    expect(patch).toHaveLength(1);
    expect(Object.keys(patch[0].body).sort()).toEqual(['display_name','updated_at']);
    expect(patch[0].body.display_name).toBe('새닉네임');
    // 읽기도 이름만(소속·부서·직책을 읽지 않는다).
    const reads=st.calls.filter(c=>c.method==='GET'&&c.path.includes('/app_profiles?')&&c.path.includes('display_name'));
    expect(reads.length).toBeGreaterThan(0);
    for(const c of reads)expect(c.path).not.toMatch(/job_title|union_name|department_name/);
    // 이미 저장된 값은 그대로(지우지 않음).
    const row=st.profile[0];
    expect([row.display_name,row.job_title,row.union_name,row.department_name]).toEqual(['새닉네임','국장','가상노동조합 샘플지부','샘플사업팀']);
    // 다시 열어도(서버 값 다시 읽기) 그대로.
    await page.evaluate(()=>window.KPTURouter.go('team'));await page.evaluate(()=>window.KPTURouter.go('profile'));
    await expect(page.locator('#psRoot [data-ps-open="name"] .sl-sum')).toHaveText('새닉네임');
    await expect(page.locator('#psName')).toHaveValue('새닉네임');
  });
}

test('이름을 고치다 다른 화면으로 가면 묻지 않고 저장한다(바꾸면 바로 저장)',async({page})=>{
  await openProfile(page);
  page.on('dialog',d=>{throw Error('unexpected dialog '+d.message())});
  const leave=()=>page.evaluate(()=>{const asked=[];const e=new CustomEvent('kptu:before-view-change',{cancelable:true,detail:{view:'team',confirmed:false,ask:t=>{asked.push(t);return false}}});const passed=window.dispatchEvent(e);return {passed,asked}});
  expect(await leave()).toEqual({passed:true,asked:[]});
  await openName(page);
  await page.fill('#psName','쓰던이름');
  expect(await leave()).toEqual({passed:true,asked:[]});
  await expect.poll(()=>page.evaluate(()=>window.__state.profile[0].display_name)).toBe('쓰던이름');
});
