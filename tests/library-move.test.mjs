// LIB-최근올린파일·폴더로옮기기: app/library-move.mjs(최근 올린 파일 고르기·'새' 표시·시각 글자·최근 넣은 폴더·옮길 곳 목록). 화면·네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import('../app/library-move.mjs');
const NOW=Date.parse('2026-10-27T05:00:00Z'); // 서울 14:00
const doc=(id,created_at,extra={})=>({id,created_at,...extra});

test('recentUploads: 서버 올린 시각(created_at) 최신 순 n개, 시각 없는 자료는 뺀다, 같은 시각은 id 순',()=>{
  const docs=[doc('a','2026-10-20T00:00:00Z'),doc('b','2026-10-27T01:00:00Z'),doc('c',null),doc('d','2026-10-27T01:00:00Z'),doc('e','not a date'),doc('f','2026-10-25T00:00:00Z')];
  assert.deepEqual(m.recentUploads(docs,{limit:5}).map(d=>d.id),['b','d','f','a']);
  assert.deepEqual(m.recentUploads(docs,{limit:2}).map(d=>d.id),['b','d']);
  assert.deepEqual(m.recentUploads(docs,{limit:0}),[]);
  assert.deepEqual(m.recentUploads([],{}),[]);assert.deepEqual(m.recentUploads(null),[]);
  assert.equal(m.RECENT_UPLOAD_LIMIT,5);assert.ok(m.RECENT_UPLOAD_MORE>m.RECENT_UPLOAD_LIMIT);
  const many=Array.from({length:30},(_,i)=>doc('x'+i,new Date(NOW-i*60000).toISOString()));
  assert.equal(m.recentUploads(many).length,5);assert.equal(m.recentUploads(many,{limit:m.RECENT_UPLOAD_MORE}).length,m.RECENT_UPLOAD_MORE);
  assert.deepEqual(docs.map(d=>d.id),['a','b','c','d','e','f'],'원본 목록은 그대로');
});

test('isNewUpload: 최근 3일 안만 새, 미래·시각 없음은 새가 아님',()=>{
  const day=24*3600*1000,at=ms=>({created_at:new Date(NOW-ms).toISOString()});
  assert.equal(m.isNewUpload(at(0),NOW),true);assert.equal(m.isNewUpload(at(3*day-1000),NOW),true);
  assert.equal(m.isNewUpload(at(3*day),NOW),false);assert.equal(m.isNewUpload(at(10*day),NOW),false);
  assert.equal(m.isNewUpload({created_at:new Date(NOW+3600000).toISOString()},NOW),false,'미래 시각');
  assert.equal(m.isNewUpload({},NOW),false);assert.equal(m.isNewUpload(null,NOW),false);assert.equal(m.isNewUpload({created_at:'x'},NOW),false);
  assert.equal(m.NEW_DAYS,3);
});

test('uploadTimeLabel: 오늘·어제·월.일 + 시:분, 시각 없으면 빈 글자',()=>{
  const local=(d,h,mi)=>({created_at:new Date(d.getFullYear(),d.getMonth(),d.getDate(),h,mi).toISOString()});
  const now=new Date(2026,9,27,14,0).getTime(),day=new Date(2026,9,27),yest=new Date(2026,9,26),old=new Date(2026,9,20);
  assert.equal(m.uploadTimeLabel(local(day,9,5),now),'오늘 09:05');
  assert.equal(m.uploadTimeLabel(local(yest,23,59),now),'어제 23:59');
  assert.equal(m.uploadTimeLabel(local(old,0,7),now),'10.20 00:07');
  assert.equal(m.uploadTimeLabel({},now),'');assert.equal(m.uploadTimeLabel(null,now),'');
});

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',D='44444444-4444-4444-8444-444444444444';
test('rememberFolder: 맨 앞에 두고 중복·넘침 정리, 틀린 id는 넣지 않음, 원본 그대로',()=>{
  const list=[A,B];
  assert.deepEqual(m.rememberFolder(list,C),[C,A,B]);assert.deepEqual(m.rememberFolder(list,B),[B,A]);
  assert.deepEqual(m.rememberFolder([A,B,C,D,'55555555-5555-4555-8555-555555555555'],'66666666-6666-4666-8666-666666666666').length,5);
  assert.deepEqual(m.rememberFolder(list,'not-an-id'),[A,B]);assert.deepEqual(m.rememberFolder(null,A),[A]);
  assert.deepEqual(list,[A,B]);
  assert.deepEqual(m.cleanRecentFolders([A,'x',A,B,null]),[A,B]);assert.deepEqual(m.cleanRecentFolders('x'),[]);
  assert.equal(m.RECENT_FOLDER_MAX,5);
});

