import {cp,mkdir,mkdtemp,realpath,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const inside=(root,file)=>{const path=relative(root,file);return path!== '..'&&!path.startsWith('..'+sep)&&!isAbsolute(path);};

// Match edge-function-deploy.yml: copy functions only, never app/ or repo config.
// Deno analyzes/bundles source here; it never runs the Edge handler or deploys it.
export async function checkDriveSummaryIsolation({root=repository,deno=process.env.DENO_BIN||'deno'}={}){
  const isolated=await mkdtemp(join(tmpdir(),'drive-summary-isolation-'));
  try{
    const functions=join(isolated,'supabase','functions');
    await mkdir(dirname(functions),{recursive:true});
    await cp(join(root,'supabase','functions'),functions,{recursive:true,verbatimSymlinks:true});
    const entry=join(functions,'drive-summary','index.ts');
    const run=args=>{
      const result=spawnSync(deno,args,{cwd:isolated,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});
      if(result.error)throw result.error;
      if(result.status!==0)throw Error(`Deno ${args[0]} failed (${result.status}): ${result.stderr}`);
      return result.stdout;
    };
    const graph=JSON.parse(run(['info','--no-config','--json',entry]));
    for(const module of graph.modules){
      if(!module.specifier.startsWith('file:'))continue;
      const file=fileURLToPath(module.specifier);
      if(!inside(functions,file))throw Error(`Import outside supabase/functions: ${module.specifier}`);
      // Also reject a copied symlink that resolves to an external local source.
      if(!inside(functions,await realpath(file)))throw Error(`Import outside supabase/functions through symlink: ${module.specifier}`);
    }
    run(['check','--no-config',entry]);
    const bundle=join(isolated,'drive-summary.bundle.js');
    run(['bundle','--no-config',entry,'--output',bundle]);
    return {modules:graph.modules.length,bundleBytes:(await stat(bundle)).size};
  }finally{
    await rm(isolated,{recursive:true,force:true});
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log('functions-only isolation check/bundle passed:',await checkDriveSummaryIsolation());}
  catch(error){console.error(error.message);process.exitCode=1;}
}
