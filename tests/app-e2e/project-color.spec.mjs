import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import {expectProjectTitle,projectColorDot} from './helpers/screen-title.mjs';

// PRJ-색: the real app runs in Chromium; only the Supabase REST boundary is synthetic.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const dir='docs/review/prj-color';
const owner='home-test',workspace='w',stamp='2026-10-16T01:00:00Z';
const project=(id,name,extra={},metadata={})=>({id,name,workspace_id:workspace,owner_id:owner,created_by:owner,parent_id:null,status:'active',visibility:'private',sort_order:10,created_at:stamp,updated_at:stamp,...extra,metadata:{project_system:'v2',objective:'설명',business:{keep:'exact'},...metadata}});
const matching=(rows,query)=>rows.filter(row=>[...query].every(([key,value])=>value.startsWith('eq.')?String(row[key]??'')===value.slice(3):value.startsWith('in.(')?value.slice(4,-1).split(',').includes(String(row[key])):true));

async function fixture(page,width=390){
  await page.setViewportSize({width,height:900});
  await openHome(page);
  const state={requests:[],serial:0,tables:{
    app_spaces:[
      project('green','초록 메인',{sort_order:10},{color:'green'}),
      project('green-kid','초록 하위',{parent_id:'green',sort_order:11},{color:'red'}),
      project('plain','색 없는 메인',{sort_order:20}),
      project('plain-kid','색 없는 메인의 하위',{parent_id:'plain',sort_order:21}),
      project('odd','이상한 값',{sort_order:30},{color:'#ff0000'}),
    ],
    app_project_modules:[],app_project_workstreams:[],app_project_progress_updates:[],app_project_comments:[],app_project_milestones:[],
    app_documents:[],app_record_links:[],app_suborganizations:[],app_suborganization_assignees:[],app_profiles:[{user_id:owner,display_name:'테스트 사용자'}],
  }};
  state.calls=(table,method)=>state.requests.filter(r=>r.table===table&&r.method===method);
  await page.route(SB+'/rest/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop(),method=req.method();
    if(!Object.hasOwn(state.tables,table))return route.fallback();
    const body=method==='GET'?null:req.postDataJSON(),prefer=req.headers().prefer||'';
    state.requests.push({table,method,body:structuredClone(body)});
    const rows=state.tables[table];let result;
    if(method==='GET'){
      result=matching(rows,url.searchParams);
      if(table==='app_spaces'&&url.searchParams.get('select')?.includes('milestones:'))result=result.map(row=>({id:row.id,milestones:[]}));
    }else if(method==='POST'){
      result=(Array.isArray(body)?body:[body]).map(row=>({...row,id:row.id||'new-'+(++state.serial),created_at:stamp,updated_at:stamp}));rows.push(...result);
    }else if(method==='PATCH'){
      result=matching(rows,url.searchParams);result.forEach(row=>Object.assign(row,body));
    }else throw new Error('Unexpected synthetic method: '+method);
    await route.fulfill({status:200,json:method==='GET'||prefer.includes('return=representation')?result:null});
  });
  await clickView(page,'projects');
  await page.evaluate(()=>window.__KPTU_PROJECT_V3_READY__);
  await expect(page.locator('#projectGrid[data-ps3-ready="1"]')).toBeVisible();
  return state;
}
// Computed dot color must equal the theme token, so light and dark values come from theme-tokens.css only.
const dotColor=(page,selector)=>page.locator(selector).evaluate(el=>getComputedStyle(el).backgroundColor);
const tokenColor=(page,name)=>page.evaluate(name=>{const probe=document.createElement('span');probe.style.background=`var(${name})`;document.body.append(probe);const value=getComputedStyle(probe).backgroundColor;probe.remove();return value},name);
const rowDot=id=>`[data-ps3-project="${id}"] .ps3-color-dot`;

