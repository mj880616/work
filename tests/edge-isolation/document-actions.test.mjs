import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,rm,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// CAL-일정첨부 6번(S59-23): document-actions에 공용 도우미 둘(_shared/google-calendar-token.ts·event-attach-file.ts)이 더해졌다.
// 실제 배포 묶음(supabase/functions만)으로 모듈 목록을 확인하고 묶어 본다(실행·배포는 하지 않는다).
// 타입 검사(deno check)는 이 시험에 넣지 않는다: main에 이미 있는 타입 오류 2개(_shared/hwp-edit.ts 301줄·document-actions/file-rename.ts 144줄)는 이 작업 범위 밖이라 따로 보고했다.
test('real document-actions graph (CAL-일정첨부 6번: calendar token + event attachment helpers) bundles with functions-only sources',{timeout:120000},async()=>{
 const isolated=await mkdtemp(join(tmpdir(),'document-actions-isolation-'));
 try{
  const functions=join(isolated,'supabase','functions');await mkdir(dirname(functions),{recursive:true});
  await cp(new URL('../../supabase/functions',import.meta.url),functions,{recursive:true,verbatimSymlinks:true});
  const entry=join(functions,'document-actions','index.ts');
  const run=args=>{const r=spawnSync(process.env.DENO_BIN||'deno',args,{cwd:isolated,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r.stdout;};
  const graph=JSON.parse(run(['info','--no-config','--json',entry])),local=[];
  for(const module of graph.modules){
   if(!module.specifier.startsWith('file:'))continue;
   const file=fileURLToPath(module.specifier),path=relative(functions,await realpath(file));
   assert.ok(path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path),'import outside deployment artifact');
   local.push(relative(functions,file).split(sep).join('/'));
  }
  // BRIEF-브리핑룸 ②: 브리핑 길(brief.ts·brief-run.mjs)이 공용 AI 호출·모델·사람별 한도·브리핑 순수 함수를 더 쓴다.
  assert.deepEqual(local.sort(),['_shared/ai-model.ts','_shared/ai-prices.mjs','_shared/ai-user-cap.mjs','_shared/basket-file-origin.ts','_shared/basket-ocr-text.mjs','_shared/bounded-json.mjs','_shared/brief-room.mjs','_shared/document-text.ts','_shared/drive-ocr.ts','_shared/event-attach-file.ts','_shared/file-rename-name.mjs','_shared/google-calendar-token.ts','_shared/hwp-edit.ts','_shared/openai-responses.ts','_shared/safe-error.ts','_shared/web-cors.ts','_shared/workspace-drive-token.ts','document-actions/brief-run.mjs','document-actions/brief.ts','document-actions/dev-inbox.ts','document-actions/file-rename.ts','document-actions/file-trash.ts','document-actions/index.ts']);
  const bundle=join(isolated,'document-actions.bundle.js');run(['bundle','--no-config',entry,'--output',bundle]);assert.ok((await stat(bundle)).size>0);
 }finally{await rm(isolated,{recursive:true,force:true});}
});
