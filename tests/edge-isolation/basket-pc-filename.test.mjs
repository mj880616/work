import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

// basket-pc v0.2.0: Korean file names reached the basket as a single '"'. The basket-files Edge function reads the
// name with Deno's req.formData(); this runs that same parser (Deno, no network, nothing deployed) on the header the
// old .NET client wrote and on the header basket-pc writes now (basket-pc/src/BasketDrop.Core/FileNames.cs).
const NAME='연구 목적 및 면접조사 (최종).hwp';
const script=`
const name=${JSON.stringify(NAME)};
const b64=btoa(String.fromCharCode(...new TextEncoder().encode(name)));
const headers={
  old_dotnet:'form-data; name=file; filename="=?utf-8?B?'+b64+'?="; filename*=utf-8\\'\\''+encodeURIComponent(name),
  basket_pc:'form-data; name="file"; filename="'+name+'"',
  split_chars:'form-data; name="file"; filename="a_b_c.txt"',
};
const out={};
for(const [k,cd] of Object.entries(headers)){
  const body=new TextEncoder().encode('--B\\r\\nContent-Disposition: '+cd+'\\r\\nContent-Type: application/x-hwp\\r\\n\\r\\nabc\\r\\n--B--\\r\\n');
  const form=await new Request('http://local.invalid/',{method:'POST',body,headers:{'content-type':'multipart/form-data; boundary=B'}}).formData();
  const file=form.get('file');out[k]={name:file.name,size:file.size,type:file.type};
}
console.log(JSON.stringify(out));
`;

test('Deno form parser reads the basket-pc file header with the Korean name intact',{timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'basket-pc-filename-'));
 try{
  const file=join(dir,'parse.mjs');await writeFile(file,script);
  const r=spawnSync(process.env.DENO_BIN||'deno',['run','--no-config','--no-prompt',file],{cwd:dir,encoding:'utf8',timeout:30000});
  if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);
  const out=JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(out.old_dotnet.name,'"','the old client header is what produced the one-quote name');
  assert.deepEqual(out.basket_pc,{name:NAME,size:3,type:'application/x-hwp'});
  assert.equal(out.split_chars.name,'a_b_c.txt');
 }finally{await rm(dir,{recursive:true,force:true});}
});

// BASKET-파일명파싱: req.formData() above cuts '"회의록; 최종=v2.hwp"' to '"회의록'. basket-files now reads multipart with
// _shared/multipart.ts; run that module in the same Deno runtime on browser, basket-pc and filename* headers.
const fixedScript=moduleUrl=>`
import {readMultipartForm} from ${JSON.stringify(moduleUrl)};
const korean=${JSON.stringify(NAME)};
const headers={
  semicolon_equals:'form-data; name="file"; filename="회의록; 최종=v2.hwp"',
  escaped_quote:'form-data; name="file"; filename="say \\\\"hi\\\\".txt"',
  basket_pc:'form-data; name="file"; filename="'+korean+'"',
  filename_star:'form-data; name="file"; filename="fallback.hwp"; filename*=UTF-8\\'\\''+encodeURIComponent('별표; 이름=1.hwp'),
  path:'form-data; name="file"; filename="..\\\\\\\\dir/evil.txt"',
};
const out={};
for(const [k,cd] of Object.entries(headers)){
  const body=new TextEncoder().encode('--B\\r\\nContent-Disposition: '+cd+'\\r\\nContent-Type: application/x-hwp\\r\\n\\r\\nabc\\r\\n--B--\\r\\n');
  const req=()=>new Request('http://local.invalid/',{method:'POST',body,headers:{'content-type':'multipart/form-data; boundary=B'}});
  const file=(await readMultipartForm(req())).get('file');
  out[k]={name:file.name,size:file.size,type:file.type,deno:(await req().formData()).get('file').name};
}
console.log(JSON.stringify(out));
`;

test('basket-files multipart reader keeps ; = quotes, Korean and filename* names in Deno',{timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'basket-files-filename-'));
 try{
  const moduleUrl=new URL('../../supabase/functions/_shared/multipart.ts',import.meta.url).href;
  const file=join(dir,'parse.mjs');await writeFile(file,fixedScript(moduleUrl));
  const r=spawnSync(process.env.DENO_BIN||'deno',['run','--no-config','--no-prompt','--no-check',file],{cwd:dir,encoding:'utf8',timeout:30000});
  if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);
  const out=JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(out.semicolon_equals.deno,'"회의록','req.formData() is the cause: it cuts the quoted name');
  assert.deepEqual({...out.semicolon_equals,deno:undefined},{name:'회의록; 최종=v2.hwp',size:3,type:'application/x-hwp',deno:undefined});
  assert.equal(out.escaped_quote.name,'say "hi".txt');
  assert.equal(out.basket_pc.name,NAME);
  assert.equal(out.filename_star.name,'별표; 이름=1.hwp');
  assert.equal(out.path.name,'evil.txt');
 }finally{await rm(dir,{recursive:true,force:true});}
});
