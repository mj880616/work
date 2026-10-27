import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

globalThis.window={dispatchEvent:()=>true,addEventListener:()=>{}};
const mod=await import('../app/basket-note-tasks.js');
const note='10000000-0000-4000-8000-000000000001',stamp='2026-10-14T01:00:00.123456+00:00';
const entry=(n,extra={})=>({task_id:'task-'+n,task_list_id:'@default',title:'할 일 '+n,created_at:'2026-10-14T0'+(n%10)+':00:00.000Z',...extra});
const rtFor=(handler,{user='u1',workspace='w1'}={})=>{const calls=[];return {calls,context:{read:()=>({user:{id:user},workspace:{id:workspace}})},api:async(path,options={})=>{calls.push({path,options});return handler(path,options,calls.length);}};};

test('merge keeps every other metadata key and puts the new task first with only the four keys',()=>{
  const metadata={source:'quick',nested:{a:1},tasks:[entry(1)]};
  const merged=mod.mergeNoteTask(metadata,{...entry(2),extra:'버림'});
  assert.deepEqual(merged.source,'quick');assert.deepEqual(merged.nested,{a:1});
  assert.deepEqual(merged.tasks.map(t=>t.task_id),['task-2','task-1']);
  assert.deepEqual(Object.keys(merged.tasks[0]).sort(),['created_at','task_id','task_list_id','title']);
  // The input object is never mutated.
  assert.deepEqual(metadata.tasks.map(t=>t.task_id),['task-1']);
});

test('merge caps the list at 50, dropping the oldest, and never lists one task twice',()=>{
  const tasks=Array.from({length:50},(_,i)=>entry(50-i));// newest first: task-50 … task-1
  const merged=mod.mergeNoteTask({tasks},entry(51));
  assert.equal(mod.NOTE_TASK_LIMIT,50);assert.equal(merged.tasks.length,50);
  assert.equal(merged.tasks[0].task_id,'task-51');assert.equal(merged.tasks.at(-1).task_id,'task-2');
  const again=mod.mergeNoteTask({tasks:[entry(1),entry(2)]},entry(2,{title:'새 제목'}));
  assert.deepEqual(again.tasks.map(t=>[t.task_id,t.title]),[['task-2','새 제목'],['task-1','할 일 1']]);
});

test('merge starts a list on empty or malformed metadata and drops malformed entries',()=>{
  assert.deepEqual(mod.mergeNoteTask({},entry(1)).tasks.length,1);
  assert.deepEqual(mod.mergeNoteTask(null,entry(1)),{tasks:[mod.mergeNoteTask({},entry(1)).tasks[0]]});
  assert.deepEqual(mod.mergeNoteTask({tasks:'x',keep:true},entry(1)).keep,true);
  const merged=mod.mergeNoteTask({tasks:[null,'x',{task_id:''},{...entry(3),created_at:'아님'},entry(4)]},entry(5));
  assert.deepEqual(merged.tasks.map(t=>t.task_id),['task-5','task-4']);
  assert.throws(()=>mod.mergeNoteTask({},{task_id:'x'}));
  assert.throws(()=>mod.mergeNoteTask({},entry(1,{title:'가'.repeat(1025)})));
});

test('entry from a created Google task carries id, list, title and creation time',()=>{
  const value=mod.noteTaskEntry({id:'g1',taskListId:'@default',title:'보도자료 초안',notes:'원문',due:null},new Date('2026-10-14T03:04:05.000Z'));
  assert.deepEqual(value,{task_id:'g1',task_list_id:'@default',title:'보도자료 초안',created_at:'2026-10-14T03:04:05.000Z'});
  assert.throws(()=>mod.noteTaskEntry({id:'g1',title:'x'}));
});

test('the write changes metadata only, keeps updated_at, and is guarded by version and first task',async()=>{
  const fresh={id:note,updated_at:stamp,metadata:{other:1,tasks:[entry(1)]}};
  const rt=rtFor((path,options)=>options.method==='PATCH'?[{...fresh,metadata:options.body.metadata}]:[fresh]);
  const result=await mod.recordNoteTask(note,entry(2),{rt,expectedSessionEpoch:7});
  assert.equal(result.ok,true);assert.equal(result.note.updated_at,stamp);
  assert.equal(rt.calls.length,2);
  const [read,write]=rt.calls;
  assert.match(read.path,new RegExp(`^/rest/v1/app_notes\\?id=eq\\.${note}&workspace_id=eq\\.w1&select=id,updated_at,metadata$`));
  assert.equal(read.options.expectedSessionEpoch,7);
  assert.equal(write.options.method,'PATCH');assert.equal(write.options.expectedSessionEpoch,7);
  // Never raw_text, attachments or updated_at: the original's version stays the same for AI handoff and photo text.
  assert.deepEqual(Object.keys(write.options.body),['metadata']);
  assert.deepEqual(write.options.body.metadata.other,1);
  assert.deepEqual(write.options.body.metadata.tasks.map(t=>t.task_id),['task-2','task-1']);
  const query=new URL('https://x'+write.path).searchParams;
  assert.equal(query.get('updated_at'),'eq.'+stamp);
  assert.equal(query.get('metadata->tasks->0->>task_id'),'eq.task-1');
  assert.equal(query.get('workspace_id'),'eq.w1');assert.equal(query.get('id'),'eq.'+note);
});

