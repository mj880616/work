import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// SHARE-페이지삭제: deleting a share page keeps the record (status 'archived'); the screen, the DB check and the public reader agree.
const archive = await import('../../app/share-pages-archive.mjs');
const screen = readFileSync('app/share-pages.js', 'utf8');
const migration = readFileSync('supabase/migrations/20261023160000_share_pages_archived_status.sql', 'utf8');
const reader = readFileSync('supabase/functions/share-page-read/handler.ts', 'utf8');

test('the archived value is the one the DB check accepts and the public reader refuses', () => {
  assert.equal(archive.ARCHIVED, 'archived');
  assert.ok(migration.includes(`status in ('draft', 'published', '${archive.ARCHIVED}')`));
  // The reader shows only published pages, so an archived page (and its still-existing links) answers 404 without an Edge change.
  assert.match(reader, /page\.status !== "published"\) return notFound\(\)/);
});

test('archive and undo are conditional PATCH requests on this workspace, never a row delete', () => {
  const where = archive.archivePatch.where('p 1', 'w/1', '2026-10-23T00:00:00+00:00');
  assert.equal(where, 'id=eq.p%201&workspace_id=eq.w%2F1&status=neq.archived&updated_at=eq.2026-10-23T00%3A00%3A00%2B00%3A00');
  assert.deepEqual(archive.archivePatch.body('N'), {status:'archived', updated_at:'N'});
  assert.equal(archive.undoPatch.where('p', 'w', 'T'), 'id=eq.p&workspace_id=eq.w&status=eq.archived&updated_at=eq.T');
  // 되살리기 from the 보관함: only a kept row as read, always back as a draft.
  assert.equal(archive.restorePatch.where('p', 'w', 'T'), 'id=eq.p&workspace_id=eq.w&status=eq.archived&updated_at=eq.T');
  assert.deepEqual(archive.restorePatch.body('N'), {status:'draft', updated_at:'N'});
  assert.equal(archive.boxFilter, 'status=eq.archived');
  assert.deepEqual(archive.undoPatch.body('published', 'U'), {status:'published', updated_at:'U'});
  assert.deepEqual(archive.undoPatch.body('anything-else', null), {status:'draft'});
  assert.equal(archive.archiveFilter, 'status=neq.archived');
  // The screen never sends a DELETE for a share page and never calls the photo clean-up when archiving (photo files stay).
  const body = screen.slice(screen.indexOf('async function archivePage'), screen.indexOf('// ── editor ──'));
  assert.doesNotMatch(body, /method:\s*'DELETE'/);
  assert.doesNotMatch(body, /prune|createSharePhotos|app_share_page_links|share-page-media/);
  // The real delete goes only through the server (purgePage → share-page-media purge_page), never a REST delete from the browser.
  assert.match(body, /await purgePage\(id, \{rt\}\)/);
  assert.match(screen, /app_share_pages\?workspace_id=eq\.\$\{ws\}&select=id,title,updated_at&\$\{boxFilter\}/);
  assert.match(screen, /app_share_pages\?workspace_id=eq\.\$\{ws\}&select=id,title,status,project_id,updated_at&\$\{archiveFilter\}/);
});

test('the confirmations: 보관 says the link stops only for a published page; 삭제 says everything goes for good', () => {
  assert.match(archive.archiveConfirmText({title:'교섭 현황', status:'published'}), /링크로 보던 사람도 더 이상 볼 수 없어요/);
  assert.match(archive.purgeConfirmText({title:'교섭 현황'}), /페이지·링크·사진이 모두 지워지고 되살릴 수 없어요/);
  assert.doesNotMatch(archive.archiveConfirmText({title:'교섭 현황', status:'draft'}), /링크/);
  assert.match(archive.archiveConfirmText({title:'', status:'draft'}), /제목 없음/);
  assert.equal(archive.shortTitle('가'.repeat(30)), '가'.repeat(24) + '…');
});

test('the weekly journal leaves archived share pages out', () => {
  assert.match(readFileSync('app/journal-data.js', 'utf8'), /app_share_pages\?[^`]*&status=neq\.archived&select=/);
});

test('purgePage sends purge_page with the login to share-page-media and turns answers into plain messages', async () => {
  const rt = {config:{url:'https://x.supabase.co', key:'anon'}, session:{ensure:async () => true, read:() => ({access_token:'tok'})}};
  const seen = [];
  const reply = (status, data) => async (url, init) => { seen.push({url, init}); return {ok:status < 400, status, json:async () => data}; };
  assert.deepEqual(await archive.purgePage('p1', {rt, fetcher:reply(200, {ok:true})}), {ok:true});
  assert.equal(seen[0].url, 'https://x.supabase.co/functions/v1/share-page-media');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(seen[0].init.body), {action:'purge_page', page_id:'p1'});
  assert.match((await archive.purgePage('p1', {rt, fetcher:reply(503, {error:'unavailable'})})).message, /다시 \[삭제\]를 누르면 남은 것부터/);
  assert.equal((await archive.purgePage('p1', {rt, fetcher:reply(404, {error:'not_found'})})).status, 404);
  assert.equal((await archive.purgePage('p1', {rt, fetcher:async () => { throw new Error('net'); }})).ok, false);
  const out = {...rt, session:{ensure:async () => false, read:() => null}};
  let called = 0;
  assert.equal((await archive.purgePage('p1', {rt:out, fetcher:async () => { called++; }})).status, 401);
  assert.equal(called, 0);
});
