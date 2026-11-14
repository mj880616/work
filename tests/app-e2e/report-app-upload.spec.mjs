// APP-뒤에서올리기 웹 연결(PR-2, S58-12, 요청함 11/11 06:56): 사업 보고 사진·회의자료 올리기.
// ① 폰 앱(가짜 KPTUAppShell): 묶음을 앱 다리에 넘기고 화면은 보내지 않는다 → 줄은 '앱이 올리는 중', 앱의 끝 알림으로 채워진다. 멈춤·실패 줄·[다시 올리기].
//    옛 앱·위젯 로그인 없음이면 지금 길 그대로(화면 안에서 올림).
// ② 브라우저(다리 없음): 화면을 벗어난 사이 끊긴 사진은 돌아오면 저절로 다시(먼저 서버에 이미 붙었는지 확인), 그래도 안 되면 그 줄에 [다시].
//    까닭을 인터넷 탓으로 알리지 않는다. 올렸는지 모르는 사진은 저절로 다시 보내지 않는다.
// 서버·앱은 흉내(page.route · 가짜 다리), 파일·이름은 모두 가짜다. 화면 사진은 SHOTS_DIR을 줄 때만 찍는다(docs/design/screens/s58-12/).
import {test,expect} from '@playwright/test';
import {fillDateTime} from './helpers/date-time.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {openMeetingResult,closeMeetingResult} from './helpers/meeting-open.mjs';

