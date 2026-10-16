import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {parse}=createRequire(new URL('../scripts/package.json',import.meta.url))('acorn');

// TASK-삭제유지: run the real declarations of google-tasks.js (inside its IIFE) with synthetic DOM/API.
// Rendering and menus are stubbed; the browser spec covers the visible rows and the undo button.
const source=readFileSync(new URL('../app/google-tasks.js',import.meta.url),'utf8');
const iife=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='ExpressionStatement').expression.callee.body.body;
const declarations=iife.filter(n=>['VariableDeclaration','FunctionDeclaration'].includes(n.type)).map(n=>source.slice(n.start,n.end)).join('\n');

function harness({failDelete=false}={}){
  const listeners=new Map(),docListeners=new Map(),calls=[],events=[],timers=new Map();let timerSeq=0;
  const on=map=>(type,fn)=>{if(!map.has(type))map.set(type,[]);map.get(type).push(fn)};
  const tasksView={classList:{contains:k=>k==='hidden'&&!h.tasksShown}};
  const document={hidden:false,readyState:'complete',querySelector:sel=>sel==='#tasksView'?tasksView:null,querySelectorAll:()=>[],addEventListener:on(docListeners),activeElement:null};
  const window={addEventListener:on(listeners),dispatchEvent:e=>{events.push(e.type+':'+(e.detail?.source||''))},KPTURouter:{on(){}}};
  const rt={session:{read:()=>({user:{id:'owner-A'}}),epoch:()=>0},api:async(path,opts)=>{calls.push({path,body:opts?.body});if(failDelete)throw new Error('delete failed');return {ok:true}}};
  window.KPTURuntime=rt;
  const h={tasksShown:true,calls,events,document,listeners,docListeners,
    fire:(type,e={})=>{for(const fn of listeners.get(type)||[])fn(e)},
    fireDoc:type=>{for(const fn of docListeners.get(type)||[])fn({})},
    runTimers:async()=>{const due=[...timers.values()];timers.clear();for(const fn of due)fn();for(let i=0;i<10;i++)await Promise.resolve()}};
  const context={window,document,CSS:{escape:String},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail}},
    setTimeout:fn=>{const id=++timerSeq;timers.set(id,fn);return id},clearTimeout:id=>{timers.delete(id)},queueMicrotask,console,Promise,Map,Set,Date,JSON,Math,Number,String,Object,Array,Error,
    formatSeoulTime:()=>'',createAnchoredMenu:()=>null,dayKey:()=>'',createGoogleTask:async()=>null,readTaskSourceNotes:()=>[],requestBasketNote(){},takeTaskOpenRequest:()=>null,basketNoteHref:()=>''};
  vm.createContext(context);
  vm.runInContext(declarations+`
    section=()=>null;ensureModal=()=>null;renderTasks=()=>{};renderUndo=()=>{};setSync=(t)=>{globalThis.__sync=t};refreshLinked=()=>{};closeScope=()=>{};load=async()=>{};
    lastTasks=[{id:'a',title:'a',taskListId:'l1'},{id:'b',title:'b',taskListId:'l1'}];
    globalThis.api={boot,queueDelete,undoDelete,pending:()=>[...pendingDeletes.keys()],tasks:()=>lastTasks.map(t=>t.id),tombstones:()=>[...deletedTombstones]};`,context);
  const a=context.api,plain=fn=>()=>JSON.parse(JSON.stringify(fn()));
  h.api={...a,pending:plain(a.pending),tasks:plain(a.tasks),tombstones:plain(a.tombstones)};h.sync=()=>context.__sync;
  return h;
}
const deletes=h=>h.calls.filter(c=>c.body?.action==='delete').map(c=>c.body.task_id);

test('leaving the task view keeps the queued delete and sends it when the wait ends',async()=>{
  const h=harness();await h.api.boot();
  h.api.queueDelete('a');
  h.tasksShown=false;h.fire('kptu:view-changed',{detail:{view:'calendar'}});
  assert.deepEqual(h.api.pending(),['a']);
  assert.deepEqual(deletes(h),[]);
  await h.runTimers();
  assert.deepEqual(deletes(h),['a']);
  assert.deepEqual(h.api.tasks(),['b']);
  assert.deepEqual(h.api.pending(),[]);
  assert.ok(h.events.includes('kptu:google-tasks-changed:delete'));
});

test('a hidden tab keeps the queued delete',async()=>{
  const h=harness();await h.api.boot();
  h.api.queueDelete('a');
  h.document.hidden=true;h.fireDoc('visibilitychange');
  assert.deepEqual(h.api.pending(),['a']);
  await h.runTimers();
  assert.deepEqual(deletes(h),['a']);
});

test('only undo cancels a queued delete, even after leaving the view',async()=>{
  const h=harness();await h.api.boot();
  h.api.queueDelete('a');
  h.tasksShown=false;h.fire('kptu:view-changed',{detail:{view:'home'}});
  h.tasksShown=true;h.fire('kptu:view-changed',{detail:{view:'tasks'}});
  h.api.undoDelete('a');
  await h.runTimers();
  assert.deepEqual(deletes(h),[]);
  assert.deepEqual(h.api.tasks(),['a','b']);
});

test('closing the page cancels the queued delete without sending it',async()=>{
  const h=harness();await h.api.boot();
  h.api.queueDelete('a');
  h.fire('pagehide');
  assert.deepEqual(h.api.pending(),[]);
  await h.runTimers();
  assert.deepEqual(deletes(h),[]);
});

test('a failed delete after leaving the view restores the task and tells other screens',async()=>{
  const h=harness({failDelete:true});await h.api.boot();
  h.api.queueDelete('a');
  h.tasksShown=false;h.fire('kptu:view-changed',{detail:{view:'calendar'}});
  await h.runTimers();
  assert.deepEqual(deletes(h),['a']);
  assert.deepEqual(h.api.tasks(),['a','b']);
  assert.deepEqual(h.api.pending(),[]);
  assert.match(h.sync(),/삭제하지 못/);
  assert.ok(h.events.includes('kptu:google-tasks-changed:delete'));
});
