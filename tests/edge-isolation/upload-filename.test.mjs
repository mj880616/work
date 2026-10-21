import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// UPLOAD-파일명파싱공용: Deno's req.formData() cuts a quoted file name at ';' or '=' and ignores filename* (the cause
// fixed for basket-files in PR #925). This file proves, per upload function, whether that reaches a stored name:
// it runs the real index.ts in the Deno runtime with the supabase/hwpx npm packages mapped to local stubs, Deno.serve
// captured, and fetch answered locally (no network, nothing deployed), then checks the name written to Drive and to
// app_documents.file_name.
const FUNCTIONS=fileURLToPath(new URL('../../supabase/functions/',import.meta.url));
const deno=args=>spawnSync(process.env.DENO_BIN||'deno',args,{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});

const NAMES={
  semicolon:{header:'filename="회의록; 최종=v2.hwp"',want:'회의록; 최종=v2.hwp'},
  equals:{header:'filename="예산=안 a=b.hwp"',want:'예산=안 a=b.hwp'},
  korean:{header:'filename="연구 목적 및 면접조사 (최종).hwp"',want:'연구 목적 및 면접조사 (최종).hwp'},
  filename_star:{header:`filename="fallback.hwp"; filename*=UTF-8''${encodeURIComponent('별표; 이름=1.hwp')}`,want:'별표; 이름=1.hwp'},
};

const STUB_SUPABASE=`
const ROWS={
  app_workspace_members:{workspace_id:'w1',role:'owner'},
  app_meetings:{id:'m1',workspace_id:'w1',project_id:'p1',title:'회의',series_name:null,round_no:null,created_by:'u1'},
  app_spaces:{id:'p1',workspace_id:'w1',name:'프로젝트',owner_id:'u1',created_by:'u1'},
  public_policy_drive_config:{google_client_id:'c',google_client_secret:'s',google_refresh_token:'r'},
  app_drive_settings:{library_folder_id:'f1',root_folder_id:'r1'},
  app_meeting_drive_folders:{folder_id:'f1'},
  app_project_drive_folders:{folder_id:'f1'},
  app_ai_workspace_settings:null,
};
function from(table){
  let list=false,inserted=null;
  const result=()=>{
    if(table==='app_documents'){globalThis.__calls.inserts.push(inserted);return {data:{id:'d1',...inserted},error:null}}
    return {data:list?[]:ROWS[table]??null,error:null};
  };
  const b={select:()=>b,eq:()=>b,is:()=>b,gt:()=>b,order:()=>b,neq:()=>{list=true;return b},
    insert:p=>{inserted=p;return b},update:()=>b,upsert:async()=>({error:null}),
    maybeSingle:async()=>result(),single:async()=>result(),then:(ok,no)=>Promise.resolve(result()).then(ok,no)};
  return b;
}
export function createClient(){return {from,auth:{getUser:async()=>({data:{user:{id:'u1'}},error:null})}}}
`;
const STUB_HWPX='export class HwpxReader{}\nexport async function hwpToText(){return ""}\n';
const RUNNER=`
globalThis.__calls={inserts:[],drive:[]};
let handler=null;
Deno.serve=fn=>{handler=fn};
globalThis.fetch=async(url,init={})=>{
  const href=String(url),method=init.method||'GET';
  const j=(d,h={})=>new Response(JSON.stringify(d),{status:200,headers:{'content-type':'application/json',...h}});
  if(href.startsWith('https://oauth2.googleapis.com/token'))return j({access_token:'t'});
  if(href.startsWith('https://www.googleapis.com/upload/drive/v3/files')){globalThis.__calls.drive.push(JSON.parse(init.body).name);return j({},{location:'https://upload.invalid/s'})}
  if(href==='https://upload.invalid/s'&&method==='PUT')return j({id:'df1',webViewLink:'https://drive.invalid/df1'});
  throw new Error('unexpected fetch '+method+' '+href);
};
const [fn,path,fields,cases]=JSON.parse(Deno.args[0]);
await import(new URL(fn+'/index.ts',${JSON.stringify('file://'+FUNCTIONS)}).href);
const out={};
for(const [k,header] of Object.entries(cases)){
  globalThis.__calls.inserts=[];globalThis.__calls.drive=[];
  let s='';
  for(const [n,v] of Object.entries(fields))s+='--B\\r\\nContent-Disposition: form-data; name="'+n+'"\\r\\n\\r\\n'+v+'\\r\\n';
  s+='--B\\r\\nContent-Disposition: form-data; name="file"; '+header+'\\r\\nContent-Type: application/x-hwp\\r\\n\\r\\nabc\\r\\n--B--\\r\\n';
  const body=new TextEncoder().encode(s);
  const req=()=>new Request('https://sb.invalid/functions/v1/'+fn+path,{method:'POST',body,headers:{Authorization:'Bearer x','content-type':'multipart/form-data; boundary=B'}});
  const res=await handler(req());
  const ins=globalThis.__calls.inserts[0]||{};
  out[k]={status:res.status,drive:globalThis.__calls.drive[0]??null,file_name:ins.file_name??null,title:ins.title??null,
    deno_form_data:(await req().formData()).get('file')?.name??null};
}
console.log(JSON.stringify(out));
`;

