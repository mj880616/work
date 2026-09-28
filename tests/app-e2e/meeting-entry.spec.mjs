import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

test.use({timezoneId:'Asia/Seoul'});

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const here=dirname(fileURLToPath(import.meta.url));
const read=path=>readFileSync(resolve(here,'../..',path),'utf8');
const meeting={
  id:'meeting-1',workspace_id:'meeting-ws',project_id:'main',title:'접근성 회의',
  meeting_at:'2026-09-17T10:00:00Z',notes:'특이사항 기록',decisions:'과거 결정 내용',
  series_name:'궤도협의회',round_no:1,location:'과거 회의실',attendee_count:6,
  transcript_text:'원문 첫 줄\n원문 둘째 줄',created_by:'meeting-user'
};

async function mock(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'meeting-access',refresh_token:'meeting-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'meeting-user'}});
    if(path==='/auth/v1/user')return ok({id:'meeting-user',email:'meeting@example.org',user_metadata:{display_name:'회의 QA'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'meeting-ws',user_id:'meeting-user',role:'owner',email:'meeting@example.org',workspace:{id:'meeting-ws',name:'QA Workspace'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'meeting-ws',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'meeting-user',display_name:'회의 QA'}]);
    if(path==='/rest/v1/app_spaces')return ok([
      {id:'main',workspace_id:'meeting-ws',name:'메인',parent_id:null,status:'active',owner_id:'meeting-user',metadata:{project_system:'v2'},sort_order:10},
      {id:'child',workspace_id:'meeting-ws',name:'하위',parent_id:'main',status:'active',owner_id:'meeting-user',metadata:{project_system:'v2'},sort_order:20}
    ]);
    if(path==='/rest/v1/app_meetings'){
      if(method==='PATCH')return ok([{id:meeting.id}]);
      if(method==='POST')return ok([{...meeting,id:'meeting-new'}]);
      return ok([meeting]);
    }
    if(path==='/rest/v1/app_tasks')return ok([]);
    if(path==='/rest/v1/app_documents')return ok([]);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await mock(page);
  const returnTo=`${BASE}/app/?view=meetings`;
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(returnTo)}`);
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('meeting@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#meetingsView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
}

test('meeting create modal exposes the task 9 fields only',async({page})=>{
  await signIn(page);
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  for(const id of ['meetingTitle','meetingRoundNo','meetingAt','meetingProject','meetingTranscript','meetingNotes','meetingFiles','meetingActionList'])await expect(page.locator('#'+id)).toBeAttached();
  await expect(page.locator('#meetingSeriesName')).toHaveCount(0);
  await expect(page.locator('#meetingModal legend')).toHaveText(['기본정보','회의 결과','첨부·후속']);
  await expect(page.locator('#meetingFiles')).toHaveAttribute('multiple','');
  await expect(page.locator('.meeting-action-row')).toHaveCount(1);
  await expect(page.locator('.meeting-action-assignee,#mrdTaskAssignee,#taskAssignee')).toHaveCount(0);
  await expect(page.locator('#meetingAutoClassify,#meetingDecisions,#wfMeetingLocation,#wfMeetingAttendees')).toHaveCount(0);
  await expect(page.locator('#meetingProject option[value="main"]')).toHaveText('메인');
  await expect(page.locator('#meetingProject option[value="child"]')).toContainText('↳');
});

test('new meeting creates a Google follow-up linked to the meeting and project',async({page})=>{
  await signIn(page);
  let savedMeeting=null,savedTask=null,legacyWrites=0;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    const req=route.request();
    if(req.method()==='POST'){
      savedMeeting=req.postDataJSON();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...savedMeeting,id:'meeting-new'}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await page.route(`${SB}/rest/v1/app_tasks**`,async route=>{
    if(route.request().method()!=='GET')legacyWrites++;
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    savedTask=route.request().postDataJSON();
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,task:{id:'google-new'}})});
  });

  await page.locator('#newMeetingBtn').click();
  await page.locator('#meetingTitle').fill('궤도협의회 집행위원회');
  await page.locator('#meetingRoundNo').fill('8');
  await page.locator('#meetingAt').fill('2026-09-25T14:00');
  await page.locator('#meetingProject').selectOption('child');
  const raw='  첫 줄\n둘째 줄\n마지막 줄  ';
  await page.locator('#meetingTranscript').fill(raw);
  await page.locator('#meetingNotes').fill('특이사항\n둘째 줄');
  await page.locator('.meeting-action-row .meeting-action-title').fill('결과 공유');
  await page.locator('.meeting-action-row .meeting-action-due').fill('2026-09-30');
  await page.locator('#saveMeetingBtn').click();

  await expect.poll(()=>savedMeeting).not.toBeNull();
  expect(savedMeeting.title).toBe('궤도협의회 집행위원회');
  expect(savedMeeting.series_name).toBe('궤도협의회 집행위원회');
  expect(savedMeeting.round_no).toBe(8);
  expect(savedMeeting.project_id).toBe('child');
  expect(savedMeeting.meeting_at).toBe('2026-09-25T05:00:00.000Z');
  expect(savedMeeting.transcript_text).toBe(raw);
  expect(savedMeeting.notes).toBe('특이사항\n둘째 줄');
  expect(savedMeeting).not.toHaveProperty('decisions');

  await expect.poll(()=>savedTask).not.toBeNull();
  expect(savedTask).toMatchObject({
    action:'create',
    title:'결과 공유',
    due:'2026-09-30',
    links:[{meeting_id:'meeting-new'},{project_id:'child'}]
  });
  expect(legacyWrites).toBe(0);
});

test('repeated meeting save submits one meeting and one Google follow-up',async({page})=>{
  await signIn(page);
  let meetingPosts=0,taskCreates=0,release;
  const held=new Promise(resolve=>{release=resolve});
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    if(route.request().method()==='POST'){
      meetingPosts++;
      await held;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...route.request().postDataJSON(),id:'meeting-once'}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>{
    if(new URL(route.request().url()).searchParams.get('action')==='create')taskCreates++;
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,task:{id:'google-once'}})});
  });
  await page.locator('#newMeetingBtn').click();
  await page.locator('#meetingTitle').fill('중복 방지 회의');
  await page.locator('#meetingAt').fill('2026-09-29T09:00');
  await page.locator('#meetingTranscript').fill('결과');
  await page.locator('.meeting-action-title').fill('후속');
  await page.locator('#saveMeetingBtn').evaluate(button=>{button.click();button.click()});
  await expect.poll(()=>meetingPosts).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(150);
  const busy=await page.locator('#saveMeetingBtn').evaluate(button=>({disabled:button.disabled,text:button.textContent.trim()}));
  release();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await expect.poll(()=>taskCreates).toBeGreaterThanOrEqual(1);
  expect(meetingPosts).toBe(1);
  expect(taskCreates).toBe(1);
  expect(busy).toEqual({disabled:true,text:'저장 중…'});
});

test('failed meeting create restores its save button for a retry',async({page})=>{
  await signIn(page);
  let posts=0;
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>{
    if(route.request().method()==='POST'){
      posts++;
      return route.fulfill(posts===1
        ?{status:503,contentType:'application/json',body:JSON.stringify({message:'잠시 후 다시 시도해 주세요.'})}
        :{status:200,contentType:'application/json',body:JSON.stringify([{...route.request().postDataJSON(),id:'meeting-retry'}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await page.locator('#newMeetingBtn').click();
  await page.locator('#meetingTitle').fill('재시도 회의');
  await page.locator('#meetingAt').fill('2026-09-29T09:00');
  await page.locator('#meetingTranscript').fill('결과');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingStatus')).toHaveClass(/error/);
  await expect(page.locator('#saveMeetingBtn')).toBeEnabled();
  await expect(page.locator('#saveMeetingBtn')).toHaveText('회의 결과 저장');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(posts).toBe(2);
});

test('a Google follow-up failure leaves the saved meeting available without another create attempt',async({page})=>{
  await signIn(page);
  let creates=0,stored=null;
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>{
    if(route.request().method()==='POST'){creates++;stored={...route.request().postDataJSON(),id:'meeting-saved'};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([stored])})}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(stored?[stored]:[meeting])});
  });
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Google 저장 실패'})}));
  await page.locator('#newMeetingBtn').click();
  await page.locator('#meetingTitle').fill('새 회의');
  await page.locator('#meetingAt').fill('2026-09-25T14:00');
  await page.locator('#meetingTranscript').fill('회의 결과');
  await page.locator('.meeting-action-title').fill('후속');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  await expect(page.locator('[data-mrd-meeting="meeting-saved"]')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('회의 결과는 저장됐습니다.');
  expect(creates).toBe(1);
});

test('meeting material upload attempts every selected file and reports partial failure without deleting the meeting',async({page})=>{
  await signIn(page);
  let meetingSaved=false,uploadCount=0;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    if(route.request().method()==='POST'){
      meetingSaved=true;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...meeting,id:'meeting-files'}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await page.route(`${SB}/functions/v1/meeting-files**`,async route=>{
    uploadCount++;
    if(uploadCount===2)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'upload failed'})});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'doc-1'})});
  });

  await page.locator('#newMeetingBtn').click();
  await page.locator('#meetingTitle').fill('자료 첨부 회의');
  await page.locator('#meetingAt').fill('2026-09-25T14:00');
  await page.locator('#meetingTranscript').fill('회의 결과 원문');
  await page.locator('#meetingFiles').setInputFiles([
    {name:'자료1.txt',mimeType:'text/plain',buffer:Buffer.from('one')},
    {name:'자료2.txt',mimeType:'text/plain',buffer:Buffer.from('two')}
  ]);
  await page.locator('#saveMeetingBtn').click();

  await expect.poll(()=>meetingSaved).toBe(true);
  await expect.poll(()=>uploadCount).toBe(2);
  await expect(page.locator('#toast')).toContainText('회의 결과는 저장했습니다. 회의자료 1개 저장 · 1개 실패');
});

test('meeting list uses canonical meeting names without title-series duplication',async({page})=>{
  await signIn(page);
  await expect(page.locator('#meetingTypeFilter')).toBeVisible();
  await expect(page.locator('#meetingTypeFilter option')).toContainText(['회의명 전체','궤도협의회','회의명 미지정']);
  await page.locator('#meetingTypeFilter').selectOption({label:'궤도협의회'});
  const row=page.locator('#meetingList .meeting-list-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('h3')).toHaveText('궤도협의회');
  await expect(row.locator('.badge')).toHaveCount(0);
  await expect(row.locator('p')).toContainText('1차');
  await expect(row).not.toContainText('과거 회의실');
  const box=await row.boundingBox();
  expect(box.height).toBeLessThanOrEqual(60);
});

const stripe=row=>row.evaluate(el=>getComputedStyle(el).borderLeftColor);
const rgb=hex=>`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`;

const neutral=page=>page.evaluate(()=>{const probe=document.createElement('i');probe.style.color='var(--kptu-border-strong)';document.body.append(probe);const c=getComputedStyle(probe).color;probe.remove();return c});
const palette=()=>JSON.parse(read('app/team.js').match(/const MEETING_COLORS=(\[[^\]]+\])/)[1].replace(/'/g,'"'));
async function showMeetings(page,rows,docs=[]){
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)}));
  await page.route(`${SB}/rest/v1/app_documents**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(docs)}));
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(rows.length);
}

