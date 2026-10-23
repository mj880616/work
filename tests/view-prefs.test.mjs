import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewPrefs,parsePrefs,applyChanges,validValue} from '../app/view-prefs.js';

// SET-보기선택서버저장: 서버 저장소(프로필 view_prefs)·기기 값 옮기기·모아 쓰기·실패 시 기본값.
const OWNER='u1';
function env({server=null,status=0,legacy={},patchFail=false}={}){
  const calls=[];let row=server;const store=new Map(Object.entries(legacy));
  const rt={context:{read:()=>({user:{id:OWNER}})},ownerCache:{prefix:'kptu_owner_cache:'},
    api:async(path,opts={})=>{calls.push({path,method:opts.method||'GET',body:opts.body});
      if(status){const e=new Error('x');e.status=status;throw e}
      if((opts.method||'GET')==='PATCH'){if(patchFail){const e=new Error('x');e.status=500;throw e}row=opts.body.view_prefs;return [{user_id:OWNER}]}
      return [{view_prefs:row}]}};
  const timers=[];
  const api=createViewPrefs({runtime:()=>rt,storage:()=>({getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}),
    setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimer:id=>{if(timers[id-1])timers[id-1].fn=null},delay:1,retryDelay:2,loadTimeout:50});
  const fire=async()=>{for(const t of timers.splice(0)){if(t.fn&&t.ms<50)await t.fn()}};
  return {api,calls,store,fire,get row(){return row}};
}
test('parse keeps valid keys only and drops bad ones one by one',()=>{
  assert.deepEqual(parsePrefs(null),{});assert.deepEqual(parsePrefs([]),{});
  assert.deepEqual(parsePrefs({theme:'navy',calendar_view:'day',extra:1,nav_collapsed:'1',split_ratio:{tasks:0.4,projects:2,x:0.3}}),{theme:'navy',split_ratio:{tasks:0.4}});
  assert.ok(validValue('note_folder','f:자료')&&validValue('note_folder','all')&&!validValue('note_folder','f:')&&!validValue('note_folder','f:'+'가'.repeat(21)));
  assert.ok(validValue('collect_hidden_on','2026-10-23')&&!validValue('collect_hidden_on','오늘'));
  assert.deepEqual(applyChanges({split_ratio:{tasks:0.4}},{'split_ratio.tasks':null,theme:'sand'}),{theme:'sand'});
});
test('reads the server value; a missing column or failure means defaults and keeps device values',async()=>{
  const a=env({server:{theme:'navy',split_ratio:{team:0.5}}});assert.equal(await a.api.load(),'ok');
  assert.equal(a.api.get('theme'),'navy');assert.equal(a.api.getSplit('team'),0.5);assert.equal(a.api.get('calendar_view'),undefined);
  for(const status of [400,500]){const b=env({status,legacy:{'kptu-theme':'sand'}});await b.api.load();
    assert.equal(b.api.status(),status===400?'pending':'error');assert.equal(b.api.get('theme'),undefined);assert.equal(b.store.get('kptu-theme'),'sand');assert.equal(b.calls.filter(c=>c.method==='PATCH').length,0)}
});
test('device values move once to the server, then are removed; the server wins when it has a value',async()=>{
  const e=env({server:{calendar_view:'list'},legacy:{'kptu-theme':'terracotta','kptu-calendar-view':'month','kptu-nav-collapsed':'1','kptu-split-ratio:tasks':'0.4','kptu-split-ratio:projects':'7','kptu_owner_cache:note-folder-v1:u1':'f:자료','kptu_owner_cache:collect-alert-hidden-v1:u1':'2026-10-23','kptu-home-quick-mode':'basket'}});
  await e.api.load();
  assert.equal(e.api.get('theme'),'terracotta');assert.equal(e.api.get('calendar_view'),'list');
  assert.equal(e.store.has('kptu-calendar-view'),false,'server value wins and device value is removed');
  assert.equal(e.store.has('kptu-home-quick-mode'),false,'unusable device value removed');assert.equal(e.store.has('kptu-split-ratio:projects'),false);
  assert.equal(e.store.get('kptu-theme'),'terracotta','kept until the server has it');
  await e.fire();await e.api.flush();
  assert.deepEqual(e.row,{calendar_view:'list',theme:'terracotta',nav_collapsed:true,split_ratio:{tasks:0.4},note_folder:'f:자료',collect_hidden_on:'2026-10-23'});
  assert.deepEqual([...e.store.keys()],[],'every moved key removed after the write');
  assert.equal(e.calls.filter(c=>c.method==='PATCH').length,1);
});
test('quick changes make one write that merges with the latest server value',async()=>{
  const e=env({server:{theme:'olive'}});await e.api.load();
  e.api.set('calendar_view','week');e.api.set('calendar_view','month');e.api.setSplit('tasks',0.3);e.api.set('nav_collapsed',true);
  assert.equal(e.calls.filter(c=>c.method==='PATCH').length,0);
  await e.fire();await e.api.flush();
  assert.equal(e.calls.filter(c=>c.method==='PATCH').length,1);
  assert.deepEqual(e.row,{theme:'olive',calendar_view:'month',split_ratio:{tasks:0.3},nav_collapsed:true});
  assert.equal(e.api.set('theme','dark'),false);assert.equal(e.api.setSplit('meetings',0.3),false);assert.equal(e.api.setSplit('tasks',1),false);
  e.api.setSplit('tasks',null);e.api.set('nav_collapsed',null);await e.api.flush();
  assert.deepEqual(e.row,{theme:'olive',calendar_view:'month'});
});
test('a failed write keeps the screen value and tries again once',async()=>{
  const e=env({patchFail:true});await e.api.load();e.api.set('theme','navy');
  await e.api.flush();assert.equal(e.api.get('theme'),'navy');assert.equal(e.row,null);
});
test('leaving the page sends pending changes at once on top of the last known server value',async()=>{
  const e=env({server:{theme:'olive'}});await e.api.load();
  e.api.set('calendar_view','month');
  await e.api.flushHidden();
  assert.deepEqual(e.row,{theme:'olive',calendar_view:'month'});
  assert.equal(e.calls.filter(c=>c.method==='PATCH').length,1);
  await e.api.flush();assert.equal(e.calls.filter(c=>c.method==='PATCH').length,1,'nothing left to send');
});
