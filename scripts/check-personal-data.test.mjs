import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDummyGroup,
  isDummyValue,
  scanText,
  valueHash,
  isAllowed,
  loadAllowlist,
  scanRepo,
} from './check-personal-data.mjs';

// 이 파일도 검사 대상이므로 실제처럼 보이는 값은 조각을 이어 붙여 실행 중에만 만든다.
const join = (...parts) => parts.join('');
const realMobile = join('010-', '48', '27-', '39', '15');
const realLandline = join('02-', '58', '3-', '71', '06');
const realRrn = join('85', '0312-', '1', '58', '3920');
const realMail = join('someone', '@', 'gmail', '.com');
const fakeKey = join('gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8');

test('숫자 묶음 가짜 판정', () => {
  for (const g of ['0000', '1111', '1234', '5678', '9876', '5432', '123', '7890']) assert.ok(isDummyGroup(g), g);
  for (const g of ['4827', '3915', '583', '0444']) assert.ok(!isDummyGroup(g), g);
});

test('시험용 가짜 전화·주민번호는 넘긴다', () => {
  assert.ok(isDummyValue('mobile', '010-1234-5678'));
  assert.ok(isDummyValue('mobile', '01011112222'));
  assert.ok(isDummyValue('mobile', '010 3333 4444'));
  assert.ok(isDummyValue('landline', '02-123-4567'));
  assert.ok(isDummyValue('landline', '02-000-0000'));
  assert.ok(isDummyValue('rrn', '900101-1234567'));
  assert.ok(isDummyValue('rrn', '900101-1000000'));
  assert.equal(scanText('연락 010-1234-5678, 010-0000-0000').length, 0);
});

test('실제처럼 보이는 값은 종류별로 잡는다', () => {
  const text = [realMobile, realLandline, realRrn, realMail, fakeKey, join('-----BEGIN ', 'PRIVATE KEY-----')].join('\n');
  const kinds = scanText(text).map(f => f.kind).sort();
  assert.deepEqual(kinds, ['email', 'landline', 'mobile', 'rrn', 'secret', 'secret']);
  assert.equal(scanText(text).find(f => f.kind === 'landline').line, 2);
});

test('오탐하지 않는 모양', () => {
  const text = [
    'task-assignment-visibility-observer-check-should-not-match',
    '2026-10-27 회의, 버전 2026-10-01-two-person',
    'user@example.com test@example.test',
    '하나 2026-09-22',
  ].join('\n');
  assert.deepEqual(scanText(text), []);
});

test('같은 값은 표기와 무관하게 같은 hash', () => {
  assert.equal(valueHash('mobile', realMobile), valueHash('mobile', realMobile.replace(/-/g, '')));
  assert.equal(valueHash('email', realMail), valueHash('email', realMail.toUpperCase()));
});

test('예외 목록: hash 지정 항목은 그 값·그 경로만 허용', () => {
  const finding = {kind: 'mobile', hash: valueHash('mobile', realMobile)};
  const list = [{kinds: ['mobile'], paths: ['press/'], hashes: [finding.hash], reason: 'x'}];
  assert.ok(isAllowed('press/a/index.html', finding, list));
  assert.ok(!isAllowed('app/a.js', finding, list));
  assert.ok(!isAllowed('press/a/index.html', {kind: 'mobile', hash: 'ffffffffffffffff'}, list));
  assert.ok(!isAllowed('press/a/index.html', {...finding, kind: 'landline'}, list));
});

test('저장소 예외 목록 형식이 올바르다', () => {
  const list = loadAllowlist();
  assert.ok(list.length > 0);
});

test('현재 저장소에 예외 밖 개인정보 모양이 없다', () => {
  const {problems} = scanRepo();
  assert.deepEqual(problems.map(p => `${p.path}:${p.line} ${p.kind} ${p.hash}`), []);
});
