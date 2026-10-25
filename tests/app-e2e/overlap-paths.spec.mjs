import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// MTG-기록겹침거르기 3단계 나머지: 홈 [업데이트] 프로젝트 기록·여러 곳 연결 업데이트·담당조직 기록도 저장이 끝나면 같은 "비슷한 기록이 있어요" 알림을 낸다.
// 진짜 앱이 Chromium에서 돌고, Supabase REST·ai-assist·판정 저장·연결 저장 경계만 모의다. 이름은 모두 합성 값이다.
// openHome은 브라우저 시계를 2026-10-06T01:00:00Z(서울 10.6)로 고정한다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const MID='f0000000-0000-4000-8000-000000000001',UID='f0000000-0000-4000-8000-000000000002',TITLE='철도 파업 출정 기자회견';
const quick=page=>page.locator('#homeView [data-home-quick]');
const dialog=page=>page.getByRole('dialog');
const notice=page=>page.locator('[data-overlap-notice]');

async function overlap(page,{linkCalls=true}={}){
  const calls={ai:[],verdicts:[],setLinks:[]};
  await page.route(SB+'/functions/v1/ai-assist',async route=>{
    const body=route.request().postDataJSON();calls.ai.push(body);
    return route.fulfill({status:200,json:{ok:true,kind:'overlap_check',saved:1,kept_user:0,results:body.pairs.map(p=>({...p,state:'judged',verdict:'same'}))}});
  });
  await page.route(SB+'/rest/v1/app_meetings**',route=>{
    const q=new URL(route.request().url()).searchParams;
    if(route.request().method()!=='GET')return route.fallback();
    if(q.has('meeting_at'))return route.fulfill({status:200,json:[{id:MID,title:TITLE,series_name:TITLE,meeting_at:'2026-10-05T05:00:00Z',activity_kind:'press',project_id:null}]});
    if(q.get('id')===`eq.${MID}`)return route.fulfill({status:200,json:[{id:MID,updated_at:'2026-10-05T06:00:00Z'}]});
    return route.fulfill({status:200,json:[]});
  });
  await page.route(SB+'/rest/v1/app_record_links**',route=>{
    const q=new URL(route.request().url()).searchParams;
    if(route.request().method()==='GET'&&((q.get('select')||'').includes('source_meeting_id')||q.has('source_meeting_id')||q.has('note_id')))return route.fulfill({status:200,json:[]});
    return route.fallback();
  });
  await page.route(SB+'/rest/v1/rpc/app_record_overlap_set',route=>{calls.verdicts.push(route.request().postDataJSON());return route.fulfill({status:200,json:{saved:1,kept_user:0}});});
  if(linkCalls)await page.route(SB+'/rest/v1/rpc/app_meeting_set_links',route=>{calls.setLinks.push(route.request().postDataJSON());return route.fulfill({status:200,json:{ok:true,updated_at:'2026-10-06T01:00:01Z',created:1,removed:0}});});
  return calls;
}
async function homeUpdate(page,text='출정 기자회견 진행함'){
  await page.setViewportSize({width:1280,height:844});
  await openHome(page);
  const q=quick(page);
  await q.locator('[data-quick-mode="task"]').click();await q.locator('[data-quick-mode="update"]').click();
  await q.locator('[data-quick-input]').fill(text);
  return q;
}
async function pick(page,q,...names){
  await q.locator('[data-quick-org]').click();await expect(dialog(page)).toBeVisible();
  for(const name of names)await dialog(page).getByRole('button',{name,exact:true}).first().click();
  await dialog(page).getByRole('button',{name:'저장',exact:true}).click();
}

