// MCP-Claude읽기 M-5: 동의 화면·설정 칸 판정(app/mcp-read-model.mjs)과 화면 파일의 경계.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from '../app/mcp-read-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = claims => `${b64({alg: 'HS256'})}.${b64(claims)}.sig`;

test('되돌아갈 곳은 claude.ai만', () => {
  assert.equal(M.safeClaudeRedirect('https://claude.ai/api/mcp/auth_callback?code=1'), 'https://claude.ai/api/mcp/auth_callback?code=1');
  for (const bad of ['https://claude.ai.evil.example/x', 'http://claude.ai/x', 'javascript:alert(1)', 'https://evil.example/?https://claude.ai', 'https://u:p@claude.ai/x', '', null, '/relative'])
    assert.equal(M.safeClaudeRedirect(bad), '', String(bad));
});

test('요청 번호 모양', () => {
  assert.equal(M.validAuthorizationId('auth-0123456789abcdef'), true);
  for (const bad of ['', 'short', 'a/b/../../c-123456', 'x'.repeat(201), null]) assert.equal(M.validAuthorizationId(bad), false);
  assert.equal(M.consentPath('ab cd'), '/auth/v1/oauth/authorizations/ab%20cd/consent');
});

test('위임 열쇠(client_id 있음)는 동의 화면을 열 수 없다', () => {
  assert.equal(M.isDelegatedToken(jwt({sub: 'u', client_id: 'c'})), true);
  assert.equal(M.isDelegatedToken(jwt({sub: 'u'})), false);
  assert.equal(M.isDelegatedToken(jwt({sub: 'u', client_id: ''})), false);
  assert.equal(M.isDelegatedToken('not-a-jwt'), false);
});

test('동의 요청 정리: 이미 허락한 연결은 claude.ai 주소만', () => {
  assert.deepEqual(M.readDetails({redirect_url: 'https://claude.ai/cb?code=1'}), {kind: 'redirect', url: 'https://claude.ai/cb?code=1'});
  assert.deepEqual(M.readDetails({redirect_url: 'https://evil.example/cb'}), {kind: 'redirect', url: ''});
  const d = M.readDetails({authorization_id: 'a', redirect_uri: M.CLAUDE_CALLBACK, client: {client_id: 'cid', name: 'Claude'}, scope: 'openid'});
  assert.equal(d.kind, 'ask'); assert.equal(d.clientId, 'cid'); assert.equal(d.clientName, 'Claude');
  assert.deepEqual(M.readDetails(null), {kind: 'bad'});
});

test('화면 거절 판정: owner·설정 행·되돌아갈 곳·클라이언트. 스위치 꺼짐은 거절하지 않는다(설계 9.1 순서)', () => {
  const details = M.readDetails({authorization_id: 'a', redirect_uri: M.CLAUDE_CALLBACK, client: {client_id: 'cid', name: 'Claude'}});
  const settings = M.settingsState([{workspace_id: 'w', enabled: false}]);
  assert.equal(M.consentRefusal({details, owner: true, settings}), '');
  assert.equal(M.consentRefusal({details, owner: false, settings}), 'not_owner');
  assert.equal(M.consentRefusal({details, owner: true, settings: null}), 'not_ready');
  assert.equal(M.consentRefusal({details: {...details, redirectUri: 'https://claude.ai/other'}, owner: true, settings}), 'redirect');
  assert.equal(M.consentRefusal({details: {...details, clientName: 'Other'}, owner: true, settings}), 'client');
  const pinned = M.settingsState([{workspace_id: 'w', enabled: true, allowed_client_id: 'cid'}]);
  assert.equal(M.consentRefusal({details, owner: true, settings: pinned}), '');
  assert.equal(M.consentRefusal({details: {...details, clientId: 'other'}, owner: true, settings: pinned}), 'client');
  assert.equal(M.consentRefusal({details: {kind: 'redirect'}, owner: true, settings}), 'bad_request');
});

test('설정 행·이번 달 시작(서울)·호출 수 글', () => {
  assert.equal(M.settingsState([]), null);
  assert.equal(M.settingsState(null), null);
  assert.equal(M.monthStartIso(new Date('2026-11-30T16:00:00Z')), '2026-11-30T15:00:00.000Z'); // 서울 12/1 01:00 → 12/1 0시
  assert.equal(M.monthStartIso(new Date('2026-11-19T01:00:00Z')), '2026-10-31T15:00:00.000Z');
  assert.equal(M.countText(42), '42번');
  assert.equal(M.countText(M.COUNT_CAP), '10,000번 넘음');
  assert.equal(M.toolLabel('ledger_search'), '원장 검색');
  assert.equal(M.statusLabel('limited'), '잠깐 멈춤');
});

test('③ 첨부 줄: 파일 수·크기(이름 없음), 못 붙인 시도는 첨부 못 함, 되돌리기 거절 문구', () => {
  assert.equal(M.writeLabel({kind: 'note', action: 'attach'}), '노트 파일 첨부');
  assert.equal(M.writeChars({action: 'attach', files: [{drive_file_id: 'a', size_bytes: 2097152}], file_bytes: 2097152}), '1개 · 2.0 MB');
  assert.equal(M.writeChars({action: 'attach', files: [{drive_file_id: 'a', size_bytes: 3000}], file_bytes: 3000}), '1개 · 3 KB');
  assert.equal(M.writeChars({action: 'attach', files: null, chars_before: 1000000}), '첨부 못 함');
  assert.equal(M.attachDone({action: 'attach', files: []}), false);
  assert.equal(M.fileSize(52 * 1024 * 1024), '52 MB');
  assert.match(M.undoError({message: 'STILL_ATTACHED'}), /아직 떼지 못했어요/);
});

