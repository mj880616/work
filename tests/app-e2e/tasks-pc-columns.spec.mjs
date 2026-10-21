// UI-PC할일(2026-10-20) → UI-PC할일후속 → UI-PC할일배치(2026-10-20): PC(≥1024) 할 일 화면은 좌우 절반.
// 왼쪽 절반 = 위 칸 "지남·오늘" + 아래 칸 "일주일 안"(높이는 항목 수만큼), 오른쪽 절반 = 상세 칸(왼쪽 위 칸과 같은 줄에서 시작해 맨 아래까지).
// "나중 N ▸"·"완료 N ▸"는 "일주일 안" 열 맨 아래 접기 줄. 상세 칸의 [저장]은 맨 위 제목 줄(닫기 X 옆)에 있고 스크롤해도 고정.
// 폰·중간 폭은 지금 묶음 목록 그대로. 상세 칸은 지금 수정 창과 같은 요소·같은 저장 경로(google-tasks update/link/unlink)를 쓴다.
import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

const NOW=Date.parse('2026-10-08T03:00:00Z'); // 한국 시각 10월 8일 정오
const task=(id,due=null,extra={})=>({id,title:'할 일 '+id,taskListId:'@default',taskListTitle:'내 할 일',due,status:'needsAction',notes:'',...extra});
const PROJECT={id:'p1',name:'시험 프로젝트',workspace_id:'qa-ws',owner_id:'qa-user',metadata:{project_system:'v2'},status:'active'};
const ORG={id:'o1',name:'시험 조직',active:true};

async function open(page,width,tasks,{links=[],projects=[PROJECT],orgs=[ORG],height=844}={}){
  await page.setViewportSize({width,height});
  await openEmphasisFixture(page,{view:'list',now:NOW,events:[],tasks,projects,orgs,links});
  // 저장 경로를 기록하는 google-tasks 응답(먼저 등록된 고정 응답보다 우선한다).
  const calls=[];let taskLinks=links.map(l=>({...l}));
  await page.route('**/functions/v1/google-tasks**',async route=>{
    const url=new URL(route.request().url()),action=url.searchParams.get('action'),body=route.request().postDataJSON?.()||null;
    calls.push({action,body});
    const ok=json=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
    const linksOf=id=>({links:taskLinks.filter(l=>l.google_task_id===id&&(l.project_id||l.organization_id)).map(({project_id,organization_id})=>({...(project_id?{project_id}:{organization_id}),status:'confirmed'})),meeting_links:[]});
    if(action==='links')return ok(linksOf(url.searchParams.get('task_id')));
    if(action==='update'){const at=tasks.findIndex(t=>t.id===body.task_id);tasks[at]={...tasks[at],title:body.title,notes:body.notes,due:body.due?body.due+'T00:00:00.000Z':null};return ok({ok:true,task:tasks[at]})}
    if(action==='link'){for(const l of body.links)taskLinks.push({google_task_id:body.task_id,...l,status:'confirmed'});return ok({ok:true,...linksOf(body.task_id)})}
    if(action==='unlink'){taskLinks=taskLinks.filter(l=>!(l.google_task_id===body.task_id&&body.links.some(x=>(x.project_id&&x.project_id===l.project_id)||(x.organization_id&&x.organization_id===l.organization_id))));return ok({ok:true,...linksOf(body.task_id)})}
    if(action==='toggle'){const at=tasks.findIndex(t=>t.id===body.task_id);tasks[at]={...tasks[at],status:body.completed?'completed':'needsAction',completed:body.completed?new Date(NOW).toISOString():null};return ok({ok:true,task:tasks[at]})}
    return ok({connected:true,authorized:true,needs_reconnect:false,tasks,pending_scope:'all'});
  });
  await page.evaluate(()=>window.KPTURouter.go('tasks'));
  await expect(page.locator('[data-gt-count]')).toHaveText(`할 일 ${tasks.filter(t=>t.status!=='completed').length}개`);
  // 입력창이 늦게 나타나면 아래 칸이 밀리므로, 배치를 재기 전에 입력창부터 기다린다.
  if(width>=1024)await expect(page.locator('#tasksView .home-quick [data-quick-input]')).toBeVisible();
  return calls;
}
const col=(page,id)=>page.locator(`#gtTaskBody [data-gt-col="${id}"]`);

