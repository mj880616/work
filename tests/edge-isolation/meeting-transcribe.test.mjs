import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,rm,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// MTG-녹음초안 2단계: analyze, type-check and bundle the actual meeting-transcribe deployment artifact; never serve/run or deploy it.
test('real meeting-transcribe graph checks/bundles with functions-only sources',{timeout:180000},async()=>{
 const isolated=await mkdtemp(join(tmpdir(),'meeting-transcribe-isolation-'));
 try{
  const functions=join(isolated,'supabase','functions');await mkdir(dirname(functions),{recursive:true});
  await cp(new URL('../../supabase/functions',import.meta.url),functions,{recursive:true,verbatimSymlinks:true});
  const entry=join(functions,'meeting-transcribe','index.ts');
  const run=args=>{const r=spawnSync(process.env.DENO_BIN||'deno',args,{cwd:isolated,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r.stdout;};
  const graph=JSON.parse(run(['info','--no-config','--json',entry])),local=[];
  for(const module of graph.modules){
   if(!module.specifier.startsWith('file:'))continue;
   const file=fileURLToPath(module.specifier),path=relative(functions,await realpath(file));
   assert.ok(path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path),'import outside deployment artifact');
   local.push(relative(functions,file).split(sep).join('/'));
  }
  // S49-2 서버 정리: 요약 지시문(_shared/meeting-draft-prompt.mjs)·답 읽기(meeting-ai-draft/parse.mjs)·폰 알림(_shared/fcm-send.ts)을 같이 쓴다.
  assert.deepEqual(local.sort(),['_shared/ai-model.ts','_shared/ai-prices.mjs','_shared/bounded-json.mjs','_shared/drive-trash.ts','_shared/fcm-send.ts','_shared/meeting-draft-prompt.mjs','_shared/openai-responses.ts','_shared/safe-error.ts','_shared/web-cors.ts','meeting-ai-draft/parse.mjs','meeting-transcribe/index.ts','meeting-transcribe/model.mjs','meeting-transcribe/ogg.mjs','meeting-transcribe/recording.mjs','meeting-transcribe/server-job.mjs']);
  run(['check','--no-config',entry]);const bundle=join(isolated,'meeting-transcribe.bundle.js');run(['bundle','--no-config',entry,'--output',bundle]);assert.ok((await stat(bundle)).size>0);
 }finally{await rm(isolated,{recursive:true,force:true});}
});
