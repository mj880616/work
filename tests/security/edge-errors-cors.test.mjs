// EDGE-서버함수정리 C2: 오류 원문 숨김(_shared/safe-error.ts)과 Web2 출처 제한 CORS(_shared/web-cors.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { safeErrorMessage, safeErrorLog, SAFE_ERROR_FALLBACK } from '../../supabase/functions/_shared/safe-error.ts';
import { withWebCors, applyWebCors, WEB2_ORIGINS } from '../../supabase/functions/_shared/web-cors.ts';

test('safeErrorMessage keeps authored Korean text and codes, hides DB, upstream and runtime text', () => {
  for (const kept of ['로그인이 필요합니다.', 'Drive 루트 폴더 생성 실패', '연 뒤에 Drive의 원본이 바뀌었습니다. 덮어쓰지 않았습니다. [새 파일로 저장]을 써 주세요.',
    'TASKS_SCOPE_REQUIRED', 'journal_draft_not_ready', 'HWP_REFUSED', 'DB 요청 실패 (500)']) {
    assert.equal(safeErrorMessage(new Error(kept)), kept, kept);
  }
  const hidden = [
    new Error('duplicate key value violates unique constraint "app_documents_pkey"'),
    { message: 'permission denied for table app_workspace_members', code: '42501', details: 'x', hint: 'y' },
    new Error('Request had insufficient authentication scopes.'),
    new TypeError("Cannot read properties of undefined (reading 'id')"),
    new Error('저장 실패: invalid input syntax for type uuid'),
    new Error('오류 {"code":"PGRST116"}'),
    new Error('<html>502 Bad Gateway</html>'),
    new Error('가'.repeat(201)),
    new Error('fetch'), 'raw string error', null, undefined, 42, {}
  ];
  for (const e of hidden) assert.equal(safeErrorMessage(e), SAFE_ERROR_FALLBACK, String(e?.message ?? e));
  assert.equal(safeErrorMessage(new Error('boom boom boom'), '다른 문구'), '다른 문구');
});

test('safeErrorLog records only name, short code and numeric status', () => {
  assert.deepEqual(safeErrorLog({ message: 'permission denied for table x', code: '42501', details: 'row', hint: 'h', status: 403 }), { code: '42501', status: 403 });
  assert.deepEqual(safeErrorLog(new TypeError('secret text')), { name: 'TypeError' });
  assert.deepEqual(safeErrorLog({ code: 'has spaces and text', status: '500' }), {});
  assert.deepEqual(safeErrorLog('text'), {});
  assert.equal(JSON.stringify(safeErrorLog(Object.assign(new Error('token-abc'), { code: 'x' }))).includes('token-abc'), false);
});