test('meeting names get palette colors in order of first appearance and keep them after reload',async({page})=>{
  await signIn(page);
  const P=palette();
  // API order is newest first; colors follow the oldest meeting of each name.
  const rows=[
    {...meeting,id:'a3',title:'궤도협의회',series_name:'궤도협의회',round_no:3,meeting_at:'2026-09-20T01:00:00Z'},
    {...meeting,id:'c1',title:'안전위원회',series_name:'안전위원회',round_no:1,meeting_at:'2026-09-19T01:00:00Z'},
    {...meeting,id:'b1',title:'노사협의회',series_name:'노사협의회',round_no:1,meeting_at:'2026-09-18T01:00:00Z'},
    {...meeting,id:'a2',title:'  궤도협의회 ',series_name:null,round_no:2,meeting_at:'2026-09-17T01:00:00Z'},
    {...meeting,id:'none',title:'',series_name:null,round_no:null,meeting_at:'2026-09-16T01:00:00Z'},
    {...meeting,id:'a1',title:'궤도협의회',series_name:'궤도협의회',round_no:1,meeting_at:'2026-09-15T01:00:00Z'}
  ];
  await showMeetings(page,rows,[{id:'d1',workspace_id:'meeting-ws',meeting_id:'a3',title:'자료'}]);
  const byId=id=>page.locator(`#meetingList [data-mrd-meeting="${id}"]`);
  const expected={a1:P[0],a2:P[0],a3:P[0],b1:P[1],c1:P[2]};
  const check=async()=>{for(const [id,hex] of Object.entries(expected))expect(await stripe(byId(id)),id).toBe(rgb(hex))};
  await check();
  expect(new Set([P[0],P[1],P[2]]).size).toBe(3);
  expect(await byId('a1').evaluate(el=>getComputedStyle(el).borderLeftWidth)).toBe('4px');
  expect(await stripe(byId('none'))).toBe(await neutral(page));
  // Second line: round · date · materials only.
  await expect(byId('a3').locator('p')).toHaveText(/^3차 · .+ · 자료 1개$/);
  await expect(byId('a3').locator('p')).not.toContainText('메인');
  // Filtering does not reassign colors.
  await page.locator('#meetingTypeFilter').selectOption({label:'안전위원회'});
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(1);
  expect(await stripe(byId('c1'))).toBe(rgb(P[2]));
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await page.locator('#meetingTypeFilter').selectOption('all');
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(rows.length);
  await check();
});