for(const scheme of ['light','dark'])test(`PRJ-색 list dots: chosen color, child soft tone, gray fallback (${scheme})`,async({page})=>{
  await page.emulateMedia({colorScheme:scheme});
  await fixture(page);
  await expect(page.locator(rowDot('green'))).toHaveAttribute('data-color','green');
  await expect(page.locator(rowDot('green'))).not.toHaveAttribute('data-tone','soft');
  // The child ignores its own stored value and follows the parent's color in the soft tone.
  await expect(page.locator(rowDot('green-kid'))).toHaveAttribute('data-color','green');
  await expect(page.locator(rowDot('green-kid'))).toHaveAttribute('data-tone','soft');
  await expect(page.locator(rowDot('plain'))).toHaveAttribute('data-color','gray');
  await expect(page.locator(rowDot('plain-kid'))).toHaveAttribute('data-tone','soft');
  await expect(page.locator(rowDot('odd'))).toHaveAttribute('data-color','gray');
  expect(await dotColor(page,rowDot('green'))).toBe(await tokenColor(page,'--ds-project-green'));
  expect(await dotColor(page,rowDot('green-kid'))).toBe(await tokenColor(page,'--ds-project-green-soft'));
  expect(await dotColor(page,rowDot('plain'))).toBe(await tokenColor(page,'--ds-project-gray'));
  expect(await dotColor(page,rowDot('odd'))).toBe(await tokenColor(page,'--ds-project-gray'));
  expect(await tokenColor(page,'--ds-project-green')).not.toBe(await tokenColor(page,'--ds-project-green-soft'));
  const box=await page.locator(rowDot('green')).boundingBox();expect(box.width).toBe(8);expect(box.height).toBe(8);
  // Dot sits before the name on the same line.
  const name=await page.locator('[data-ps3-project="green"] .kptu-list-name').boundingBox();
  expect(box.x+box.width).toBeLessThanOrEqual(name.x);expect(Math.abs(box.y+box.height/2-(name.y+name.height/2))).toBeLessThan(4);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const capture=process.env.PRJ_COLOR_CAPTURE==='1';if(capture)mkdirSync(dir,{recursive:true});
  if(capture)await page.screenshot({path:`${dir}/list-390-${scheme}.png`});
  // Detail header: dot before the title, hierarchy and ⋯ menu unchanged.
  await page.locator('[data-ps3-project="green-kid"]').click();
  await expectProjectTitle(page,'초록 하위');
  await expect(await projectColorDot(page)).toHaveAttribute('data-tone','soft');
  await expect(page.locator('#ps3Hierarchy .ps3-parent-link')).toContainText('초록 메인');
  await expect(page.locator('#ps3Menu details.ps3-more')).toHaveCount(1);
  if(capture)await page.screenshot({path:`${dir}/detail-child-390-${scheme}.png`});
  await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  await page.locator('#newProjectBtn').click();
  await page.locator('#ps3CreateColorField [aria-label="파랑"]').click();
  if(capture)await page.screenshot({path:`${dir}/create-390-${scheme}.png`});
});

