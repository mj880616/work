import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
// MEET-파일로만들기: pdf.js 버전은 scripts/pdf/pdf-pin.json 한 곳에서 정하고, 반입 파일은 SHA256SUMS와 같아야 하며(직접 수정 없음),
// 읽기 모듈은 저장소 안 같은 주소 파일만 부르고 글자만 읽는다(외부 CDN·eval 없음).
const pin=JSON.parse(readFileSync('scripts/pdf/pdf-pin.json','utf8'));
const dir=pin.folder,name=`${pin.package}-${pin.version}`;

test('one pinned pdf.js version is used by the vendored folder and the reader module',()=>{
  assert.equal(pin.package,'pdfjs-dist');
  assert.match(pin.version,/^\d+\.\d+\.\d+$/);
  assert.match(pin.integrity,/^sha512-/);
  assert.deepEqual(readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name),[name]);
  const reader=readFileSync('app/meeting-file-text.js','utf8');
  const named=[...reader.matchAll(/pdf-lib\/(pdfjs-dist-[\d.]+)\//g)].map(m=>m[1]);
  assert.deepEqual([...new Set(named)],[name]);
  assert.ok(readFileSync(`${dir}/SOURCE.md`,'utf8').includes(pin.integrity));
  assert.ok(readFileSync(`${dir}/${name}/LICENSE`,'utf8').includes('Apache License'));
});

test('vendored files match the recorded hashes and stay small',()=>{
  const rows=readFileSync(`${dir}/SHA256SUMS`,'utf8').trim().split('\n').map(line=>line.split(/  /));
  let total=0;
  for(const [hash,path] of rows){const data=readFileSync(`${dir}/${path}`);total+=data.length;assert.equal(createHash('sha256').update(data).digest('hex'),hash,path);}
  assert.ok(rows.some(([,path])=>path.endsWith('cmaps/UniKS-UCS2-H.bcmap')));
  assert.ok(total<3*1048576,`${total} bytes`);
});

test('the reader loads only same-origin vendored files and never evaluates PDF code',()=>{
  const reader=readFileSync('app/meeting-file-text.js','utf8').replace(/^\s*\/\/.*$/gm,'');
  assert.doesNotMatch(reader,/https?:\/\//);
  assert.match(reader,/new URL\('\.\/pdf-lib\/pdfjs-dist-[\d.]+\/',import\.meta\.url\)/);
  assert.match(reader,/isEvalSupported:false/);
  // HWP goes through the existing sandboxed editor frame, not a new frame.
  assert.match(reader,/import\('\.\/hwp-frame\.js'\)/);
  assert.doesNotMatch(reader,/createElement\('iframe'\)/);
});