import {addReport} from './helpers/report-add.mjs';
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const ANDROID='Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.5.7';
const OLD_ID='22222222-2222-4222-8222-222222222222',NEW_ID='11111111-1111-4111-8111-111111111111';
const SHOTS=process.env.SHOTS_DIR||'';
const PIXEL=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const photo=n=>({name:`사진${n}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from('jpeg-'+n)});
const paper=(name='자료.hwp')=>({name,mimeType:'application/x-hwp',buffer:Buffer.from('hwp-'+name)});
const sizeOf=name=>/\.jpg$/.test(name)?photo(name.match(/\d+/)?.[0]||'').buffer.length:paper(name).buffer.length;
const dock=page=>page.locator('#uploadDock:not([hidden])');
const batchId=n=>`batch_${String(n).padStart(4,'0')}_abcdefghij`;
const docId=n=>`cccccccc-0000-4ccc-8ddd-${String(n).padStart(12,'0')}`;
const reloadAsks=page=>page.evaluate(()=>{const detail={otherDraft:false};window.dispatchEvent(new CustomEvent('kptu:before-reload',{detail}));return detail.otherDraft});
// 처음 올릴 때는 자료실 올리기 부품을 불러온다(늦게 받는 부품): 첫 올리기가 시작되기까지만 넉넉히 기다린다.
const FIRST=15000;
const shot=async(page,name)=>{if(SHOTS)await page.screenshot({path:`${SHOTS}/${name}.png`})};

// app: null = 브라우저(다리 없음). {know, on} = 가짜 앱(know=false 옛 앱 — up:hello에 답 없음, on=false 위젯 로그인 없음).
async function boot(page,width,{app=null,height=900}={}){
  await page.setViewportSize({width,height});
  const state={meetings:[{id:OLD_ID,workspace_id:'ws',created_by:'owner',title:'가짜 회의',round_no:1,meeting_at:'2026-11-10T01:00:00Z',report_kind:'meeting',transcript:'가짜 결과',project_id:null}],
    docs:[],uploads:[],checks:[],hold:false,waiting:[],cut:new Set(),cutAlways:false,cutAfterSave:false,errors:[]};
  state.release=()=>{const next=state.waiting.shift();if(next)next()};
  state.releaseAll=()=>{state.hold=false;while(state.waiting.length)state.release()};
  // 앱이 올린 것처럼 서버에 자료를 붙인다(가짜).
  state.attach=(n,name,meeting=OLD_ID)=>{const isPhoto=/\.jpg$/.test(name);state.docs.push({id:docId(n),workspace_id:'ws',file_id:'drive-'+n,file_name:name,file_size:sizeOf(name),title:name,mime_type:isPhoto?'image/jpeg':'application/x-hwp',category:isPhoto?'사진':'회의자료',tags:[],meeting_id:meeting,created_at:new Date().toISOString()});return docId(n)};
  page.on('pageerror',e=>state.errors.push(e.message));
  if(app)await page.addInitScript(({know,on})=>{
    const listeners=[],shell=window.__app={sent:[],starts:[],begins:[],seq:0,know,on};
    const say=data=>setTimeout(()=>listeners.forEach(fn=>fn({data})),0);
    shell.job=value=>say('up:job:'+JSON.stringify(value));
    window.KPTUAppShell={
      postMessage(m){
        m=String(m);if(!m.startsWith('up:'))return;
        shell.sent.push(m.startsWith('up:part:')?'up:part':m);
        if(!shell.know)return;
        const step=m.slice(3).split(':')[0];
        if(step==='hello')return say('up:state:'+JSON.stringify({v:1,on:shell.on,kinds:['meeting'],jobs:[]}));
        if(step==='cancel'||step==='seen')return;
        if(step==='start'){shell.seq++;shell.starts.push(JSON.parse(m.slice('up:start:'.length)))}
        if(step==='begin')shell.begins.push(JSON.parse(m.slice('up:begin:'.length)));
        const id=step==='start'||step==='go'?`,"id":"batch_${String(shell.seq).padStart(4,'0')}_abcdefghij"`:'';
        say(`up:ack:{"ok":true,"step":"${step}","error":""${id}}`);
      },
      addEventListener(type,fn){if(type==='message')listeners.push(fn)},
    };
  },app);
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/auth/v1/token')return ok({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner'}});
    if(path==='/auth/v1/user')return ok({id:'owner',email:'owner@example.org'});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'ws',user_id:'owner',role:'owner',workspace:{id:'ws',name:'테스트'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws',name:'테스트'}]);
    if(path==='/rest/v1/app_meetings'){
      if(req.method()==='POST'){const row={id:NEW_ID,workspace_id:'ws',created_by:'owner',...req.postDataJSON()};state.meetings=[...state.meetings,row];return ok([row])}
      const id=url.searchParams.get('id')?.replace(/^eq\./,'');
      return ok(state.meetings.filter(m=>!id||m.id===id));
    }
    if(path==='/rest/v1/app_documents'){
      const eq=key=>url.searchParams.get(key)?.replace(/^eq\./,''),mid=eq('meeting_id'),name=eq('file_name'),size=eq('file_size');
      // UX-이미있는파일알림: 고른 직후 같은 이름·크기를 찾는 읽기(file_name=in.)는 '다시 보내기 전 확인'이 아니다 — 이 시험의 자료는 같은 것이 없다.
      if(String(url.searchParams.get('file_name')||'').startsWith('in.'))return ok([]);
      if(name)state.checks.push(name); // 다시 보내기 전에 '이미 붙었는지' 묻는 읽기
      return ok(state.docs.filter(d=>(!mid||d.meeting_id===mid)&&(!name||d.file_name===name)&&(!size||String(d.file_size)===size)));
    }
    if(path==='/functions/v1/library-files'){
      // 사진 칸이 작은 그림을 읽는 요청(GET): 가짜 그림 한 점.
      if(req.method()!=='POST')return route.fulfill({status:200,contentType:'image/png',body:PIXEL});
      const raw=req.postDataBuffer().toString('utf8'),name=raw.match(/filename="([^"]+)"/)?.[1]||'';
      const upload={raw,name,meeting:raw.match(/name="meeting_id"\r\n\r\n([^\r]+)/)?.[1]||''};
      state.uploads.push(upload);
      if(state.hold)await new Promise(resolve=>state.waiting.push(resolve));
      // 끊김 흉내: 그 이름의 첫 요청(cutAlways면 늘)을 서버에 닿기 전에 끊는다.
      // cutAfterSave: 서버는 받아 저장했는데 답이 닿기 전에 끊김(화면은 다 보낸 줄 모른다).
      if(state.cutAfterSave){state.cutAfterSave=false;state.attach(state.uploads.length,name,upload.meeting);return route.abort('connectionreset')}
      if(state.cutAlways||state.cut.has(name)){state.cut.delete(name);return route.abort('connectionreset')}
      state.attach(state.uploads.length,name,upload.meeting);
      return ok({ok:true,document:state.docs.at(-1)});
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
const appState=page=>page.evaluate(()=>({sent:window.__app.sent,starts:window.__app.starts,begins:window.__app.begins}));
const appJob=(page,n,over)=>page.evaluate(job=>window.__app.job(job),{id:batchId(n),kind:'meeting',target:OLD_ID,total:1,left:0,state:'done',reason:'',docs:[],errors:[],...over});
// 화면이 뒤로 갔다 돌아옴 흉내(브라우저 탭·앱 전환).
async function fakeVisibility(page){
  await page.evaluate(()=>{window.__vis='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__vis});Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__vis==='hidden'})});
  return value=>page.evaluate(v=>{window.__vis=v;document.dispatchEvent(new Event('visibilitychange'))},value);
}
const pickPhotos=(page,n)=>page.locator('#mrdPhotoInput').setInputFiles(Array.from({length:n},(_,i)=>photo(i+1)));
// STAB-report-app-upload(S59-5): 사업 보고를 다 읽은 뒤에 사진을 고른다. 폰은 줄을 누르면 곧 돌아오는데, 사진 고르기 칸(#mrdPhotoInput)은
// 창을 깔 때 이미 있고 그 보고는 그 뒤에 읽는다. 읽기가 끝나기 전에 넣은 파일은 화면이 받을 보고가 없어 받지 않는다 — CI에서 읽기가 조금 늦으면
// 고른 사진이 통째로 사라져 '2장을 올렸어요'·하단 한 줄이 끝내 나오지 않았다. 사람은 창이 열린 뒤에야 [+]를 누를 수 있으므로,
// 창이 그 보고를 다 읽었다(data-meeting-id)·[+]가 보인다를 확인한 뒤에 고른다.
async function openReport(page,id=OLD_ID){
  await openMeetingResult(page,id);
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('data-meeting-id',id);
  await expect(page.locator('#mrdPickPhotos')).toBeVisible();
}

test.describe('폰 앱(가짜 다리)',()=>{
  test.use({userAgent:ANDROID});

  test('상세 사진 줄: 사진 3장을 앱에 넘기고 화면은 보내지 않는다 → 끝 알림으로 채워지고, 멈춤·실패 줄·[다시 올리기] 412px',async({page})=>{
    const state=await boot(page,412,{app:{know:true,on:true}});
    await openReport(page,OLD_ID);
    await pickPhotos(page,3);
    // 넘김: 화면은 서버로 보내지 않고, 줄은 '앱이 올리는 중'.
    await expect(page.locator('#mrdPhotoRows .up-row[data-phase="handed"]')).toHaveCount(3,{timeout:FIRST});
    await expect(page.locator('#mrdPhotoRows .up-sum')).toHaveText('앱이 뒤에서 올리는 중 3개');
    await expect(page.locator('#mrdPhotoRows .up-row .up-pc').first()).toHaveText('앱이 올리는 중');
    await expect(page.locator('#mrdPhotoRows .up-row .up-x')).toHaveCount(0);
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 3장 앱이 뒤에서 올리는 중');
    expect(state.uploads).toEqual([]);
    const sent=await appState(page);
    expect(sent.starts).toEqual([{kind:'meeting',meeting:OLD_ID,project:'',count:3}]);
    expect(sent.begins.map(b=>b.name)).toEqual(['사진1.jpg','사진2.jpg','사진3.jpg']);
    expect(sent.begins.every(b=>b.category&&b.date==='2026-11-10')).toBe(true); // 사진 칸(종류·날짜)을 같이 넘긴다
    expect(sent.sent.at(-1)).toBe('up:go');
    expect(sent.sent.some(m=>/test-access|test-refresh|bearer|"ws"/i.test(m))).toBe(false); // 로그인 정보·작업공간은 넘기지 않는다
    expect(await reloadAsks(page)).toBe(false); // 앱이 맡았으니 새로 고쳐도 잃지 않는다
    await shot(page,'app-handed-412');
    // 올리는 중: 끝난 사진부터 그때그때 채워진다.
    const first=state.attach(1,'사진1.jpg');
    await appJob(page,1,{state:'run',total:3,left:2,docs:[first,'',''],errors:['','','']});
    await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 1');
    await expect(page.locator('#mrdPhotoRows .up-row[data-phase="handed"]')).toHaveCount(2);
    // 멈춤: 까닭과 함께, 화면이 다시 보내지 않는다.
    await appJob(page,1,{state:'stopped',reason:'signed_out',total:3,left:2,docs:[first,'',''],errors:['','','']});
    await expect(page.locator('#mrdPhotoRows .up-sum')).toHaveText('앱이 멈춤 2개');
    await expect(page.locator('#mrdPhotoRows .up-row .up-pc').first()).toHaveText('멈춤');
    await expect(dock(page).locator('.up-dock-text')).toHaveText('멈춤 · 위젯 로그인이 풀렸어요 · 앱을 열면 이어 올려요');
    await shot(page,'app-stopped-412');
    expect(state.uploads).toEqual([]);
    // 끝: 둘째는 올림, 셋째는 못 올림(까닭) → 아래 한 줄 하나에 [다시 올리기](UX-알림하나로 S59-21 — 사진 칸 줄은 그 실패를 따로 그리지 않는다).
    const second=state.attach(2,'사진2.jpg');
    await appJob(page,1,{total:3,docs:[first,second,''],errors:['','','server']});
    await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 2');
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 1장 못 올렸어요');
    await expect(page.locator('#mrdPhotoRows .up-row[data-phase="failed"]')).toHaveCount(0);
    await expect(dock(page).locator('.up-dock-note')).toHaveText('사진 2장 올렸어요 · 서버가 잠시 답하지 않아요');
    await expect.poll(async()=>(await appState(page)).sent.includes(`up:seen:${batchId(1)}`)).toBe(true); // 반영한 묶음은 앱 기록을 지운다
    await shot(page,'app-failed-line-412');
    // [다시 올리기]: 못 올린 사진만 다시 앱에 넘긴다.
    await dock(page).getByRole('button',{name:'못 올린 파일 다시 올리기'}).click();
    await expect.poll(async()=>(await appState(page)).starts.length).toBe(2);
    expect((await appState(page)).starts[1]).toEqual({kind:'meeting',meeting:OLD_ID,project:'',count:1});
    await expect(page.locator('#mrdPhotoRows .up-row[data-phase="handed"]')).toHaveCount(1);
    const third=state.attach(3,'사진3.jpg');
    await appJob(page,2,{docs:[third],errors:['']});
    await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 3');
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 3장 올렸어요'); // 그 묶음에서 올라간 사진 전부
    await expect(page.locator('#mrdPhotoRows .up-row[data-phase="failed"],#mrdPhotoRows .up-row[data-phase="handed"]')).toHaveCount(0);
    expect(state.uploads).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('새 사업 보고 [저장]: 사진 2장 + 자료 1개를 앱에 넘기고 창은 바로 닫힌다 → 앱이 끝내면 그 보고에 모두 붙어 있다 412px',async({page})=>{
    const state=await boot(page,412,{app:{know:true,on:true}});
    await addReport(page);
    await expect(page.locator('#meetingModal')).toBeVisible();
    const select=page.locator('#meetingNameSelect');if(await select.isVisible())await select.selectOption('__other__');
    await page.locator('#meetingTitle').fill('가짜 새 회의');
    await fillDateTime(page,'#meetingAt','2026-11-10T10:00');
    await page.locator('#meetingTranscript').fill('가짜 결과');
    await page.locator('#meetingPhotoFiles').setInputFiles([photo(1),photo(2)]);
    await page.locator('#meetingFiles').setInputFiles([paper()]);
    await page.locator('#saveMeetingBtn').click();
    await expect(page.locator('#meetingModal')).toBeHidden();
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 2장·자료 1개 앱이 뒤에서 올리는 중',{timeout:FIRST});
    const sent=await appState(page);
    expect(sent.starts).toEqual([{kind:'meeting',meeting:NEW_ID,project:'',count:3}]);
    expect(sent.begins.map(b=>[b.name,!!b.date])).toEqual([['사진1.jpg',true],['사진2.jpg',true],['자료.hwp',false]]); // 사진 칸은 사진에만
    expect(state.uploads).toEqual([]);
    await shot(page,'app-new-report-handed-412');
    const ids=[state.attach(1,'사진1.jpg',NEW_ID),state.attach(2,'사진2.jpg',NEW_ID),state.attach(3,'자료.hwp',NEW_ID)];
    await appJob(page,1,{target:NEW_ID,total:3,docs:ids,errors:['','','']});
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 2장·자료 1개 올렸어요');
    await openReport(page,NEW_ID);
    await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 2');
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(1);
    await expect(page.locator('#mrdPhotoRows .up-row,#mrdDropRows .up-row')).toHaveCount(0);
    expect(state.uploads).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  for(const [label,app] of [['옛 앱(물음에 답 없음)',{know:false,on:true}],['위젯 로그인 없음',{know:true,on:false}]]){
    test(`${label}: 넘기지 않고 지금 길 그대로 화면 안에서 올린다 412px`,async({page})=>{
      const state=await boot(page,412,{app});
      await openReport(page,OLD_ID);
      await pickPhotos(page,2);
      await expect(page.locator('#mrdPhotoStatus')).toContainText('2장을 올렸어요',{timeout:10000});
      await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 2');
      expect(state.uploads.map(u=>u.name)).toEqual(['사진1.jpg','사진2.jpg']);
      const sent=await appState(page);
      expect(sent.sent.filter(m=>m!=='up:hello')).toEqual([]); // 파일은 넘기지 않는다
      expect(state.errors).toEqual([]);
    });
  }
});

for(const width of [412,1280]){
  test(`브라우저: 화면을 벗어난 사이 끊긴 사진은 돌아오면 저절로 다시 올리고, 까닭을 인터넷 탓으로 알리지 않는다 ${width}px`,async({page})=>{
    const state=await boot(page,width);
    await openReport(page,OLD_ID);
    const setVisible=await fakeVisibility(page);
    state.hold=true;state.cut.add('사진1.jpg');
    await pickPhotos(page,2);
    await expect.poll(()=>state.uploads.length,{timeout:FIRST}).toBe(1);
    await setVisible('hidden'); // 다른 앱·탭으로 감
    state.release();            // 그 사이 첫 사진이 끊긴다
    await expect(page.locator('#mrdPhotoRows .up-row[data-phase="failed"]')).toHaveCount(1);
    await expect(page.locator('#mrdPhotoRows .up-row[data-phase="failed"]')).toHaveAttribute('title','화면을 벗어나 올리기가 멈췄어요.');
    await page.waitForTimeout(900);
    expect(state.uploads.length).toBe(1); // 돌아오기 전에는 다시 보내지 않고, 뒤 사진이 앞지르지도 않는다
    await setVisible('visible');
    await expect.poll(()=>state.uploads.length).toBe(2);
    expect(state.uploads[1].name).toBe('사진1.jpg');
    expect(state.checks).toEqual(['사진1.jpg']); // 다시 보내기 전에 이미 붙었는지 먼저 물었다(붙어 있지 않아 다시 보냄)
    await expect(dock(page).locator('.up-dock-text')).toHaveText('화면을 벗어나 멈췄어요 · 다시 올리는 중');
    await expect(page.locator('#mrdPhotoRows .up-row[data-phase="failed"]')).toHaveCount(0); // 옛 실패 줄은 지우고 새 줄로
    await shot(page,`back-again-${width}`);
    state.releaseAll();
    await expect(page.locator('#mrdPhotoStatus')).toContainText('2장을 올렸어요',{timeout:10000});
    await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 2');
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 2장 올렸어요');
    expect(state.uploads.map(u=>u.name)).toEqual(['사진1.jpg','사진1.jpg','사진2.jpg']);
    expect(state.errors).toEqual([]);
  });

  test(`브라우저: 돌아와 다시 보내도 안 되면 그 줄에 [다시] — 못 올린 사진만 다시 올린다(처음부터 다시 고르지 않음) ${width}px`,async({page})=>{
    const state=await boot(page,width);
    await openReport(page,OLD_ID);
    const setVisible=await fakeVisibility(page);
    state.hold=true;state.cutAlways=true;
    await pickPhotos(page,2);
    await expect.poll(()=>state.uploads.length,{timeout:FIRST}).toBe(1);
    await setVisible('hidden');
    state.release();
    await expect(page.locator('#mrdPhotoRows .up-row[data-phase="failed"]')).toHaveCount(1);
    await setVisible('visible');
    await expect.poll(()=>state.uploads.length).toBe(2); // 한 번 저절로 다시
    await setVisible('hidden');
    state.release();
    // 또 끊김: 저절로는 한 번뿐 → 두 장 모두 못 올림, 아래 한 줄 하나에 까닭(인터넷 탓 문구 아님)과 [다시 올리기](사진 칸 줄은 실패를 따로 그리지 않는다).
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 2장 못 올렸어요');
    await expect(page.locator('#mrdPhotoRows .up-row[data-phase="failed"]')).toHaveCount(0);
    await expect(dock(page).locator('.up-dock-note')).toHaveText('화면을 벗어나 올리기가 멈췄어요.');
    expect(await page.locator('#meetingRoundDetailModal,#uploadDock').allInnerTexts()).not.toContain('네트워크');
    await expect(page.locator('#mrdPhotoStatus')).toHaveText('');
    await shot(page,`back-retry-line-${width}`);
    await page.waitForTimeout(900);
    expect(state.uploads.length).toBe(2);
    await setVisible('visible');
    state.cutAlways=false;state.hold=false;
    await dock(page).getByRole('button',{name:'못 올린 파일 다시 올리기'}).click();
    await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 2');
    await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 2장 올렸어요');
    await expect(page.locator('#mrdPhotoRows .up-row')).toHaveCount(0);
    expect(state.uploads.map(u=>u.name)).toEqual(['사진1.jpg','사진1.jpg','사진1.jpg','사진2.jpg']);
    expect(state.errors).toEqual([]);
  });
}

test('브라우저: 화면이 멈춘 사이 서버가 이미 받은 사진은 돌아와도 다시 보내지 않는다(같은 사진이 두 번 붙지 않게) 412px',async({page})=>{
  const state=await boot(page,412);
  await openReport(page,OLD_ID);
  const setVisible=await fakeVisibility(page);
  state.hold=true;state.cutAfterSave=true;
  await pickPhotos(page,2);
  await expect.poll(()=>state.uploads.length,{timeout:FIRST}).toBe(1);
  await setVisible('hidden');
  state.release(); // 서버는 첫 사진을 저장했지만 답이 끊겼다
  await expect(page.locator('#mrdPhotoRows .up-row[data-phase="failed"]')).toHaveCount(1);
  state.hold=false;
  await setVisible('visible');
  // 이미 붙어 있는 것을 확인하고 다시 보내지 않는다 → 둘째만 올린다.
  await expect(page.locator('#mrdPhotoStatus')).toContainText('2장을 올렸어요',{timeout:10000});
  await expect(page.locator('#mrdPhotosHead')).toHaveText('사진 2');
  expect(state.checks).toEqual(['사진1.jpg']);
  expect(state.uploads.map(u=>u.name)).toEqual(['사진1.jpg','사진2.jpg']);
  expect(state.docs.map(d=>d.file_name)).toEqual(['사진1.jpg','사진2.jpg']);
  await expect(page.locator('#mrdPhotoRows .up-row')).toHaveCount(0);
  await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 2장 올렸어요');
  expect(state.errors).toEqual([]);
});

test('브라우저: 다 보낸 뒤 끊긴 사진(올렸는지 모름)은 돌아와도 저절로 다시 보내지 않는다 412px',async({page})=>{
  const state=await boot(page,412);
  await openReport(page,OLD_ID);
  const setVisible=await fakeVisibility(page);
  // 다 보낸 뒤 끊김 흉내: 올리기 길이 '다 보냄' 뒤의 끊김으로 알린다(서버가 받았을 수 있다).
  await page.evaluate(()=>{const Real=window.XMLHttpRequest;window.XMLHttpRequest=function(){const xhr=new Real(),send=xhr.send.bind(xhr);xhr.send=body=>{if(!(body instanceof FormData))return send(body);setTimeout(()=>{window.__vis='hidden';document.dispatchEvent(new Event('visibilitychange'));xhr.upload.onload?.();xhr.onerror?.()},50)};return xhr}});
  await pickPhotos(page,1);
  await expect(dock(page).locator('.up-dock-text')).toHaveText('사진 1장 못 올렸어요',{timeout:FIRST});
  await expect(dock(page).locator('.up-dock-note')).toContainText('화면을 벗어난 사이 올리기가 끊겨 올렸는지 확인하지 못했어요.');
  await setVisible('visible');
  await page.waitForTimeout(900);
  expect(state.uploads).toEqual([]); // 저절로 다시 보내지 않는다(같은 사진이 두 번 붙지 않게)
  await expect(page.locator('#mrdPhotoRows .up-row[data-phase="failed"] [data-up-act="retry"]')).toHaveCount(0); // 그 줄에 [다시]도 없다(확인을 받은 뒤에만)
  expect(state.errors).toEqual([]);
  await closeMeetingResult(page);
});
