// 빠짐11: 전체 검색 결과 안에서 자료실 자료를 폴더로 옮기는 부품(library-folder-pick.js)의 쓰기·되돌리기 시험. 값은 모두 합성.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moveLibraryDocsToFolder,libraryFolderPlace} from '../app/library-folder-pick.js';

const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b1',F1='00000000-0000-4000-8000-0000000000f1',F2='00000000-0000-4000-8000-0000000000f2';
const folders=[{id:F1,name:'회의자료'},{id:F2,name:'교섭 자료'}];
function fakeRt(fail=new Set()){const calls=[];return {calls,rt:{api:async(path,opt={})=>{calls.push({path,method:opt.method||'GET',body:opt.body});if([...fail].some(id=>path.includes(id)||opt.body?.document_id===id))throw new Error('x');return null}}}}

test('폴더 안 자료는 PATCH, 폴더 밖 자료는 POST, 이미 그 폴더면 건너뜀, 되돌리기는 원래 자리로',async()=>{
  const {calls,rt}=fakeRt();
  const loaded={workspace:'ws-1',folders,itemFolder:new Map([[A,F1]])};
  const r=await moveLibraryDocsToFolder([A,B,'not-uuid'],folders[1],{rt,loaded});
  assert.deepEqual(r.done,[A,B]);assert.deepEqual(r.failed,[]);assert.equal(r.place,'📁 교섭 자료');
  assert.deepEqual(calls.map(c=>[c.method,c.body]),[['PATCH',{folder_id:F2}],['POST',{document_id:B,folder_id:F2,workspace_id:'ws-1'}]]);
  assert.match(calls[0].path,/document_id=eq\.[^&]+&workspace_id=eq\.ws-1/);
  calls.length=0;assert.equal(await r.undo(),true);
  assert.deepEqual(calls.map(c=>[c.method,c.body]),[['PATCH',{folder_id:F1}],['DELETE',undefined]]);
  const same=await moveLibraryDocsToFolder([A],folders[0],{rt,loaded});assert.deepEqual(same.done,[]);assert.equal(same.undo,null);
});
test('폴더 밖으로는 DELETE, 실패한 것만 failed, 되돌리기는 POST',async()=>{
  const {calls,rt}=fakeRt(new Set([B]));
  const loaded={workspace:'ws-1',folders,itemFolder:new Map([[A,F1],[B,F2]])};
  const r=await moveLibraryDocsToFolder([A,B],null,{rt,loaded});
  assert.deepEqual(r.done,[A]);assert.deepEqual(r.failed,[B]);assert.equal(r.place,'폴더 밖');
  calls.length=0;await r.undo();
  assert.deepEqual(calls.map(c=>[c.method,c.body]),[['POST',{document_id:A,folder_id:F1,workspace_id:'ws-1'}]]);
  assert.equal(libraryFolderPlace(folders,F1),'📁 회의자료');
});