for(const width of [1280,1440]){
  test(`PC ${width}: 수정 칸 기한 줄 빠른 버튼(내일·모레·다음주·기한 없음)은 누르면 바로 저장`,async({page})=>{
    const tasks=[task('a','2026-10-08')];
    const calls=await open(page,width,tasks);
    await page.locator('[data-gt-edit="a"]').click();
    const due=page.locator('#gtEditDue'),btns=page.locator('#gtTaskModal [data-gt-due-quick]');
    await expect(btns).toHaveText(['내일','모레','다음주','기한 없음']);
    const bd=await due.boundingBox(),b0=await btns.first().boundingBox();
    expect(bd.width).toBeLessThan(260);expect(b0.x).toBeGreaterThan(bd.x+bd.width-1);expect(Math.abs((b0.y+b0.height/2)-(bd.y+bd.height/2))).toBeLessThan(30);
    const last=()=>calls.filter(c=>c.action==='update').at(-1)?.body.due;
    for(const [name,want] of [['내일','2026-10-09'],['모레','2026-10-10'],['다음주','2026-10-15']]){
      const n=calls.filter(c=>c.action==='update').length;
      await page.locator('#gtTaskModal').getByRole('button',{name,exact:true}).click();
      await expect.poll(()=>calls.filter(c=>c.action==='update').length).toBe(n+1);
      expect(last()).toBe(want);await expect(due).toHaveValue(want);
    }
    const n=calls.filter(c=>c.action==='update').length;
    await page.locator('#gtTaskModal').getByRole('button',{name:'기한 없음',exact:true}).click();
    await expect.poll(()=>calls.filter(c=>c.action==='update').length).toBe(n+1);
    expect(last()).toBeNull();await expect(due).toHaveValue('');
  });

  test(`PC ${width}: 완료를 펼쳐도 위 칸은 줄지 않고 완료 목록은 아래로 이어지며 칸 안 스크롤은 없다`,async({page})=>{
    const tasks=[...Array.from({length:6},(_,i)=>task('n'+i,'2026-10-08')),...Array.from({length:6},(_,i)=>task('w'+i,'2026-10-10')),...Array.from({length:10},(_,i)=>task('d'+i,null,{status:'completed',completed:new Date(NOW).toISOString()}))];
    await open(page,width,tasks,{height:800});
    const h=async id=>(await col(page,id).boundingBox()).height;
    const [n0,w0]=[await h('now'),await h('week')];
    await col(page,'week').locator('#gtCompleted summary').click();
    await expect(col(page,'week').locator('[data-google-task="d9"]')).toBeVisible();
    const [n1,w1]=[await h('now'),await h('week')];
    expect(n1).toBeGreaterThanOrEqual(n0-1);expect(w1).toBeGreaterThan(w0+200);
    for(const id of ['now','week']){const sc=await col(page,id).locator('.gt-col-body').evaluate(e=>e.scrollHeight-e.clientHeight);expect(sc).toBeLessThanOrEqual(1)}
    const wk=await col(page,'week').boundingBox(),last=await col(page,'week').locator('[data-google-task="d9"]').boundingBox();
    expect(last.y+last.height).toBeLessThanOrEqual(wk.y+wk.height+1);
  });

  test(`PC ${width}: 기한별 열 2개 + 접기 줄, 건수, 빈 열 "없음", 지난 기한은 빨간 글자, 한 페이지`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const tasks=[task('late','2026-10-06'),task('today','2026-10-08'),task('soon','2026-10-10'),task('far','2026-10-30'),task('none'),task('done',null,{status:'completed',completed:new Date(NOW).toISOString()})];
    await open(page,width,tasks,{links:[{google_task_id:'today',project_id:'p1',status:'confirmed'},{google_task_id:'soon',organization_id:'o1',status:'confirmed'}]});
    await expect(page.locator('#gtTaskBody .gt-col-name')).toHaveText(['지남·오늘','일주일 안']);
    await expect(page.locator('#gtTaskBody [data-gt-col="later"]')).toHaveCount(0);
    await expect(page.locator('#gtTaskBody .gt-col-count')).toHaveText(['2','1']);
    // 지남·오늘: 지난 건이 먼저, 기한 글자는 빨강(지금 목록의 "기한 지남" 색과 같음).
    await expect(col(page,'now').locator('.gt-card')).toHaveCount(2);
    await expect(col(page,'now').locator('.gt-card').first()).toHaveAttribute('data-google-task','late');
    const danger=await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--kptu-danger').trim());
    const red=await col(page,'now').locator('[data-google-task="late"] .gt-due').evaluate(e=>getComputedStyle(e).color);
    const plain=await col(page,'now').locator('[data-google-task="today"] .gt-due').evaluate(e=>getComputedStyle(e).color);
    expect(red).not.toBe(plain);expect(danger).not.toBe('');
    // 카드 태그: 프로젝트·담당조직 이름.
    await expect(col(page,'now').locator('[data-google-task="today"] .gt-tag-project')).toHaveText('시험 프로젝트');
    await expect(col(page,'week').locator('[data-google-task="soon"] .gt-tag-org')).toHaveText('시험 조직');
    // "일주일 안" 열 맨 아래 접기 줄: "나중 2 ▸"(먼 기한 1 + 기한 없음 1)·"완료 1 ▸". 접힌 동안 항목은 안 보이고, 펼치면 모두 보인다.
    const later=col(page,'week').locator('#gtLater'),done=col(page,'week').locator('#gtCompleted');
    await expect(later.locator('summary')).toContainText('나중 2');await expect(done.locator('summary')).toContainText('완료 1');
    await expect(later).not.toHaveAttribute('open','');await expect(done).not.toHaveAttribute('open','');
    await expect(later.locator('[data-google-task="far"]')).toBeHidden();await expect(later.locator('[data-google-task="none"]')).toBeHidden();await expect(done.locator('[data-google-task="done"]')).toBeHidden();
    // 접기 줄은 열 안쪽 맨 아래(일주일 안 카드 뒤), 나중이 완료보다 먼저.
    const order=await col(page,'week').locator('.gt-col-body').evaluate(b=>[...b.children].map(e=>e.matches('ul[data-gt-week]')?'week':e.id));
    expect(order).toEqual(['week','gtLater','gtCompleted']);
    await later.locator('summary').click();await expect(later).toHaveAttribute('open','');
    await expect(later.locator('[data-gt-later] [data-google-task="far"]')).toBeVisible();
    await expect(later.locator('.gt-col-sub')).toHaveText('기한 없음 1');
    await expect(later.locator('[data-gt-undated] [data-google-task="none"]')).toBeVisible();
    await expect(page.locator('#gtTaskBody [data-google-task]:visible')).toHaveCount(5);
    await done.locator('summary').click();await expect(done).toHaveAttribute('open','');await expect(done.locator('[data-google-task="done"]')).toBeVisible();
    // 다시 접으면 다시 숨고, 항목은 목록에서 사라지지 않는다(DOM에 모두 있음).
    await later.locator('summary').click();await expect(later.locator('[data-google-task="far"]')).toBeHidden();
    await expect(page.locator('#gtTaskBody [data-google-task]')).toHaveCount(6);
    await expect(col(page,'now').locator('[data-gt-overdue] [data-google-task]')).toHaveCount(1);await expect(col(page,'now').locator('[data-gt-today] [data-google-task]')).toHaveCount(1);
    // 화면 전체는 한 페이지(세로·가로 넘김 없음), 입력 카드는 입력창 + [추가]만.
    const m=await page.evaluate(()=>({sh:document.documentElement.scrollHeight,ih:innerHeight,sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
    expect(m.sh).toBeLessThanOrEqual(m.ih+1);expect(m.sw).toBeLessThanOrEqual(m.cw+1);
    const quick=page.locator('#tasksView .home-quick');
    await expect(quick.locator('[data-quick-save]')).toHaveText('추가');await expect(quick.locator('[data-quick-input]')).toBeVisible();
    const qbox=await quick.boundingBox(),input=await quick.locator('[data-quick-input]').boundingBox();
    expect(qbox.height-input.height).toBeLessThanOrEqual(16);
    // 폰 묶음 목록은 PC에 없다.
    await expect(page.locator('#gtTaskBody > .gt-group')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`PC ${width}: 좌우 절반, 왼쪽 위·아래 칸(내용만큼 높이), 오른쪽 상세 칸은 왼쪽 위 칸과 같은 줄에서 시작해 맨 아래까지`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await open(page,width,[task('late','2026-10-06'),task('today','2026-10-08'),task('soon','2026-10-10'),task('far','2026-10-30')]);
    const box=l=>l.boundingBox();
    const now=await box(col(page,'now')),week=await box(col(page,'week')),pane=await box(page.locator('#gtDetailPane')),sec=await box(page.locator('#gtTaskSection'));
    // 좌 1/3 : 우 2/3(UI-좌우비율): 오른쪽 폭이 왼쪽의 2배(±3%), 왼쪽 두 칸 폭은 같고 사이에 틈만 있다.
    expect(Math.abs(week.width-now.width)).toBeLessThanOrEqual(1);expect(Math.abs(pane.width/now.width-2)).toBeLessThan(0.06);
    expect(Math.abs(now.x-sec.x)).toBeLessThanOrEqual(1);expect(pane.x-(now.x+now.width)).toBeGreaterThan(4);expect(pane.x-(now.x+now.width)).toBeLessThan(40);
    expect(Math.abs((pane.x+pane.width)-(sec.x+sec.width))).toBeLessThanOrEqual(1);
    // 왼쪽 위 칸이 위, 아래 칸이 그 밑. 오른쪽 칸 윗줄 = 왼쪽 위 칸 윗줄, 상세 칸은 왼쪽 아래 칸 밑줄까지 이어지거나 더 길다.
    expect(week.y).toBeGreaterThanOrEqual(now.y+now.height);
    expect(Math.abs(pane.y-now.y)).toBeLessThanOrEqual(1);
    expect(pane.y+pane.height).toBeGreaterThanOrEqual(week.y+week.height-1);
    // 상세 칸은 입력창 아래에서 시작(입력창과 겹치지 않음), 위로 튀어나오지 않는다.
    const quick=await box(page.locator('#tasksView .home-quick'));expect(pane.y).toBeGreaterThanOrEqual(quick.y+quick.height-1);
    // 왼쪽 위·아래 칸 높이는 항목 수에 맞게: 항목 둘뿐인 위 칸이 화면 절반보다 훨씬 작고, 칸 안 넘김이 없다.
    expect(now.height).toBeLessThan(pane.height/2);
    const fit=await page.evaluate(()=>['now','week'].map(id=>{const b=document.querySelector(`[data-gt-col="${id}"] .gt-col-body`);return b.scrollHeight-b.clientHeight}));
    expect(fit.every(d=>d<=1)).toBe(true);
    // 항목이 늘면 높이도 는다(위 칸 항목 하나 더 = 더 큼)은 아래 "많으면" 시험에서 칸 안 넘김으로 확인.
    expect(errors).toEqual([]);
  });

  test(`PC ${width}: 아무것도 안 골랐을 때 오른쪽 칸 안내 문구, 고르면 사라지고 닫으면 돌아옴`,async({page})=>{
    await open(page,width,[task('a','2026-10-08')]);
    const pane=page.locator('#gtDetailPane');
    await expect(pane.locator('.gt-pane-empty')).toHaveText('왼쪽에서 할 일을 고르면 여기서 고칠 수 있어요.');
    await expect(pane.locator('.gt-pane-empty')).toBeVisible();
    await page.locator('[data-gt-edit="a"]').click();await expect(pane.locator('#gtTaskModal')).toBeVisible();await expect(pane.locator('.gt-pane-empty')).toBeHidden();
    await pane.locator('[data-gt-close]').click();await expect(pane.locator('.gt-pane-empty')).toBeVisible();
  });

  test(`PC ${width}: 왼쪽 칸이 많으면 위·아래 칸이 내용만큼 늘어나고(칸 안 스크롤 없음) 페이지가 스크롤`,async({page})=>{
    const tasks=[...Array.from({length:14},(_,i)=>task('n'+i,'2026-10-08')),...Array.from({length:14},(_,i)=>task('w'+i,'2026-10-1'+(i%5)))];
    await open(page,width,tasks,{height:800});
    const now=await col(page,'now').boundingBox(),week=await col(page,'week').boundingBox(),pane=await page.locator('#gtDetailPane').boundingBox();
    expect(now.height).toBeGreaterThan(80);expect(week.height).toBeGreaterThan(80);
    expect(now.height).toBeGreaterThan(14*40);expect(week.height).toBeGreaterThan(14*40);
    for(const id of ['now','week']){const sc=await col(page,id).locator('.gt-col-body').evaluate(e=>({sh:e.scrollHeight,ch:e.clientHeight,oy:getComputedStyle(e).overflowY}));expect(sc.oy).not.toBe('auto');expect(sc.sh-sc.ch).toBeLessThanOrEqual(1)}
    const m=await page.evaluate(()=>({sh:document.documentElement.scrollHeight,ih:innerHeight}));expect(m.sh).toBeGreaterThan(m.ih+100);
  });

  test(`PC ${width}: 상세 칸의 프로젝트 체크 목록은 한 열(순서 그대로), 조직은 2열, 저장·닫기 제목 줄은 그대로`,async({page})=>{
    const projects=Array.from({length:6},(_,i)=>({...PROJECT,id:'p'+i,name:'프로젝트 '+i}));
    const orgs=Array.from({length:6},(_,i)=>({id:'o'+i,name:'조직 '+i,active:true}));
    await open(page,width,[task('a','2026-10-08')],{projects,orgs,height:900});
    const pane=page.locator('#gtDetailPane');
    await page.locator('[data-gt-edit="a"]').click();await expect(pane.locator('[data-gt-link]')).toHaveCount(12);
    const left=group=>pane.locator(`.gt-link-group[aria-label="${group}"] .gt-link-opt`).evaluateAll(es=>es.map(e=>({x:Math.round(e.getBoundingClientRect().left),y:Math.round(e.getBoundingClientRect().top),t:e.textContent.trim()})));
    const proj=await left('프로젝트');
    expect(proj.length).toBe(6);expect(new Set(proj.map(r=>r.x)).size).toBe(1);
    expect(proj.map(r=>r.t)).toEqual(Array.from({length:6},(_,i)=>'프로젝트 '+i));expect(proj.every((r,i)=>i===0||r.y>proj[i-1].y)).toBe(true);
    // 조직 묶음 안쪽은 2열(홀수 번째는 왼쪽 열, 짝수 번째는 오른쪽 열).
    const xs=(await left('조직')).map(r=>r.x);
    expect(xs.length).toBe(6);expect(new Set(xs).size).toBe(2);expect(xs.filter((_,i)=>i%2===0).every(x=>x===xs[0])).toBe(true);expect(xs[1]).toBeGreaterThan(xs[0]+100);
    // 상세 칸이 넓어졌으니 수정 내용도 칸 폭을 채운다(가운데 좁게 모이지 않음).
    const [pb,eb]=[await pane.boundingBox(),await pane.locator('#gtTaskModal .modal-card').boundingBox()];expect(eb.width).toBeGreaterThanOrEqual(pb.width-40);
    // 2열이어도 칸 밖으로 넘치지 않는다.
    const over=await pane.evaluate(e=>e.scrollWidth-e.clientWidth);expect(over).toBeLessThanOrEqual(1);
    expect(await pane.locator('#gtSaveBtn').evaluate(e=>e.parentElement.classList.contains('modal-head'))).toBe(true);
  });

  test(`PC ${width}: 빈 열은 "없음", 많으면 열이 늘어나고 칸 안 스크롤 없음`,async({page})=>{
    const tasks=Array.from({length:24},(_,i)=>task('w'+i,'2026-10-1'+(i%5)));
    await open(page,width,tasks);
    await expect(col(page,'now').locator('.gt-col-empty')).toHaveText('없음');
    await expect(col(page,'week').locator('.gt-col-count')).toHaveText('24');
    await expect(col(page,'week').locator('.gt-col-empty')).toHaveCount(0);
    const scroll=await col(page,'week').locator('.gt-col-body').evaluate(e=>({sh:e.scrollHeight,ch:e.clientHeight,oy:getComputedStyle(e).overflowY}));
    expect(scroll.oy).not.toBe('auto');expect(scroll.sh-scroll.ch).toBeLessThanOrEqual(1);
    const m=await page.evaluate(()=>({sh:document.documentElement.scrollHeight,ih:innerHeight}));
    expect(m.sh).toBeGreaterThan(m.ih);
  });

  test(`PC ${width}: 카드를 고르면 오른쪽 칸에서 바로 수정·저장, 선택 표시, 키보드`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const tasks=[task('a','2026-10-08',{notes:'첫 메모'}),task('b','2026-10-12')];
    const calls=await open(page,width,tasks,{links:[{google_task_id:'a',project_id:'p1',status:'confirmed'}]});
    const pane=page.locator('#gtDetailPane');
    await expect(pane).toBeVisible();await expect(pane.locator('.gt-pane-empty')).toBeVisible();await expect(page.locator('#gtTaskModal')).toBeHidden();
    // 키보드로 카드 고르기(제목 버튼 Enter).
    await page.locator('[data-gt-edit="a"]').focus();await page.keyboard.press('Enter');
    const editor=pane.locator('#gtTaskModal');
    await expect(editor).toBeVisible();await expect(page.locator('#gtEditTitle')).toBeFocused();
    await expect(page.locator('[data-google-task="a"]')).toHaveClass(/is-selected/);await expect(page.locator('[data-gt-edit="a"]')).toHaveAttribute('aria-current','true');
    // 팝업이 아니다: 화면을 덮지 않고 열·카드를 계속 누를 수 있다.
    expect(await editor.evaluate(e=>({role:e.getAttribute('role'),modal:e.getAttribute('aria-modal'),pos:getComputedStyle(e).position}))).toEqual({role:'region',modal:null,pos:'static'});
    // 지금 수정 창과 같은 항목: 할 일·기한·메모·프로젝트·조직 연결.
    await expect(page.locator('#gtEditDue')).toHaveValue('2026-10-08');await expect(page.locator('#gtEditNotes')).toHaveValue('첫 메모');
    await expect(pane.locator('[data-gt-link][value="p:p1"]')).toBeChecked();await expect(pane.locator('[data-gt-link][value="o:o1"]')).not.toBeChecked();
    // 바로 수정 → 저장(같은 update·link·unlink 경로). 칸은 열린 채 "저장했습니다."
    await page.locator('#gtEditDue').fill('2026-10-12');await page.locator('#gtEditNotes').fill('고친 메모');
    await pane.locator('[data-gt-link][value="o:o1"]').check();await pane.locator('[data-gt-link][value="p:p1"]').uncheck();
    await pane.locator('#gtSaveBtn').click();
    await expect(page.locator('#gtEditStatus')).toHaveText('저장했습니다.');
    const update=calls.find(c=>c.action==='update');
    expect(update.body).toMatchObject({action:'update',task_id:'a',title:'할 일 a',notes:'고친 메모',due:'2026-10-12'});
    expect(calls.find(c=>c.action==='link').body.links).toEqual([{organization_id:'o1'}]);
    expect(calls.find(c=>c.action==='unlink').body.links).toEqual([{project_id:'p1'}]);
    expect(calls.some(c=>c.action==='create')).toBe(false);
    // 다시 읽은 목록에서 카드가 "일주일 안"으로 옮겨지고 선택은 유지된다.
    await expect(col(page,'week').locator('[data-google-task="a"]')).toHaveClass(/is-selected/);
    await expect(editor).toBeVisible();
    // 다른 카드를 누르면 그 할 일로 바뀐다.
    await page.locator('[data-gt-edit="b"]').click();await expect(page.locator('#gtEditTitle')).toHaveValue('할 일 b');
    await expect(page.locator('[data-google-task="b"]')).toHaveClass(/is-selected/);await expect(page.locator('[data-google-task="a"]')).not.toHaveClass(/is-selected/);
    // Esc로 칸을 닫으면 그 카드로 초점이 돌아간다.
    await page.locator('#gtEditTitle').focus();await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();await expect(pane.locator('.gt-pane-empty')).toBeVisible();
    await expect(page.locator('[data-gt-edit="b"]')).toBeFocused();await expect(page.locator('.gt-card.is-selected')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`PC ${width}: "일주일 안"이 비어도 나중·완료 접기 줄은 남고, 펼친 항목은 다시 그려도 유지`,async({page})=>{
    const tasks=[task('far','2026-10-30'),task('none'),task('done',null,{status:'completed',completed:new Date(NOW).toISOString()})];
    await open(page,width,tasks);
    await expect(col(page,'week').locator('.gt-col-empty')).toHaveText('없음');await expect(col(page,'week').locator('.gt-col-count')).toHaveText('0');
    const later=col(page,'week').locator('#gtLater');
    await expect(later.locator('summary')).toContainText('나중 2');await expect(col(page,'week').locator('#gtCompleted summary')).toContainText('완료 1');
    await later.locator('summary').click();
    await expect(later.locator('[data-google-task="far"]')).toBeVisible();await expect(later.locator('[data-google-task="none"]')).toBeVisible();
    // 펼친 줄의 카드를 고르면(= 다시 읽어 그려도) 접기 줄은 펼친 채 유지, 카드는 선택 표시.
    await later.locator('[data-gt-edit="far"]').click();
    await expect(page.locator('#gtEditTitle')).toHaveValue('할 일 far');
    await expect(later).toHaveAttribute('open','');await expect(later.locator('[data-google-task="far"]')).toHaveClass(/is-selected/);
  });

  test(`PC ${width}: 연결 목록이 길어도 [저장]은 처음부터 제목 줄에 보이고, 스크롤해도 고정, 누르면 저장`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const projects=Array.from({length:40},(_,i)=>({...PROJECT,id:'p'+i,name:'긴 목록 프로젝트 '+i}));
    const orgs=Array.from({length:30},(_,i)=>({id:'o'+i,name:'긴 목록 조직 '+i,active:true}));
    const tasks=[task('a','2026-10-08',{notes:'메모'})];
    const calls=await open(page,width,tasks,{projects,orgs,height:700});
    const pane=page.locator('#gtDetailPane'),save=pane.locator('#gtSaveBtn'),close=pane.locator('[data-gt-close]'),status=pane.locator('#gtEditStatus');
    await page.locator('[data-gt-edit="a"]').click();
    await expect(pane.locator('[data-gt-link]')).toHaveCount(70);
    await expect(save).toBeEnabled();
    // 연결 목록이 길어 칸은 실제로 세로로 넘친다.
    const over=await pane.evaluate(e=>({sh:e.scrollHeight,ch:e.clientHeight}));expect(over.sh).toBeGreaterThan(over.ch*2);
    // 저장은 제목 줄(닫기 X 왼쪽)에 있고 처음부터 화면 안에 있다. 맨 아래 줄에는 없다.
    await expect(save).toBeInViewport();
    expect(await save.evaluate(e=>e.parentElement.classList.contains('modal-head'))).toBe(true);
    await expect(pane.locator('.modal-action-footer #gtSaveBtn')).toHaveCount(0);
    const head=async()=>({pane:await pane.boundingBox(),save:await save.boundingBox(),close:await close.boundingBox(),head:await pane.locator('.modal-head').boundingBox()});
    const first=await head();
    expect(first.save.y-first.pane.y).toBeLessThan(80);expect(first.save.x+first.save.width).toBeLessThanOrEqual(first.close.x+1);
    // 맨 아래까지 스크롤해도 제목 줄(저장·닫기)은 칸 맨 위에 그대로.
    await pane.evaluate(e=>{e.scrollTop=e.scrollHeight});
    expect(await pane.evaluate(e=>e.scrollTop)).toBeGreaterThan(200);
    const last=await head();
    expect(Math.abs(last.head.y-last.pane.y)).toBeLessThanOrEqual(2);expect(Math.abs(last.save.y-first.save.y)).toBeLessThanOrEqual(2);
    await expect(save).toBeInViewport();await expect(close).toBeInViewport();
    // 스크롤한 채로 저장 → 같은 update 경로, 안내("저장했습니다.")도 제목 줄 안에서 보인다.
    await pane.locator('#gtEditTitle').evaluate(e=>{e.value='고친 제목';e.dispatchEvent(new Event('input',{bubbles:true}))});
    await save.click();
    await expect(status).toHaveText('저장했습니다.');await expect(status).toBeInViewport();
    expect(await status.evaluate(e=>e.parentElement.classList.contains('modal-head'))).toBe(true);
    expect(calls.find(c=>c.action==='update').body).toMatchObject({task_id:'a',title:'고친 제목'});
    expect(errors).toEqual([]);
  });

  test(`PC ${width}: 저장 오류 안내도 제목 줄 근처에 보이고 입력은 유지`,async({page})=>{
    const projects=Array.from({length:40},(_,i)=>({...PROJECT,id:'p'+i,name:'긴 목록 프로젝트 '+i}));
    const tasks=[task('a','2026-10-08')];
    await open(page,width,tasks,{projects,height:700});
    await page.route('**/functions/v1/google-tasks**',async route=>{
      if(new URL(route.request().url()).searchParams.get('action')==='update')return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'시험 오류'})});
      return route.fallback();
    });
    const pane=page.locator('#gtDetailPane');
    await page.locator('[data-gt-edit="a"]').click();await expect(pane.locator('[data-gt-link]')).toHaveCount(41);await expect(pane.locator('#gtSaveBtn')).toBeEnabled();
    await pane.evaluate(e=>{e.scrollTop=e.scrollHeight});
    await pane.locator('#gtEditTitle').evaluate(e=>{e.value='바꾼 제목';e.dispatchEvent(new Event('input',{bubbles:true}))});
    await pane.locator('#gtSaveBtn').click();
    const status=pane.locator('#gtEditStatus');
    await expect(status).not.toBeEmpty();await expect(status).not.toHaveText('저장했습니다.');await expect(status).toBeInViewport();
    const [p,st]=[await pane.boundingBox(),await status.boundingBox()];expect(st.y-p.y).toBeLessThan(120);
    await expect(pane.locator('#gtEditTitle')).toHaveValue('바꾼 제목');await expect(pane.locator('#gtSaveBtn')).toBeEnabled();
  });

  test(`PC ${width}: 카드의 완료 동그라미는 지금 완료 경로(toggle)`,async({page})=>{
    const tasks=[task('a','2026-10-08')];const calls=await open(page,width,tasks);
    await page.locator('[data-gt-toggle="a"]').click();
    await expect.poll(()=>calls.filter(c=>c.action==='toggle').map(c=>c.body.completed)).toEqual([true]);
    const done=col(page,'week').locator('#gtCompleted');
    await expect(done.locator('summary')).toContainText('완료 1',{timeout:6000});
    await expect(col(page,'now').locator('.gt-col-empty')).toHaveText('없음');
  });
}

