import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=path=>readFileSync(resolve(root,path),'utf8');

function loadedAppScripts(){
  const found=new Set(),queue=[];
  const html=read('app/index.html');
  for(const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["'](\.\/[^"']+\.js(?:\?[^"']*)?)["'][^>]*>/g))queue.push(match[1]);
  while(queue.length){
    const path=`app/${queue.shift().replace(/^\.\//,'').split('?')[0]}`;
    if(found.has(path))continue;
    found.add(path);
    const source=read(path);
    for(const match of source.matchAll(/\b(?:import|module)\s*\(\s*["'](\.\/[^"']+\.js(?:\?[^"']*)?)["']/g))queue.push(match[1]);
  }
  return found;
}

function callEnd(source,opening){
  let depth=0,quote='';
  for(let i=opening;i<source.length;i++){
    const char=source[i];
    if(quote){
      if(char==='\\'){i++;continue}
      if(char===quote)quote='';
      continue;
    }
    if(char==='\''||char==='"'||char==='`'){quote=char;continue}
    if(char==='(')depth++;
    if(char===')'&&!--depth)return i+1;
  }
  throw new Error('Unclosed API call');
}

function appTasksWrites(source){
  const writes=[];
  // Direct REST calls, including multiline options and template literal URLs.
  for(const match of source.matchAll(/\b[A-Za-z_$][\w$]*\s*\(\s*["'`]\/rest\/v1\/app_tasks\b/g)){
    const opening=source.indexOf('(',match.index);
    const call=source.slice(opening,callEnd(source,opening));
    if(/\bmethod\s*:\s*["'`](?:POST|PATCH|DELETE)["'`]/i.test(call))writes.push(source.slice(0,match.index).split('\n').length);
  }
  // Supabase query-builder writes use the table name without a REST URL.
  for(const match of source.matchAll(/\.from\s*\(\s*["'`]app_tasks["'`]\s*\)\s*\.\s*(?:insert|update|delete|upsert)\s*\(/g)){
    writes.push(source.slice(0,match.index).split('\n').length);
  }
  return writes;
}

test('write detector catches REST and query-builder operations',()=>{
  for(const method of ['POST','PATCH','DELETE']){
    assert.deepEqual(appTasksWrites(`api('/rest/v1/app_tasks', {\n method: '${method}'\n})`),[1]);
  }
  for(const method of ['insert','update','delete','upsert']){
    assert.deepEqual(appTasksWrites(`db.from('app_tasks').${method}({})`),[1]);
  }
  assert.deepEqual(appTasksWrites("api('/rest/v1/app_tasks?select=id')"),[]);
});

test('app files reachable from the live loader do not write app_tasks',()=>{
  const loaded=loadedAppScripts();
  assert.ok(loaded.has('app/project-system-v3.js'));
  assert.ok(loaded.has('app/team.js'));
  for(const inactive of ['task-layout.js','workflow-ai-v3.js','legacy/home-task-actions.js']){
    assert.ok(!loaded.has(`app/${inactive}`),`${inactive} is inactive`);
  }
  const violations=[...loaded].flatMap(path=>appTasksWrites(read(path)).map(line=>`${path}:${line}`));
  assert.deepEqual(violations,[]);
});
