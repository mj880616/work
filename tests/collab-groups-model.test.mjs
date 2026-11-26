import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  errorText, errorCode, cleanName, groupName, groupMeta, createDefaults, createReady, createArgs,
  inviteUrl, tokenFromUrl, urlWithoutToken, inviteSummary, CREATED_TEXT,
} from '../app/collab-groups-model.mjs';

const TOKEN = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';

test('error codes map to one Korean line each; unknown errors get the fallback', () => {
  assert.equal(errorCode({message: 'COLLAB_INVITE_UNUSABLE'}), 'COLLAB_INVITE_UNUSABLE');
  assert.equal(errorText({message: 'COLLAB_INVITE_UNUSABLE'}), '쓸 수 없는 링크예요. 묶음 사람에게 새 링크를 받아 주세요.');
  assert.equal(errorText({message: 'COLLAB_ADMIN_REQUIRED'}), '관리자만 할 수 있어요.');
  assert.equal(errorCode({message: 'COLLAB_SOMETHING_ELSE'}), '');
  assert.match(errorText(new Error('boom')), /하지 못했어요/);
});

test('names are cleaned like the server and shown as union + dept + kind', () => {
  assert.equal(cleanName('  가상   노조\n'), '가상 노조');
  assert.equal(cleanName('가'.repeat(61)), '');
  assert.equal(cleanName('   '), '');
  assert.equal(groupName({kind: 'dept', union_name: '가상노조', dept_name: '정책실'}), '가상노조 정책실 부서');
  assert.equal(groupName({kind: 'union', union_name: '가상노조', dept_name: null}), '가상노조 노조');
  assert.equal(groupMeta({my_role: 'admin', members: [{}, {}, {}], requests: [{}]}), '관리자 · 3명 · 요청 1');
  assert.equal(groupMeta({my_role: 'member', members: [{}], requests: [{}]}), '멤버 · 1명');
});

test('create form: empty defaults (S71-34 프로필은 소속·부서를 받지 않음), union kind sends no dept, consent always true', () => {
  assert.deepEqual(createDefaults('dept'), {kind: 'dept', union: '', dept: ''});
  assert.deepEqual(createDefaults('union', {union_name: '가상노조', department_name: '정책실'}), {kind: 'union', union: '', dept: ''});
  const d = {kind: 'dept', union: '가상노조', dept: '정책실'};
  assert.equal(createReady({kind: 'dept', union: '가상노조', dept: ''}), false);
  assert.equal(createReady({kind: 'union', union: '가상노조', dept: ''}), true);
  assert.deepEqual(createArgs({kind: 'union', union: ' 가상노조', dept: '정책실'}), {p_kind: 'union', p_union_name: '가상노조', p_dept_name: null, p_agree: true});
  assert.deepEqual(createArgs(d), {p_kind: 'dept', p_union_name: '가상노조', p_dept_name: '정책실', p_agree: true});
  // 같은 이름이 있든 없든 같은 한 줄.
  assert.match(CREATED_TEXT.dept, /같은 이름 묶음이 이미 있으면/);
});

test('invite link: team view (S71-35) + join param only for a 64-hex token; read once and removed from the address', () => {
  const url = inviteUrl('https://example.test/app/', TOKEN);
  assert.equal(url, `https://example.test/app/?view=team&join=${TOKEN}`);
  assert.equal(inviteUrl('https://example.test/app/', 'short'), '');
  assert.equal(tokenFromUrl(url), TOKEN);
  assert.equal(tokenFromUrl('https://example.test/app/?view=profile&join=xyz'), 'bad');
  assert.equal(tokenFromUrl('https://example.test/app/?view=profile'), '');
  assert.equal(urlWithoutToken(url + '#x'), '/app/?view=team#x');
  assert.equal(inviteSummary({kind: 'dept', union_name: '가상노조', dept_name: '정책실', admin_name: '가상 관리자', admin_title: '부장', member_count: 3}), '가상노조 정책실 부서 · 가상 관리자 부장 외 2명');
});

test('screen calls only app_collab_* RPCs, never tables, ids or device storage', () => {
  const src = readFileSync(new URL('../app/collab-groups.js', import.meta.url), 'utf8');
  const calls = [...src.matchAll(/'(app_[a-z_]+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ['app_collab_admin_move', 'app_collab_group_create', 'app_collab_invite_accept', 'app_collab_invite_create',
    'app_collab_invite_peek', 'app_collab_invite_revoke_all', 'app_collab_leave', 'app_collab_member_remove', 'app_collab_my_groups', 'app_collab_request_decide']);
  // 기기 저장소 이름은 글자 그대로 쓰지 않는다(browser-storage-audit가 실제 사용으로 셈).
  assert.doesNotMatch(src, /\/rest\/v1\/app_|(?:local|session)Storage|indexed[D]B|p_workspace|p_user|workspace_id|user_id/);
  // 받은 링크는 읽자마자 주소에서 지운다.
  assert.match(src, /replaceState\([^)]*urlWithoutToken/);
});
