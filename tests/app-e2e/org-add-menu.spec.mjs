import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
// MULTI-다른담당자맞춤 ①(2026-11-13 명진 결정): 조직 보고 맨 위 [+ 담당조직](이름·종류 두 칸)과 조직 줄 ⋯
// [이름 바꾸기]·[쟁의 단계]·[담당 조직에서 제외]/[담당 조직으로 추가]·[삭제]. 두 계정: 막 가입한 다른 담당자(?orgs=none)와 명진(?orgs=order).
// 값은 화면 기억 org_order 하나(window.__orgOrderPrefs 대역), 서버는 가짜(저장 요청만 확인). 이름은 모두 합성 값.
const base=`${appOrigin}/tests/app-e2e/suborganization-filters-canonical-fixture.html`;
const SHOTS=process.env.S61_39_SHOTS; // 화면 사진: docs/design/screens/s61-39/
const menuLabels=page=>page.locator('#soTeamMenu button').allTextContents().then(xs=>xs.map(x=>x.trim()));
const rowOf=(page,name)=>page.locator('#soOrganizationList .so-row').filter({has:page.locator('.kptu-list-name',{hasText:new RegExp(`^${name.replace(/[()]/g,'\\$&')}$`)})});
async function openRowMenu(page,name){
  const row=rowOf(page,name);await row.hover();await row.locator('[data-so-row-more]').click();
  const menu=page.locator('#soTeamMenu');await expect(menu).toBeVisible();return menu;
}

for(const width of [412,760,1280])test(`새 담당자: [+ 담당조직]으로 넣고 이름 바꾸기·제외·다시 추가 ${width}px`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:860});await page.goto(base+'?orgs=none');
  const add=page.locator('#soAddOrg');await expect(add).toBeVisible();await expect(add).toHaveText('+ 담당조직');
  if(SHOTS)await page.screenshot({path:`${SHOTS}/new-user-empty-${width}.png`});
  await add.click();
  const modal=page.locator('#soEditModal');await expect(modal).toBeVisible();await expect(page.locator('#soEditHeading')).toHaveText('담당조직 추가');
  // 칸은 이름·종류 둘
  await expect(modal.locator('input,textarea')).toHaveCount(2);await expect(page.locator('#soEditName')).toBeFocused();
  await page.locator('#soEditName').fill('가상병원지부');await page.locator('#sofEditType').fill('병원');
  if(SHOTS)await page.screenshot({path:`${SHOTS}/add-dialog-${width}.png`});
  await page.locator('#soSaveOrg').click();await expect(modal).toBeHidden();
  const post=await page.evaluate(()=>window.__orgPosts);
  expect(post).toHaveLength(1);expect(post[0].body).toMatchObject({workspace_id:'ws-1',name:'가상병원지부',organization_type:'병원',created_by:'user-me',active:true,aliases:[]});
  expect(post[0].prefer).toContain('return=representation');
  // 만든 사람 담당으로 이어져 목록에 바로 보인다(묶음을 정하지 않았으니 묶음 이름 없이)
  await expect(rowOf(page,'가상병원지부')).toHaveCount(1);await expect(page.locator('.so-group-heading')).toHaveCount(0);
  // 이름 바꾸기: 같은 창, 제목만 다르고 이름이 채워져 있음. 다른 이름·설명은 보내지 않는다.
  let menu=await openRowMenu(page,'가상병원지부');
  expect(await menuLabels(page)).toEqual(['이름 바꾸기','쟁의 단계','담당 조직에서 제외','삭제']);
  if(SHOTS)await page.screenshot({path:`${SHOTS}/row-menu-${width}.png`});
  await menu.getByRole('button',{name:'이름 바꾸기'}).click();
  await expect(page.locator('#soEditHeading')).toHaveText('이름 바꾸기');await expect(page.locator('#soEditName')).toHaveValue('가상병원지부');
  await page.locator('#soEditName').fill('가상의료지부');await page.locator('#soSaveOrg').click();await expect(modal).toBeHidden();
  const patch=(await page.evaluate(()=>window.__patches)).at(-1);
  expect(Object.keys(patch.body).sort()).toEqual(['name','organization_type','updated_at']);expect(patch.body.name).toBe('가상의료지부');
  await expect(rowOf(page,'가상의료지부')).toHaveCount(1);
  // 담당 조직에서 제외 → 맨 아래 '제외한 조직' 묶음에 흐리게, 값은 org_order.hidden
  menu=await openRowMenu(page,'가상의료지부');await menu.getByRole('button',{name:'담당 조직에서 제외'}).click();
  await expect(page.locator('.so-excluded-group .so-group-heading')).toHaveText('제외한 조직1곳');
  await expect(rowOf(page,'가상의료지부')).toHaveClass(/is-excluded/);
  expect(await page.evaluate(()=>window.__orgOrderPrefs.org_order)).toEqual({groups:[],hidden:['가상의료지부']});
  if(SHOTS)await page.screenshot({path:`${SHOTS}/excluded-${width}.png`});
  menu=await openRowMenu(page,'가상의료지부');
  expect(await menuLabels(page)).toEqual(['이름 바꾸기','쟁의 단계','담당 조직으로 추가','삭제']);
  await menu.getByRole('button',{name:'담당 조직으로 추가'}).click();
  await expect(page.locator('.so-excluded-group')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__orgOrderPrefs.org_order)).toEqual({groups:[],hidden:[]});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('새 담당자: 이름 없이·같은 이름으로는 저장하지 않음',async({page})=>{
  await page.goto(base+'?orgs=none');
  await page.locator('#soAddOrg').click();await page.locator('#soSaveOrg').click();
  await expect(page.locator('#soEditStatus')).toHaveText('조직명을 입력해 주세요.');
  await page.locator('#soEditName').fill('가상지부');await page.locator('#soSaveOrg').click();await expect(page.locator('#soEditModal')).toBeHidden();
  await page.locator('#soAddOrg').click();await page.locator('#soEditName').fill(' 가상지부 ');await page.locator('#soSaveOrg').click();
  await expect(page.locator('#soEditStatus')).toHaveText('같은 이름의 담당조직이 이미 있어요.');
  expect(await page.evaluate(()=>window.__orgPosts.length)).toBe(1);
});