test('meeting names beyond the palette get the neutral stripe instead of reusing a color',async({page})=>{
  await signIn(page);
  const P=palette();
  const rows=Array.from({length:P.length+2},(_,i)=>({...meeting,id:'n'+i,title:'회의'+(i+1),series_name:'회의'+(i+1),round_no:null,meeting_at:new Date(Date.UTC(2026,0,1+i)).toISOString()})).reverse();
  await showMeetings(page,rows);
  const colors=[];
  for(let i=0;i<rows.length;i++)colors.push(await stripe(page.locator(`#meetingList [data-mrd-meeting="n${i}"]`)));
  expect(colors.slice(0,P.length)).toEqual(P.map(rgb));
  expect(new Set(colors.slice(0,P.length)).size).toBe(P.length);
  const gray=await neutral(page);
  expect(colors.slice(P.length)).toEqual([gray,gray]);
});

test('meeting palette has 12 distinct non-red colors visible on light and dark surfaces',async()=>{
  const P=palette();
  expect(P).toHaveLength(12);
  expect(new Set(P).size).toBe(12);
  const lin=c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4};
  const parts=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const lum=hex=>{const [r,g,b]=parts(hex).map(lin);return .2126*r+.7152*g+.0722*b};
  const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const hue=hex=>{const [r,g,b]=parts(hex).map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(!d)return null;const h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;return (h*60+360)%360};
  const lab=hex=>{const [r,g,b]=parts(hex).map(lin),f=t=>t>.008856?Math.cbrt(t):7.787*t+16/116,x=(r*.4124+g*.3576+b*.1805)/.95047,y=r*.2126+g*.7152+b*.0722,z=(r*.0193+g*.1192+b*.9505)/1.08883;return [116*f(y)-16,500*(f(x)-f(y)),200*(f(y)-f(z))]};
  const dE=(a,b)=>{const A=lab(a),B=lab(b);return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2])};
  for(const color of P){
    const h=hue(color);
    expect(h,color).not.toBeNull();
    expect(h>=40&&h<=320,`${color} hue ${h}`).toBe(true);
    expect(contrast(color,'#ffffff'),color).toBeGreaterThanOrEqual(3);
    expect(contrast(color,'#1f2933'),color).toBeGreaterThanOrEqual(3);
    expect(contrast(color,'#121212'),color).toBeGreaterThanOrEqual(3);
    expect(dE(color,'#cfd6dc'),`${color} vs neutral`).toBeGreaterThan(30);
  }
  for(let i=0;i<P.length;i++)for(let j=i+1;j<P.length;j++)expect(dE(P[i],P[j]),`${P[i]} ${P[j]}`).toBeGreaterThanOrEqual(20);
});

