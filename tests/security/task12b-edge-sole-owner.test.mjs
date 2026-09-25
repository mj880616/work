import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(
  new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url),
  'utf8',
);

const functionBody = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `${start} must exist`);
  assert.notEqual(to, -1, `${end} must exist after ${start}`);
  return source.slice(from, to);
};

test('all seven service-role Edge functions authenticate the caller before privileged work', () => {
  for (const name of [
    'document-actions',
    'workspace-drive',
    'library-files',
    'meeting-files',
    'meeting-ai-draft',
    'page-ai-draft',
    'event-media',
  ]) {
    const source = read(name);
    assert.match(source, /Authorization/);
    assert.match(source, /auth\.getUser\(|\/auth\/v1\/user/);
    assert.match(source, /app_workspace_members/);
    assert.match(source, /role\s*!==\s*['"]owner['"]/);
  }
});

test('document actions authorize against the target document workspace only', () => {
  const body = functionBody(read('document-actions'), 'async function assertDeleteAccess', 'async function deleteDocument');
  assert.match(body, /workspace_id=eq\.\$\{encodeURIComponent\(doc\.workspace_id\)\}/);
  assert.match(body, /members\?\.\[0\]\?\.role !== 'owner'/);
  assert.doesNotMatch(body, /admin|manager|editor|author|uploaded_by/);
});

test('workspace Drive gates upload, token minting, and token redemption by exact workspace owner', () => {
  const source = read('workspace-drive');
  const project = functionBody(source, 'async function projectAccess', 'async function ensureRoot');
  const document = functionBody(source, 'async function checkDocumentAccess', 'Deno.serve');
  assert.match(project, /wm\?\.role!==['"]owner['"]/);
  assert.doesNotMatch(project, /app_space_members/);
  assert.match(document, /doc\.workspace_id/);
  assert.match(document, /wm\?\.role!==['"]owner['"]/);
  assert.match(source, /checkDocumentAccess\(tok\.user_id,tok\.document_id\)/);
  assert.match(source, /checkDocumentAccess\(user\.id,id\)/);
});

test('library, meeting, page AI, and event media reject every non-owner role', () => {
  const library = read('library-files');
  assert.match(library, /import \{ HwpxReader, hwpToText \} from ['"]npm:@ssabrojs\/hwpxjs['"]/);
  assert.match(library, /workspaceFor[\s\S]*?wm\?\.role!==['"]owner['"]/);
  assert.match(library, /canEditProject[\s\S]*?wm\?\.role!==['"]owner['"]/);

  const meetingFiles = read('meeting-files');
  assert.match(meetingFiles, /if\(role!==['"]owner['"]\)throw new MeetingAuthError/);
  assert.doesNotMatch(meetingFiles.slice(meetingFiles.indexOf('Deno.serve')), /await canEditProject/);

  const meetingAi = read('meeting-ai-draft');
  assert.match(meetingAi, /member\?\.role!==['"]owner['"]/);
  assert.doesNotMatch(meetingAi.slice(meetingAi.indexOf('Deno.serve')), /await canEditMeeting/);

  const pageAi = read('page-ai-draft');
  assert.match(pageAi, /mem\?\.role!==['"]owner['"]/);
  assert.match(pageAi, /return wm\?\.role===['"]owner['"]/);

  const eventMedia = read('event-media');
  const access = functionBody(eventMedia, 'async function eventAccess', 'Deno.serve');
  assert.doesNotMatch(eventMedia, /^const URL=/m);
  assert.match(access, /m\?\.role!==['"]owner['"]/);
  assert.doesNotMatch(access, /visibility|app_space_members|owner_id/);
});
