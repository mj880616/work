// 주소 개편 ② E1: Web2 '아스날' 화면 순수 규칙(app/arsenal-model.mjs). 실제 자료(app/arsenal/matches.js)와 지어낸 자료로 본다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {ALL, normalizeMatches, seasonsOf, competitionsOf, competitionText, filterMatches, pickMatch, dateText, scoreText,
  goalsOf, reviewSections, statsOf, safeUrl, linksOf, isUpcoming, upcomingOf, upcomingText, kstToday} from '../app/arsenal-model.mjs';

const context = {window: {}};
runInNewContext(readFileSync(new URL('../app/arsenal/matches.js', import.meta.url), 'utf8'), context);
const raw = context.window.ARSENAL_MATCHES;

test('자료 → 최신 날짜가 위, 형식이 틀린 줄은 버림', () => {
  const list = normalizeMatches(raw);
  assert.equal(list.length, raw.filter(m => !isUpcoming(m)).length);
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].date >= list[i].date);
  assert.deepEqual(normalizeMatches([{id: 'a', date: '2026-01-01'}, {id: 'b'}, null, {date: '2026-01-02'}, {id: 'c', date: '2026-02-01'}]).map(m => m.id), ['c', 'a']);
  assert.deepEqual(normalizeMatches('x'), []);
});

test('시즌은 최신 시즌이 앞, 대회는 원문 이름으로 거르고 한국어로 보임', () => {
  const list = normalizeMatches(raw);
  assert.deepEqual(seasonsOf(list), ['2026-27', '2025-26']);
  assert.ok(competitionsOf(list).includes('Premier League'));
  assert.equal(competitionText('Premier League'), '프리미어리그');
  assert.equal(competitionText('UEFA Champions League'), '챔피언스리그');
  assert.equal(competitionText('Some Cup'), 'Some Cup');
});

test('거르기: 시즌·대회·상대 검색(대소문자 무시), 옛 페이지와 같은 개수', () => {
  const list = normalizeMatches(raw);
  assert.equal(filterMatches(list, {season: '2025-26'}).length, 53);
  assert.equal(filterMatches(list, {season: '2025-26', competition: 'Premier League'}).length, 38);
  assert.equal(filterMatches(list, {season: '2025-26', competition: 'UEFA Champions League'}).length, 15);
  assert.equal(filterMatches(list, {season: '2025-26', competition: 'UEFA Champions League', query: '아틀레티코'}).length, 3);
  assert.equal(filterMatches(list, {query: '  '}).length, list.length);
  const fake = [{id: 'x', date: '2026-01-01', home: 'Arsenal', away: 'Lille', title: '', subtitle: '', round: 'MD1', season: 's', competition: 'c'}];
  assert.equal(filterMatches(fake, {query: 'LIL'}).length, 1);
  assert.equal(filterMatches(fake, {season: ALL, competition: 'other'}).length, 0);
});

test('고른 경기가 거르기에서 빠지면 맨 위, 없으면 null', () => {
  const a = {id: 'a'}, b = {id: 'b'};
  assert.equal(pickMatch([a, b], 'b'), b);
  assert.equal(pickMatch([a, b], 'z'), a);
  assert.equal(pickMatch([], 'a'), null);
});

test('날짜·점수·득점 줄(자책골·페널티킥·도움 없음)', () => {
  assert.equal(dateText('2026-10-18'), '2026.10.18');
  assert.equal(scoreText({homeScore: 0, awayScore: 1}), '0–1');
  const m = {goals: [{side: 'home', minute: '13', scorer: 'A', assist: null, type: 'goal'}, {side: 'home', minute: '45+2', scorer: 'B', assist: 'C', type: 'own-goal'},
    {side: 'away', minute: '90', scorer: 'D', assist: null, type: 'penalty'}]};
  assert.deepEqual(goalsOf(m, 'home'), [{minute: '13', scorer: 'A', kind: '', type: 'goal', assist: '—'}, {minute: '45+2', scorer: 'B', kind: '자책골', type: 'own-goal', assist: 'C'}]);
  assert.equal(goalsOf(m, 'away')[0].kind, '페널티킥');
  assert.deepEqual(goalsOf({}, 'home'), []);
  // 실제 자료: 득점 줄 수 = 점수.
  for (const match of normalizeMatches(raw)) {
    assert.equal(goalsOf(match, 'home').length, match.homeScore, match.id);
    assert.equal(goalsOf(match, 'away').length, match.awayScore, match.id);
  }
});

test('리뷰 묶음은 내용 있는 것만, 통계는 빈 값이 —', () => {
  const sections = reviewSections({summary: ['a', ''], whyLost: ['b'], arteta: [], nextWatch: ['c']});
  assert.deepEqual(sections.map(s => s.key), ['summary', 'decisive', 'nextWatch']);
  assert.deepEqual(sections[0].items, ['a']);
  assert.deepEqual(statsOf({stats: {possession: '74%', xg: 1.07}}).map(s => s.value), ['74%', '—', '1.07', '—']);
});

test('바깥 링크는 https만', () => {
  assert.equal(safeUrl('https://example.org/a'), 'https://example.org/a');
  for (const bad of ['http://example.org', 'javascript:alert(1)', 'data:text/html,x', '', null, '/rel']) assert.equal(safeUrl(bad), '');
  assert.deepEqual(linksOf([{label: 'A', url: 'https://a.example/'}, {label: 'B', url: 'javascript:x'}, null]), [{label: 'A', url: 'https://a.example/'}]);
  for (const match of normalizeMatches(raw)) for (const source of match.sources || []) assert.ok(safeUrl(source.url), `${match.id}: ${source.label}`);
});

test('S46-26 예정 경기 줄: 목록·개수·득점에서 빠지고, 오늘 이후만 가까운 순으로 작은 줄', () => {
  const fake = [
    {id: 'f', date: '2026-10-27', home: '아스날', away: 'A', homeScore: 1, awayScore: 0},
    {id: 'u2', upcoming: true, date: '2026-11-08', kickoff: '00:00', home: '아스날', away: '헐 시티', competition: 'Premier League', season: '2026-27'},
    {id: 'u1', upcoming: true, date: '2026-11-02', kickoff: '01:30', home: '리버풀', away: '아스날', competition: 'Premier League', season: '2026-27'},
    {id: 'old', upcoming: true, date: '2026-10-30', kickoff: '20:00', home: '아스날', away: 'B'},
    {id: 'nokick', upcoming: true, date: '2026-11-10', home: 'C', away: '아스날'}
  ];
  assert.deepEqual(normalizeMatches(fake).map(m => m.id), ['f']);
  assert.deepEqual(upcomingOf(fake, '2026-10-31').map(m => m.id), ['u1', 'u2', 'nokick']);
  assert.deepEqual(upcomingOf(fake, '2026-11-03').map(m => m.id), ['u2', 'nokick']);
  assert.equal(upcomingText(fake[2]), '예정 · 11.2.(월) 01:30 원정 리버풀');
  assert.equal(upcomingText(fake[1]), '예정 · 11.8.(일) 00:00 홈 헐 시티');
  assert.equal(upcomingText(fake[4]), '예정 · 11.10.(화) 원정 C');
  assert.equal(kstToday(new Date('2026-10-31T15:30:00Z')), '2026-11-01');
  assert.equal(kstToday(new Date('2026-10-31T14:59:00Z')), '2026-10-31');
  // 실제 자료: 예정 줄은 점수·득점자가 없다.
  for (const m of raw.filter(isUpcoming)) {
    assert.equal(m.homeScore, undefined, m.id);
    assert.equal(m.goals, undefined, m.id);
  }
});
