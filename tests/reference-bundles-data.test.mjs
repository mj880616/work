import test from 'node:test';
import assert from 'node:assert/strict';
// REF-참고묶음 화면 2: the reference bundle table's owner REST writes (no RPC) and the list helpers.
globalThis.window={dispatchEvent:()=>true,addEventListener:()=>{}};
const mod=await import('../app/reference-bundles-data.js');
const rtFor=api=>({context:{read:()=>({user:{id:'owner'},workspace:{id:'ws 1'}})},api});
const q=path=>new URL(path,'http://fixture');

test('names are trimmed and checked like the database (1~30 characters)',()=>{
  assert.equal(mod.validateBundleName('  기타 조직 '),'기타 조직');
  assert.throws(()=>mod.validateBundleName('   '),/입력/);
  assert.equal(mod.validateBundleName('가'.repeat(30)),'가'.repeat(30));
  assert.throws(()=>mod.validateBundleName('가'.repeat(31)),/30자/);
  assert.throws(()=>mod.validateBundleName('a\0b'),/글자/);
});

test('the list is read inside the signed-in workspace, ordered, and other workspaces are dropped',async()=>{
  const calls=[];
  const rt=rtFor(async path=>{calls.push(path);return [{id:'b2',workspace_id:'ws 1',name:'둘',sort_order:20,created_at:'2026-10-23'},{id:'b1',workspace_id:'ws 1',name:'하나',sort_order:10,created_at:'2026-10-23'},{id:'x',workspace_id:'other',name:'남의 것',sort_order:0}];});
  const rows=await mod.readReferenceBundles(rt);
  assert.deepEqual(rows.map(r=>r.id),['b1','b2']);
  const u=q(calls[0]);assert.equal(u.pathname,'/rest/v1/app_reference_bundles');assert.equal(u.searchParams.get('workspace_id'),'eq.ws 1');
});

test('add puts the bundle last; rename is guarded by updated_at; delete names the id and workspace',async()=>{
  const calls=[];
  const rt=rtFor(async(path,options={})=>{calls.push({path,...options});if(options.method==='POST')return [{id:'new',...options.body}];if(options.method==='PATCH')return [];if(options.method==='DELETE')return [{id:'b1'}];return [];});
  const saved=await mod.createReferenceBundle('  새 묶음 ',[{sort_order:10},{sort_order:30}],rt);
  assert.deepEqual(calls[0].body,{workspace_id:'ws 1',name:'새 묶음',sort_order:40});assert.equal(calls[0].prefer,'return=representation');assert.equal(saved.id,'new');
  assert.equal(await mod.renameReferenceBundle({id:'b1',updated_at:'2026-10-24T00:00:00Z'},'바꾼 이름',rt),null);
  const r=q(calls[1].path);assert.equal(r.searchParams.get('id'),'eq.b1');assert.equal(r.searchParams.get('workspace_id'),'eq.ws 1');assert.equal(r.searchParams.get('updated_at'),'eq.2026-10-24T00:00:00Z');
  assert.equal(calls[1].body.name,'바꾼 이름');assert.deepEqual(Object.keys(calls[1].body).sort(),['name','updated_at']);
  assert.equal(await mod.deleteReferenceBundle('b1',rt),true);
  const d=q(calls[2].path);assert.equal(calls[2].method,'DELETE');assert.equal(d.searchParams.get('id'),'eq.b1');assert.equal(d.searchParams.get('workspace_id'),'eq.ws 1');
});

test('order writes only the rows whose number changes; stats count links and keep the latest date',async()=>{
  assert.deepEqual(mod.orderPatches([{id:'a',sort_order:20},{id:'b',sort_order:10},{id:'c',sort_order:30}]),[{id:'a',sort_order:10},{id:'b',sort_order:20}]);
  const calls=[];const rt=rtFor(async(path,options)=>{calls.push({path,...options});return [{id:q(path).searchParams.get('id').slice(3)}];});
  assert.equal(await mod.saveBundleOrder([{id:'a',sort_order:20},{id:'b',sort_order:10}],rt),2);
  assert.deepEqual(calls.map(c=>c.body),[{sort_order:10},{sort_order:20}]);
  const stats=mod.bundleStats([{bundle_id:'a',occurred_at:'2026-10-20T00:00:00Z'},{bundle_id:'a',occurred_at:'2026-10-22T00:00:00Z'},{bundle_id:'b',occurred_at:'2026-10-21T00:00:00Z'},{organization_id:'o'}]);
  assert.deepEqual(stats.get('a'),{count:2,last:'2026-10-22T00:00:00Z'});assert.equal(stats.get('b').count,1);assert.equal(stats.size,2);
});

test('database refusals are said plainly (409 = same name, or the bundle still holds links)',()=>{
  assert.match(mod.bundleErrorText({status:409}),/같은 이름/);
  assert.match(mod.bundleErrorText({status:409},'delete'),/붙은 소식/);
  assert.match(mod.bundleErrorText(new Error('묶음 이름을 입력해 주세요.')),/입력/);
});
