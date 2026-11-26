import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFind, markParts, rankFound, wantsMeaning, looksSentence, inPeriod, initialsOf, jamoOf, initialOf} from '../app/find-match-model.mjs';

// SEARCH-비슷한것찾기 ①(S70-67): 모든 찾기가 함께 쓰는 글자 비슷 찾기. 이름·글은 지어낸 것.
const hit = (q, s) => compileFind(q).test(s);
const marked = (q, s) => markParts(s, compileFind(q)).filter(p => p.mark).map(p => p.text);

test('띄어쓰기 무시: 검색어·글 어느 쪽 빈칸이든 맞고, 맞은 부분은 원래 글 위치', () => {
  assert.ok(hit('국토 부', '국토부 협의'));
  assert.ok(hit('국토부', '국토 부 협의'));
  assert.ok(hit('민자 철도', '민자철도 현장'));
  assert.deepEqual(marked('국토 부', '가상 국토부 협의'), ['국토부']);
  assert.deepEqual(marked('국토부', '국토 부'), ['국토 부'], '빈칸을 사이에 둔 글도 한 덩어리로 굵게');
  assert.ok(hit('WEB2', 'web2 노트'), '대소문자 무시');
});

test('초성: ㄱㅌㅂ → 국토부, 초성·글자를 섞어도 맞음, 초성만은 오타를 보지 않음', () => {
  assert.ok(hit('ㄱㅌㅂ', '국토부 협의'));
  assert.ok(hit('ㄱㅌ ㅂ', '국토부'));
  assert.ok(hit('국ㅌㅂ', '국토부'));
  assert.ok(hit('ㅁㅈㅊㄷ', '가상 민자철도'));
  assert.equal(hit('ㄱㅌㅂ', '국회 토론'), null, '이어지지 않은 초성은 맞지 않음');
  assert.ok(hit('ㄱㅌㅂㅎ', '국토부 회의'), '빈칸 건너 이어지는 초성은 맞음');
  assert.equal(hit('ㄱㅌㅂㅎ', '국토부 의견'), null, '초성 하나가 달라도 오타로 맞추지 않음');
  assert.deepEqual(marked('ㄱㅌㅂ', '가상 국토부'), ['국토부']);
  assert.equal(initialsOf('국토부 web'), 'ㄱㅌㅂ web');
});

test('한글 자모 경계: 치는 중인 마지막 글자(받침이 다음 글자 초성으로 넘어가는 중)도 맞음', () => {
  assert.equal(jamoOf('국'), 'ㄱㅜㄱ');
  assert.equal(jamoOf('과'), 'ㄱㅗㅏ', '겹홀소리는 풀어서');
  assert.equal(jamoOf('ㄳ'), 'ㄱㅅ', '겹받침 낱자도 풀어서');
  assert.equal(initialOf('토'), 'ㅌ');
  assert.ok(hit('국톱', '국토부'), '국토부를 치는 중: 국톱');
  assert.ok(hit('국토ㅂ', '국토부'));
  assert.ok(hit('국토부', '국토부'));
  assert.ok(hit('미', '민자'), '마지막 글자가 받침 없이 친 중간');
  assert.ok(hit('혀', '협의'));
  assert.ok(hit('협으', '협의회'), 'ㅇㅡ → 의(ㅇㅡㅣ)');
  assert.deepEqual(marked('국톱', '가상 국토부 일정'), ['국토부']);
  assert.equal(hit('국톱', '국토 교통'), null, '넘어간 받침이 다음 글자 초성과 다르면 아님');
  assert.equal(hit('고', '국'), null, '앞 글자 홀소리가 다르면 아님');
});

test('앞부분 일치: 민자 → 민자철도, 글 맨 앞·낱말 맨 앞이 더 높은 점수', () => {
  assert.ok(hit('민자', '민자철도'));
  const f = compileFind('민자');
  const start = f.test('민자철도 협의').score, word = f.test('가상 민자철도').score, inside = f.test('가상민자철도').score;
  assert.ok(start > word && word > inside, `${start} > ${word} > ${inside}`);
});

