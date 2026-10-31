import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadArchive, auditArchive } from '../../scripts/arsenal/validate-archive.mjs';

const baselineText = execFileSync('git', [
  'show',
  '6f5444357a730aad4b03da3f0c24706cc548ccd2:personal/arsenal-match-archive/matches.js'
], { encoding: 'utf8' });
const original = loadArchive(baselineText);
const copy = () => structuredClone(original);

test('partial baseline has known counts', () => {
  const { counts, errors } = auditArchive(copy(), { complete: false, baselineMatches: original });
  assert.deepEqual(counts, { premierLeague: 15, championsLeague: 5, total: 20 });
  assert.deepEqual(errors, []);
});

test('impossible date is rejected', () => {
  const data = copy();
  data.find(m => m.season === '2025-26').date = '2026-02-30';
  assert.match(auditArchive(data, { complete: false }).errors.join(' '), /date/i);
});

test('complete mode rejects the baseline undercount', () => {
  assert.match(auditArchive(copy(), { complete: true }).errors.join(' '), /38|15|53/);
});

test('duplicate ID and duplicate round are distinct failures', () => {
  const withDuplicateId = copy();
  withDuplicateId.push(structuredClone(withDuplicateId.find(m => m.season === '2025-26')));
  assert.match(auditArchive(withDuplicateId, { complete: false }).errors.join(' '), /id/i);

  const withDuplicateRound = copy();
  const extra = structuredClone(withDuplicateRound.find(m => m.season === '2025-26' && m.competition === 'Premier League'));
  extra.id += '-second';
  withDuplicateRound.push(extra);
  assert.match(auditArchive(withDuplicateRound, { complete: false }).errors.join(' '), /round/i);
});

test('two meetings with one opponent remain separate when rounds differ', () => {
  const data = copy();
  const extra = structuredClone(data.find(m => m.season === '2025-26' && m.round === '1R'));
  extra.id += '-return';
  extra.round = '38R';
  data.push(extra);
  assert.deepEqual(auditArchive(data, { complete: false }).errors, []);
});

test('duplicate source and unsafe media URL fail', () => {
  const data = copy();
  const match = data.find(m => m.season === '2025-26');
  match.sources[1].url = match.sources[0].url;
  match.media[0].url = 'javascript:alert(1)';
  assert.match(auditArchive(data, { complete: false }).errors.join(' '), /source/i);
  assert.match(auditArchive(data, { complete: false }).errors.join(' '), /media/i);
});

test('2026-27 mutation is rejected', () => {
  const data = copy();
  data.find(m => m.season === '2026-27').subtitle += 'changed';
  assert.match(auditArchive(data, { complete: false, baselineMatches: original }).errors.join(' '), /2026-27/);
});

test('new 2026-27 records can be prepended without mutating existing reviews', () => {
  const data = copy();
  const added = structuredClone(data.find(m => m.season === '2026-27'));
  added.id = '2026-10-10-new-match';
  added.date = '2026-10-10';
  data.unshift(added);
  assert.deepEqual(auditArchive(data, { complete: false, baselineMatches: original }).errors, []);
});

test('scoring links must use HTTPS in either season', () => {
  const data = copy();
  data.find(m => m.season === '2025-26').goalsSource = 'javascript:alert(1)';
  data.find(m => m.season === '2026-27').goalsTimeSource = 'data:text/html,test';
  assert.equal(auditArchive(data, { complete: false }).errors.filter(error => /scoring source/i.test(error)).length, 2);
});

test('2026-27 scoring additions are allowed without masking existing fields or later goal edits', () => {
  const data = copy();
  const match = data.find(m => m.season === '2026-27');
  match.goals = [{ side: 'home', minute: '31', scorer: 'Example', assist: null, type: 'goal' }];
  match.goalsSource = 'https://example.org/match-events';
  assert.deepEqual(auditArchive(data, { complete: false, baselineMatches: original }).errors, []);

  match.subtitle += 'changed';
  assert.match(auditArchive(data, { complete: false, baselineMatches: original }).errors.join(' '), /2026-27/);

  match.subtitle = original.find(m => m.id === match.id).subtitle;
  const withScoringBaseline = structuredClone(data);
  match.goals[0].minute = '32';
  assert.match(auditArchive(data, { complete: false, baselineMatches: withScoringBaseline }).errors.join(' '), /2026-27/);
});

test('only the three verified Ipswich assist-label corrections are allowed in legacy reviews', () => {
  const data = copy();
  const match = data.find(m => m.id === '2026-09-15-ipswich-away-carabao');
  match.events[1] = '16분 마두에케 골(메리노 패스·공식 도움 배정 없음)';
  match.events[3] = '58분 메리노 골(다우먼 연결·공식 도움 배정 없음)';
  match.decisive[1] = '브루노-메리노 중원이 경기 초반 세컨드볼과 전진 패스를 장악해 입스위치가 압박을 지속하지 못하게 했고, 메리노는 1골과 16분 추가골의 마지막 패스로 공격 마무리까지 관여했음. 공식 이벤트에서는 해당 패스에 도움을 배정하지 않았음.';
  assert.deepEqual(auditArchive(data, { complete: false, baselineMatches: original }).errors, []);

  match.events[0] += 'incorrect';
  assert.match(auditArchive(data, { complete: false, baselineMatches: original }).errors.join(' '), /2026-27/);

  match.events[0] = original.find(m => m.id === match.id).events[0];
  const correctedBaseline = structuredClone(data);
  match.events[1] = '16분 마두에케 골(메리노 도움)';
  assert.match(auditArchive(data, { complete: false, baselineMatches: correctedBaseline }).errors.join(' '), /2026-27/);
});

