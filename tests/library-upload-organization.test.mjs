// ORG-자료올리기: 담당조직 상세의 자료 [+]가 자료실 올리기를 그대로 쓰고 올라온 자료를 조직에 붙이는지. 네트워크 없음(runtime은 가짜).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const m=await import('../app/library-upload-organization.js');
const ORG='b0000000-0000-4000-8000-000000000001',DOC='d0000000-0000-4000-8000-000000000002',WS='a0000000-0000-4000-8000-000000000003';

test('normalizeUploadOrganization: only an id makes a target; label names the organization',()=>{
  assert.deepEqual(m.normalizeUploadOrganization({id:` ${ORG} `,name:' 지부 '}),{id:ORG,name:'지부'});
  assert.equal(m.normalizeUploadOrganization({name:'x'}),null);
  assert.equal(m.normalizeUploadOrganization(null),null);
  assert.equal(m.uploadOrganizationLabel(null),'');
  assert.match(m.uploadOrganizationLabel({id:ORG,name:'지부'}),/지부/);
});

test('linkUploadedDocument: one owner-RLS PATCH of organization_id on the uploaded row, verified from the returned row',async()=>{
  const calls=[];
  const rt={api:async(path,o)=>{calls.push([path,o]);return [{id:DOC,organization_id:ORG}]}};
  assert.equal(await m.linkUploadedDocument(rt,{documentId:DOC,workspaceId:WS,organizationId:ORG}),true);
  assert.equal(calls.length,1);
  const [path,o]=calls[0];
  assert.equal(path,`/rest/v1/app_documents?id=eq.${DOC}&workspace_id=eq.${WS}&select=id,organization_id`);
  assert.equal(o.method,'PATCH');assert.equal(o.prefer,'return=representation');
  assert.equal(o.body.organization_id,ORG);
  assert.deepEqual(Object.keys(o.body).sort(),['organization_id','updated_at']);
});

test('linkUploadedDocument: unverified or failed results are false, never throw; missing ids send nothing',async()=>{
  const fail=[{api:async()=>[]},{api:async()=>[{id:DOC,organization_id:null}]},{api:async()=>{throw new Error('x')}},{api:async()=>({})}];
  for(const rt of fail)assert.equal(await m.linkUploadedDocument(rt,{documentId:DOC,workspaceId:WS,organizationId:ORG}),false);
  let called=false;const rt={api:async()=>{called=true;return []}};
  assert.equal(await m.linkUploadedDocument(rt,{documentId:'',workspaceId:WS,organizationId:ORG}),false);
  assert.equal(await m.linkUploadedDocument(rt,{documentId:DOC,workspaceId:WS,organizationId:''}),false);
  assert.equal(called,false);
});

test('library-upload.js: project upload path unchanged (link only when an organization target is set; each open clears it; server fields unchanged)',()=>{
  const s=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  assert.match(s,/if\(luUploadOrg&&!\(await linkUploadedDocument\(/);
  assert.match(s,/newDocument\.addEventListener\('click',\(\)=>\{luResetUploadSelection\(\);luRenderUploadProject\(''\);luSetUploadOrg\(null\);luSetUploadMeeting\(null\)\},true\)/);
  assert.match(s,/startUploadForOrganization:luStartUploadForOrganization/);
  // The same upload request and AI fill as the project path.
  assert.match(s,/luAiFill\(d\.document\.id,fd\)/);
  assert.match(s,/project_id:'#docProject'/);
  assert.doesNotMatch(s,/fd\.append\('organization_id'/);
});

test('workplace-detail.js: 자료 줄 [+] opens the shared upload; the empty hint and dashed box are gone',()=>{
  const s=readFileSync(new URL('../app/workplace-detail.js',import.meta.url),'utf8');
  assert.match(s,/id="wdDocAdd" class="wd-add-plus" type="button" aria-label="자료 올리기" data-wd-doc-add/);
  assert.match(s,/startUploadForOrganization\?\.\(\{id:org\.id,name:org\.name\},files\)/);
  assert.match(s,/bindDropTarget\(zone,/);
  assert.doesNotMatch(s,/붙은 자료가 없습니다|바구니에서 넣을 수 있어요|wd-doc-none/);
  const css=readFileSync(new URL('../app/workplace-detail.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/\.wd-doc-none/);
});
