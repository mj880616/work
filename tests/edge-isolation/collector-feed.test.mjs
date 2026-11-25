import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,rm,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Analyze and bundle the actual deployment artifact; never serve/run or deploy it.
test('real collector-feed graph checks/bundles with functions-only sources',{timeout:120000},async()=>{
 const isolated=await mkdtemp(join(tmpdir(),'collector-feed-isolation-'));
 try{
  const functions=join(isolated,'supabase','functions');await mkdir(dirname(functions),{recursive:true});
  await cp(new URL('../../supabase/functions',import.meta.url),functions,{recursive:true,verbatimSymlinks:true});
  const entry=join(functions,'collector-feed','index.ts');
  const run=args=>{const r=spawnSync(process.env.DENO_BIN||'deno',args,{cwd:isolated,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r.stdout;};
  const graph=JSON.parse(run(['info','--no-config','--json',entry])),local=[];
  for(const module of graph.modules){
   if(!module.specifier.startsWith('file:'))continue;
   const file=fileURLToPath(module.specifier),path=relative(functions,await realpath(file));
   assert.ok(path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path),'import outside deployment artifact');
   local.push(relative(functions,file).split(sep).join('/'));
  }
  // 채널 기사 주소 규칙(scrap)은 news-feed와 같은 순수 모듈(_shared/news-url.ts)을 쓴다.
  // 프로젝트·담당조직 목록 규칙은 ai-assist 자료실 채우기와 같은 순수 함수(library-fill.ts)를 쓴다(중복 구현 없음).
  // S69 NEWS-제목늘읽기: 들어온 기사 주소 한 장의 제목 읽기는 news-feed와 같은 읽기(_shared/feed-fetch.ts)·제목 규칙(_shared/page-title.ts)을 쓴다.
  // S70-17b NEWS-제목꼭얻기: 같은 기사의 RSS 줄 제목(_shared/same-article.ts, 매체 표 news-catalog.ts의 같은 기사 규칙 한 곳)을 news-feed와 같이 쓴다.
  //   그 읽기가 쓰는 글자 풀기(outside-feed/parse.ts와 그 짝 html-entities·outside-tidy·outside-catalog)가 함께 따라온다(복사 구현 없음).
  assert.deepEqual(local.sort(),['_shared/ai-model.ts','_shared/bounded-json.mjs','_shared/feed-fetch.ts','_shared/html-entities.ts','_shared/library-file-name.mjs','_shared/news-catalog.ts','_shared/news-url.ts','_shared/openai-responses.ts','_shared/org-name-match.mjs','_shared/outside-catalog.ts','_shared/outside-tidy.ts','_shared/page-title.ts','_shared/reader-headers.ts','_shared/same-article.ts','_shared/web-cors.ts','ai-assist/library-fill.ts','collector-feed/call-analysis.ts','collector-feed/context.ts','collector-feed/family.ts','collector-feed/handler.ts','collector-feed/index.ts','collector-feed/replied.ts','collector-feed/telegram.ts','outside-feed/parse.ts']);
  run(['check','--no-config',entry]);const bundle=join(isolated,'collector-feed.bundle.js');run(['bundle','--no-config',entry,'--output',bundle]);assert.ok((await stat(bundle)).size>0);
 }finally{await rm(isolated,{recursive:true,force:true});}
});
