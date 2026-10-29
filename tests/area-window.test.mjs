// MTG-프로젝트합치기 ①③: 사업영역 관리 창(area-window.js)·'사업영역 안 단 보고 n건 [달기]' 줄의 규칙과 연결 전수(정적 검사).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {untaggedInWeek,presetArea} from '../app/business-area-model.mjs';

const read=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');

test('③ 보고 있는 주 안의 일시 있는 보고 중 사업영역을 직접 안 단 것만(한 줄 업데이트·옛 서버 줄·일시 없음 제외), 오래된 것부터',()=>{
  const ms=[
    {id:'a',business_area_id:null,meeting_at:'2026-10-28T01:00:00Z'},
    {id:'b',business_area_id:'area-1',meeting_at:'2026-10-27T01:00:00Z'},
    {id:'c',meeting_at:'2026-10-27T01:00:00Z'},
    {id:'d',business_area_id:null,meeting_at:null},
    {id:'e',business_area_id:null,activity_kind:'oneline',meeting_at:'2026-10-28T01:00:00Z'},
    {id:'f',business_area_id:'',project_id:'p-1',meeting_at:'2026-10-26T00:30:00Z'},
    {id:'g',business_area_id:null,meeting_at:'2026-11-02T01:00:00Z'}
  ];
  assert.deepEqual(untaggedInWeek(ms,'2026-10-26').map(m=>m.id),['f','a']);
  assert.deepEqual(untaggedInWeek(ms,'2026-11-02').map(m=>m.id),['g']);
  assert.deepEqual(untaggedInWeek(ms,'2026-10-19'),[]);
  assert.deepEqual(untaggedInWeek(ms,null),[]);
});

test('③ 미리 고르기: 첫 연결 사업영역 → AI 첫 추천 → 고르기(목록에 없는 id는 쓰지 않음)',()=>{
  const known=id=>['p-1','x-1'].includes(id);
  assert.deepEqual(presetArea({project_id:'p-1'},'x-1',known),{id:'p-1',from:'link'});
  assert.deepEqual(presetArea({project_id:'gone'},'x-1',known),{id:'x-1',from:'ai'});
  assert.deepEqual(presetArea({},'nope',known),{id:'',from:''});
  assert.deepEqual(presetArea({},'',known),{id:'',from:''});
});

test('① 사업영역 관리는 화면이 아니라 사업 보고 위 공용 .modal 창이고, 안의 목록 칸은 그대로 한 곳',()=>{
  const html=read('index.html');
  assert.match(html,/<div id="areaWindow" class="modal hidden area-window" role="dialog" aria-modal="true"/);
  assert.doesNotMatch(html,/id="projectsView" class="view-panel/);
  const win=html.slice(html.indexOf('id="areaWindow"'),html.indexOf('id="libraryView"'));
  for(const id of ['projectsView','projectGrid','newProjectBtn'])assert.ok(win.includes(`id="${id}"`),id);
  assert.equal((html.match(/id="projectGrid"/g)||[]).length,1);
  assert.match(win,/data-close="areaWindow"[^>]*>.*사업 보고/);
});

test('① 옛 주소·go(projects)는 사업 보고 + 창(detail.areas), 화면 이름 projects는 없다',()=>{
  const router=read('app-router.js');
  assert.match(router,/VIEW_ALIAS=\{[^}]*projects:'meetings'/);
  assert.match(router,/if\(view==='projects'\)areas=true/);
  assert.match(router,/params\.get\('project'\)&&viewExists\('meetings'\)\)return 'meetings'/);
  const loader=read('loader-v2.js');
  assert.doesNotMatch(loader,/staticShellViews=new Set\(\[[^\]]*'projects'/);
  assert.match(loader,/areasAtStart\?'meetings'/);
  assert.match(loader,/KPTUAreaWindow\?\.open\(\{id:params\.get\('project'\)/);
  const ps=read('project-system-v3.js');
  assert.doesNotMatch(ps,/KPTURouter[^;]{0,40}current==='projects'/);
  assert.doesNotMatch(ps,/KPTURouter\.on\('projects'/);
  assert.match(ps,/window\.KPTUProjects=\{open:openProject,shown:onProjectsView,hide:hideProjects,place:placeDetail,back:onBack\}/);
  // 상세의 뒤로가기(저장 안 한 글 묻기)는 공용 폰 기록보다 먼저: 시작할 때 붙는 창 그릇의 popstate가 맨 앞에서 부르고, 상세 묶음은 따로 붙이지 않는다.
  const aw=read('area-window.js');
  assert.match(aw,/addEventListener\('popstate',e=>\{\n(?:.*\n){0,2}\s*window\.KPTUProjects\?\.back\?\.\(e\);if\(e\.cancelBubble/);
  assert.doesNotMatch(ps,/addEventListener\('popstate',event=>\{\n\s*const id=new URLSearchParams/);
});

test('① 다른 곳의 사업영역 연결은 모두 KPTUAreaWindow.open 하나로 연다',()=>{
  const opens={
    'team.js':/\[data-report-areas\]'\)\)return void window\.KPTUAreaWindow\?\.open\?\.\(/,
    'basket.js':/if \(project\) await window\.KPTUAreaWindow\.open\(\{ id: link\.project_id \}\)/,
    'home-read.js':/KPTUAreaWindow\.open\(\{ id: b\.dataset\.homeProject \}\)/,
    'todo-radar.js':/KPTUAreaWindow\.open\(\{id: c\.project_id\}\)/,
    'global-search.js':/target\.view === 'projects'\) await window\.KPTUAreaWindow\?\.open\?\.\(\{id: target\.id\}\)/,
    'ledger-browse.js':/target\.view === 'projects'\) await window\.KPTUAreaWindow\?\.open\?\.\(\{ id: target\.id \}\)/,
    'journal.js':/window\.KPTUAreaWindow\.open\(\{ id: target\.project, trigger \}\)/
  };
  for(const [file,re] of Object.entries(opens))assert.match(read(file),re,file);
  for(const file of Object.keys(opens))assert.doesNotMatch(read(file),/KPTUProjects\.open\(|go\('projects'|openView\?\.\('projects'\)/,file);
  const bnt=read('basket-note-tasks.js');
  assert.match(bnt,/ORIGIN_SCREEN=\{projects:'meetings'\}/);
});

test('③ 줄은 team.js 한 곳이 그리고, [달기] 저장은 기존 app_meetings PATCH로 business_area_id·updated_at만',()=>{
  const team=read('team.js');
  assert.match(team,/function paintUntagged\(\)\{const line=\$\('#areaUntaggedLine'\)/);
  assert.match(team,/renderReportWeek\(\);paintUntagged\(\);/);
  const tag=read('report-area-tag.js');
  assert.match(tag,/method:'PATCH',body:\{business_area_id:areaId,updated_at:new Date\(\)\.toISOString\(\)\}/);
  assert.match(tag,/kind:'area_suggest'/);
  assert.match(read('index.html'),/<div id="areaUntaggedLine" class="area-untagged" hidden><\/div>/);
});
