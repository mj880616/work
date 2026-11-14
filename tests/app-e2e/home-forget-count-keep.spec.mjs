// HOME-잊지말기숫자(S61-44, 명진 11/14 '잊지 말기 안에 5건이 있는데 홈 칩에 숫자가 없다'):
// 'kptu:session-changed'는 같은 사람의 로그인 이어 가기(토큰 새로 받기)에도 온다(runtime-client.js write).
// 그때 홈 [잊지 말기 n] 칩과 메뉴 '홈' 표시가 숫자 없는 '모름'으로 내려가면 안 된다(사람이 바뀐 때만 지운다).
// 서버는 흉내, 글·이름은 모두 지어낸 것.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const cid=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cand=n=>({id:cid(n),kind:'request',summary:`가짜 요청 ${n}`,due:null,source_kind:'basket',source_id:cid(90+n),source_day:'2026-10-06',evidence:'근거',project_id:null,organization_id:null,status:'open',task_id:null,task_due:null,created_at:`2026-10-06T00:0${n}:00Z`,decided_at:null});

for(const width of [412,1280])test(`${width}px: 같은 사람의 로그인 이어 가기 뒤에도 잊지 말기 숫자가 남는다`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const cands=[1,2,3,4,5].map(cand);
  await openHome(page,{beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_candidates',r=>{const st=new URL(r.request().url()).searchParams.get('status');return r.fulfill({json:st==='eq.open'?cands:[]});});
  }});
  const chip=page.locator('#homeView [data-home-summary] [data-home-forget-open]');
  await expect(chip.locator('[data-nbx-badge]')).toHaveText('5');
  await expect(page.locator('#appView')).toHaveAttribute('data-home-asks','5');
  // 같은 사람의 토큰을 새로 받은 것처럼: 같은 세션 값을 다시 써서(runtime-client.js write) 실제 알림을 낸다.
  await page.evaluate(()=>{const s=window.KPTURuntime.session;s.write(s.read());});
  await expect(chip.locator('[data-nbx-badge]')).toHaveText('5');
  await expect(chip).not.toHaveAttribute('data-chip-empty','');
  await expect(page.locator('#appView')).toHaveAttribute('data-home-asks','5');
});