test('화면 파일 경계: 설정 칸은 enabled·revoked_before·영역 칸(area_*)·쓰기 스위치(write_enabled)만 PATCH, 기록은 읽기만(되돌리기 RPC 하나), 기기 저장 없음', () => {
  const src = read('app/mcp-read-settings.js');
  assert.match(src, /patch\(area \? \{\[`area_\$\{area\}`\]: want\} : \{enabled: want\}\)/);
  assert.match(src, /if \(area && !AREAS\.some\(a => a\.key === area\)\) return;/);
  assert.match(src, /patch\(\{revoked_before: now\(\)\.toISOString\(\)\}\)/);
  // PATCH는 둘: 읽기 칸(위 셋)과 쓰기 스위치(write_enabled 하나만, MCP-Claude쓰기). POST는 되돌리기 RPC 하나뿐.
  assert.equal((src.match(/method: 'PATCH'/g) || []).length, 2);
  assert.match(src, /method: 'PATCH', body: \{write_enabled: want\}/);
  // POST는 셋: 되돌리기 RPC, ③ 첨부 되돌리기의 첨부 [삭제] 길(trash-file만, 노트 대상)과 되돌림 표시 RPC.
  assert.equal((src.match(/method: 'POST'/g) || []).length, 3);
  assert.match(src, /rt\.api\(UNDO, \{method: 'POST', body: \{p_log_id: id\}/);
  assert.match(src, /rt\.api\(FILE_TRASH, \{method: 'POST', body: \{action: 'trash-file', target: 'note', id: row\.target_id, drive_file_id: f\.drive_file_id\}/);
  assert.match(src, /rt\.api\(ATTACH_UNDONE, \{method: 'POST', body: \{p_log_id: id\}/);
  assert.match(src, /const ATTACH_UNDONE = '\/rest\/v1\/rpc\/app_mcp_attach_undone';/);
  assert.match(src, /const UNDO = '\/rest\/v1\/rpc\/app_mcp_write_undo';/);
  assert.doesNotMatch(src, /method: '(DELETE|PUT)'/);
  assert.doesNotMatch(src, /allowed_client_id\s*:/);
  const consent = read('app/oauth-consent/consent.js');
  for (const s of [src, consent]) assert.doesNotMatch(s, /local[S]torage|session[S]torage|indexed[D]B/);
  assert.match(consent, /window\.top !== window\.self/);
  assert.match(consent, /safeClaudeRedirect/);
  assert.doesNotMatch(consent, /location\.(assign|replace|href\s*=)\((?!url\)|window\.KPTUAuth\.loginUrl)/);
  assert.match(read('app/profile-settings.js'), /import\('\.\/mcp-read-settings\.js'\)\.then\(m=>m\.mountMcpReadSettings/);
});

test('3판 영역: 다섯 칸, 가족 방만 기본 꺼짐, 칸이 없으면 기본값, 기록 도구 이름', () => {
  assert.deepEqual(M.AREAS.map(a => a.key), ['diary', 'calls', 'recordings', 'basket', 'family']);
  assert.deepEqual(M.AREA_COLUMNS, ['area_diary', 'area_calls', 'area_recordings', 'area_basket', 'area_family']);
  assert.deepEqual(M.settingsState([{workspace_id: 'w', enabled: false}]).areas, {diary: true, calls: true, recordings: true, basket: true, family: false});
  assert.deepEqual(M.settingsState([{workspace_id: 'w', enabled: true, area_diary: false, area_family: true}]).areas,
    {diary: false, calls: true, recordings: true, basket: true, family: true});
  assert.equal(M.toolLabel('web2_call_get'), '통화 한 건');
  assert.equal(M.toolLabel('web2_family_list'), '가족 방 목록');
});

test('쓰기 기록 한 줄: 종류·동작·글자 수만, 되돌리기 거절 문구', () => {
  assert.equal(M.writeLabel({kind: 'note', action: 'edit'}), '노트 수정');
  assert.equal(M.writeLabel({kind: 'update', action: 'trash'}), '업데이트 휴지통으로');
  assert.equal(M.writeChars({action: 'create', chars_before: 0, chars_after: 1200}), '1,200자');
  assert.equal(M.writeChars({action: 'edit', chars_before: 10, chars_after: 20}), '10→20자');
  assert.equal(M.undoError({message: 'CHANGED'}), '그 뒤에 또 바뀌어서 되돌리지 않았어요.');
  assert.equal(M.undoError({message: 'TRASH_NOT_FOUND'}), '그 뒤에 또 바뀌어서 되돌리지 않았어요.');
  assert.equal(M.undoError({message: 'NOT_FOUND'}), '이미 되돌렸거나 찾을 수 없어요.');
  assert.equal(M.undoError(new Error('network')), '되돌리지 못했어요. 잠시 뒤 다시 해 주세요.');
});
