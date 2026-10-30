import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// TODO-내일만(요청함 10/29 16:41): [내 일 아님]·예외 방·쌓인 후보 다시 거르기의 화면 쪽 데이터와 서버 순수 함수. 가짜 ID·가짜 글만 쓴다.
const mod=await import('../../app/todo-radar-data.js');
const recheck=await import('../../supabase/functions/ai-assist/todo-recheck.ts');
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fakeRt(api){
  const calls=[];
  return {calls,rt:{config:{url:'https://fixture.invalid',key:'anon-fixture'},context:{read:()=>({user:{id:'u'},workspace:{id:'w'}})},
    session:{ensure:async()=>true,read:()=>({access_token:'token-fixture'}),epoch:()=>1},
    api:async(path,opts={})=>{calls.push({path,opts});return api(path,opts);}}};
}
const cand={id:id(1),summary:'가상 남의 일.',source_kind:'meeting'};

test('[내 일 아님]: dismiss first (guarded on open), then keep source kind + summary as an example; undo reopens and removes it',async()=>{
  const {rt,calls}=fakeRt(async(path,opts)=>{
    if(path.startsWith('/rest/v1/app_todo_candidates'))return [{id:id(1),status:opts.body.status}];
    if(path.startsWith('/rest/v1/app_todo_not_mine')&&opts.method==='POST')return [{id:id(50)}];
    return null;});
  const r=await mod.markNotMine(cand,rt);
  assert.deepEqual(r,{ok:true,saved:true,exampleId:id(50)});
  assert.match(calls[0].path,/status=eq\.open/);assert.equal(calls[0].opts.body.status,'dismissed');
  assert.deepEqual(calls[1].opts.body,{workspace_id:'w',source_kind:'meeting',summary:'가상 남의 일.'});
  assert.equal(await mod.undoNotMine(id(1),id(50),rt),true);
  assert.match(calls[2].path,/status=eq\.dismissed/);assert.equal(calls[2].opts.body.status,'open');
  assert.equal(calls[3].opts.method,'DELETE');assert.match(calls[3].path,new RegExp(`app_todo_not_mine\\?id=eq\\.${id(50)}&workspace_id=eq\\.w`));
});
test('[내 일 아님]: not dismissed → nothing saved; example table missing → still out (saved=false); odd candidate refused',async()=>{
  const none=fakeRt(async()=>[]);
  assert.deepEqual(await mod.markNotMine(cand,none.rt),{ok:false});assert.equal(none.calls.length,1);
  const missing=fakeRt(async(path,opts)=>{if(path.includes('app_todo_not_mine')){const e=new Error('PGRST205');e.status=404;throw e;}return [{id:id(1),status:opts.body.status}];});
  assert.deepEqual(await mod.markNotMine(cand,missing.rt),{ok:true,saved:false});
  assert.deepEqual(await mod.markNotMine({...cand,id:'x'},none.rt),{ok:false});
  const odd=fakeRt(async(path,opts)=>[{id:id(1),status:opts.body.status}]);
  assert.deepEqual(await mod.markNotMine({...cand,source_kind:'mail'},odd.rt),{ok:true,saved:false});assert.equal(odd.calls.length,1);
});
test('exception rooms: stored by room key only; bad keys never sent; missing table reported',async()=>{
  const {rt,calls}=fakeRt(async(path)=>path.startsWith('/rest/v1/app_todo_ask_rooms?workspace_id')&&!path.includes('room_key=eq')?[{room_key:'-100123'},{room_key:'bad key'},{}]:null);
  assert.deepEqual(await mod.readAskRooms(rt),{ok:true,keys:['-100123']});
  assert.equal(await mod.addAskRoom('-100123',rt),true);
  assert.deepEqual(calls[1].opts.body,{workspace_id:'w',room_key:'-100123'});assert.match(calls[1].path,/on_conflict=workspace_id,room_key/);assert.match(calls[1].opts.prefer,/ignore-duplicates/);
  assert.equal(await mod.removeAskRoom('-100123',rt),true);assert.equal(calls[2].opts.method,'DELETE');assert.match(calls[2].path,/room_key=eq\.-100123/);
  for(const k of ['','a b','x'.repeat(101),null]){assert.equal(await mod.addAskRoom(k,rt),false);assert.equal(await mod.removeAskRoom(k,rt),false);}
  assert.equal(calls.length,3);
  const gone=fakeRt(async()=>{const e=new Error('relation does not exist');e.status=404;throw e;});
  assert.deepEqual(await mod.readAskRooms(gone.rt),{missing:true});
});
test('recheckTodos sends only {kind} and reads counts; odd answers refused',async()=>{
  const seen=[];const {rt}=fakeRt(async()=>null);
  const ask=body=>mod.recheckTodos({rt,online:()=>true,fetcher:async(url,init)=>{seen.push(JSON.parse(init.body));return new Response(JSON.stringify(body));}});
  assert.deepEqual(await ask({ok:true,kind:'todo_recheck',checked:5,dismissed:2,kept:3,more:true}),{ok:true,checked:5,dismissed:2,more:true});
  assert.deepEqual(seen[0],{kind:'todo_recheck'});
  assert.equal((await ask({ok:true,kind:'todo_recheck',checked:1,dismissed:2})).code,'ai_invalid_response');
  assert.equal((await ask({ok:true,kind:'todo_radar',checked:1,dismissed:0})).code,'ai_invalid_response');
});
test('server recheck rules: keep me/support_named; group-wide only for listed telegram rooms; no verdict keeps; bad answers',()=>{
  const row=(o={})=>({id:id(1),source_kind:'telegram',summary:'가상',evidence:'',room:'group',...o});
  assert.equal(recheck.keepCandidate('me',row()),true);
  assert.equal(recheck.keepCandidate('support_named',row()),true);
  assert.equal(recheck.keepCandidate('group_all',row()),false);
  assert.equal(recheck.keepCandidate('group_all',row({room:'group_listed'})),true);
  assert.equal(recheck.keepCandidate('group_all',row({source_kind:'note',room:null})),false);
  for(const v of ['other','requested_by_me','unclear'])assert.equal(recheck.keepCandidate(v,row({room:'group_listed'})),false,v);
  assert.equal(recheck.keepCandidate(undefined,row()),true);
  const packed=recheck.packRecheck([row(),row({id:id(2)})]);
  assert.deepEqual(packed.map(p=>p.ref),['c1','c2']);
  const r=recheck.parseRecheck(JSON.stringify({items:[{ref:'c1',verdict:'other'},{ref:'c1',verdict:'me'},{ref:'c9',verdict:'me'},{ref:'c2',verdict:'boss'},{ref:'c2',verdict:'me',x:1}]}),packed);
  assert.deepEqual([...r.verdicts],[[id(1),'other']]);assert.equal(r.dropped,4);
  for(const t of [null,'x','[]','{"items":3}'])assert.equal(recheck.parseRecheck(t,packed),null);
  const m=JSON.parse(recheck.recheckMaterial(packed,['가상 예시',' ','<b>x</b>']));
  assert.deepEqual(m.not_mine_examples,['가상 예시','x']);assert.equal(m.candidates[0].room,'단체방');assert.ok(!('id' in m.candidates[0]));
  assert.match(recheck.buildRecheckInstructions(),/requested_by_me: 기록 주인이 다른 사람에게 부탁·요청한 일/);
});
// HOME-업무일지홈: 홈·업무일지 챙길 것 상자(todo-radar.js mountRadar)는 없앴다 — 후보 목록은 정리함(inbox-todos.js) 하나.
test('screen: ⋯ menu with [내 일 아님] on the candidate list, shared anchored menu; settings panel saves on the server only',()=>{
  assert.doesNotMatch(readFileSync('app/todo-radar.js','utf8'),/export function mountRadar/);
  for(const f of ['app/inbox-todos.js']){
    const src=readFileSync(f,'utf8');
    assert.match(src,/import \{createAnchoredMenu\} from '\.\/anchored-menu\.js'/,f);
    assert.match(src,/>내 일 아님<\/button>/,f);assert.match(src,/aria-label="더 보기"/,f);assert.match(src,/markNotMine\(c, rt\)/,f);
  }
  const settings=readFileSync('app/todo-rules-settings.js','utf8');
  assert.match(readFileSync('app/profile-settings.js','utf8'),/import\('\.\/todo-rules-settings\.js'\)/);
  // 공개 저장소: 실제 방 이름·사람 이름을 코드·시험에 쓰지 않는다.
  for(const f of ['app/todo-rules-settings.js','supabase/functions/ai-assist/todo-recheck.ts','supabase/functions/collector-feed/telegram.ts','docs/ops/todo-candidates-source-count.sql'])
    assert.doesNotMatch(readFileSync(f,'utf8'),new RegExp(['궤도'+' 집행','본부'+' 자료방','김'+'명진'].join('|')),f);
  const sql=readFileSync('docs/ops/todo-candidates-source-count.sql','utf8').replace(/--.*$/gm,'');
  assert.doesNotMatch(sql,/\b(insert|update|delete|alter|drop|create|grant|truncate)\b|information_schema|summary|evidence|room_label|\bname\b/i,'select only, counts only');
});
