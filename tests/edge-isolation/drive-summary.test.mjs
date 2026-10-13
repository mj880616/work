import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkDriveSummaryIsolation} from '../../scripts/check-drive-summary-isolation.mjs';

test('functions-only deployment copy passes Deno check and bundle for the real drive-summary graph',{timeout:120000},async()=>{
  const result=await checkDriveSummaryIsolation();
  assert.equal(result.modules,5);assert.ok(result.bundleBytes>0);
});

async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'drive-summary-import-probe-'));
  try{
    await mkdir(join(root,'supabase','functions','drive-summary'),{recursive:true});
    await mkdir(join(root,'app'));
    await writeFile(join(root,'app','external.mjs'),'export const external=1;\n');
    return await run(root);
  }finally{await rm(root,{recursive:true,force:true});}
}

for(const dynamic of [false,true]){
  test(`isolated deployment rejects an outside relative ${dynamic?'dynamic':'static'} import even when the repository source exists`,async()=>fixture(async root=>{
    await writeFile(join(root,'supabase','functions','drive-summary','index.ts'),dynamic?"await import('../../../app/external.mjs');\n":"import '../../../app/external.mjs';\n");
    await assert.rejects(checkDriveSummaryIsolation({root}),/Import outside supabase\/functions/);
  }));
}

test('isolated deployment rejects a copied symlink to a file outside functions',async()=>fixture(async root=>{
  const dir=join(root,'supabase','functions','drive-summary');
  await symlink(join(root,'app','external.mjs'),join(dir,'external.mjs'));
  await writeFile(join(dir,'index.ts'),"import './external.mjs';\n");
  await assert.rejects(checkDriveSummaryIsolation({root}),/Import outside supabase\/functions/);
}));


test('functions-only copy preserves valid internal relative symlinks like deployment cp -R',async()=>fixture(async root=>{
  const dir=join(root,'supabase','functions','drive-summary');
  await writeFile(join(dir,'local.mjs'),'export const local=1;\n');
  await symlink('./local.mjs',join(dir,'internal.mjs'));
  await writeFile(join(dir,'index.ts'),"import {local} from './internal.mjs'; export const value=local;\n");
  const result=await checkDriveSummaryIsolation({root});assert.ok(result.bundleBytes>0);
}));