test('폰 390: 지금 묶음 목록·수정 창 그대로(열·상세 칸 없음)',async({page})=>{
  const tasks=[task('late','2026-10-06'),task('today','2026-10-08'),task('far','2026-10-30')];
  await open(page,390,tasks);
  await expect(page.locator('#gtTaskBody .gt-cols')).toHaveCount(0);await expect(page.locator('#gtDetailPane')).toBeHidden();
  expect(await page.locator('#gtTaskBody>.gt-group .gt-group-head').allTextContents()).toEqual(['기한 지남 1','오늘 1','나중 1']);
  await page.locator('[data-gt-edit="today"]').click();
  const modal=page.locator('#gtTaskModal');await expect(modal).toBeVisible();
  expect(await modal.evaluate(e=>({parent:e.parentElement.tagName,role:e.getAttribute('role'),pos:getComputedStyle(e).position}))).toEqual({parent:'BODY',role:'dialog',pos:'fixed'});
  // 폰 팝업: [저장]·안내는 그대로 맨 아래 줄(footer)에 있다(제목 줄로 옮기는 것은 PC 상세 칸만).
  // UI-팝업머리고정: 제목 줄은 모든 창에서 위에 고정(sticky)이다. 저장 위치는 바뀌지 않는다.
  expect(await modal.evaluate(e=>({save:e.querySelector('#gtSaveBtn').closest('.modal-action-footer')!==null,status:e.querySelector('#gtEditStatus').parentElement.classList.contains('modal-action-footer'),headSave:e.querySelector('.modal-head #gtSaveBtn')!==null,sticky:getComputedStyle(e.querySelector('.modal-head')).position}))).toEqual({save:true,status:true,headSave:false,sticky:'sticky'});
  await page.locator('[data-gt-close]').click();await expect(modal).toBeHidden();
});

