import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
// MULTI-다른담당자맞춤 ②(시안 PR 2522, 명진 11/13 'ㅇ'·'ㅇㅋ'): 조직 보고 화면에서 묶음 만들기(화면 ⋯)·손잡이 ⋮⋮ 끌기·묶음 ⋯ [이름 바꾸기][묶음 풀기].
// 값은 화면 기억 org_order 하나(window.__orgOrderPrefs 대역). 두 계정: 막 가입한 다른 담당자(?orgs=none)와 명진(?orgs=order). 이름은 합성 값.
const base=`${appOrigin}/tests/app-e2e/suborganization-filters-canonical-fixture.html`;
const SHOTS=process.env.S61_39_SHOTS;
const rowOf=(page,name)=>page.locator('#soOrganizationList .so-row').filter({has:page.locator('.kptu-list-name',{hasText:new RegExp(`^${name}$`)})});
const gripOf=(page,name)=>rowOf(page,name).locator('[data-so-grip="org"]');
const groupCard=(page,name)=>page.locator(`#soOrganizationList .so-org-group[data-so-group="${name}"]`);
const order=page=>page.evaluate(()=>window.__orgOrderPrefs.org_order??null);
// 화면 밖 자리로는 위·아래 끝에 들고 있어 저절로 굴러가게 한 뒤 놓는다(손가락 끌기와 같은 길).
async function dragTo(page,from,to,{dy=0,dx=null}={}){
  await from.scrollIntoViewIfNeeded();
  const a=await from.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2+12,{steps:3});
  const vh=page.viewportSize().height;
  for(let i=0;i<60;i++){
    const b=await to.boundingBox();
    if(b&&b.y>=60&&b.y+b.height<=vh-60)break;
    await page.mouse.move(a.x+a.width/2,b&&b.y<60?20:vh-20,{steps:2});await page.waitForTimeout(60);
  }
  const b=await to.boundingBox();await page.mouse.move(dx===null?b.x+b.width/2:b.x+dx,b.y+b.height/2+dy,{steps:8});
  await page.mouse.up();
}
// S61-39c(CC 사진 검토): PC 맨 위 [+ 담당조직]·⋯는 묶음이 있어도 목록 위 한 줄(#2546 자리) — 첫 묶음 머리줄과 겹치지 않고, 화면 위로 잘리지 않는다.
// 폰은 [+ 담당조직]·⋯가 앱 머리줄 줄로 올라간다(앱 화면 자리는 org-dispute-stage가 본다). 이 시험 화면에는 앱 머리줄이 없어
// 사진·자리 확인이 화면 위로 잘리지 않게 폰 폭에서는 앱 머리줄 높이(56px)만큼 위를 비워 둔다(phoneShell).
const phoneShell=page=>page.viewportSize().width<761?page.addStyleTag({content:'body{padding-top:56px}'}):null;
async function headAboveList(page){
  await page.evaluate(()=>scrollTo(0,0));
  const add=await page.locator('#soAddOrg').boundingBox(),more=await page.locator('#soTeamMore').boundingBox(),first=await page.locator('#soOrganizationList .so-group-heading').first().boundingBox();
  for(const b of [add,more]){expect(b.y).toBeGreaterThanOrEqual(0);expect(b.y+b.height).toBeLessThanOrEqual(first.y+1)}
}
async function addOrg(page,name){
  await page.locator('#soAddOrg').click();await page.locator('#soEditName').fill(name);await page.locator('#soSaveOrg').click();
  await expect(page.locator('#soEditModal')).toBeHidden();await expect(rowOf(page,name)).toHaveCount(1);
}