async function runFunction(fn,path,fields){
  const dir=await mkdtemp(join(tmpdir(),'upload-filename-'));
  try{
    await writeFile(join(dir,'stub-supabase.mjs'),STUB_SUPABASE);
    await writeFile(join(dir,'stub-hwpx.mjs'),STUB_HWPX);
    await writeFile(join(dir,'run.mjs'),RUNNER);
    await writeFile(join(dir,'import-map.json'),JSON.stringify({imports:{
      'npm:@supabase/supabase-js@2':'./stub-supabase.mjs','npm:@ssabrojs/hwpxjs':'./stub-hwpx.mjs'}}));
    const cases=Object.fromEntries(Object.entries(NAMES).map(([k,v])=>[k,v.header]));
    const r=spawnSync(process.env.DENO_BIN||'deno',['run','--no-config','--no-prompt','--no-check','--no-lock',
      '--import-map',join(dir,'import-map.json'),'--allow-env','--allow-read',join(dir,'run.mjs'),JSON.stringify([fn,path,fields,cases])],
      {cwd:dir,encoding:'utf8',timeout:60000,env:{...process.env,SUPABASE_URL:'https://sb.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',OPENAI_API_KEY:''}});
    if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);
    return JSON.parse(r.stdout.trim().split('\n').at(-1));
  }finally{await rm(dir,{recursive:true,force:true});}
}

function assertNames(out,{title}={}){
  for(const [k,{want}] of Object.entries(NAMES)){
    assert.equal(out[k].status,200,k);
    assert.equal(out[k].drive,want,`${k}: Drive file name`);
    assert.equal(out[k].file_name,want,`${k}: app_documents.file_name`);
    if(title)assert.equal(out[k].title,title(want),`${k}: title from the file name`);
  }
  // The cause, in the same runtime: req.formData() would have stored these instead.
  assert.equal(out.semicolon.deno_form_data,'"회의록');
  assert.equal(out.equals.deno_form_data,'"예산');
  assert.equal(out.filename_star.deno_form_data,'fallback.hwp');
  assert.equal(out.korean.deno_form_data,NAMES.korean.want,'plain Korean names were never cut');
}

test('library-files keeps ; = Korean and filename* names (Drive and app_documents)',{timeout:90000},async()=>{
  assertNames(await runFunction('library-files','',{}));
});

test('meeting-files keeps ; = Korean and filename* names and titles from them',{timeout:90000},async()=>{
  assertNames(await runFunction('meeting-files','',{meeting_id:'m1'}),{title:n=>n.replace(/\.[^.]+$/,'')});
});

test('workspace-drive upload keeps ; = Korean and filename* names',{timeout:90000},async()=>{
  assertNames(await runFunction('workspace-drive','?action=upload',{project_id:'p1'}));
});

// Not switched, with the reason pinned: both still read multipart with req.formData(), but neither stores the
// uploaded part's file name, so the cut name never reaches Drive, Storage or the DB.
test('event-media and document-actions (HWP overwrite) never use the uploaded file name',async()=>{
  const read=p=>readFile(join(FUNCTIONS,p),'utf8');
  const media=await read('event-media/index.ts');
  assert.match(media,/await req\.formData\(\)/);
  assert.doesNotMatch(media,/\.name\b/,'event-media names Storage objects <event>/<uuid>.jpg');
  assert.match(media,/const mainPath=base\+'\.jpg',thumbPath=base\+'-thumb\.jpg'/);
  const actions=await read('document-actions/index.ts'),hwp=await read('_shared/hwp-edit.ts');
  assert.match(actions,/form = await req\.formData\(\)/);
  const overwrite=hwp.slice(hwp.indexOf('async function overwrite('));
  assert.ok(overwrite.length>0);
  assert.doesNotMatch(overwrite.slice(0,overwrite.indexOf('\n  }\n')),/file\.name/,'overwrite names the backup from the DB record');
  assert.match(overwrite,/backupName\(src\.fileName, now\(\)\)/);
});

test('switched functions read multipart only through _shared/multipart.ts',async()=>{
  for(const fn of ['basket-files/handler.ts','library-files/index.ts','meeting-files/index.ts','workspace-drive/index.ts']){
    const src=await readFile(join(FUNCTIONS,fn),'utf8');
    assert.match(src,/import \{ readMultipartForm \} from ['"]\.\.\/_shared\/multipart\.ts['"]/,fn);
    assert.doesNotMatch(src,/req\.formData\(\)\s*[;}]/,fn);
  }
});