test('중간 폭 900: 열·상세 칸 없이 묶음 목록, 수정 창 [저장]은 맨 아래 줄 그대로',async({page})=>{
  await open(page,900,[task('today','2026-10-08')]);
  await expect(page.locator('#gtTaskBody .gt-cols')).toHaveCount(0);await expect(page.locator('#gtDetailPane')).toBeHidden();
  await page.locator('[data-gt-edit="today"]').click();
  const modal=page.locator('#gtTaskModal');await expect(modal).toBeVisible();
  expect(await modal.evaluate(e=>({parent:e.parentElement.tagName,save:e.querySelector('#gtSaveBtn').closest('.modal-action-footer')!==null}))).toEqual({parent:'BODY',save:true});
});

test('PC에서 열었다 닫은 뒤 폭을 좁히면 [저장]이 팝업 맨 아래 줄로 돌아온다',async({page})=>{
  await open(page,1280,[task('a','2026-10-08')]);
  await page.locator('[data-gt-edit="a"]').click();await expect(page.locator('#gtDetailPane .modal-head #gtSaveBtn')).toHaveCount(1);
  await page.locator('#gtDetailPane [data-gt-close]').click();await expect(page.locator('#gtDetailPane .gt-pane-empty')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-gt-edit="a"]').click();
  const modal=page.locator('#gtTaskModal');await expect(modal).toBeVisible();
  expect(await modal.evaluate(e=>({footerSave:e.querySelector('.modal-action-footer #gtSaveBtn')!==null,footerStatus:e.querySelector('.modal-action-footer #gtEditStatus')!==null,cls:e.querySelector('#gtSaveBtn').classList.contains('gt-pane-save')}))).toEqual({footerSave:true,footerStatus:true,cls:false});
});