test('오타 허용: 4~6글자 1글자, 7글자 이상 2글자 · 짧은 낱말은 오타를 보지 않음', () => {
  assert.ok(hit('민자철드', '가상 민자철도'), '한 글자 다름');
  assert.deepEqual(marked('민자철드', '가상 민자철도 현장'), ['민자철도']);
  assert.ok(hit('민자철도현', '민자철도 협의'), '다섯 글자 한 글자 다름');
  assert.ok(hit('민자철도협의회의', '민자철도 협의회 회의'), '7글자 이상은 더해진 글자도');
  assert.ok(hit('민자칠더협의회', '민자철도협의회'), '7글자 두 글자 다름');
  assert.equal(hit('민자칠더협', '민자철도협'), null, '5글자 두 글자 다름은 아님');
  assert.equal(hit('철도', '도철'), null);
  assert.equal(hit('회의록', '회의실'), null, '세 글자 이하는 오타 없음');
  assert.equal(hit('국토부', '국토교통부'), null);
  assert.equal(hit('교섭', '협의'), null, '뜻이 비슷한 말은 ②(AI) 몫');
});

test('여러 낱말: 붙여서 먼저, 안 되면 낱말마다 모두(순서 무관)', () => {
  assert.ok(hit('민자 협의', '민자철도 협의회'));
  assert.ok(hit('협의 민자', '민자철도 협의회'));
  assert.equal(hit('민자 교섭', '민자철도 협의회'), null);
  assert.deepEqual(marked('협의 민자', '민자철도 협의회'), ['민자', '협의']);
});

test('맞은 정도 순(같으면 원래 순서), 여러 칸 중 가장 잘 맞은 칸', () => {
  const rows = [{t: '가상 국토부 회의'}, {t: '국토부'}, {t: '가상 일정'}, {t: '국토부 협의'}, {t: '국톱 아님', n: '메모 국토부'}];
  assert.deepEqual(rankFound(rows, compileFind('국토부'), r => [r.t, r.n]).map(r => r.t), ['국토부', '국토부 협의', '가상 국토부 회의', '국톱 아님']);
  assert.deepEqual(rankFound(rows, compileFind(''), r => r.t).length, 5, '빈 검색어는 그대로');
  const f = compileFind('국토부');
  assert.equal(f.best('가상', '국토부').field, 1);
  assert.equal(f.best(null, '', '아님'), null);
});

test('비슷한 말(②가 돌려준 낱말)은 검색어로 못 맞춘 것만, 낮은 점수로 · 오타는 보지 않음', () => {
  const f = compileFind('교섭', {also: ['협의', '간담회', '교섭']});
  assert.deepEqual(f.also, ['협의', '간담회'], '검색어와 같은 말은 뺌');
  const a = f.test('가상 협의 일정'), b = f.test('교섭 일정');
  assert.ok(a?.also && b && !b.also && b.score > a.score);
  assert.equal(f.test('가상 협이'), null);
  assert.deepEqual(markParts('가상 간담회', f).filter(p => p.mark).map(p => p.text), ['간담회']);
});

test('뜻 비슷 찾기를 부를 때: 결과 3개 미만이거나 문장일 때만, 초성만·너무 짧거나 긴 글은 아님', () => {
  assert.equal(wantsMeaning('교섭', 0), true);
  assert.equal(wantsMeaning('교섭', 2), true);
  assert.equal(wantsMeaning('교섭', 3), false);
  assert.equal(wantsMeaning('지난달 철도 관련 회의', 20), true);
  assert.equal(looksSentence('철도 관련'), true);
  assert.equal(looksSentence('국토부'), false);
  assert.equal(wantsMeaning('ㄱㅌㅂ', 0), false);
  assert.equal(wantsMeaning('가', 0), false);
  assert.equal(wantsMeaning('가'.repeat(101), 0), false);
});

test('기간 거르기: 날짜가 없는 항목은 거르지 않음', () => {
  const p = {from: '2026-10-01', to: '2026-10-31'};
  assert.equal(inPeriod('2026-10-15T09:00:00+09:00', p), true);
  assert.equal(inPeriod('2026-11-01', p), false);
  assert.equal(inPeriod('2026-09-30', p), false);
  assert.equal(inPeriod('', p), true);
  assert.equal(inPeriod('2026-11-01', {from: '', to: ''}), true);
  assert.equal(inPeriod('2026-11-01', null), true);
});

test('조합형(NFD) 글자도 찾되, 굵게는 칠하지 않음(위치를 되돌릴 수 없음)', () => {
  const nfd = '국토부 자료'.normalize('NFD');
  const r = hit('국토부', nfd);
  assert.ok(r);
  assert.deepEqual(r.ranges, []);
  assert.deepEqual(markParts(nfd, compileFind('국토부')), [{text: nfd, mark: false}]);
});
