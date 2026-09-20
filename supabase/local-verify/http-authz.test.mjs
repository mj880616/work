import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const api = process.env.API_URL;
const anonKey = process.env.ANON_KEY;
const usersPath = process.env.LOCAL_USERS_FILE;
if (!api || !anonKey || !usersPath) throw new Error('Local Supabase test environment is incomplete');
const parsed = new URL(api);
if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
  throw new Error('HTTP authorization tests may target only a loopback Supabase API');
}
const users = JSON.parse(readFileSync(usersPath, 'utf8'));
const owner = users.owner.accessToken;
const viewer = users.viewer.accessToken;
const outsider = users.outsider.accessToken;
const project = '90000000-0000-4000-8000-000000000020';
const child = '90000000-0000-4000-8000-000000000021';
const block = '90000000-0000-4000-8000-000000000031';
const meeting = '90000000-0000-4000-8000-000000000041';
const file = '90000000-0000-4000-8000-000000000050';
const slugFor = id => `project-${id.replaceAll('-', '')}`;

async function call(path, {token = anonKey, method = 'GET', body, headers = {}} = {}) {
  const response = await fetch(new URL(path, api), {
    method,
    headers: {apikey: anonKey, Authorization: `Bearer ${token}`, ...headers,
      ...(body !== undefined && !(body instanceof FormData) ? {'Content-Type': 'application/json'} : {})},
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return {status: response.status, data};
}
const rpc = (name, args, token = anonKey) =>
  call(`/rest/v1/rpc/${name}`, {token, method: 'POST', body: args});
const hidden = result => result.status >= 400 ||
  result.data == null || (Array.isArray(result.data) && result.data.length === 0);
const publicProject = id => rpc('app_public_project', {p_slug: slugFor(id)});
const publicPost = slug => rpc('app_public_post', {p_slug: slug});

test('synthetic local Supabase authorization and public URL flow', async t => {
  await t.test('anon sees no internal direct IDs or private RPC payloads', async () => {
    for (const [table, id] of [
      ['app_spaces', project], ['app_spaces', child], ['app_meetings', meeting],
      ['app_documents', file], ['app_tasks', '90000000-0000-4000-8000-000000000042'],
    ]) {
      assert.ok(hidden(await call(`/rest/v1/${table}?id=eq.${id}&select=*`)), `${table} leaked to anon`);
    }
    assert.ok(hidden(await call('/rest/v1/app_pages?slug=eq.local-private-post&select=*')));
    assert.deepEqual((await publicPost('local-private-post')).data, []);
    assert.equal((await publicProject(project)).data, null);
    assert.equal((await publicProject(child)).data, null);
  });

  await t.test('seven legacy page URLs and fourteen document URLs remain public', async () => {
    const unlisted = [
      'bus-strike-publicness-internal-archive-202609',
      'gimpo-publicization', 'gimpo-publicization-audit',
      'gimpo-publicization-press-1008', 'line9-publicization',
      'line9-publicization-audit',
    ];
    for (const slug of unlisted) {
      const result = await publicPost(slug);
      assert.equal(result.status, 200, slug);
      assert.equal(result.data?.length, 1, slug);
      assert.equal(result.data[0].indexable, false, slug);
    }
    const forum = await publicPost('private-rail-forum-0929-prep');
    assert.equal(forum.data?.length, 1);
    assert.equal(forum.data[0].indexable, true);
    for (let n = 100; n <= 113; n++) {
      const slug = `public-doc-90000000${String(n).padStart(4, '0')}`;
      assert.equal((await publicPost(slug)).data?.length, 1, slug);
    }
  });

  await t.test('owner reads internal data; outsider IDs are denied', async () => {
    for (const [table, id] of [
      ['app_spaces', project], ['app_meetings', meeting], ['app_documents', file],
    ]) {
      const own = await call(`/rest/v1/${table}?id=eq.${id}&select=*`, {token: owner});
      assert.equal(own.status, 200, table);
      assert.equal(own.data?.length, 1, table);
      assert.ok(hidden(await call(`/rest/v1/${table}?id=eq.${id}&select=*`, {token: outsider})), table);
    }
    assert.ok(hidden(await call(`/rest/v1/app_documents?id=eq.${file}&select=*`, {token: viewer})));
    assert.equal((await call('/rest/v1/app_pages?slug=eq.local-private-post&select=id', {token: owner})).data?.length, 1);
    assert.ok(hidden(await call('/rest/v1/app_pages?slug=eq.local-private-post&select=id', {token: outsider})));
  });

  await t.test('private post publish and revoke changes the same URL immediately', async () => {
    assert.deepEqual((await publicPost('local-private-post')).data, []);
    const publish = await call('/rest/v1/app_pages?slug=eq.local-private-post', {
      token: owner, method: 'PATCH', body: {visibility: 'public'},
      headers: {Prefer: 'return=representation'},
    });
    assert.equal(publish.status, 200);
    assert.equal(publish.data?.length, 1);
    assert.equal((await publicPost('local-private-post')).data?.length, 1);
    const revoke = await call('/rest/v1/app_pages?slug=eq.local-private-post', {
      token: owner, method: 'PATCH', body: {visibility: 'private'},
      headers: {Prefer: 'return=representation'},
    });
    assert.equal(revoke.status, 200);
    assert.equal(revoke.data?.length, 1);
    assert.deepEqual((await publicPost('local-private-post')).data, []);
  });

  await t.test('child publication is independent; canonical project edit reaches public view', async () => {
    assert.equal((await rpc('app_set_project_publication',
      {p_project: child, p_publish: true, p_confirm: true, p_summary: 'Safe child'}, outsider)).data, false);
    assert.equal((await rpc('app_set_project_publication',
      {p_project: child, p_publish: true, p_confirm: false, p_summary: 'Safe child'}, owner)).data, false);
    assert.equal((await rpc('app_set_project_publication',
      {p_project: child, p_publish: true, p_confirm: true, p_summary: 'Safe child'}, owner)).data, true);
    assert.equal((await publicProject(child)).data?.title, 'LOCAL PRIVATE SUBPAGE');
    assert.equal((await publicProject(project)).data, null);
    assert.equal((await rpc('app_set_project_publication',
      {p_project: child, p_publish: false, p_confirm: false, p_summary: null}, owner)).data, true);
    assert.equal((await publicProject(child)).data, null);

    assert.equal((await rpc('app_set_project_block_publication',
      {p_block: block, p_publish: true, p_confirm: true, p_order: 10}, owner)).data, true);
    assert.equal((await rpc('app_set_project_publication',
      {p_project: project, p_publish: true, p_confirm: true, p_summary: 'Synthetic safe summary'}, owner)).data, true);
    const first = await publicProject(project);
    assert.equal(first.data?.blocks?.[0]?.content?.text, 'Synthetic public candidate');
    const serialized = JSON.stringify(first.data);
    for (const forbidden of [
      'private_key', 'never disclose', 'Synthetic internal memo',
      'Synthetic internal task note', 'Synthetic internal file text',
      'workspace_id', 'owner_id', 'assignee_id', 'author_id', 'metadata',
    ]) assert.ok(!serialized.includes(forbidden), `Public project leaked ${forbidden}`);

    const edited = await call(`/rest/v1/app_project_blocks?id=eq.${block}`, {
      token: owner, method: 'PATCH',
      body: {content: {text: 'Changed canonical content', private_key: 'never disclose'}},
      headers: {Prefer: 'return=representation'},
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.data?.length, 1);
    assert.equal((await publicProject(project)).data?.blocks?.[0]?.content?.text, 'Changed canonical content');
    assert.equal((await rpc('app_set_project_publication',
      {p_project: project, p_publish: false, p_confirm: false, p_summary: null}, owner)).data, true);
    assert.equal((await publicProject(project)).data, null);
  });

  await t.test('meeting Edge Functions stop unauthorized IDs before AI or Drive', async () => {
    const json = {'Content-Type': 'application/json'};
    const draftBody = {meeting_id: meeting};
    const anonDraft = await call('/functions/v1/meeting-ai-draft', {method: 'POST', body: draftBody, token: anonKey});
    assert.ok(anonDraft.status >= 400);
    const outsiderDraft = await call('/functions/v1/meeting-ai-draft', {method: 'POST', body: draftBody, token: outsider});
    assert.ok(outsiderDraft.status >= 400);
    assert.ok(!JSON.stringify(outsiderDraft.data).includes('Synthetic private'));
    const ownerDraft = await call('/functions/v1/meeting-ai-draft', {method: 'POST', body: draftBody, token: owner});
    assert.ok(ownerDraft.status >= 400);
    assert.match(String(ownerDraft.data?.error), /팀 AI 설정|녹취 텍스트/);

    const outsiderIngest = await call('/functions/v1/meeting-ai-ingest', {
      method: 'POST', body: {meeting_id: meeting}, token: outsider, headers: json,
    });
    const anonIngest = await call('/functions/v1/meeting-ai-ingest', {
      method: 'POST', body: {meeting_id: meeting}, token: anonKey, headers: json,
    });
    assert.ok(anonIngest.status >= 400);
    assert.ok(outsiderIngest.status >= 400);
    const ownerIngest = await call('/functions/v1/meeting-ai-ingest', {
      method: 'POST', body: {meeting_id: meeting}, token: owner, headers: json,
    });
    assert.equal(ownerIngest.status, 200);
    assert.equal(ownerIngest.data?.ok, true);
    assert.match(ownerIngest.data?.materials_text || '', /Synthetic internal file text/);

    const form = () => {
      const value = new FormData();
      value.append('meeting_id', meeting);
      value.append('file', new Blob(['synthetic file'], {type: 'text/plain'}), 'local.txt');
      return value;
    };
    const anonFile = await call('/functions/v1/meeting-files', {method: 'POST', body: form(), token: anonKey});
    assert.ok(anonFile.status >= 400);
    const outsiderFile = await call('/functions/v1/meeting-files', {method: 'POST', body: form(), token: outsider});
    assert.ok(outsiderFile.status >= 400);
    const ownerFile = await call('/functions/v1/meeting-files', {method: 'POST', body: form(), token: owner});
    assert.ok(ownerFile.status >= 400);
    assert.match(String(ownerFile.data?.error), /Google Drive 연결 설정/);
  });
});
