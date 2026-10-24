import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,rm,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// UPLOAD-파일명파싱공용: these upload functions now import _shared/multipart.ts. Analyze and bundle each real
// deployment artifact with functions-only sources (same check as basket-files.test.mjs); never serve or deploy it.
// meeting-files is bundled but not type-checked: main already fails `deno check` there (TS2345 on error.status in
// getUser, unrelated to this change; reported separately).
const TYPE_CHECK=new Set(['library-files','workspace-drive']);
const FILES={
  'library-files':['_shared/ai-model.ts','_shared/multipart.ts','library-files/index.ts'],
  'meeting-files':['_shared/meeting-auth.mjs','_shared/multipart.ts','meeting-files/index.ts'],
  'workspace-drive':['_shared/multipart.ts','workspace-drive/index.ts'],
};

for(const [fn,expected] of Object.entries(FILES)){
  test(`real ${fn} graph checks/bundles with functions-only sources`,{timeout:180000},async()=>{
    const isolated=await mkdtemp(join(tmpdir(),`${fn}-isolation-`));
    try{
      const functions=join(isolated,'supabase','functions');await mkdir(dirname(functions),{recursive:true});
      await cp(new URL('../../supabase/functions',import.meta.url),functions,{recursive:true,verbatimSymlinks:true});
      const entry=join(functions,fn,'index.ts');
      const run=args=>{const r=spawnSync(process.env.DENO_BIN||'deno',args,{cwd:isolated,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r.stdout;};
      const graph=JSON.parse(run(['info','--no-config','--json',entry])),local=[];
      for(const module of graph.modules){
        if(!module.specifier.startsWith('file:'))continue;
        const file=fileURLToPath(module.specifier),path=relative(functions,await realpath(file));
        assert.ok(path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path),'import outside deployment artifact');
        local.push(relative(functions,file).split(sep).join('/'));
      }
      assert.deepEqual(local.sort(),expected);
      if(TYPE_CHECK.has(fn))run(['check','--no-config',entry]);
      const bundle=join(isolated,`${fn}.bundle.js`);run(['bundle','--no-config',entry,'--output',bundle]);assert.ok((await stat(bundle)).size>0);
    }finally{await rm(isolated,{recursive:true,force:true});}
  });
}