// 폴더: fa(프로젝트 p1) ⊃ fb, fc(프로젝트 p2), fn(프로젝트 없음)
const folders=[
  {id:'fa',project_id:'p1',parent_id:null,name:'가상 A',sort_order:1024},
  {id:'fb',project_id:'p1',parent_id:'fa',name:'가상 B',sort_order:1024},
  {id:'fc',project_id:'p2',parent_id:null,name:'가상 C',sort_order:2048},
  {id:'fn',project_id:null,parent_id:null,name:'가상 N',sort_order:3072},
];
const names=rows=>rows.map(r=>r.name);
test('pickerRows(프로젝트 틀 있음): 같은 틀만 고를 수 있고 나머지는 흐리게 + 이유, 트리 차례와 들여쓰기',()=>{
  const r=m.pickerRows({folders,docs:[{id:'d1',project_id:'p1'}],free:false});
  assert.deepEqual(names(r.all),['가상 A','가상 B','가상 C','가상 N']);assert.deepEqual(r.all.map(x=>x.depth),[0,1,0,0]);
  assert.deepEqual(r.all.map(x=>x.enabled),[true,true,false,false]);
  assert.equal(r.all[2].reason,m.FRAME_REASON);assert.equal(r.all[0].reason,'');assert.equal(r.frameLimited,true);
  assert.equal(r.all[1].label,'가상 A › 가상 B');assert.deepEqual(r.recent,[]);assert.equal(r.total,4);
});
test('pickerRows(폴더 묶기 free): 틀과 무관하게 모두 고를 수 있음',()=>{
  const r=m.pickerRows({folders,docs:[{id:'d1',project_id:'p1'}],free:true});
  assert.deepEqual(r.all.map(x=>x.enabled),[true,true,true,true]);assert.equal(r.frameLimited,false);assert.ok(r.all.every(x=>x.reason===''));
});
test('pickerRows: 프로젝트가 섞인 여러 자료는 틀 있는 묶기에서 모두 흐림(이유 다름), free에서는 가능',()=>{
  const docs=[{id:'d1',project_id:'p1'},{id:'d2',project_id:'p2'}];
  const r=m.pickerRows({folders,docs,free:false});
  assert.ok(r.all.every(x=>!x.enabled&&x.reason===m.MIXED_REASON));
  assert.ok(m.pickerRows({folders,docs,free:true}).all.every(x=>x.enabled));
  // 프로젝트 없는 자료는 프로젝트 없는 폴더에만.
  const none=m.pickerRows({folders,docs:[{id:'d3',project_id:null}],free:false});
  assert.deepEqual(none.all.map(x=>x.enabled),[false,false,false,true]);
});
test('pickerRows: 지금 폴더는 못 고르고 "지금 여기", 여럿이 모두 같은 폴더일 때만',()=>{
  const itemFolder=new Map([['d1','fa'],['d2','fa'],['d3','fb']]);
  const one=m.pickerRows({folders,docs:[{id:'d1',project_id:'p1'}],itemFolder,free:false});
  assert.equal(one.all[0].current,true);assert.equal(one.all[0].enabled,false);assert.equal(one.all[1].enabled,true);
  const same=m.pickerRows({folders,docs:[{id:'d1',project_id:'p1'},{id:'d2',project_id:'p1'}],itemFolder,free:false});
  assert.equal(same.all[0].current,true);
  const diff=m.pickerRows({folders,docs:[{id:'d1',project_id:'p1'},{id:'d3',project_id:'p1'}],itemFolder,free:false});
  assert.equal(diff.all[0].current,false);assert.equal(diff.all[0].enabled,true);assert.equal(diff.all[1].enabled,true);
});
test('pickerRows: 최근 넣은 폴더가 먼저(기억 순서, 없어진 폴더는 건너뜀), 폴더 찾기는 경로 이름에서 찾고 최근이 먼저',()=>{
  const r=m.pickerRows({folders,docs:[{id:'d1',project_id:'p1'}],free:true,recent:[fc(),'99999999-9999-4999-8999-999999999999',fbId()]});
  function fc(){return 'fc'}function fbId(){return 'fb'}
  // 시험용 폴더 id는 uuid 모양이 아니므로 최근으로 인정되지 않는다(서버 기억은 uuid만) → 최근 칸 없음.
  assert.deepEqual(r.recent,[]);
  const uf=[{...folders[0],id:A},{...folders[1],id:B,parent_id:A},{...folders[2],id:C},{...folders[3],id:D}];
  const u=m.pickerRows({folders:uf,docs:[{id:'d1',project_id:'p1'}],free:true,recent:[C,'99999999-9999-4999-8999-999999999999',B]});
  assert.deepEqual(u.recent.map(x=>x.id),[C,B]);assert.ok(u.recent.every(x=>x.recent&&x.depth===0));
  assert.equal(u.recent[1].label,'가상 A › 가상 B');
  assert.deepEqual(u.all.map(x=>x.id),[A,B,C,D],'전체 칸은 트리 차례 그대로');
  const q=m.pickerRows({folders:uf,docs:[{id:'d1',project_id:'p1'}],free:true,recent:[C,B],query:' 가상 '});
  assert.deepEqual(q.recent.map(x=>x.id),[C,B]);assert.ok(q.all.every(x=>x.depth===0),'찾는 중에는 들여쓰지 않고 경로 이름');
  const one=m.pickerRows({folders:uf,docs:[{id:'d1',project_id:'p1'}],free:true,query:'a › 가상 b'});
  assert.deepEqual(one.all.map(x=>x.id),[B]);assert.equal(one.total,4);
  assert.deepEqual(m.pickerRows({folders:uf,docs:[],free:true,query:'없는 폴더'}).all,[]);
});
test('pickerRows: 폴더가 없으면 빈 목록',()=>{
  const r=m.pickerRows({folders:[],docs:[{id:'d1',project_id:null}],free:false});
  assert.deepEqual([r.recent,r.all,r.total,r.frameLimited],[[],[],0,false]);
});
