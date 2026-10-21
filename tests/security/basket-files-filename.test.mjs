import test from 'node:test';
import assert from 'node:assert/strict';

// BASKET-파일명파싱: Deno req.formData() cut quoted file names at ';' and '=' ("회의록; 최종=v2.hwp" -> '"회의록').
// basket-files now reads multipart itself (supabase/functions/basket-files/multipart.ts); these pin its header rules.
const {parseMultipart,parseHeaderParams,decodeExtValue,cleanFileName}=await import('../../supabase/functions/basket-files/multipart.ts');

const enc=new TextEncoder();
const CT='multipart/form-data; boundary=B';
function body(parts,{preamble=''}={}){
  let s=preamble;
  for(const p of parts)s+='--B\r\n'+p.headers.join('\r\n')+'\r\n\r\n'+p.content+'\r\n';
  return enc.encode(s+'--B--\r\n');
}
const filePart=(cd,content='abc',type='application/x-hwp')=>({headers:['Content-Disposition: '+cd,'Content-Type: '+type],content});
const nameOf=cd=>parseMultipart(body([filePart(cd)]),CT).get('file').name;

test('quoted filename keeps ; and = inside the quotes (browser upload of a Korean name)',()=>{
  assert.equal(nameOf('form-data; name="file"; filename="회의록; 최종=v2.hwp"'),'회의록; 최종=v2.hwp');
  assert.equal(nameOf('form-data; name="file"; filename="a=b.txt"'),'a=b.txt');
  assert.equal(nameOf('form-data; name="file"; filename="a;b.txt"'),'a;b.txt');
  assert.equal(nameOf('form-data; filename="x;name=evil"; name="file"'),'x;name=evil','a quoted ; = never starts a new parameter');
});

test('escaped quotes and backslashes inside the quoted string',()=>{
  assert.equal(nameOf('form-data; name="file"; filename="say \\"hi\\".txt"'),'say "hi".txt');
  assert.equal(nameOf('form-data; name="file"; filename="semi\\;colon.txt"'),'semi;colon.txt');
});

test('raw UTF-8 Korean bytes and the basket-pc header (PR #918) are read as is',()=>{
  const name='연구 목적 및 면접조사 (최종).hwp';
  assert.equal(nameOf('form-data; name="file"; filename="'+name+'"'),name);
  assert.equal(nameOf('form-data; name="file"; filename="회의록_ 최종_v2.hwp"'),'회의록_ 최종_v2.hwp');
});

test('RFC 5987 filename* is preferred when valid, ignored when broken',()=>{
  const name='회의록; 최종=v2.hwp';
  assert.equal(nameOf(`form-data; name="file"; filename="fallback.hwp"; filename*=UTF-8''${encodeURIComponent(name)}`),name);
  assert.equal(nameOf(`form-data; name="file"; filename*=utf-8'ko'${encodeURIComponent(name)}; filename="fallback.hwp"`),name,'order does not matter');
  assert.equal(nameOf(`form-data; name="file"; filename*=iso-8859-1''caf%E9.txt`),'café.txt');
  for(const bad of ["UTF-8''%ED%9A","UTF-8''%ZZ","EUC-KR''%C8%B8","no-quotes","UTF-8''a b"])
    assert.equal(nameOf(`form-data; name="file"; filename="fallback.hwp"; filename*=${bad}`),'fallback.hwp',bad);
  assert.equal(decodeExtValue("UTF-8''%E2%82%AC"),'€');
});

test('safety: path separators, control characters and blanks are removed; empty stays empty for validation',()=>{
  assert.equal(nameOf('form-data; name="file"; filename="C:\\\\Users\\\\me\\\\보고서.hwp"'),'보고서.hwp');
  assert.equal(nameOf('form-data; name="file"; filename="../../etc/passwd"'),'passwd');
  assert.equal(nameOf(`form-data; name="file"; filename*=UTF-8''..%2F..%2Fx.txt`),'x.txt');
  assert.equal(nameOf(`form-data; name="file"; filename*=UTF-8''a%00b%0D%0Ac%09d.txt`),'abcd.txt');
  assert.equal(nameOf('form-data; name="file"; filename="  a.txt  "'),'a.txt');
  assert.equal(nameOf('form-data; name="file"; filename=""'),'');
  assert.equal(nameOf('form-data; name="file"; filename="dir/"'),'');
  assert.equal(cleanFileName('a\u0085b/c\u007fd'),'cd');
});