test('web CORS echoes only the four owned origins and never sends a wildcard', async () => {
  assert.deepEqual([...WEB2_ORIGINS].sort(), ['https://bokdoong.com', 'https://desk.bokdoong.com', 'https://mj880616.github.io', 'https://work.bokdoong.com']);
  const h = withWebCors(async req => new Response(req.method === 'OPTIONS' ? 'ok' : '{}', { status: req.method === 'OPTIONS' ? 200 : 401, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization', Vary: 'Accept-Encoding' } }));
  for (const origin of WEB2_ORIGINS) {
    for (const method of ['OPTIONS', 'POST']) {
      const r = await h(new Request('https://x.supabase.co/functions/v1/f', { method, headers: { Origin: origin } }));
      assert.equal(r.headers.get('Access-Control-Allow-Origin'), origin);
      assert.equal(r.headers.get('Access-Control-Allow-Headers'), 'authorization');
      assert.equal(r.headers.get('Vary'), 'Accept-Encoding, Origin');
      assert.equal(r.status, method === 'OPTIONS' ? 200 : 401);
    }
  }
  for (const origin of ['https://evil.example', 'http://bokdoong.com', 'https://www.bokdoong.com', 'https://bokdoong.com.evil.example', 'https://bokdoong.com:8443', 'null']) {
    const r = await h(new Request('https://x.supabase.co/functions/v1/f', { method: 'OPTIONS', headers: { Origin: origin } }));
    assert.equal(r.status, 200, 'preflight still answers; the browser blocks the read');
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), null, origin);
  }
  // 출처 머리글 없는 호출(폰 위젯·바구니 PC·예약 호출)은 응답이 그대로다.
  const native = await h(new Request('https://x.supabase.co/functions/v1/f', { method: 'POST' }));
  assert.equal(native.status, 401);
  assert.equal(native.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(await native.text(), '{}');
  const empty = applyWebCors(new Request('https://x/f', { headers: { Origin: 'https://bokdoong.com' } }), new Response(null, { status: 204, headers: { Vary: 'origin' } }));
  assert.equal(empty.status, 204);
  assert.equal(empty.headers.get('Vary'), 'origin');
});

const FN = new URL('../../supabase/functions/', import.meta.url);
const WRAPPED = ['ai-assist', 'basket-files', 'collector-feed', 'document-actions', 'document-ai-index', 'drive-summary', 'event-media', 'gdrive-photos',
  'google-calendar', 'google-tasks', 'library-files', 'meeting-ai-draft', 'meeting-ai-ingest', 'meeting-files', 'meeting-transcribe', 'news-feed',
  'onedrive-photos', 'outside-feed', 'page-ai-draft', 'phone-push', 'share-page-media', 'workspace-drive'];
// 자기 출처 목록을 따로 가진 공개·로그인 전달 함수, 그리고 410만 돌려주는 퇴역 함수.
const OWN_ORIGINS = ['auth-handoff', 'pc0914-checklist', 'pc0921-board', 'public-page-edit', 'public-policy-drive', 'share-page-read', 'push-notifications'];

test('no Edge function source sends a wildcard CORS origin; Web2 functions go through withWebCors', () => {
  const dirs = readdirSync(FN, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name).sort();
  assert.deepEqual(dirs, [...WRAPPED, ...OWN_ORIGINS].sort(), 'every function is classified');
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(new URL(d.name + '/', dir)) : [new URL(d.name, dir)]);
  for (const file of walk(FN).filter(u => /\.(ts|mjs)$/.test(u.pathname))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /Access-Control-Allow-Origin['"]?\s*[:=,]\s*['"]\*['"]/, file.pathname);
  }
  for (const name of WRAPPED) {
    const src = readFileSync(new URL(`${name}/index.ts`, FN), 'utf8');
    assert.match(src, /^import \{ withWebCors \} from "\.\.\/_shared\/web-cors\.ts";$/m, name);
    assert.equal(src.match(/Deno\.serve\(/g).length, 1, name);
    assert.match(src, /Deno\.serve\(withWebCors\(/, name);
  }
});

const SAFE = ['document-actions', 'document-ai-index', 'event-media', 'google-calendar', 'google-tasks', 'library-files', 'meeting-ai-draft',
  'meeting-ai-ingest', 'meeting-files', 'page-ai-draft', 'pc0914-checklist', 'pc0921-board', 'public-policy-drive', 'workspace-drive'];

test('old functions return no raw error text and log no raw detail', () => {
  for (const name of SAFE) {
    const src = readFileSync(new URL(`${name}/index.ts`, FN), 'utf8');
    assert.doesNotMatch(src, /error\s*:\s*(?:e|err|error) instanceof Error\s*\?\s*(?:e|err|error)\.message\s*:\s*String/, `${name} response`);
    assert.doesNotMatch(src, /warning\s*:\s*(?:e|err) instanceof Error/, `${name} warning`);
    assert.doesNotMatch(src, /\{\s*error\s*:\s*error\.message\s*\}/, `${name} db message`);
    assert.doesNotMatch(src, /console\.(?:error|warn|log)\((?:e|err|error)\)/, `${name} raw log`);
    assert.doesNotMatch(src, /console\.(?:error|warn|log)\([^)]*,\s*(?:e|err)\)/, `${name} raw log arg`);
    assert.doesNotMatch(src, /\{\s*status\s*,\s*detail\s*\}/, `${name} upstream detail log`);
    assert.doesNotMatch(src, /console\.error\(await [A-Za-z]+\.text\(\)\)/, `${name} response body log`);
    assert.doesNotMatch(src, /message\s*:\s*error\.message/, `${name} db message log`);
    assert.doesNotMatch(src, /detail\s*:\s*\(await/, `${name} db body log`);
  }
  assert.ok(existsSync(new URL('_shared/safe-error.ts', FN)));
});
