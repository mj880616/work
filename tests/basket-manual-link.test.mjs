import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

globalThis.window={dispatchEvent:()=>true,addEventListener:()=>{}};
const mod=await import('../app/basket-manual-link.js');
const {confirmLinks}=await import('../app/basket-classification.js');
const note='10000000-0000-4000-8000-000000000001',org='30000000-0000-4000-8000-000000000001',project='20000000-0000-4000-8000-000000000001';
const picks=[{kind:'organization',id:org,name:'합성 조직',summary:'10/20 14시 본사 앞, 조합원 30명'},{kind:'project',id:project,name:'합성 프로젝트',summary:'기자회견 장소 협의'}];

test('manual targets carry only the keys the RPC accepts, with the summary and one fixed reason',()=>{
  const targets=mod.manualLinkTargets(picks);
  assert.deepEqual(targets,[
    {kind:'organization',target_id:org,reason:'직접 연결',summary:'10/20 14시 본사 앞, 조합원 30명'},
    {kind:'project',target_id:project,reason:'직접 연결',summary:'기자회견 장소 협의'},
  ]);
  for(const target of targets)assert.deepEqual(Object.keys(target).sort(),['kind','reason','summary','target_id']);
  // The RPC requires reason 1~2,000 characters; the fixed text is never empty.
  assert.ok([...mod.MANUAL_LINK_REASON].length>=1&&[...mod.MANUAL_LINK_REASON].length<=2000);
});

test('one confirm call sends note id, note version and the manual targets unchanged',async()=>{
  const calls=[];const rt={api:async(path,options)=>{calls.push({path,options});return {ok:true,created:2,existing:0};}};
  const result=await confirmLinks(note,'2026-10-06T01:00:00Z',mod.manualLinkTargets(picks),rt);
  assert.deepEqual(result,{ok:true,created:2,existing:0});
  assert.equal(calls.length,1);
  assert.equal(calls[0].path,'/rest/v1/rpc/app_basket_confirm_links');
  assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(Object.keys(calls[0].options.body).sort(),['p_note_id','p_note_updated_at','p_targets']);
  assert.equal(calls[0].options.body.p_note_id,note);
  assert.equal(calls[0].options.body.p_note_updated_at,'2026-10-06T01:00:00Z');
  assert.deepEqual(calls[0].options.body.p_targets,mod.manualLinkTargets(picks));
});

test('summaries are required like the database check: blank, whitespace-only and over 2,000 are refused',()=>{
  assert.equal(mod.invalidManualSelection([]).message,'연결할 담당조직이나 프로젝트를 골라 주세요.');
  assert.deepEqual(mod.invalidManualSelection([{...picks[0],summary:''}]),{index:0,message:'합성 조직: 기록 요약을 입력해 주세요.'});
  assert.equal(mod.invalidManualSelection([picks[0],{...picks[1],summary:' 　\n'}]).index,1);
  assert.equal(mod.invalidManualSelection([{...picks[0],summary:'가'.repeat(2001)}]).message,'합성 조직: 기록 요약은 2,000자까지 쓸 수 있어요.');
  assert.equal(mod.invalidManualSelection([{...picks[0],summary:'가'.repeat(2000)}]),null);
  assert.equal(mod.invalidManualSelection(picks),null);
  assert.match(mod.invalidManualSelection(Array.from({length:21},(_,i)=>({...picks[0],id:String(i)}))).message,/20곳/);
});

test('already confirmed or suggested destinations of this note are recognized, other notes are not',()=>{
  const map=mod.linkedDestinations(note,[
    {note_id:note,status:'confirmed',organization_id:org},
    {note_id:note,status:'suggested',project_id:project},
    {note_id:'other',status:'confirmed',organization_id:'x'},
    {note_id:note,status:'rejected',organization_id:'y'},
  ]);
  assert.deepEqual([...map],[['organization:'+org,'confirmed'],['project:'+project,'suggested']]);
});

test('task defaults and limits follow Google Tasks',()=>{
  assert.equal(mod.firstLine('\n  첫 줄 제목  \n둘째 줄'),'첫 줄 제목');
  assert.equal(mod.firstLine(''),'');
  assert.equal([...mod.firstLine('가'.repeat(1500))].length,1024);
  assert.equal(mod.validateTaskInput({title:'  ',notes:''}),'할 일 제목을 입력해 주세요.');
  assert.equal(mod.validateTaskInput({title:'제목',notes:'가'.repeat(8193)}),'할 일 메모는 8,192자까지 넣을 수 있어요. 줄여 주세요.');
  assert.equal(mod.validateTaskInput({title:'제목',notes:'가'.repeat(8192)}),'');
});

test('plain-language errors for manual linking',()=>{
  assert.match(mod.manualErrorText('NOTE_CHANGED'),/그사이 바뀌었어요/);
  assert.doesNotMatch(mod.manualErrorText('NOTE_CHANGED'),/AI/);
  assert.match(mod.manualErrorText('TARGET_MISSING'),/찾거나 열 수 없어요/);
  assert.equal(mod.manualErrorText('UNKNOWN_CODE'),'연결하지 못했어요. 다시 시도해 주세요.');
});

test('manual linking reuses the existing RPC and task paths and adds no new write path',()=>{
  const source=readFileSync(new URL('../app/basket-manual-link.js',import.meta.url),'utf8');
  assert.match(source,/import \{confirmLinks,ERROR_TEXT\} from '\.\/basket-classification\.js\?v=8'/);
  assert.match(source,/import \{createGoogleTask\} from '\.\/quick-save\.js\?v=2'/);
  assert.doesNotMatch(source,/method:'(POST|PATCH|DELETE)'/);
  assert.doesNotMatch(source,/app_record_links/);
});