for(const width of [412,1280])test(`명진 계정: 묶음·순서 그대로, 이름을 바꾸면 묶음 자리도 따라감, 제외한 조직은 맨 아래 ${width}px`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:900});await page.goto(base+'?orgs=order');
  await expect(page.locator('.so-group-heading')).toHaveText(['철도1곳','지하철4곳','민자철도4곳','민간도시철도4곳','그 외2곳','제외한 조직1곳']);
  await expect(page.locator('.so-excluded-group .kptu-list-name')).toHaveText(['궤도협의회']);
  if(SHOTS)await page.screenshot({path:`${SHOTS}/operator-list-${width}.png`});
  const before=await page.evaluate(()=>structuredClone(window.__orgOrderPrefs.org_order));
  const menu=await openRowMenu(page,'서해선지부');await menu.getByRole('button',{name:'이름 바꾸기'}).click();
  await page.locator('#soEditName').fill('서해선지부(새)');await page.locator('#soSaveOrg').click();await expect(page.locator('#soEditModal')).toBeHidden();
  const after=await page.evaluate(()=>window.__orgOrderPrefs.org_order);
  expect(after.groups[2]).toEqual({name:'민자철도',orgs:['서해선지부(새)','신분당선지부','지티엑스에이운영지부','공항철도지부']});
  expect({...after,groups:after.groups.filter((_,i)=>i!==2)}).toEqual({...before,groups:before.groups.filter((_,i)=>i!==2)});
  await expect(page.locator('.so-group-heading')).toHaveText(['철도1곳','지하철4곳','민자철도4곳','민간도시철도4곳','그 외2곳','제외한 조직1곳']);
  await expect(page.locator('#soOrganizationList .so-org-group').nth(2).locator('.kptu-list-name').first()).toHaveText('서해선지부(새)');
  expect(errors).toEqual([]);
});
