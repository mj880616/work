import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';

// PROFILE-화면정리: 내 프로필 화면. 저장 버튼 하나(이름), 맡은 프로젝트 칸·안내문 없음.
// S71-35 ORG-조직관리로모으기(2026-11-26 명진 "관련 대상 현황 이것도 걍 없애", "내 묶음도 여기서 삭제 조직 관리에서 처리 가능하게"):
// '담당조직 현황' 체크 칸과 '내 묶음' 칸은 없다(그리기째). 담당 추가·보관·삭제·내 묶음은 조직 관리(org-manage-gather.spec.mjs가 본다).
const url=`${appOrigin}/tests/app-e2e/profile-workplaces-fixture.html`;

async function openProfile(page){
  await page.goto(url);
  await expect(page.locator('#userBadge')).toBeVisible();
  await page.click('#userBadge');
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('#psName')).toHaveValue('테스터');
}
// AI-사람별한도: 프로필 '사용 현황' 칸의 AI 한도 한 줄 읽기(ai-assist kind=ai_month, 쓰기 아님)는 저장 순서 대조에서 뺀다.
const calls=page=>page.evaluate(()=>window.__state.calls.filter(x=>x.body?.kind!=='ai_month').map(x=>`${x.method} ${x.path.split('?')[0]}`));

for(const [label,width] of [['폰 390',390],['폴드 880',880],['PC 1280',1280]]){
  test(`${label}: 내 프로필에 '담당조직 현황'·'내 묶음' 칸이 없고, 조직·담당·묶음을 읽지도 쓰지도 않는다`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize({width,height:900});
    await openProfile(page);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#psWorkplacePanel,#psWorkplaceList,#psCollabPanel,.ps-collab,[data-ps-org-check],.ps-legacy-wrap')).toHaveCount(0);
    await expect(page.locator('#profileView')).not.toContainText('담당조직 현황');
    await expect(page.locator('#profileView')).not.toContainText('내 묶음');
    await expect(page.locator('#profileView')).not.toContainText('묶음 만들기');
    const all=await calls(page);
    expect(all.filter(c=>/app_suborganization|app_profile_workplaces|app_collab/.test(c))).toEqual([]);
    expect(await page.evaluate(()=>window.__state.collabCalls||[])).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
  });
}

test('프로필 저장이 실패하면 입력을 남기고 다시 저장할 수 있다',async({page})=>{
  await openProfile(page);
  await page.evaluate(()=>{window.__state.fail.push({method:'PATCH',path:'/rest/v1/app_profiles'})});
  await page.fill('#psName','실패이름');
  await page.click('#psSave');
  await expect(page.locator('#toast')).toContainText('프로필은 저장하지 못했어요');
  await expect(page.locator('#psName')).toHaveValue('실패이름');
  await expect(page.locator('#psState')).toHaveText('바뀜, 저장 안 됨');
  await page.evaluate(()=>{window.__state.fail.length=0});
  await page.click('#psSave');
  await expect(page.locator('#psState')).toHaveText('저장됨');
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

test('이름만 바꿔도 저장되고 이름이 비면 저장하지 않는다',async({page})=>{
  await openProfile(page);
  await page.fill('#psName','');
  await page.click('#psSave');
  await expect(page.locator('#toast')).toContainText('이름을 입력해 주세요');
  expect((await calls(page)).some(c=>c.startsWith('PATCH'))).toBeFalsy();
  await page.fill('#psName','이름만');
  await page.click('#psSave');
  await expect(page.locator('#psState')).toHaveText('저장됨');
  const state=await page.evaluate(()=>window.__state);
  expect(state.profile[0].display_name).toBe('이름만');
  // S71-34: 직책은 보내지 않는다 — 이미 저장된 값은 서버에 그대로.
  expect(state.profile[0].job_title).toBe('국장');
  expect((await calls(page)).filter(c=>c.startsWith('POST')||c.startsWith('DELETE'))).toEqual([]);
});

// S71-34 PROFILE-이름만(명진 11/26): 기본 정보 칸은 이름(닉네임) 하나. 저장 요청에 소속·부서·직책이 없고, 이미 저장된 값은 지우지 않는다.
// PROFILE-주간캘린더칸삭제: '주간 정리 일정 캘린더' 칸도 없다.
for(const [label,width] of [['폰 390',390],['폴드 880',880],['PC 1280',1280]]){
  test(`${label}: 기본 정보 칸은 이름 하나 — 저장 요청은 이름만, 다시 열어도 그대로, 주간 캘린더 칸 없음`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await openProfile(page);
    await page.evaluate(()=>{window.__state.profile[0].union_name='가상노동조합 샘플지부';window.__state.profile[0].department_name='샘플사업팀'});
    const inputs=page.locator('#profileView .ps-fields input');
    await expect(inputs).toHaveCount(1);
    expect(await inputs.evaluateAll(xs=>xs.map(x=>x.id))).toEqual(['psName']);
    await expect(page.locator('#psName')).toHaveAttribute('aria-label','이름');
    await expect(page.locator('#psName')).toHaveAttribute('placeholder',/닉네임/);
    await expect(page.locator('#psReportPanel,#psReportCalendar,[data-ps-report-summary]')).toHaveCount(0);
    await expect(page.locator('#profileView')).not.toContainText('일정 캘린더');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.fill('#psName','  새닉네임 ');
    await expect(page.locator('#psState')).toHaveText('바뀜, 저장 안 됨');
    await page.click('#psSave');
    await expect(page.locator('#psState')).toHaveText('저장됨');
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
    await expect(page.locator('#psName')).toHaveValue('새닉네임');
    await expect(page.locator('#psState')).toHaveText('');
  });
}

test('저장하지 않고 떠나려 하면 라우터의 작은 확인창 물음을 한 번 남기고, [나가기] 뒤 다시 오면 떠나고 수정한 것은 버려진다',async({page})=>{
  await openProfile(page);
  // UI-알림창정리(S61-31): 브라우저 기본 확인창은 뜨지 않는다. 화면은 라우터의 detail.ask(물음)로 묻고, 라우터가 공용 작은 확인창을 띄운 뒤
  // [나가기]면 같은 이동을 confirmed로 다시 한다(라우터 쪽 흐름은 basket-linked-display·hwp-menu 시험이 진짜 라우터로 본다).
  page.on('dialog',d=>{throw Error('unexpected dialog '+d.message())});
  const leave=confirmed=>page.evaluate(confirmed=>{const asked=[];const e=new CustomEvent('kptu:before-view-change',{cancelable:true,detail:{view:'team',confirmed,ask:t=>{if(confirmed)return true;asked.push(t);return false}}});const passed=window.dispatchEvent(e);return {passed,asked}},confirmed);
  // 바뀐 것이 없으면 묻지 않는다.
  expect(await leave(false)).toEqual({passed:true,asked:[]});
  await page.fill('#psName','쓰던이름');
  expect(await leave(false)).toEqual({passed:true,asked:['저장하지 않은 변경이 있어요. 저장하지 않고 나갈까요?']});
  await expect(page.locator('#psName')).toHaveValue('쓰던이름');
  expect(await leave(true)).toEqual({passed:true,asked:[]});
  await page.evaluate(()=>window.KPTURouter.go('team'));
  await page.evaluate(()=>window.KPTURouter.go('profile'));
  await expect(page.locator('#psName')).toHaveValue('테스터');
  await expect(page.locator('#psState')).toHaveText('');
});