test('first task on a note is guarded by "no first task yet"',()=>{
  assert.match(mod.noteTaskGuard({updated_at:stamp,metadata:{}}),/metadata->tasks->0->>task_id=is\.null$/);
  assert.match(mod.noteTaskGuard({updated_at:stamp,metadata:{tasks:[]}}),/is\.null$/);
  assert.match(mod.noteTaskGuard({updated_at:stamp,metadata:{tasks:[{task_id:'a,b'}]}}),/eq\.a%2Cb$/);
});

test('a lost race reads again once; a second loss reports failure without more writes',async()=>{
  let version=0;const rt=rtFor((path,options)=>options.method==='PATCH'?[]:[{id:note,updated_at:stamp.replace('123456',String(100000+ ++version)),metadata:{}}]);
  const result=await mod.recordNoteTask(note,entry(1),{rt});
  assert.deepEqual(result,{ok:false});
  assert.deepEqual(rt.calls.map(c=>c.options.method||'GET'),['GET','PATCH','GET','PATCH']);
  let lost=false;const rt2=rtFor((path,options)=>{if(options.method==='PATCH'){if(!lost){lost=true;return [];}return [{id:note,updated_at:stamp,metadata:options.body.metadata}];}return [{id:note,updated_at:stamp,metadata:{}}];});
  assert.equal((await mod.recordNoteTask(note,entry(1),{rt:rt2})).ok,true);
});

test('an already recorded task is not written again; a missing note or a thrown request is a failure',async()=>{
  const rt=rtFor(()=>[{id:note,updated_at:stamp,metadata:{tasks:[entry(1)]}}]);
  assert.equal((await mod.recordNoteTask(note,entry(1),{rt})).ok,true);assert.equal(rt.calls.length,1);
  assert.deepEqual(await mod.recordNoteTask(note,entry(1),{rt:rtFor(()=>[])}),{ok:false});
  await assert.rejects(mod.recordNoteTask(note,entry(1),{rt:rtFor(()=>{throw Error('session_changed');})}));
});

test('source notes are read in one contains query (paged), not one request per task',async()=>{
  const rows=Array.from({length:100},(_,i)=>({id:'n'+i,tasks:[entry(i)]}));
  const rt=rtFor((path)=>new URL('https://x'+path).searchParams.get('offset')==='0'?rows:[{id:'last',tasks:[entry(1),{bad:true}]},{id:'none',tasks:null}]);
  const map=await mod.readTaskSourceNotes({rt});
  assert.equal(rt.calls.length,2);
  const query=new URL('https://x'+rt.calls[0].path).searchParams;
  assert.equal(query.get('metadata'),'cs.{"tasks":[]}');assert.equal(query.get('select'),'id,tasks:metadata->tasks');assert.equal(query.get('workspace_id'),'eq.w1');
  assert.equal(map.get('task-5'),'n5');assert.equal(map.get('task-1'),'n1');// first note wins
  assert.equal(map.size,100);
});

test('in-app hand-offs are one-shot and bound to the signed-in user and workspace',()=>{
  const a=rtFor(()=>[]),b=rtFor(()=>[],{user:'u2'});
  mod.requestBasketNote(note,a);assert.equal(mod.takeBasketNoteRequest(b),null);
  mod.requestBasketNote(note,a);assert.equal(mod.takeBasketNoteRequest(a),note);assert.equal(mod.takeBasketNoteRequest(a),null);
  mod.requestTaskOpen('task-1',a);assert.equal(mod.takeTaskOpenRequest(a),'task-1');
  assert.equal(mod.basketNoteHref(note),`./?view=basket&note=${note}`);
});

test('the manual task form records on the note after creation and never re-creates the task on a failed record',()=>{
  const source=readFileSync(new URL('../app/basket-manual-link.js',import.meta.url),'utf8');
  const save=source.slice(source.indexOf('async function saveTask'),source.indexOf('async function recoverTask'));
  assert.equal(save.match(/createGoogleTask\(/g).length,1);
  assert.ok(save.indexOf('createGoogleTask(')<save.indexOf('recordNoteTask('));
  assert.match(save,/할 일은 만들었지만 업데이트에 기록하지 못했어요\./);
  assert.doesNotMatch(source,/연결 기록은 남지 않아요/);
});
