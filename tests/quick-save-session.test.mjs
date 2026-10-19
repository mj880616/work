import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createGoogleTask} from '../app/quick-save.js';

function runtime(ownerAfterRefresh='owner-a'){
  const rows=new Map(),calls=[];
  const localStorage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k),get length(){return rows.size},key:i=>[...rows.keys()][i]};
  const window={dispatchEvent(){}};
  const session={access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner-a'}};
  const fetch=async(url,options)=>{const path=new URL(url).pathname;calls.push({path,body:JSON.parse(options.body||'null')});
    if(path==='/auth/v1/token')return new Response(JSON.stringify({...session,user:{id:ownerAfterRefresh},access_token:'synthetic-next',refresh_token:'synthetic-next-refresh'}),{status:200});
    const count=calls.filter(c=>c.path.endsWith('google-tasks')).length;
    return new Response(JSON.stringify(count===1?{message:'expired'}:{ok:true,task:{id:'task-confirmed'}}),{status:count===1?401:200});
  };
  vm.runInNewContext(readFileSync(new URL('../app/runtime-client.js',import.meta.url),'utf8'),{window,localStorage,fetch,performance,URL,URLSearchParams,AbortController,FormData,CustomEvent:class{},setTimeout,clearTimeout,console});
  window.KPTURuntime.session.write(session);return{rt:window.KPTURuntime,calls};
}
test('quick create binds a 401 retry to its submitted authentication epoch',async()=>{
  const {rt,calls}=runtime('owner-b'),expectedSessionEpoch=rt.session.epoch();
  await assert.rejects(createGoogleTask({title:'원래 입력',links:[{project_id:'project-a'}],expectedSessionEpoch},rt),e=>e.code==='session_changed');
  assert.equal(calls.filter(c=>c.path.endsWith('google-tasks')).length,1);
  assert.equal(calls.filter(c=>c.path==='/auth/v1/token').length,1);
  assert.equal(Object.hasOwn(calls[0].body,'expectedSessionEpoch'),false);
});
test('same-owner token refresh keeps the bound quick create retry available',async()=>{
  const {rt,calls}=runtime(),expectedSessionEpoch=rt.session.epoch();
  const data=await createGoogleTask({title:'유지할 입력',due:'2026-10-07',expectedSessionEpoch},rt);
  assert.equal(data.task.id,'task-confirmed');assert.equal(calls.filter(c=>c.path.endsWith('google-tasks')).length,2);
  assert.deepEqual(calls[0].body,{action:'create',task_id:null,title:'유지할 입력',notes:'',due:'2026-10-07',links:[]});
});
test('project update saves the same row shape as the project screen progress input',async()=>{
  const {saveProjectProgress}=await import('../app/quick-save.js');const sent=[];
  await saveProjectProgress({project_id:'project-a',raw_text:'내용',created_by:'owner-a'},{api:(path,options)=>{sent.push({path,options});return Promise.resolve([]);}});
  assert.equal(sent[0].path,'/rest/v1/app_project_progress_updates');assert.equal(sent[0].options.method,'POST');
  const {effective_on,...rest}=sent[0].options.body;
  assert.deepEqual(rest,{project_id:'project-a',workstream_id:null,author_id:'owner-a',status_label:null,summary:'내용',next_step:null,metadata:{}});
  assert.match(effective_on,/^\d{4}-\d{2}-\d{2}$/);
});
