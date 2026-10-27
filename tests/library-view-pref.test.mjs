// LIB-보기기억·LIB-거르기전체: app/library-view-pref.js(저장 값 해석·[전체] 칩 계산·프로필 칸 읽기/쓰기). 화면 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import('../app/library-view-pref.js');

test('parseView: 비어 있으면 {}, 알려진 칸만, 틀린 모양은 null',()=>{
  assert.deepEqual(m.parseView(null),{});assert.deepEqual(m.parseView(undefined),{});assert.deepEqual(m.parseView({}),{});
  assert.deepEqual(m.parseView({group_by:'month',categories_off:['회의','기타']}),{groupBy:'month',categoriesOff:['회의','기타']});
  assert.deepEqual(m.parseView({group_by:'folder'}),{groupBy:'folder'},'폴더 묶기도 다른 묶기와 똑같이 읽는다');
  assert.deepEqual(m.parseView({categories_off:[]}),{categoriesOff:[]});
  for(const bad of [[],'x',1,{group_by:'Folder'},{group_by:'folders'},{group_by:5},{group_by:null},{extra:1},{categories_off:'회의'},{categories_off:[1]},{categories_off:['']},{categories_off:[' 앞']},{categories_off:['가'.repeat(41)]},{categories_off:['a','a']},{categories_off:Array.from({length:61},(_,i)=>'n'+i)}])
    assert.equal(m.parseView(bad),null,JSON.stringify(bad));
});
test('serializeView: 정해진 칸만, 중복 이름은 합침, 틀린 값은 null',()=>{
  assert.deepEqual(m.serializeView({groupBy:'project'}),{group_by:'project'});
  assert.deepEqual(m.serializeView({categoriesOff:['회의','회의']}),{categories_off:['회의']});
  assert.deepEqual(m.serializeView({groupBy:'category',categoriesOff:[]}),{group_by:'category',categories_off:[]});
  assert.deepEqual(m.serializeView({}),{});
  assert.deepEqual(m.serializeView({groupBy:'folder',categoriesOff:['회의']}),{group_by:'folder',categories_off:['회의']});
  assert.equal(m.serializeView({groupBy:'Folder'}),null);assert.equal(m.serializeView({categoriesOff:['']}),null);
});
test('[전체] 칩: 모두·일부·없음 상태와 누른 뒤의 상태',()=>{
  const names=['교섭','투쟁','회의'];
  assert.equal(m.allState(names,new Set()),'all');assert.equal(m.allState(names,new Set(['회의'])),'some');assert.equal(m.allState(names,new Set(names)),'none');
  assert.equal(m.allState([],new Set()),'all');
  // 목록에 없는 옛 이름이 꺼진 목록에 섞여 있어도 현재 목록만 센다.
  assert.equal(m.allState(names,new Set(['사라진 분류'])),'all');
  assert.deepEqual([...m.afterAllTap(names,new Set())],names,'모두 켜짐 → 모두 끔');
  assert.deepEqual([...m.afterAllTap(names,new Set(['회의']))],[],'일부 → 모두 켬');
  assert.deepEqual([...m.afterAllTap(names,new Set(names))],[],'모두 꺼짐 → 모두 켬');
});
const rt=(handler)=>({context:{read:()=>({user:{id:'u 1'}})},api:handler});
test('readView/saveView: 내 프로필 행 하나만, 칸이 없으면 pending, 실패는 error',async()=>{
  const calls=[];
  const ok=rt(async(path,o)=>{calls.push([path,o]);return o?.method==='PATCH'?[{user_id:'u 1'}]:[{library_view:{group_by:'month'}}]});
  assert.deepEqual(await m.readView(ok),{status:'ok',view:{groupBy:'month'}});
  assert.equal(calls[0][0],'/rest/v1/app_profiles?user_id=eq.u%201&select=library_view&limit=1');
  assert.deepEqual(await m.saveView({groupBy:'month',categoriesOff:['회의']},ok),{status:'ok'});
  assert.equal(calls[1][0],'/rest/v1/app_profiles?user_id=eq.u%201');
  assert.deepEqual(calls[1][1],{method:'PATCH',prefer:'return=representation',body:{library_view:{group_by:'month',categories_off:['회의']}}});
  const missing=rt(async()=>{throw Object.assign(new Error('x'),{status:400})});
  assert.deepEqual(await m.readView(missing),{status:'pending'});assert.deepEqual(await m.saveView({groupBy:'month'},missing),{status:'pending'});
  const broken=rt(async()=>{throw Object.assign(new Error('x'),{status:500})});
  assert.deepEqual(await m.readView(broken),{status:'error'});assert.deepEqual(await m.saveView({groupBy:'month'},broken),{status:'error'});
  assert.deepEqual(await m.readView(rt(async()=>[{library_view:{group_by:'x'}}])),{status:'error'},'모양이 틀린 저장 값은 믿지 않음');
  assert.deepEqual(await m.readView(rt(async()=>[])),{status:'error'});
  assert.deepEqual(await m.saveView({groupBy:'folders'},ok),{status:'error'},'틀린 값은 보내지 않음');
  assert.equal(calls.length,2);
  assert.deepEqual(await m.readView({context:{read:()=>({})},api:async()=>[]}),{status:'error'},'로그인 정보 없음');
});