test('2025-26 match statistics have numeric big-chance coverage and source links', () => {
  const data = loadArchive(readFileSync(new URL('../../app/arsenal/matches.js', import.meta.url), 'utf8'))
    .filter(match => match.season === '2025-26');
  assert.equal(data.length, 53);
  for (const match of data) {
    for (const stats of [match.stats, match.opponentStats]) {
      assert.match(stats.bigChances, /^\d+$/, `${match.id}: missing big chances`);
    }
    assert.ok(match.sources.some(source => source.label.includes('빅찬스')),
      `${match.id}: missing big-chance provenance`);
  }
  const villa = data.find(match => match.id === '2025-12-06-aston-villa-away');
  assert.deepEqual([villa.stats.xg, villa.opponentStats.xg, villa.stats.bigChances, villa.opponentStats.bigChances],
    ['1.84', '2.27', '3', '2']);
  const brugge = data.find(match => match.id === '2025-12-10-club-brugge-away');
  assert.deepEqual([brugge.stats.xg, brugge.opponentStats.xg, brugge.stats.bigChances, brugge.opponentStats.bigChances],
    ['2.97', '1.06', '5', '1']);
});

// S46-26 예정 경기 줄.
const upcoming = (extra = {}) => ({ id: '2026-11-01-liverpool-away', upcoming: true, date: '2026-11-02', kickoff: '01:30',
  season: '2026-27', competition: 'Premier League', round: '9R', venue: 'Anfield', home: '리버풀', away: '아스날',
  sources: [{ label: '공식 일정', url: 'https://www.premierleague.com/en/news/1' }], ...extra });
const TODAY = '2026-10-31';

test('upcoming record without scores is accepted and does not count toward 2025-26 or the 2026-27 guard', () => {
  const data = copy();
  data.unshift(upcoming());
  const result = auditArchive(data, { complete: false, baselineMatches: original, today: TODAY });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.counts, { premierLeague: 15, championsLeague: 5, total: 20 });
});

test('upcoming record dated before today fails', () => {
  const data = copy();
  data.unshift(upcoming({ date: '2026-10-30' }));
  assert.match(auditArchive(data, { complete: false, today: TODAY }).errors.join(' '), /past/);
  // 오늘 날짜는 통과(한국 시간 기준 당일 경기).
  assert.deepEqual(auditArchive([upcoming({ date: TODAY })], { complete: false, today: TODAY }).errors, []);
});

test('upcoming record with scores, scorers, stats or review text fails', () => {
  for (const extra of [{ homeScore: 0 }, { awayScore: 1 }, { result: '승' }, { goals: [] }, { goalsSource: 'https://a.example/' },
    { stats: { possession: '50%' } }, { opponentStats: {} }, { summary: ['a'] }, { title: 'x' }, { lineup: {} }, { events: [] }]) {
    const errors = auditArchive([upcoming(extra)], { complete: false, today: TODAY }).errors.join(' ');
    assert.match(errors, /must not have/, JSON.stringify(extra));
  }
});

test('upcoming kickoff, competition, sides and flag are checked', () => {
  const check = extra => auditArchive([upcoming(extra)], { complete: false, today: TODAY }).errors.join(' ');
  assert.match(check({ kickoff: '1:30' }), /kickoff/);
  assert.match(check({ kickoff: undefined }), /kickoff/);
  assert.match(check({ competition: 'Friendly' }), /competition/);
  assert.match(check({ home: '아스날', away: '아스날' }), /exactly one side/);
  assert.match(check({ home: 'A', away: 'B' }), /exactly one side/);
  assert.match(check({ season: '2025-26' }), /season/);
  assert.match(check({ sources: [{ label: 'x', url: 'http://a.example/' }] }), /source/);
  assert.match(auditArchive([upcoming({ upcoming: 'yes' })], { complete: false, today: TODAY }).errors.join(' '), /upcoming must be true/);
});

test('finished records keep their checks: missing scores without the upcoming flag fail in any season', () => {
  const data = copy();
  delete data.find(m => m.season === '2026-27').homeScore;
  assert.match(auditArchive(data, { complete: false, today: TODAY }).errors.join(' '), /homeScore/);
  const old = copy();
  delete old.find(m => m.season === '2025-26').awayScore;
  assert.match(auditArchive(old, { complete: false, today: TODAY }).errors.join(' '), /awayScore/);
});

test('an upcoming record may be replaced by the finished record with the same id, but not the reverse', () => {
  const finished = structuredClone(original.find(m => m.season === '2026-27'));
  const baseline = [...copy(), upcoming({ id: 'x-upcoming' })];
  const replaced = [...copy(), { ...finished, id: 'x-upcoming' }];
  // 예정 → 결과(같은 id): 기준의 예정 줄은 지킬 기록이 아니므로 통과(새 결과 줄 자체 검사는 그대로).
  assert.deepEqual(auditArchive(replaced, { complete: false, baselineMatches: baseline, today: TODAY }).errors.filter(e => /2026-27/.test(e)), []);
  // 결과 → 예정(되돌리기): 지켜야 할 기록이 사라진 것이므로 실패.
  const reverted = copy();
  const idx = reverted.findIndex(m => m.season === '2026-27');
  reverted[idx] = upcoming({ id: reverted[idx].id });
  assert.match(auditArchive(reverted, { complete: false, baselineMatches: original, today: TODAY }).errors.join(' '), /2026-27/);
});

test('real archive upcoming records are well formed (date checks use today in KST)', () => {
  const data = loadArchive(readFileSync(new URL('../../app/arsenal/matches.js', import.meta.url), 'utf8'));
  const rows = data.filter(m => m.upcoming === true);
  assert.ok(rows.length <= 3, 'keep at most the next three fixtures');
  const errors = auditArchive(rows, { complete: false, today: '2026-10-31' }).errors;
  assert.deepEqual(errors, []);
});