test('MTG-겹침 홈 [업데이트]로 프로젝트에 기록하면 저장된 기록의 id로 확인하고 알림이 뜬다',async({page})=>{
  const q=await homeUpdate(page);const calls=await overlap(page);
  const posts=[];
  await page.route(SB+'/rest/v1/app_project_progress_updates',route=>{
    if(route.request().method()!=='POST')return route.fallback();
    const body=route.request().postDataJSON();posts.push({body,prefer:route.request().headers().prefer||''});
    return route.fulfill({status:200,json:[{...body,id:UID,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]});
  });
  await pick(page,q,'테스트 프로젝트');
  await q.locator('[data-quick-save]').click();
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText('비슷한 기록이 있어요');await expect(notice(page)).toContainText(TITLE);
  expect(posts).toHaveLength(1);expect(posts[0].prefer).toContain('return=representation');
  expect(calls.ai).toHaveLength(1);
  expect(calls.ai[0].pairs).toEqual([{a:`meeting:${MID}`,b:`project_update:${UID}`}]);
  await notice(page).getByRole('button',{name:'연결로 바꾸기'}).click();
  await expect(notice(page)).toContainText('연결했어요. 쓴 글은 연결 메모로 붙였어요.');
  expect(calls.setLinks).toHaveLength(1);
  expect(calls.setLinks[0].p_targets).toEqual([{kind:'project',target_id:'p',summary:'출정 기자회견 진행함'}]);
  expect(calls.verdicts[0].p_pairs[0]).toMatchObject({verdict:'same',decided_by:'user'});
});

test('MTG-겹침 홈 [업데이트]로 담당조직에 기록하면 담당조직 기록(org_update)으로 확인하고 [그대로 두기]는 다른 일로 남긴다',async({page})=>{
  const q=await homeUpdate(page,'현장 면담 진행함');const calls=await overlap(page);
  await page.route(SB+'/rest/v1/app_suborganization_updates',route=>{
    if(route.request().method()!=='POST')return route.fallback();
    const body=route.request().postDataJSON();
    return route.fulfill({status:200,json:[{...body,id:UID,occurred_at:'2026-10-06T01:00:00Z'}]});
  });
  await pick(page,q,'테스트 조직');
  await q.locator('[data-quick-save]').click();
  await expect(notice(page)).toBeVisible();
  expect(calls.ai[0].pairs).toEqual([{a:`meeting:${MID}`,b:`org_update:${UID}`}]);
  await notice(page).getByRole('button',{name:'그대로 두기'}).click();
  await expect(notice(page)).toContainText('그대로 두었어요');
  expect(calls.verdicts[0].p_pairs).toEqual([{a_ref:`meeting:${MID}`,b_ref:`org_update:${UID}`,verdict:'different',decided_by:'user'}]);
  expect(calls.setLinks).toHaveLength(0);
});

test('MTG-겹침 두 곳에 연결한 업데이트는 연결이 끝난 뒤 확인하고, [연결로 바꾸기]는 두 곳을 모두 사업 보고에 잇는다',async({page})=>{
  const q=await homeUpdate(page,'두 곳 소식');const calls=await overlap(page);
  const NOTE='f0000000-0000-4000-8000-000000000003';
  await page.route(SB+'/rest/v1/app_notes**',route=>{
    if(route.request().method()!=='POST')return route.fallback();
    const body=route.request().postDataJSON();
    return route.fulfill({status:200,json:[{...body,id:NOTE,kind:'basket',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true}]});
  });
  await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',route=>route.fulfill({status:200,json:{ok:true,created:2,existing:0}}));
  await pick(page,q,'테스트 프로젝트','테스트 조직');
  await q.locator('[data-quick-save]').click();
  await expect(notice(page)).toBeVisible();
  expect(calls.ai).toHaveLength(1);
  expect(calls.ai[0].pairs).toEqual([{a:`basket:${NOTE}`,b:`meeting:${MID}`}]);
  await notice(page).getByRole('button',{name:'연결로 바꾸기'}).click();
  await expect(notice(page)).toContainText('연결했어요');
  expect(calls.setLinks).toHaveLength(1);
  expect(calls.setLinks[0].p_targets.map(t=>[t.kind,t.target_id]).sort()).toEqual([['organization','o'],['project','p']]);
});

test('MTG-겹침 연결이 거절된 업데이트는 확인하지 않는다(정리함에 남아 있는 글을 건드리지 않는다)',async({page})=>{
  const q=await homeUpdate(page,'거절될 소식');const calls=await overlap(page);
  await page.route(SB+'/rest/v1/app_notes**',route=>{
    if(route.request().method()!=='POST')return route.fallback();
    const body=route.request().postDataJSON();
    return route.fulfill({status:200,json:[{...body,id:'f0000000-0000-4000-8000-000000000004',kind:'basket',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z'}]});
  });
  await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',route=>route.fulfill({status:200,json:{ok:false,error:'NOTE_CHANGED'}}));
  await pick(page,q,'테스트 프로젝트','테스트 조직');
  await q.locator('[data-quick-save]').click();
  await expect(page.locator('#toast')).toContainText('정리함에 저장했습니다.');
  await page.waitForTimeout(300);
  expect(calls.ai).toHaveLength(0);
  await expect(notice(page)).toHaveCount(0);
});