for(const width of [320,360,390,768,1280]){
  test(`meeting filter stays usable and add button sits in the list card at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:800});
    await signIn(page);
    const bar=page.locator('#meetingsView .meeting-toolbar');
    const select=page.locator('#meetingTypeFilter'),button=page.locator('#newMeetingBtn');
    await expect(button).toBeVisible();
    const head=page.locator('#meetingsListCard .add-list-head');
    const [b,s,h,btn]=await Promise.all([bar.boundingBox(),select.boundingBox(),head.boundingBox(),button.boundingBox()]);
    expect(btn.height).toBeCloseTo(36,0);
    expect(s.height).toBeCloseTo(btn.height,0);
    expect(s.x).toBeCloseTo(b.x,0);
    expect(s.width).toBeCloseTo(b.width,0);
    expect(btn.x+btn.width).toBeCloseTo(h.x+h.width,0);
    expect(btn.y).toBeGreaterThanOrEqual(h.y);
    expect(btn.y+btn.height).toBeLessThanOrEqual(h.y+h.height);
    expect(b.height).toBeCloseTo(36,0);
    expect(await button.evaluate(el=>el.scrollWidth<=el.clientWidth&&getComputedStyle(el).whiteSpace==='nowrap')).toBe(true);
    const row=page.locator('#meetingList .meeting-list-row').first();
    const fit=await row.evaluate(el=>{const main=el.querySelector('.meeting-list-main').getBoundingClientRect(),box=el.getBoundingClientRect(),cs=getComputedStyle(el);return {row:box.height,content:main.height+parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom)+parseFloat(cs.borderBottomWidth)}});
    expect(Math.abs(fit.row-fit.content)).toBeLessThanOrEqual(1);
    expect(fit.row).toBeLessThanOrEqual(56);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

test('meeting list filters title-only and series-only legacy rows by the displayed meeting name',async({page})=>{
  await signIn(page);
  const rows=[
    {...meeting,id:'title-only',title:'제목만 회의',series_name:null,round_no:null},
    {...meeting,id:'series-only',title:'',series_name:'계열명만 회의',round_no:2},
    {...meeting,id:'different',title:'33차 기존 제목',series_name:'기존 회의 계열',round_no:33}
  ];
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)}));
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator('#meetingList h3')).toHaveText(['제목만 회의','계열명만 회의','기존 회의 계열']);
  await page.locator('#meetingTypeFilter').selectOption({label:'제목만 회의'});
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(1);
  await expect(page.locator('#meetingList .meeting-list-row p')).not.toContainText('차');
});

test('meeting detail shows one canonical heading while retaining a distinct legacy title in metadata',async({page})=>{
  await signIn(page);
  const trigger=page.locator('[data-mrd-meeting="meeting-1"]');
  await trigger.click();
  await expect(page.locator('#mrdTitle')).toHaveText('궤도협의회');
  await expect(page.locator('#mrdMeta')).toContainText('기존 제목: 접근성 회의');
  await expect(page.locator('#mrdMeta')).toContainText('1차');
  await expect(page.locator('#mrdMeta')).not.toContainText('궤도협의회');
});

test('meeting detail does not repeat a new meeting name when title and series name are equal',async({page})=>{
  await signIn(page);
  const fresh={...meeting,title:'궤도협의회 집행위원회',series_name:'궤도협의회 집행위원회',round_no:8};
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([fresh])}));
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdTitle')).toHaveText('궤도협의회 집행위원회');
  await expect(page.locator('#mrdMeta')).not.toContainText('궤도협의회 집행위원회');
  await expect(page.locator('#mrdMeta')).toContainText('8차');
});

test('meeting detail dialog exposes semantics, Escape close, and trigger focus restore',async({page})=>{
  await signIn(page);
  const trigger=page.locator('[data-mrd-meeting="meeting-1"]');
  await trigger.focus();
  await trigger.click();
  const modal=page.locator('#meetingRoundDetailModal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('role','dialog');
  await expect(modal).toHaveAttribute('aria-modal','true');
  await expect(modal).toHaveAttribute('aria-labelledby','mrdTitle');
  await expect(page.locator('#mrdClose')).toHaveAttribute('aria-label','닫기');
  await expect(page.locator('#mrdClose')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);
  await expect(trigger).toBeFocused();
});

test('meeting edit preserves legacy name fields when the user does not rename the meeting',async({page})=>{
  await signIn(page);
  let saved=null;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    if(route.request().method()==='PATCH'){
      saved=route.request().postDataJSON();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:meeting.id}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdResult')).toHaveText('원문 첫 줄\n원문 둘째 줄');
  await expect(page.locator('#mrdSpecialSection')).toBeVisible();
  await page.locator('#mrdEdit').click();
  await expect(page.locator('#mrdEditSeries')).toHaveCount(0);
  await expect(page.locator('#mrdEditTitle')).toHaveValue('궤도협의회');
  await expect(page.locator('#mrdEditAt')).toHaveValue('2026-09-17T19:00');
  await expect(page.locator('#mrdEditProject option[value="child"]')).toContainText('↳');
  const raw='  수정 원문 첫 줄\n둘째 줄\n마지막 줄  ';
  await page.locator('#mrdEditTranscript').fill(raw);
  await page.locator('#mrdEditNotes').fill('수정 특이사항\n둘째 줄');
  await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>saved).not.toBeNull();
  expect(saved.transcript_text).toBe(raw);
  expect(saved.notes).toBe('수정 특이사항\n둘째 줄');
  expect(saved.meeting_at).toBe('2026-09-17T10:00:00.000Z');
  expect(saved).not.toHaveProperty('title');
  expect(saved).not.toHaveProperty('series_name');
  expect(saved).not.toHaveProperty('decisions');
  expect(saved).not.toHaveProperty('location');
  expect(saved).not.toHaveProperty('attendee_count');
});

test('renaming a legacy meeting normalizes title and series_name to the one user-visible name',async({page})=>{
  await signIn(page);
  let saved=null;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    if(route.request().method()==='PATCH'){
      saved=route.request().postDataJSON();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:meeting.id}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await page.locator('#mrdEdit').click();
  await page.locator('#mrdEditTitle').fill('궤도협의회 집행위원회');
  await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>saved).not.toBeNull();
  expect(saved.title).toBe('궤도협의회 집행위원회');
  expect(saved.series_name).toBe('궤도협의회 집행위원회');
});

test('round number remains optional on edit',async({page})=>{
  await signIn(page);
  let saved=null;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    if(route.request().method()==='PATCH'){
      saved=route.request().postDataJSON();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:meeting.id}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await page.locator('#mrdEdit').click();
  await page.locator('#mrdEditRound').fill('');
  await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>saved).not.toBeNull();
  expect(saved.round_no).toBeNull();
});

test('empty special notes stay hidden in meeting detail',async({page})=>{
  await signIn(page);
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...meeting,notes:''}])}));
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdSpecialSection')).toBeHidden();
});

test('legacy structured decisions remain visible only as fallback when old meetings have no raw result',async({page})=>{
  await signIn(page);
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...meeting,transcript_text:null,decisions:'기존 결정 기록'}])}));
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdResult')).toContainText('[기존 회의결과 기록]');
  await expect(page.locator('#mrdResult')).toContainText('기존 결정 기록');
});

test('meeting edit does not report success when RLS updates zero rows',async({page})=>{
  await signIn(page);
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    const data=route.request().method()==='PATCH'?[]:[meeting];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await page.locator('#mrdEdit').click();
  await page.locator('#mrdSaveEdit').click();
  await expect(page.locator('#mrdEditStatus')).toContainText('수정 권한을 확인하지 못했습니다.');
  await expect(page.locator('#mrdEditor')).toBeVisible();
});

test('closing a meeting ignores its late detail response',async({page})=>{
  await signIn(page);
  let release;
  const held=new Promise(resolve=>{release=resolve});
  let requested=false;
  await page.route(`${SB}/rest/v1/app_meetings**`,async route=>{
    requested=true;
    await held;
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([meeting])});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect.poll(()=>requested).toBe(true);
  await page.locator('#mrdClose').evaluate(button=>button.click());
  release();
  await expect(page.locator('#meetingRoundDetailModal')).toHaveClass(/hidden/);
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('aria-hidden','true');
});

test('closing a meeting during a delayed follow-up save does not reopen its detail',async({page})=>{
  await signIn(page);
  let release,posted=false;
  const held=new Promise(resolve=>{release=resolve});
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    if(action==='create'){posted=true;await held}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(action==='linked'?{tasks:[]}:{ok:true,task:{id:'google-new'}})});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await page.locator('#mrdAddTask').click();
  await page.locator('#mrdTaskTitle').fill('후속 자료 정리');
  await page.locator('#mrdTaskSave').click();
  await expect.poll(()=>posted).toBe(true);
  await page.locator('#mrdClose').click();
  release();
  await expect(page.locator('#meetingRoundDetailModal')).toHaveClass(/hidden/);
  await page.waitForTimeout(100);
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('aria-hidden','true');
});

test('repeated meeting follow-up save sends one Google create',async({page})=>{
  await signIn(page);
  let creates=0,release;
  const held=new Promise(resolve=>{release=resolve}),tasks=[];
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    if(action==='linked')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks})});
    if(action==='create'){
      creates++;
      await held;
      tasks.push({id:'google-once',taskListId:'@default',title:route.request().postDataJSON().title,status:'needsAction'});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await page.locator('#mrdAddTask').click();
  await page.locator('#mrdTaskTitle').fill('후속');
  await page.locator('#mrdTaskSave').click();
  await expect.poll(()=>creates).toBeGreaterThanOrEqual(1);
  await page.locator('#mrdTaskCancel').click();
  await page.locator('#mrdAddTask').click();
  await page.locator('#mrdTaskTitle').fill('후속 변경');
  await expect(page.locator('#mrdTaskSave')).toBeDisabled();
  await page.locator('#mrdTaskSave').evaluate(button=>button.click());
  await page.waitForTimeout(150);
  const createsBeforeRelease=creates;
  release();
  await expect(page.locator('#mrdTasks [data-mrd-task="google-once"]')).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(createsBeforeRelease).toBe(1);
  expect(creates).toBe(1);
});

test('meeting detail waits for a task screen completion and rereads it on reopening',async({page})=>{
  await signIn(page);
  const due=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10)+'T00:00:00Z';
  let status='needsAction',toggleStarted=false,linkedReads=0,release;
  const held=new Promise(resolve=>{release=resolve});
  const task=()=>({id:'meeting-follow-up',taskListId:'@default',taskListTitle:'내 할 일',title:'후속',status,due,completed:status==='completed'?new Date().toISOString():null});
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    if(action==='overview')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,authorized:true,tasks:[task()]})});
    if(action==='linked'){linkedReads++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:[task()]})})}
    if(action==='toggle'){
      toggleStarted=true;
      await held;
      status='completed';
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,task:task()})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await page.locator('.app-nav [data-view="tasks"]').click();
  await expect(page.locator('#gtTaskBody [data-google-task="meeting-follow-up"]')).toBeVisible();
  await page.locator('#gtTaskBody [data-gt-toggle="meeting-follow-up"]').click();
  await expect.poll(()=>toggleStarted).toBe(true);
  await expect(page.locator('#gtTaskBody [data-google-task="meeting-follow-up"]')).toHaveClass(/completed/);
  await page.locator('.app-nav [data-view="meetings"]').click();
  linkedReads=0;
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await page.waitForTimeout(150);
  const readsBeforeSave=linkedReads;
  release();
  await expect(page.locator('#mrdTasks [data-mrd-task="meeting-follow-up"]')).toHaveClass(/completed/);
  expect(readsBeforeSave).toBe(0);
  await page.locator('#mrdClose').click();
  const previousReads=linkedReads;
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdTasks [data-mrd-task="meeting-follow-up"]')).toHaveClass(/completed/);
  expect(linkedReads).toBeGreaterThan(previousReads);
});

test('meeting detail keeps completed Google follow-ups and supports create, edit, toggle, and confirmed delete without app_tasks',async({page})=>{
  await signIn(page);
  const tasks=[{id:'old-done',taskListId:'@default',title:'완료된 항목',due:'2025-01-01T00:00:00Z',notes:'기존 메모',status:'completed',completed:'2025-01-02T00:00:00Z'}];
  let legacyRequests=0,created=null,updated=null,deleted=null;
  await page.route(`${SB}/rest/v1/app_tasks**`,route=>{legacyRequests++;return route.fulfill({status:200,contentType:'application/json',body:'[]'})});
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>{
    const action=new URL(route.request().url()).searchParams.get('action'),body=route.request().method()==='POST'?route.request().postDataJSON():{};
    if(action==='linked')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks})});
    if(action==='create'){created=body;tasks.push({id:'new-google',taskListId:'@default',title:body.title,due:body.due,notes:body.notes,status:'needsAction'})}
    if(action==='update'){updated=body;Object.assign(tasks.find(t=>t.id===body.task_id),{title:body.title,due:body.due,notes:body.notes})}
    if(action==='toggle'){Object.assign(tasks.find(t=>t.id===body.task_id),{status:body.completed?'completed':'needsAction',completed:body.completed?new Date().toISOString():null})}
    if(action==='delete'){deleted=body;tasks.splice(tasks.findIndex(t=>t.id===body.task_id),1)}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdTasks [data-mrd-task]')).toHaveCount(1);
  await expect(page.locator('#mrdTasks [data-mrd-task="old-done"]')).toHaveClass(/completed/);
  await expect(page.locator('#mrdTasks [data-mrd-task-toggle="old-done"]')).toHaveAttribute('aria-label','완료 취소');
  expect(await page.locator('#mrdTasks [data-mrd-task="old-done"] b').evaluate(el=>getComputedStyle(el).textDecorationLine)).toContain('line-through');
  await page.locator('#mrdAddTask').click();
  await page.locator('#mrdTaskTitle').fill('새 후속');
  await page.locator('#mrdTaskDue').fill('2026-09-30');
  await page.locator('#mrdTaskSave').click();
  await expect(page.locator('#mrdTasks [data-mrd-task]')).toHaveCount(2);
  expect(created).toMatchObject({action:'create',due:'2026-09-30',notes:'',links:[{meeting_id:'meeting-1'},{project_id:'main'}]});
  await page.locator('#mrdTasks [data-mrd-task-edit="old-done"]').click();
  await page.locator('#mrdTaskTitle').fill('수정된 후속');
  await page.locator('#mrdTaskDue').fill('2026-10-01');
  await page.locator('#mrdTaskSave').click();
  await expect(page.locator('#mrdTasks [data-mrd-task="old-done"]')).toContainText('수정된 후속');
  expect(updated).toMatchObject({action:'update',task_id:'old-done',due:'2026-10-01',notes:'기존 메모'});
  await page.locator('#mrdTasks [data-mrd-task-toggle="old-done"]').click();
  await expect(page.locator('#mrdTasks [data-mrd-task="old-done"]')).toHaveClass(/pending/);
  await page.locator('#mrdTasks [data-mrd-task-toggle="old-done"]').click();
  await expect(page.locator('#mrdTasks [data-mrd-task="old-done"]')).toHaveClass(/completed/);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#mrdTasks [data-mrd-task-delete="new-google"]').click();
  await expect(page.locator('#mrdTasks [data-mrd-task]')).toHaveCount(1);
  expect(deleted).toMatchObject({action:'delete',task_id:'new-google'});
  expect(legacyRequests).toBe(0);
});

for(const width of [390,1280])test(`meeting Google follow-up row stays usable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await signIn(page);
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:[{id:'followup',title:'긴 후속 할 일 제목을 표시하는 항목',status:'completed',completed:'2025-01-01T00:00:00Z',due:'2025-01-02T00:00:00Z',taskListId:'@default'}]})}));
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  const row=page.locator('#mrdTasks [data-mrd-task="followup"]');
  await expect(row).toBeVisible();
  await expect(row.locator('[data-mrd-task-toggle]')).toBeVisible();
  await expect(row.locator('[data-mrd-task-edit]')).toBeVisible();
  await expect(row.locator('[data-mrd-task-delete]')).toBeVisible();
  expect(await row.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('Google editor displays and retains meeting links while a meeting-only task stays unlinked to projects',async({page})=>{
  await signIn(page);
  const today=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
  const task={id:'linked-google',taskListId:'@default',taskListTitle:'내 할 일',title:'회의 연결 항목',due:today+'T00:00:00Z',notes:'',status:'needsAction'};
  let update=null,linkChanges=0,unlinkBody=null;const actions=[];
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    actions.push(action);
    if(action==='overview')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,authorized:true,tasks:[task]})});
    if(action==='links')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({links:[{project_id:'main',status:'confirmed'}],meeting_links:[{meeting_id:'meeting-1',status:'confirmed'}]})});
    if(action==='unlinked')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:[{...task,id:'meeting-only'}]})});
    if(action==='update')update=route.request().postDataJSON();
    if(action==='link'||action==='unlink'){linkChanges++;if(action==='unlink')unlinkBody=route.request().postDataJSON()}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,task})});
  });
  await page.locator('.app-nav [data-view="tasks"]').click();
  await expect.poll(()=>actions,{timeout:15000}).toContain('overview');
  await expect(page.locator('#gtTaskBody [data-google-task="linked-google"]')).toBeVisible({timeout:15000});
  await page.locator('[data-gt-edit="linked-google"]').click();
  await expect(page.locator('#gtMeetingLinks')).toContainText('회의: 궤도협의회');
  await expect(page.locator('#gtEditLinkBody input[value="p:main"]')).toBeChecked();
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>update).not.toBeNull();
  expect(linkChanges).toBe(0);
  await page.locator('[data-gt-edit="linked-google"]').click();
  await expect(page.locator('#gtEditLinkBody input[value="p:main"]')).toBeChecked();
  await page.locator('#gtEditLinkBody input[value="p:main"]').uncheck();
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>unlinkBody).not.toBeNull();
  expect(unlinkBody.links).toEqual([{project_id:'main'}]);
  await page.locator('#gtUnlinked summary').click();
  await expect(page.locator('#gtUnlinkedBody [data-gt-unlinked-task="meeting-only"]')).toBeVisible();
});

