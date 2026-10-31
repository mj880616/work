import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,rm,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Analyze and bundle the actual deployment artifact; never serve/run or deploy it.
test('real outside-feed graph checks/bundles with functions-only sources',{timeout:120000},async()=>{
 const isolated=await mkdtemp(join(tmpdir(),'outside-feed-isolation-'));
 try{
  const functions=join(isolated,'supabase','functions');await mkdir(dirname(functions),{recursive:true});
  await cp(new URL('../../supabase/functions',import.meta.url),functions,{recursive:true,verbatimSymlinks:true});
  const entry=join(functions,'outside-feed','index.ts');
  const run=args=>{const r=spawnSync(process.env.DENO_BIN||'deno',args,{cwd:isolated,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r.stdout;};
  const graph=JSON.parse(run(['info','--no-config','--json',entry])),local=[];
  for(const module of graph.modules){
   if(!module.specifier.startsWith('file:'))continue;
   const file=fileURLToPath(module.specifier),path=relative(functions,await realpath(file));
   assert.ok(path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path),'import outside deployment artifact');
   local.push(relative(functions,file).split(sep).join('/'));
  }
  // 카탈로그(_shared/outside-catalog.ts)와 기존 AI 공용 모듈만 쓴다(새 AI 경로·바깥 라이브러리 없음).
  assert.deepEqual(local.sort(),['_shared/ai-model.ts','_shared/bounded-json.mjs','_shared/openai-responses.ts','_shared/outside-catalog.ts',
   'outside-feed/handler.ts','outside-feed/index.ts','outside-feed/parse.ts']);
  assert.ok(graph.modules.every(m=>m.specifier.startsWith('file:')),'no remote or npm imports');
  run(['check','--no-config',entry]);const bundle=join(isolated,'outside-feed.bundle.js');run(['bundle','--no-config',entry,'--output',bundle]);assert.ok((await stat(bundle)).size>0);
 }finally{await rm(isolated,{recursive:true,force:true});}
});
