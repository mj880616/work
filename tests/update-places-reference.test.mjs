import test from 'node:test';
import assert from 'node:assert/strict';
// REF-참고묶음 화면 2: the 기록할 곳 sheet's 참고 block and the save path for a reference bundle (always a basket update + link).
const events=[];
globalThis.window={dispatchEvent:e=>events.push(e.type),addEventListener:()=>{},KPTUOrganizationOrder:{groupName:()=>'',GROUP_NAMES:['그 외']}};
globalThis.CustomEvent=class{constructor(type){this.type=type}};
const mod=await import('../app/update-places.js');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const places={projects:[{project:{id:'p1',name:'합성 프로젝트',status:'active'},depth:0}],orgs:{recent:[],groups:[[{id:'o1',name:'합성 조직'}]]},bundles:[{id:'b1',name:'공공운수노조'},{id:'b2',name:'기타 조직'}]};

test('reference places round-trip through the sheet value and keep their name',()=>{
  assert.equal(mod.placeValue({kind:'reference',id:'b1'}),'reference:b1');
  assert.deepEqual(mod.placeFromValue('reference:b1'),{kind:'reference',id:'b1'});
  assert.deepEqual(mod.togglePlace([{kind:'organization',id:'o1'}],'reference:b2'),[{kind:'organization',id:'o1'},{kind:'reference',id:'b2'}]);
  assert.equal(mod.placeName(places,{kind:'reference',id:'b2'}),'기타 조직');
  assert.deepEqual(mod.keepPlaces(places,[{kind:'reference',id:'b2'},{kind:'reference',id:'gone'}]),[{kind:'reference',id:'b2'}]);
});

test('the 참고 block is last, under the projects; the 사업 보고 sheet leaves it out',()=>{
  const html=mod.placeSheetHtml(places,[{kind:'reference',id:'b2'}],esc);
  assert.ok(html.indexOf('data-sheet-refs')>html.indexOf('data-sheet-projects'));
  assert.match(html,/data-sheet-value="reference:b2" aria-pressed="true"/);
  assert.match(html,/data-sheet-value="reference:b1" aria-pressed="false"/);
  assert.doesNotMatch(mod.placeSheetHtml(places,[],esc,{basket:false,references:false}),/data-sheet-refs/);
});

test('one bundle alone is a basket update linked to it (never an organization or project record)',async()=>{
  const calls=[];
  const rt={context:{read:()=>({user:{id:'u'},workspace:{id:'w'}})},api:async(path,options={})=>{calls.push({path,...options});if(path==='/rest/v1/app_notes')return [{id:'n1',workspace_id:'w',kind:'basket',raw_text:options.body.raw_text,updated_at:'t1',attachments:[]}];return {ok:true,created:1,existing:0};}};
  const result=await mod.saveUpdate({places:[{kind:'reference',id:'b1'}],text:'노조 소식',owner:'u'},rt);
  assert.equal(result.note.id,'n1');assert.equal(result.linkError,'');
  assert.equal(calls[0].path,'/rest/v1/app_notes');
  assert.equal(calls[1].path,'/rest/v1/rpc/app_basket_confirm_links');
  assert.deepEqual(calls[1].body.p_targets,[{kind:'reference',target_id:'b1',reason:'직접 연결'}]);
  assert.ok(!calls.some(c=>/suborganization_updates|project_progress/.test(c.path)));
});
