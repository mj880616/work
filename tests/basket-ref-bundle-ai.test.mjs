// REF-참고묶음 AI (docs/design/ref-bundle.md 5절, 9절 질문 5): the AI request lists the reference bundles, the answer check
// accepts kind 'reference' only with a bundle UUID, the preview checks it against the live bundle list, and a reference
// suggestion starts unchecked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildHandoff} from '../app/basket-ai-handoff.js';
import {classificationFormat, parseClassification, parseAIAnswer, previewClassification, readClassificationSnapshot} from '../app/basket-classification.js';
import {startsChecked} from '../app/basket-classification-ui.js';

const now=new Date('2026-10-11T01:02:03.123Z'),stamp=now.toISOString();
const n='10000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001',o='20000000-0000-4000-8000-000000000002';
const b='50000000-0000-4000-8000-000000000001',w='30000000-0000-4000-8000-000000000001';
const note={id:n,raw_text:'노조 전체 소식',updated_at:stamp,occurred_at:stamp,ai_export_allowed:true,attachments:[]};
const proposal=(destinations=[{kind:'reference',target_id:b,reason:'공공운수노조 대의원대회 10/30 예정'}])=>({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations}]});
const snapshot=()=>({workspaceId:w,userId:'owner',notes:[{id:n,workspace_id:w,raw_text:'노조 전체 소식',updated_at:stamp,ai_export_allowed:true}],links:[],
  projects:[{id:p,workspace_id:w,owner_id:'owner',name:'프로젝트',metadata:{project_system:'v2'}}],organizations:[{id:o,workspace_id:w,name:'조직'}],
  bundles:[{id:b,workspace_id:w,name:'공공운수노조',sort_order:10}]});

test('handoff lists the reference bundles right under the organization and project lists',()=>{
  const text=buildHandoff([note],[{id:p,name:'프로젝트'}],[{id:o,name:'조직'}],now,false,[],[{id:b,name:'공공운수노조'}]);
  const org=text.indexOf('담당조직 목록 (ID · 이름)'),project=text.indexOf('프로젝트 목록 (ID · 이름)'),ref=text.indexOf('참고 묶음 목록 (ID · 이름)');
  assert.ok(org>0&&project>org&&ref>project);
  assert.ok(text.includes(`reference · ${b} · 공공운수노조`));
  // No bundles (or a failed read): no empty heading.
  assert.ok(!buildHandoff([note],[],[],now).includes('참고 묶음 목록'));
});

test('the answer format allows reference only when nothing else fits and never together with organization/project',()=>{
  const format=classificationFormat(now);
  assert.ok(format.includes('reference(참고 묶음)는 담당조직·프로젝트 어디에도 맞지 않을 때만 제안하세요. 노조 전체·공공기관 사업 전반·담당이 아닌 조직의 소식이 여기에 해당합니다. 담당조직·프로젝트와 함께 쓰지 마세요.'));
  assert.deepEqual(parseAIAnswer(format),{schema_version:1,copied_at:stamp,items:[]});
});

test('parse accepts kind reference with a UUID and rejects a missing or non-UUID target',()=>{
  const ok=proposal([{kind:'reference',target_id:b.toUpperCase(),reason:'요약'}]);
  assert.equal(parseClassification(JSON.stringify(ok)).items[0].destinations[0].target_id,b);
  for(const target of [{kind:'reference',reason:'요약'},{kind:'reference',target_id:'bundle-1',reason:'요약'},{kind:'reference',target_id:null,reason:'요약'},{kind:'reference',target_id:7,reason:'요약'}])
    assert.throws(()=>parseClassification(JSON.stringify(proposal([target]))),/행.*열/);
});

test('preview checks the bundle by the live list: name, workspace and missing IDs',()=>{
  let t=previewClassification(proposal(),snapshot())[0].destinations[0];
  assert.equal(t.error,null);assert.equal(t.name,'공공운수노조');assert.equal(t.action,'create');
  const other=snapshot();other.bundles[0].workspace_id='other';
  assert.equal(previewClassification(proposal(),other)[0].destinations[0].error,'TARGET_WORKSPACE');
  const missing=snapshot();missing.bundles=[];
  assert.equal(previewClassification(proposal(),missing)[0].destinations[0].error,'TARGET_MISSING');
  // An organization ID handed in as a reference is not a bundle.
  assert.equal(previewClassification(proposal([{kind:'reference',target_id:o,reason:'요약'}]),snapshot())[0].destinations[0].error,'TARGET_MISSING');
  // The existing link to that bundle (bundle_id) makes it an update of that link, not a second one.
  const linked=snapshot();linked.links=[{id:'40000000-0000-4000-8000-000000000001',note_id:n,bundle_id:b,status:'confirmed',summary:null}];
  t=previewClassification(proposal(),linked)[0].destinations[0];assert.equal(t.action,'update');assert.equal(t.linkId,linked.links[0].id);
  // A snapshot without bundles (older callers) refuses rather than guesses.
  const {bundles,...old}=snapshot();assert.equal(previewClassification(proposal(),old)[0].destinations[0].error,'TARGET_MISSING');
});

test('a reference suggestion starts unchecked; organization and project ones start checked',()=>{
  const row=previewClassification(proposal([{kind:'organization',target_id:o,reason:'조직'},{kind:'project',target_id:p,reason:'프로젝트'},{kind:'reference',target_id:b,reason:'참고'}]),snapshot())[0];
  assert.deepEqual(row.destinations.map(startsChecked),[true,true,false]);
  // The preview screen does not re-check a reference row when its error clears.
  const ui=readFileSync(new URL('../app/basket-classification-ui.js',import.meta.url),'utf8');
  assert.match(ui,/checked:startsChecked\(target\)/);
  assert.match(ui,/!target\.error&&target\.kind!=='reference'&&!s\.touched/);
  // The bundles are choices in the 연결할 곳 select too.
  assert.match(ui,/kind:'reference',id:b\.id,name:b\.name/);
});

test('snapshot reads the bundles of this workspace and survives a failed bundle read',async()=>{
  const paths=[];const rt={context:{read:()=>({workspace:{id:w},user:{id:'owner'}})},api:async path=>{paths.push(path);
    if(path.includes('app_reference_bundles'))return [{id:b,workspace_id:w,name:'공공운수노조',sort_order:10}];return [];}};
  const live=await readClassificationSnapshot(proposal(),rt);
  assert.deepEqual(live.bundles.map(x=>x.id),[b]);
  assert.ok(paths.find(x=>x.includes('app_reference_bundles')).includes(`workspace_id=eq.${w}`));
  assert.ok(paths.find(x=>x.includes('app_record_links')).includes('bundle_id'));
  const failing={...rt,api:async path=>{if(path.includes('app_reference_bundles'))throw Error('down');return [];}};
  assert.deepEqual((await readClassificationSnapshot(proposal(),failing)).bundles,[]);
});

test('no new suggested rows, no Edge/server AI path and no link_summary for a reference',()=>{
  const ui=readFileSync(new URL('../app/basket-classification-ui.js',import.meta.url),'utf8'),cls=readFileSync(new URL('../app/basket-classification.js',import.meta.url),'utf8');
  assert.doesNotMatch(ui+cls,/'suggested'|status:'suggested'|link_summary|ai-assist/);
});