test('PC: 하위 프로젝트는 상위 바로 아래 한 줄씩 들여쓰기(3단이면 한 단 더), 순서는 프로젝트 순서 그대로',async({page})=>{
  const P=(id,name,parent)=>({...PROJECT,id,name,parent_id:parent||null,sort_order:Number(id.slice(1))*10});
  const projects=[P('p1','합성 상위'),P('p2','합성 하위','p1'),P('p3','합성 하위의 하위','p2'),P('p4','합성 다른 상위')];
  await open(page,1280,[task('a','2026-10-08')],{projects,height:900});
  await page.locator('[data-gt-edit="a"]').click();
  const opts=page.locator('#gtDetailPane .gt-link-group[aria-label="프로젝트"] .gt-link-opt');await expect(opts).toHaveCount(4);
  const rows=await opts.evaluateAll(es=>es.map(e=>({t:e.querySelector('span').textContent.replace(/[↳\s]/g,''),x:Math.round(e.querySelector('input').getBoundingClientRect().left),y:Math.round(e.getBoundingClientRect().top)})));
  expect(rows.map(r=>r.t)).toEqual(['합성상위','합성하위','합성하위의하위','합성다른상위']);
  expect(rows[1].x).toBeGreaterThan(rows[0].x+8);expect(rows[2].x).toBeGreaterThan(rows[1].x+8);expect(rows[3].x).toBe(rows[0].x);
  expect(rows.every((r,i)=>i===0||r.y>rows[i-1].y)).toBe(true);
});

