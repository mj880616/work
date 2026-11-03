// HOTFIX2-회의칸깨짐(S48-63): 사업 보고 보기·고치기 화면이 깨지지 않는다 — 깨짐을 잡는 시험.
// - 첨부 칸(사진·회의자료)은 #mrdAttach 한 곳에 있고 보기·고치기 모두 보인다(요소를 옮기지 않는다).
// - 칸 안의 모든 테두리 상자·머리줄이 부모 칸(카드) 폭 안에 있다(옆 칸을 덮거나 바깥으로 넘치지 않음).
// - 큰 창 ⤢ 버튼은 글 칸마다 칸 이름 줄 안의 글자 높이 아이콘이다(폭 가득 막대 아님).
// 폰(390)·폴드(700)·PC(1280). 가짜 서버만 쓴다(운영 서버 호출 없음).
import {test,expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const MEETING={id:'meeting-1',workspace_id:'ws',title:'자료 확인 회의',series_name:'자료 확인 회의',meeting_at:'2026-10-10T10:00:00Z',transcript_text:'회의 원문',notes:'특이 글',created_by:'owner'};

async function boot(page,width){
  await page.setViewportSize({width,height:900});
  const state={meeting:{...MEETING},docs:['first.pdf','second.pdf'].map((name,i)=>({id:'doc-'+i,workspace_id:'ws',meeting_id:MEETING.id,file_name:name,title:name,category:'회의자료',tags:[],created_at:'2026-10-10T00:00:00Z'})),uploads:[],patches:[],errors:[]};
  page.on('pageerror',e=>state.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')state.errors.push(m.text())});
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/auth/v1/token')return ok({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner'}});
    if(path==='/auth/v1/user')return ok({id:'owner',email:'owner@example.org'});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'ws',user_id:'owner',role:'owner',workspace:{id:'ws',name:'테스트'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws',name:'테스트'}]);
    if(path==='/rest/v1/app_meetings'){
      if(req.method()==='PATCH'){const body=req.postDataJSON();state.patches.push(body);Object.assign(state.meeting,body)}
      return ok([state.meeting]);
    }
    if(path==='/rest/v1/app_documents'){
      const id=url.searchParams.get('id')?.replace(/^eq\./,''),mid=url.searchParams.get('meeting_id')?.replace(/^eq\./,'');
      return ok(state.docs.filter(d=>(!id||d.id===id)&&(!mid||d.meeting_id===mid)));
    }
    if(['/functions/v1/library-files','/functions/v1/meeting-files'].includes(path)){
      const raw=req.postDataBuffer().toString('latin1');
      state.uploads.push({path,raw});
      const name=raw.match(/filename="([^"]+)"/)?.[1];
      const doc={id:'uploaded-'+state.uploads.length,workspace_id:'ws',file_name:name,title:name,tags:[],meeting_id:raw.includes('name="meeting_id"')?MEETING.id:null,created_at:'2026-10-11T00:00:00Z'};
      state.docs.push(doc);
      return ok({ok:true,document:doc});
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[]});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    return ok([]);
  });
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(BASE+'/app/?view=meetings')}`);
  await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  return state;
}


// 카드 안에서 눈에 보이는 모든 요소가 카드 가로 범위(1px 여유) 안에 있는지. 벗어난 것의 표시를 돌려준다.
async function overflowing(modal){
  return modal.evaluate(root=>{
    const card=root.querySelector('.modal-card')||root,box=card.getBoundingClientRect(),bad=[];
    for(const el of card.querySelectorAll('*')){
      if(el.closest('[hidden],.hidden'))continue;
      const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
      if(getComputedStyle(el).position==='fixed')continue;
      if(r.left<box.left-1||r.right>box.right+1)bad.push(`${el.tagName}#${el.id}.${String(el.className).slice(0,40)} ${Math.round(r.left-box.left)}~${Math.round(r.right-box.right)}`);
    }
    return bad.slice(0,8);
  });
}
for(const [name,width] of [['폰',390],['폴드',700],['PC',1280]]){
  test(`${name} ${width}px: 사업 보고 보기·고치기 — 첨부 칸 한 곳·테두리와 머리줄이 칸 안`,async({page})=>{
    const state=await boot(page,width);
    await openMeetingResult(page,'meeting-1');
    const modal=page.locator('#meetingRoundDetailModal');
    await expect(modal.locator('#mrdView')).toBeVisible();
    await expect(modal.locator('#mrdAttach')).toBeVisible();
    await expect(modal.locator('#mrdAttach #mrdPhotoSection')).toHaveCount(1);
    await expect(modal.locator('#mrdAttach #mrdMaterials .mrd-file-row')).toHaveCount(2);
    expect(await overflowing(modal)).toEqual([]);
    // 머리줄이 자기 칸 폭 안(옆 칸을 덮지 않음).
    const headFit=await modal.evaluate(root=>{const h=root.querySelector('.modal-head').getBoundingClientRect(),p=(root.closest('.mcol-result')||root.querySelector('.modal-card')).getBoundingClientRect();return {l:h.left-p.left,r:h.right-p.right}});
    expect(headFit.l).toBeGreaterThanOrEqual(-1);expect(headFit.r).toBeLessThanOrEqual(1);
    // 고치기: 같은 첨부 칸 그대로(옮기지 않음), 틀 없음.
    await modal.locator('#mrdMore').click();
    await modal.locator('#mrdMoreMenu [data-mrd-more="edit"]').click();
    await expect(modal.locator('#mrdEditor')).toBeVisible();
    await expect(modal.locator('#mrdAttach')).toBeVisible();
    await expect(modal.locator('#mrdEditAttach')).toHaveCount(0);
    await expect(modal.locator('#mrdAttach #mrdMaterials .mrd-file-row')).toHaveCount(2);
    expect(await overflowing(modal)).toEqual([]);
    // 빈 테두리 상자 없음: 테두리가 있는 보이는 상자는 안에 글·입력·단추가 있거나 높이가 얇은 줄이다.
    const empties=await modal.evaluate(root=>[...root.querySelectorAll('*')].filter(el=>{
      if(el.closest('[hidden],.hidden')||el.matches('input,textarea,select,button,img,svg,label,.dt-date,.dt-time,.due-chip'))return false;const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
      if(!r.width||!r.height||r.height<8)return false;
      const bordered=['Top','Right','Bottom','Left'].filter(s=>parseFloat(cs['border'+s+'Width'])>0&&cs['border'+s+'Style']!=='none').length>=3;
      return bordered&&!el.textContent.trim()&&!el.querySelector('input,textarea,select,button,img,svg');
    }).map(el=>`${el.tagName}#${el.id}.${String(el.className).slice(0,40)}`));
    expect(empties).toEqual([]);
    // 큰 창 ⤢: 칸 이름 줄 안 작은 아이콘(글자 높이 정도).
    const bigs=modal.locator('.record-big-write');
    await expect(bigs).toHaveCount(2);
    for(const b of await bigs.all()){
      const box=await b.boundingBox();
      expect(box.height).toBeLessThanOrEqual(24);expect(box.width).toBeLessThanOrEqual(28);
      expect(await b.evaluate(el=>!!el.closest('.record-big-head'))).toBe(true);
    }
    expect(state.errors).toEqual([]);
  });
}
