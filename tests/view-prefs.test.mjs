import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewPrefs,parsePrefs,applyChanges,validValue,THEMES} from '../app/view-prefs.js';

// SET-보기선택서버저장: 서버 저장소(프로필 view_prefs)·기기 값 옮기기·모아 쓰기·실패 시 기본값.
const OWNER='u1';
function env({server=null,status=0,legacy={},patchFail=false,oldCheck=false}={}){
  const calls=[];let row=server;const store=new Map(Object.entries(legacy));
  const rt={context:{read:()=>({user:{id:OWNER}})},ownerCache:{prefix:'kptu_owner_cache:'},
    api:async(path,opts={})=>{calls.push({path,method:opts.method||'GET',body:opts.body});
      if(status){const e=new Error('x');e.status=status;throw e}
      if((opts.method||'GET')==='PATCH'){if(oldCheck&&!['olive','navy','terracotta','sand','mugwort','lavender','ink','rose','teal','mustard',undefined].includes(opts.body.view_prefs?.theme)){const e=new Error('check');e.status=400;throw e}if(patchFail){const e=new Error('x');e.status=500;throw e}row=opts.body.view_prefs;return [{user_id:OWNER}]}
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
  assert.deepEqual(applyChanges({split_ratio:{tasks:0.4}},{'split_ratio.tasks':null,theme:'ink'}),{theme:'ink'});
});
test('reads the server value; a missing column or failure means defaults and keeps device values',async()=>{
  const a=env({server:{theme:'navy',split_ratio:{team:0.5}}});assert.equal(await a.api.load(),'ok');
  assert.equal(a.api.get('theme'),'navy');assert.equal(a.api.getSplit('team'),0.5);assert.equal(a.api.get('calendar_view'),undefined);
  for(const status of [400,500]){const b=env({status,legacy:{'kptu-theme':'ink'}});await b.api.load();
    assert.equal(b.api.status(),status===400?'pending':'error');assert.equal(b.api.get('theme'),undefined);assert.equal(b.store.get('kptu-theme'),'ink');assert.equal(b.calls.filter(c=>c.method==='PATCH').length,0)}
});
test('device values move once to the server, then are removed; the server wins when it has a value',async()=>{
  const e=env({server:{calendar_view:'list'},legacy:{'kptu-theme':'lavender','kptu-calendar-view':'month','kptu-nav-collapsed':'1','kptu-split-ratio:tasks':'0.4','kptu-split-ratio:projects':'7','kptu_owner_cache:note-folder-v1:u1':'f:자료','kptu_owner_cache:collect-alert-hidden-v1:u1':'2026-10-23','kptu-home-quick-mode':'basket'}});
  await e.api.load();
  assert.equal(e.api.get('theme'),'lavender');assert.equal(e.api.get('calendar_view'),'list');
  assert.equal(e.store.has('kptu-calendar-view'),false,'server value wins and device value is removed');
  assert.equal(e.store.has('kptu-home-quick-mode'),false,'unusable device value removed');assert.equal(e.store.has('kptu-split-ratio:projects'),false);
  assert.equal(e.store.get('kptu-theme'),'lavender','kept until the server has it');
  await e.fire();await e.api.flush();
  assert.deepEqual(e.row,{calendar_view:'list',theme:'lavender',nav_collapsed:true,split_ratio:{tasks:0.4},note_folder:'f:자료',collect_hidden_on:'2026-10-23'});
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

// UI-화면색10·재정리: 허용 목록은 THEMES 한 곳, 서버 검사가 새 색을 거절하면(DB 적용 전) 그 칸만 되돌리고 알린다.
test('all ten colors are accepted, anything else is not',()=>{
  assert.equal(THEMES.length,10);assert.equal(new Set(THEMES).size,10);
  for(const t of THEMES){assert.ok(validValue('theme',t),t);assert.deepEqual(parsePrefs({theme:t}),{theme:t})}
  for(const t of ['dark','Olive','','red ',null,5,['red']])assert.equal(validValue('theme',t),false,String(t));
});
test('colors taken out in the refresh are not allowed; a server value with one shows the default and the other fields are kept',()=>{
  assert.deepEqual([...THEMES],['olive','navy','ink','lavender','teal','sky','mint','coral','lemon','red']);
  for(const t of ['terracotta','sand','mugwort','rose','mustard']){assert.equal(validValue('theme',t),false,t);assert.deepEqual(parsePrefs({theme:t,calendar_view:'month'}),{calendar_view:'month'},t)}
});
test('a saved removed color does not come back when another field is saved',async()=>{
  const e=env({server:{theme:'rose',nav_collapsed:true}});await e.api.load();
  assert.equal(e.api.get('theme'),undefined,'default color');
  e.api.set('calendar_view','week');await e.api.flush();
  assert.deepEqual(e.row,{nav_collapsed:true,calendar_view:'week'},'the removed value is not written back');
});
test('a color the server check refuses goes back to the old value and is announced; other changes are kept',async()=>{
  const heard=[];const had=globalThis.window;
  globalThis.window={dispatchEvent:event=>{heard.push([event.type,event.detail]);return true}};
  try{
    const e=env({server:{theme:'navy'},oldCheck:true});await e.api.load();heard.length=0;
    e.api.set('theme','sky',{rejectable:true});e.api.set('nav_collapsed',true);
    assert.equal(e.api.get('theme'),'sky','the screen shows the new color first');
    await e.api.flush();
    assert.equal(e.api.get('theme'),'navy','back to the value the server knows');
    assert.deepEqual(heard.find(h=>h[0]==='kptu:view-prefs-rejected')?.[1],{paths:['theme']});
    assert.deepEqual(e.row,{theme:'navy',nav_collapsed:true},'the other change was still saved');
    assert.equal(e.api.status(),'ok','later saves still work');
    e.api.set('theme','ink',{rejectable:true});await e.api.flush();
    assert.equal(e.api.get('theme'),'ink');assert.deepEqual(e.row,{theme:'ink',nav_collapsed:true});
    // A refusal for a field that did not ask for the notice keeps the old quiet behavior (no revert, no announcement).
    heard.length=0;const q=env({server:{},oldCheck:true});await q.api.load();
    q.api.set('theme','mint');await q.api.flush();
    assert.equal(q.api.get('theme'),'mint');assert.equal(q.api.status(),'pending');assert.equal(heard.some(h=>h[0]==='kptu:view-prefs-rejected'),false);
  }finally{if(had===undefined)delete globalThis.window;else globalThis.window=had}
});
test('a newer choice made while the refusal was on its way is not undone',async()=>{
  const heard=[];const had=globalThis.window;
  globalThis.window={dispatchEvent:event=>{heard.push(event.type);return true}};
  try{
    const e=env({server:{theme:'navy'},oldCheck:true});await e.api.load();heard.length=0;
    e.api.set('theme','sky',{rejectable:true});
    const sending=e.api.flush();
    e.api.set('theme','ink',{rejectable:true});
    await sending;await e.api.flush();
    assert.equal(e.api.get('theme'),'ink');assert.equal(heard.includes('kptu:view-prefs-rejected'),false);
    assert.equal(e.row.theme,'ink');
  }finally{if(had===undefined)delete globalThis.window;else globalThis.window=had}
});

// UI-작은결정묶음 ④: 칸 폭은 화면마다 따로(텔레그램·통화·참고 묶음·사업 보고 3단도 자기 이름). 옛 기기 키는 원래 네 화면만 옮긴다.
test('split ratio accepts every screen name of its own and moves only the original device keys',async()=>{
  assert.deepEqual(parsePrefs({split_ratio:{telegram:0.3,calls:0.35,refs:0.4,reports3:0.350571,chat:0.2}}),{split_ratio:{telegram:0.3,calls:0.35,refs:0.4,reports3:0.350571}});
  assert.equal(validValue('split_ratio',{telegram:0.3}),true);assert.equal(validValue('split_ratio',{telegram:1}),false);
  const e=env({server:{},legacy:{'kptu-split-ratio:telegram':'0.3','kptu-split-ratio:tasks':'0.4'}});
  assert.equal(await e.api.load(),'ok');assert.equal(e.api.getSplit('tasks'),0.4);assert.equal(e.api.getSplit('telegram'),undefined);
  assert.equal(e.api.setSplit('calls',0.45),true);assert.equal(e.api.getSplit('calls'),0.45);
});