test('PRJ-색 create: 8 labelled 44px choices, saved as a color key; child create has no picker',async({page})=>{
  const state=await fixture(page);
  await page.locator('#newProjectBtn').click();
  const field=page.locator('#ps3CreateColorField');await expect(field).toBeVisible();
  const options=field.locator('[role="radio"]');await expect(options).toHaveCount(8);
  expect(await options.evaluateAll(xs=>xs.map(x=>x.getAttribute('aria-label')))).toEqual(['초록','파랑','주황','보라','분홍','노랑','빨강','회색']);
  for(const b of await options.all()){const r=await b.boundingBox();expect(r.width).toBeGreaterThanOrEqual(44);expect(r.height).toBeGreaterThanOrEqual(44)}
  await expect(field.locator('[aria-checked="true"]')).toHaveCount(0);
  await page.locator('#ps3CreateName').fill('파랑 프로젝트');
  await field.locator('[aria-label="파랑"]').click();
  await expect(field.locator('[aria-label="파랑"]')).toHaveAttribute('aria-checked','true');
  // UI-색고르기통일: the chosen square keeps its own color; only a ✓ and a thin outline are added.
  const blue=field.locator('[aria-label="파랑"] .ui-swatch-fill');
  expect(await blue.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await tokenColor(page,'--ds-project-blue'));
  expect(await blue.evaluate(el=>getComputedStyle(el,'::after').content)).toBe('"✓"');
  // Choosing a parent turns this into a child project: the picker hides.
  await page.locator('#ps3CreateParent').selectOption('green');await expect(field).toBeHidden();
  await page.locator('#ps3CreateParent').selectOption('');await expect(field).toBeVisible();
  await page.locator('#ps3CreateSave').click();
  await expectProjectTitle(page,'파랑 프로젝트');
  const created=state.calls('app_spaces','POST')[0].body;
  expect(created.metadata.color).toBe('blue');expect(created.visibility).toBe('private');
  await expect(await projectColorDot(page)).toHaveAttribute('data-color','blue');
  // Child creation from the detail child list: no picker, no color written.
  await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  await page.locator('[data-ps3-project="green"]').first().click();
  await page.locator('[data-ps3-child]').click();
  await expect(page.locator('#ps3CreateHeading')).toHaveText('하위 사업영역 만들기');
  await expect(field).toBeHidden();
  await page.locator('#ps3CreateName').fill('새 하위');await page.locator('#ps3CreateSave').click();
  await expectProjectTitle(page,'새 하위');
  const child=state.calls('app_spaces','POST')[1].body;
  expect(child.parent_id).toBe('green');expect('color' in child.metadata).toBe(false);
  await expect(await projectColorDot(page)).toHaveAttribute('data-color','green');
  await expect(await projectColorDot(page)).toHaveAttribute('data-tone','soft');
});

test('PRJ-색 create without a choice writes no color and shows gray',async({page})=>{
  const state=await fixture(page);
  await page.locator('#newProjectBtn').click();
  await page.locator('#ps3CreateName').fill('색 안 고름');await page.locator('#ps3CreateSave').click();
  await expectProjectTitle(page,'색 안 고름');
  expect('color' in state.calls('app_spaces','POST')[0].body.metadata).toBe(false);
  await expect(await projectColorDot(page)).toHaveAttribute('data-color','gray');
});

test('PRJ-색 edit: current color is selected, arrow keys change it, other metadata is kept',async({page})=>{
  const state=await fixture(page,1280);
  await page.locator('[data-ps3-project="green"]').first().click();
  await page.locator('#ps3Menu .ps3-more summary').click();await page.locator('[data-ps3-edit-project]').click();
  const field=page.locator('#ps3CreateColorField');
  await expect(field.locator('[aria-checked="true"]')).toHaveAttribute('aria-label','초록');
  await expect(field.locator('[tabindex="0"]')).toHaveCount(1);
  await field.locator('[aria-label="초록"]').focus();await page.keyboard.press('ArrowRight');
  await expect(field.locator('[aria-label="파랑"]')).toBeFocused();
  await expect(field.locator('[aria-label="파랑"]')).toHaveAttribute('aria-checked','true');
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');
  await expect(field.locator('[aria-label="회색"]')).toHaveAttribute('aria-checked','true');
  await page.locator('#ps3CreateSave').click();
  await expect(page.locator('#ps3CreateModal')).toBeHidden();
  const patch=state.calls('app_spaces','PATCH').at(-1).body;
  expect(patch.metadata.color).toBe('gray');expect(patch.metadata.business).toEqual({keep:'exact'});
  await expect(page.locator(rowDot('green'))).toHaveAttribute('data-color','gray');
  await expect(page.locator(rowDot('green-kid'))).toHaveAttribute('data-tone','soft');
  await expect(page.locator(rowDot('green-kid'))).toHaveAttribute('data-color','gray');
});