test('changing a meeting project leaves existing Google follow-up links untouched',async({page})=>{
  await signIn(page);
  let current={...meeting},linkChanges=0,linkedReads=0;
  await page.route(`${SB}/rest/v1/app_meetings**`,route=>{
    if(route.request().method()==='PATCH'){current={...current,...route.request().postDataJSON()};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:meeting.id}])})}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([current])});
  });
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    if(action==='link'||action==='unlink')linkChanges++;
    if(action==='linked'){linkedReads++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:[{id:'existing',title:'기존 후속',status:'needsAction',taskListId:'@default'}]})})}
    return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#mrdTasks [data-mrd-task="existing"]')).toBeVisible();
  await page.locator('#mrdEdit').click();
  await page.locator('#mrdEditProject').selectOption('child');
  await page.locator('#mrdSaveEdit').click();
  await expect(page.locator('#mrdTasks [data-mrd-task="existing"]')).toBeVisible();
  expect(current.project_id).toBe('child');
  expect(linkedReads).toBeGreaterThan(1);
  expect(linkChanges).toBe(0);
});

test('meeting integration keeps project auto-selection and one direct render path',async()=>{
  const html=read('app/index.html');
  const loader=read('app/loader-v2.js');
  const views=read('app/view-loader.js');
  const workflow=read('app/task-workflow.js');
  const detail=read('app/meeting-round-detail.js');
  const team=read('app/team.js');
  const css=read('app/styles.css');
  const project=read('app/project-system-v3.js');
  const files=read('supabase/functions/meeting-files/index.ts');

  for(const id of ['meetingRoundNo','meetingTranscript','meetingNotes','meetingFiles','meetingActionList','addMeetingAction','meetingTypeFilter'])expect(html).toContain(`id="${id}"`);
  for(const id of ['meetingSeriesName','meetingAutoClassify','meetingDecisions','wfMeetingLocation','wfMeetingAttendees'])expect(html).not.toContain(`id="${id}"`);
  expect(loader).not.toContain('meeting-assignee-picker.js');
  expect(loader).not.toContain('meeting-file-route.js');
  expect(loader).not.toContain('workflow-ai-v3.js');
  expect(loader).toContain("import('./team.js?v=54')");
  expect(views).toContain('task-workflow.js?v=9');
  expect(views).toContain('meeting-round-detail.js?v=16');
  expect(views).toContain('meeting-ui.css?v=10');
  expect(workflow).not.toContain('MutationObserver');
  expect(workflow).not.toContain("document.createElement('style')");
  expect(detail).not.toContain('MutationObserver');
  expect(detail).not.toContain("document.createElement('style')");
  expect(detail).not.toContain('mrdEditSeries');
  expect(detail).not.toContain('mrdAiDraft');
  expect(team).toContain('series_name:title');
  expect(team).toContain('transcript_text:transcript');
  expect(team).toContain("/functions/v1/meeting-files");
  expect(project).toContain("meeting:['meetings','newMeetingBtn','meetingProject']");
  expect(project).toContain('s.value=project.id');
  expect(files).toContain('file.size>100*1024*1024');
  expect(css).toContain("meeting-ui.css?v=10");
});
