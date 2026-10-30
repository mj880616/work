import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
// UI-점검1030손질(2026-10-30 사이트 점검 실측): 폰 412·PC 1440 수치 확인.
// C2 사업 보고 칸 칩 줄은 [거르기 ▾] 앞에서 끝나고 넘치면 끝을 흐리게, C4 달력 이전·다음 달 화살표 누르는 범위 44px.
// 합성 자료만, 진짜 서버 호출 없음.
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'audit-user',email:'audit@example.invalid',user_metadata:{display_name:'Audit QA'}};
const workspace={id:'audit-workspace',name:'Fixture workspace'};
const project={id:'audit-project',workspace_id:workspace.id,name:'Fixture project',description:'Fixture',parent_id:null,owner_id:user.id,created_by:user.id,status:'active',visibility:'private',sort_order:10,metadata:{project_system:'v2',management_version:2}};
// 칸 칩 줄은 늘 [전체]+여덟 칸이라 412px에서는 넘친다(report-kinds.mjs).
const meetings=[{id:'audit-meeting',workspace_id:workspace.id,project_id:project.id,title:'합성 보고',meeting_at:'2026-10-05T09:00:00+09:00',created_by:user.id}];
const events=[{id:'audit-ev-1',calendarId:'primary',title:'피부과 합성 일정',start:'2026-10-31T10:00:00+09:00',end:'2026-10-31T11:00:00+09:00',allDay:false}];
const calendars=[{id:'primary',summary:'기본 캘린더',accessRole:'owner',backgroundColor:'#336699'}];
const ok=(route,data)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
async function openApp(page,view){
  await page.clock.setFixedTime(new Date('2026-10-29T01:00:00Z'));
  await page.route(`${SB}/**`,async route=>{
    const u=new URL(route.request().url()),p=u.pathname,action=u.searchParams.get('action');
    if(p==='/auth/v1/token')return ok(route,{access_token:'fixture',refresh_token:'fixture',expires_in:3600,expires_at:4102444800,user});
    if(p==='/auth/v1/user')return ok(route,user);
    if(p==='/auth/v1/logout')return ok(route,{});
    if(p==='/rest/v1/app_workspace_members')return ok(route,[{workspace_id:workspace.id,user_id:user.id,role:'owner',workspace}]);
    if(p==='/rest/v1/app_workspaces')return ok(route,[workspace]);
    if(p==='/rest/v1/app_profiles')return ok(route,[{user_id:user.id,display_name:'Audit QA'}]);
    if(p==='/rest/v1/app_spaces')return ok(route,[project]);
    if(p==='/rest/v1/app_meetings')return ok(route,meetings);
    if(p==='/functions/v1/google-calendar'){
      // Like the real Edge: status has no events; only action=events does.
      const status={connected:true,enabled:true,selected:['primary'],calendars,colors:{},eventColors:{}};
      return ok(route,action==='events'?{...status,events}:status);
    }
    if(p==='/functions/v1/google-tasks'){
      if(action==='linked')return ok(route,{tasks:[],removed:0});
      return ok(route,{connected:true,authorized:true,tasks:[],links:[],meeting_links:[]});
    }
    if(p.startsWith('/rest/v1/rpc/'))return ok(route,null);
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok(route,[]);
    return ok(route,{});
  });
  await page.goto(loginEntry(`${BASE}/app/?view=${view}`));
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await page.evaluate(v=>window.KPTURouter.go(v,{source:'audit-test'}),view);
  await expect(page.locator(`#${view}View`)).toBeVisible({timeout:15000});
}

test.describe('폰 412',()=>{
  test.use({viewport:{width:412,height:915},timezoneId:'Asia/Seoul',hasTouch:true});

  test('C4 달력 이전·다음 달 화살표: 보이는 폭은 좁아도 누르는 범위 44px',async({page})=>{
    await openApp(page,'calendar');
    await expect(page.locator('#prevMonthBtn')).toBeVisible();await expect(page.locator('#nextMonthBtn')).toBeVisible();
    // 이전·다음 달 화살표: 보이는 칸은 좁아도(16px) 옆 18px을 눌러도 그 화살표다.
    for(const [id,dx] of [['prevMonthBtn',18],['nextMonthBtn',-18]]){
      const b=await page.locator('#'+id).boundingBox();
      const hit=await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.closest('button')?.id||'',[b.x+b.width/2+dx,b.y+b.height/2]);
      expect(hit,id).toBe(id);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });

  test('C2 사업 보고: 칸 칩 줄은 [거르기 ▾] 앞에서 끝나고, 넘치면 가려진 끝을 흐리게 한다',async({page})=>{
    await openApp(page,'meetings');
    const row=page.locator('#reportKindFilter'),btn=page.locator('#reportFilterBtn');
    await expect(row.locator('button').first()).toBeVisible();await expect(btn).toBeVisible();
    const r=await row.boundingBox(),b=await btn.boundingBox();
    expect(r.x+r.width).toBeLessThanOrEqual(b.x);
    const m=await row.evaluate(el=>({over:el.scrollWidth>el.clientWidth+1,more:el.dataset.scrollMore||'',mask:getComputedStyle(el).maskImage||getComputedStyle(el).webkitMaskImage||''}));
    if(m.over){expect(m.more).toBe('end');expect(m.mask).toContain('linear-gradient');}
    else{expect(m.more).toBe('');}
    // 끝까지 밀면 앞쪽이 흐려지고 끝은 또렷해진다.
    if(m.over){
      await row.evaluate(el=>{el.scrollLeft=el.scrollWidth});
      await expect(row).toHaveAttribute('data-scroll-more','start');
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
});
