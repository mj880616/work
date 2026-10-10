import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {File} from 'node:buffer';

function runtime(){
  const window=new EventTarget();
  runInNewContext(readFileSync('app/runtime-client.js','utf8'),{window,File,FormData,URLSearchParams,Map,Error});
  return window.KPTURuntime;
}

test('upload copy is a distinct File with identical bytes, name, type and lastModified',async()=>{
  const original=new File(['%PDF-1.4\n자료 🙂'],'한글 자료.pdf',{type:'application/pdf',lastModified:123456789});
  const copy=await runtime().copyUploadFile(original);
  assert.notEqual(copy,original);
  assert.ok(copy instanceof File);
  assert.equal(copy.name,original.name);
  assert.equal(copy.type,original.type);
  assert.equal(copy.lastModified,original.lastModified);
  assert.deepEqual(await copy.arrayBuffer(),await original.arrayBuffer());
});

test('unreadable upload File rejects with a non-retryable read error and no fallback',async()=>{
  const original=new File(['data'],'unreadable.pdf',{type:'application/pdf'});
  let reads=0;
  const cause=new Error('file provider unavailable');
  original.arrayBuffer=async()=>{reads++;throw cause};
  await assert.rejects(()=>runtime().copyUploadFile(original),error=>{
    assert.equal(error.code,'file_read_failed');
    assert.equal(error.message,'파일을 읽지 못했습니다. 파일을 다시 선택해 주세요.');
    assert.equal(error.retryable,false);
    assert.equal(error.cause,cause);
    return true;
  });
  assert.equal(reads,1);
});