test('PC 1024(좁은 PC): 좌 1/3 : 우 2/3(왼쪽 최소 폭 안), 체크 목록 1열, 가로 넘김 없음',async({page})=>{
  const projects=Array.from({length:4},(_,i)=>({...PROJECT,id:'p'+i,name:'프로젝트 '+i}));
  await open(page,1024,[task('a','2026-10-08'),task('b','2026-10-12')],{projects,height:768});
  const now=await col(page,'now').boundingBox(),pane=await page.locator('#gtDetailPane').boundingBox();
  expect(Math.abs(pane.width/now.width-2)).toBeLessThan(0.15);expect(now.width).toBeGreaterThanOrEqual(239);expect(Math.abs(pane.y-now.y)).toBeLessThanOrEqual(1);
  await page.locator('[data-gt-edit="a"]').click();await expect(page.locator('#gtDetailPane [data-gt-link]')).toHaveCount(5);
  const xs=await page.locator('#gtDetailPane .gt-link-group[aria-label="프로젝트"] .gt-link-opt').evaluateAll(es=>es.map(e=>Math.round(e.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBe(1);
  const m=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,sh:document.documentElement.scrollHeight,ih:innerHeight}));
  expect(m.sw).toBeLessThanOrEqual(m.cw+1);expect(m.sh).toBeLessThanOrEqual(m.ih+1);
  const pw=await page.locator('#gtDetailPane').evaluate(e=>e.scrollWidth-e.clientWidth);expect(pw).toBeLessThanOrEqual(1);
});