test('text fields, several files, unquoted tokens, preamble and part types',()=>{
  const form=parseMultipart(body([
    {headers:['Content-Disposition: form-data; name="raw_text"'],content:' 메모; a=b \r\n둘째 줄'},
    filePart('form-data; name=file; filename=plain.txt','xy','text/plain'),
    filePart('form-data; name="file"; filename="둘; 째.hwp"','12345'),
    {headers:['Content-Disposition: form-data; name="note_id"'],content:''},
  ],{preamble:'ignored preamble\r\n'}),CT);
  assert.equal(form.get('raw_text'),' 메모; a=b \r\n둘째 줄');
  assert.equal(form.get('note_id'),'');
  const files=form.getAll('file');
  assert.deepEqual(files.map(f=>[f.name,f.size,f.type]),[['plain.txt',2,'text/plain'],['둘; 째.hwp',5,'application/x-hwp']]);
});

test('binary content containing CRLF and boundary-like bytes is kept exactly',async()=>{
  const bytes=new Uint8Array([0,13,10,45,45,67,0,255,13,10,45,45,66,66,45,13]);
  const head=enc.encode('--B\r\nContent-Disposition: form-data; name="file"; filename="b;in.bin"\r\n\r\n');
  const tail=enc.encode('\r\n--B--\r\n');
  const all=new Uint8Array(head.length+bytes.length+tail.length);all.set(head);all.set(bytes,head.length);all.set(tail,head.length+bytes.length);
  const file=parseMultipart(all,CT).get('file');
  assert.equal(file.name,'b;in.bin');assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);
});

test('malformed requests are refused (handler maps to 400 invalid_request)',()=>{
  const ok=body([filePart('form-data; name="file"; filename="a.txt"')]);
  for(const ct of [null,'application/json','multipart/form-data','multipart/form-data; boundary=""','multipart/mixed; boundary=B'])
    assert.throws(()=>parseMultipart(ok,ct),undefined,String(ct));
  assert.throws(()=>parseMultipart(enc.encode('--B\r\nContent-Disposition: form-data; name="file"; filename="a"\r\n\r\nabc'),CT),Error,'unterminated');
  assert.throws(()=>parseMultipart(enc.encode('no boundary at all'),CT));
  assert.throws(()=>parseMultipart(body([{headers:['Content-Disposition: attachment; name="file"; filename="a"'],content:'x'}]),CT));
  assert.throws(()=>parseMultipart(body([{headers:['Content-Type: text/plain'],content:'x'}]),CT),Error,'missing name');
  assert.throws(()=>parseMultipart(body(Array.from({length:65},()=>({headers:['Content-Disposition: form-data; name="x"'],content:'1'}))),CT));
  assert.throws(()=>parseMultipart(body([{headers:['Content-Disposition: form-data; name="x"','X-Pad: '+'a'.repeat(17000)],content:'1'}]),CT));
});

test('header parameter tokenizer',()=>{
  const r=parseHeaderParams('Form-Data ; NAME="a\\"b" ; filename=x.txt; filename="second"; flag; empty=');
  assert.equal(r.type,'form-data');
  assert.deepEqual([...r.params],[['name','a"b'],['filename','x.txt'],['empty','']],'first value wins; valueless keys dropped');
  assert.equal(parseHeaderParams('form-data; filename="unterminated; x=1').params.get('filename'),'unterminated; x=1');
  assert.equal(parseHeaderParams('form-data; filename="a"junk; name=f').params.get('name'),'f');
});

test('browser FormData through Request is read the same way (handler entry point)',async()=>{
  const {readMultipartForm}=await import('../../supabase/functions/basket-files/multipart.ts');
  const fd=new FormData();fd.append('file',new File(['abc'],'회의록; 최종=v2.hwp',{type:'application/x-hwp'}));fd.append('raw_text','메모');
  const form=await readMultipartForm(new Request('https://synthetic.invalid/',{method:'POST',body:fd}));
  assert.equal(form.get('file').name,'회의록; 최종=v2.hwp');assert.equal(form.get('file').size,3);assert.equal(form.get('raw_text'),'메모');
});
