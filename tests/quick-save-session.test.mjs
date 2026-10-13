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
