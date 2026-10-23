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
  assert.deepEqual(archive.undoPatch.body('published', 'U'), {status:'published', updated_at:'U'});
  assert.deepEqual(archive.undoPatch.body('anything-else', null), {status:'draft'});
  assert.equal(archive.archiveFilter, 'status=neq.archived');
  // The screen never sends a DELETE for a share page and never calls the photo clean-up when archiving (photo files stay).
  const body = screen.slice(screen.indexOf('async function archivePage'), screen.indexOf('// ── editor ──'));
  assert.doesNotMatch(body, /method:\s*'DELETE'/);
  assert.doesNotMatch(body, /prune|createSharePhotos|app_share_page_links|share-page-media/);
  assert.match(screen, /app_share_pages\?workspace_id=eq\.\$\{q\(workspaceId\(\)\)\}&select=id,title,status,project_id,updated_at&\$\{archiveFilter\}/);
});

test('the confirmation says the link stops only for a published page', () => {
  assert.match(archive.archiveConfirmText({title:'교섭 현황', status:'published'}), /링크로 보던 사람도 더 이상 볼 수 없어요/);
  assert.doesNotMatch(archive.archiveConfirmText({title:'교섭 현황', status:'draft'}), /링크/);
  assert.match(archive.archiveConfirmText({title:'', status:'draft'}), /제목 없음/);
  assert.equal(archive.shortTitle('가'.repeat(30)), '가'.repeat(24) + '…');
});

test('the weekly journal leaves archived share pages out', () => {
  assert.match(readFileSync('app/journal-data.js', 'utf8'), /app_share_pages\?[^`]*&status=neq\.archived&select=/);
});