for(const width of [412,1280])test(`새 담당자: [묶음 만들기]로 만들고 조직을 끌어 넣기·순서·이름 바꾸기·풀기 ${width}px`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:900});await page.goto(base+'?orgs=none');await phoneShell(page);
  for(const n of ['가상가지부','가상나지부','가상다지부'])await addOrg(page,n);
  // 묶음이 없으면 지금처럼 묶음 이름·손잡이 없이 가나다순 한 목록
  await expect(page.locator('.so-group-heading')).toHaveCount(0);await expect(page.locator('[data-so-grip]')).toHaveCount(0);
  // 묶음 만들기는 화면 ⋯ 메뉴 줄(맨 위 줄 단추는 지금처럼 [+ 담당조직]·⋯만)
  await expect(page.locator('#soTeamHead button:visible')).toHaveCount(2);
  await page.locator('#soTeamMore').click();
  await expect(page.locator('#soTeamMenu button').first()).toHaveText('묶음 만들기');
  if(SHOTS)await page.screenshot({path:`${SHOTS}/groups-screen-menu-${width}.png`});
  await page.locator('#soTeamMenu').getByRole('button',{name:'묶음 만들기'}).click();
  await expect(page.locator('#soGroupHeading')).toHaveText('묶음 만들기');await expect(page.locator('#soGroupName')).toBeFocused();
  await page.locator('#soSaveGroup').click();await expect(page.locator('#soGroupStatus')).toHaveText('묶음 이름을 입력해 주세요.');
  await page.locator('#soGroupName').fill('그 외');await page.locator('#soSaveGroup').click();await expect(page.locator('#soGroupStatus')).toContainText('쓸 수 없어요');
  await page.locator('#soGroupName').fill('병원');await page.locator('#soSaveGroup').click();await expect(page.locator('#soGroupModal')).toBeHidden();
  // 빈 묶음은 화면에만(값은 아직 없음), 조직 줄마다 손잡이
  await expect(page.locator('.so-group-heading')).toHaveText(['병원0곳','그 외3곳']);
  await expect(groupCard(page,'병원').locator('.so-group-empty')).toContainText('여기로 끌어 넣기');
  expect(await order(page)).toBeNull();
  await expect(page.locator('[data-so-grip="org"]')).toHaveCount(3);
  if(SHOTS)await page.screenshot({path:`${SHOTS}/groups-new-empty-${width}.png`});
  // 끌어 넣기 → 값에 저장
  await dragTo(page,gripOf(page,'가상나지부'),groupCard(page,'병원').locator('.so-group-empty'));
  await expect.poll(()=>order(page)).toEqual({groups:[{name:'병원',orgs:['가상나지부']}],hidden:[]});
  await expect(page.locator('.so-group-heading')).toHaveText(['병원1곳','그 외2곳']);
  // 같은 묶음의 앞(줄 위쪽 절반)에 넣기
  await dragTo(page,gripOf(page,'가상다지부'),rowOf(page,'가상나지부'),{dy:-8});
  await expect.poll(()=>order(page)).toEqual({groups:[{name:'병원',orgs:['가상다지부','가상나지부']}],hidden:[]});
  // 키보드: 손잡이에서 Alt+↓ 한 칸
  await gripOf(page,'가상다지부').focus();await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(()=>order(page)).toEqual({groups:[{name:'병원',orgs:['가상나지부','가상다지부']}],hidden:[]});
  await expect(gripOf(page,'가상다지부')).toBeFocused();
  // 묶음 ⋯: [이름 바꾸기][묶음 풀기]
  await groupCard(page,'병원').locator('[data-so-group-more]').click();
  const menu=page.locator('#soGroupMenu');await expect(menu).toBeVisible();
  expect((await menu.locator('button').allTextContents()).map(x=>x.trim())).toEqual(['이름 바꾸기','묶음 풀기']);
  if(SHOTS)await page.screenshot({path:`${SHOTS}/groups-menu-${width}.png`});
  await menu.getByRole('button',{name:'이름 바꾸기'}).click();
  await expect(page.locator('#soGroupHeading')).toHaveText('묶음 이름 바꾸기');await expect(page.locator('#soGroupName')).toHaveValue('병원');
  await page.locator('#soGroupName').fill('의료');await page.locator('#soSaveGroup').click();
  await expect.poll(()=>order(page)).toEqual({groups:[{name:'의료',orgs:['가상나지부','가상다지부']}],hidden:[]});
  await expect(page.locator('.so-group-heading')).toHaveText(['의료2곳','그 외1곳']);
  // 알림은 공용 작은 알림 틀(#toast.toast) — 화면 위쪽 가운데, 어두운 바탕
  const toast=page.locator('#toast');await expect(toast).toHaveText('묶음 이름을 바꿨어요.');await expect(toast).toBeVisible();
  const tb=await toast.boundingBox();expect(Math.abs(tb.x+tb.width/2-width/2)).toBeLessThanOrEqual(2);
  expect(await toast.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
  await headAboveList(page);
  if(SHOTS)await page.screenshot({path:`${SHOTS}/groups-filled-${width}.png`});
  await groupCard(page,'의료').locator('[data-so-group-more]').click();await page.locator('#soGroupMenu').getByRole('button',{name:'묶음 풀기'}).click();
  // 묶음을 풀면 조직은 '그 외'로, 값이 비면 설정을 지운다(처음 상태 = 가나다순 한 목록)
  await expect.poll(()=>order(page)).toBeNull();
  await expect(page.locator('.so-group-heading')).toHaveCount(0);await expect(rowOf(page,'가상가지부')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

for(const width of [412,1280])test(`명진: 지금 묶음 그대로 + 손잡이, 묶음 순서 끌기·조직을 그 외로 빼기 ${width}px`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:900});await page.goto(base+'?orgs=order');await phoneShell(page);
  const heads=['철도1곳','지하철4곳','민자철도4곳','민간도시철도4곳','그 외2곳','제외한 조직1곳'];
  await expect(page.locator('.so-group-heading')).toHaveText(heads);
  // 새로 생기는 것은 손잡이·묶음 ⋯·화면 ⋯의 [묶음 만들기]뿐('그 외'·'제외한 조직'에는 묶음 손잡이·⋯ 없음)
  await expect(page.locator('[data-so-grip="group"]')).toHaveCount(4);await expect(page.locator('[data-so-group-more]')).toHaveCount(4);
  await expect(page.locator('.so-excluded-group [data-so-grip]')).toHaveCount(0);
  await headAboveList(page);
  if(SHOTS)await page.screenshot({path:`${SHOTS}/groups-operator-${width}.png`,fullPage:true});
  // 묶음 머리 손잡이를 끌어 '철도' 위로
  await dragTo(page,groupCard(page,'민자철도').locator('[data-so-grip="group"]'),groupCard(page,'철도').locator('.so-group-heading'),{dy:-6});
  await expect.poll(async()=>(await order(page)).groups.map(g=>g.name)).toEqual(['민자철도','철도','지하철','민간도시철도']);
  await expect(page.locator('.so-group-heading')).toHaveText(['민자철도4곳','철도1곳','지하철4곳','민간도시철도4곳','그 외2곳','제외한 조직1곳']);
  // 조직을 '그 외'로(그 외 칸에 놓기)
  await dragTo(page,gripOf(page,'서해선지부'),groupCard(page,'').first());
  await expect.poll(async()=>(await order(page)).groups[0].orgs).toEqual(['신분당선지부','지티엑스에이운영지부','공항철도지부']);
  await expect(page.locator('.so-group-heading').first()).toHaveText('민자철도3곳');
  expect((await order(page)).hidden).toEqual(['궤도협의회']);
  expect(errors).toEqual([]);
});
