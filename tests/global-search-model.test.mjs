import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuery, errorMessage, highlightParts, snippetAround, filterEvents, filterTasks, cleanServer, buildGroups, chipOptions,
  countLabel, openTarget, dateLabel, placeLabel, eventRanges, byRecent, GROUPS, CAP
} from '../app/global-search-model.mjs';

test('parseQuery follows the server rules (2+ letters, 1~6 words, 200 chars, no control characters)', () => {
  assert.deepEqual(parseQuery('궤도 교섭'), {words: ['궤도', '교섭'], error: null, query: '궤도 교섭'});
  assert.equal(parseQuery('').error, 'short');
  assert.equal(parseQuery('   ').error, 'short');
  assert.equal(parseQuery('궤').error, 'short');
  assert.equal(parseQuery('궤도 a').error, 'short');
  assert.deepEqual(parseQuery('Rail rail RAIL').words, ['Rail'], 'same word once, case-insensitive');
  assert.equal(parseQuery('aa bb cc dd ee ff').error, null);
  assert.equal(parseQuery('aa bb cc dd ee ff gg').error, 'many');
  assert.equal(parseQuery('a'.repeat(101)).error, 'many');
  assert.equal(parseQuery('가'.repeat(201)).error, 'bad');
  assert.equal(parseQuery('궤도\n교섭').error, 'bad');
  assert.equal(parseQuery('궤도\t교섭').error, 'bad');
  assert.equal(parseQuery('50%_\\').error, null, '% _ \\ are plain letters');
});

test('errorMessage maps every server error code and status to plain words', () => {
  assert.match(errorMessage({message: 'SEARCH_QUERY_TOO_SHORT'}), /두 글자/);
  assert.match(errorMessage({message: 'SEARCH_TOO_MANY_WORDS'}), /6개/);
  assert.match(errorMessage({message: 'SEARCH_BAD_QUERY'}), /200자/);
  assert.match(errorMessage({message: 'SEARCH_BAD_KIND'}), /조건/);
  assert.match(errorMessage({message: 'SEARCH_BAD_PAGE'}), /조건/);
  assert.match(errorMessage({status: 401, message: 'x'}), /로그인/);
  assert.match(errorMessage({status: 403, message: 'permission denied for function'}), /권한/);
  assert.match(errorMessage({status: 404, message: 'PGRST202'}), /아직/);
  assert.match(errorMessage({status: 500, message: 'boom'}), /잠시 뒤/);
  assert.doesNotMatch(errorMessage({status: 500, message: 'secret detail'}), /secret/);
});

test('highlightParts splits text into plain/mark pieces, merges overlaps, ignores case, never builds HTML', () => {
  assert.deepEqual(highlightParts('궤도협의회 교섭', ['교섭']), [{text: '궤도협의회 ', mark: false}, {text: '교섭', mark: true}]);
  assert.deepEqual(highlightParts('abcd', ['abc', 'bcd']), [{text: 'abcd', mark: true}]);
  assert.deepEqual(highlightParts('Rail rail', ['RAIL']), [{text: 'Rail', mark: true}, {text: ' ', mark: false}, {text: 'rail', mark: true}]);
  const xss = '<img src=x onerror=alert(1)>';
  const parts = highlightParts(`제목 ${xss}`, [xss]);
  assert.equal(parts.at(-1).text, xss, 'the raw text stays text; the renderer uses textContent');
  assert.deepEqual(highlightParts('', ['a']), []);
  assert.deepEqual(highlightParts('없음', ['xx']), [{text: '없음', mark: false}]);
});

test('snippetAround keeps about 40 letters around the first word found', () => {
  const body = '가'.repeat(60) + ' 교섭 ' + '나'.repeat(60);
  const s = snippetAround(body, ['없음', '교섭']);
  assert.ok(s.startsWith('…') && s.endsWith('…'));
  assert.ok(s.includes('교섭'));
  assert.ok(s.length <= 2 + 40 + 2 + 40 + 2);
  assert.equal(snippetAround('짧은 교섭', ['교섭']), '짧은 교섭');
  assert.equal(snippetAround('', ['a']), null);
});

test('Google events: title and place only (not the description), all words, recent first', () => {
  const events = [
    {id: 'a', title: '궤도 교섭', location: '서울', description: '', start: '2026-09-01T10:00:00+09:00', calendarId: 'c'},
    {id: 'b', title: '회의', location: '궤도 교섭실', start: '2026-10-01T10:00:00+09:00', calendarId: 'c'},
    {id: 'c', title: '회의', location: '', description: '궤도 교섭', start: '2026-10-02', allDay: true},
    {id: 'd', title: '궤도', location: '부산', start: '2026-10-03'}
  ];
  const r = filterEvents(events, ['궤도', '교섭']);
  assert.deepEqual(r.map(x => x.id), ['b', 'a']);
  assert.equal(r[0].matched_in, 'body');
  assert.match(r[0].snippet, /궤도 교섭실/);
  assert.equal(r[1].matched_in, 'title');
  assert.equal(r[1].source, 'google_event');
  assert.equal(r[1].calendar_id, 'c');
  assert.deepEqual(filterEvents(events, []), []);
});

test('Google tasks: title and notes, completed ones marked done', () => {
  const tasks = [
    {id: '1', title: '교섭 자료 준비', status: 'needsAction', due: '2026-10-10'},
    {id: '2', title: '정리', notes: '교섭 결과 정리', status: 'completed', completed: '2026-10-05T00:00:00Z'},
    {id: '3', title: '다른 일'}
  ];
  const r = filterTasks(tasks, ['교섭']);
  assert.deepEqual(r.map(t => t.id), ['1', '2']);
  assert.equal(r[1].state, 'done');
  assert.equal(r[1].matched_in, 'body');
  assert.equal(r[0].source, 'google_task');
});

test('cleanServer keeps known kinds only (never a diary group) and the fields the screen uses', () => {
  const g = cleanServer({words: ['x'], groups: [
    {kind: 'update', total: 3, capped: false, offset: 0, items: [{id: 'n1', kind: 'update', source: 'note', title: 't', matched_in: 'body', snippet: 's', occurred_at: '2026-10-01T00:00:00Z', state: 'held', extra: 'drop'}]},
    {kind: 'diary', total: 9, items: [{id: 'd'}]},
    {kind: 'milestone', total: 250, capped: true, items: [{id: 'm', matched_in: '<b>'}]}
  ]});
  assert.deepEqual([...g.keys()], ['update', 'milestone']);
  assert.equal(g.get('update').items[0].extra, undefined);
  assert.equal(g.get('update').items[0].state, 'held');
  assert.equal(g.get('milestone').items[0].matched_in, 'title');
  assert.equal(cleanServer(null).size, 0);
});

test('buildGroups merges milestones and Google events into 일정, tasks into 할 일, recent first, with counts and caps', () => {
  const server = cleanServer({groups: [
    {kind: 'milestone', total: 1, items: [{id: 'm', kind: 'milestone', source: 'milestone', title: '주요', occurred_at: '2026-10-05T00:00:00Z'}]},
    {kind: 'update', total: 300, capped: true, items: [{id: 'u', occurred_at: '2026-10-01T00:00:00Z'}]}
  ]});
  const local = {schedule: [{id: 'g', source: 'google_event', occurred_at: '2026-10-09T00:00:00Z'}], task: [{id: 't', occurred_at: null}]};
  const groups = buildGroups(server, local, 3);
  assert.deepEqual(groups.map(g => g.key), GROUPS.map(g => g.key));
  const schedule = groups.find(g => g.key === 'schedule');
  assert.equal(schedule.total, 2);
  assert.deepEqual(schedule.items.map(i => i.id), ['g', 'm']);
  assert.equal(groups.find(g => g.key === 'task').total, 1);
  const update = groups.find(g => g.key === 'update');
  assert.equal(update.capped, true);
  assert.equal(countLabel(update.total, update.capped), `${CAP}+`);
  const chips = chipOptions(groups);
  assert.deepEqual(chips.map(c => c.value), ['all', 'update', 'note', 'task', 'document', 'meeting', 'schedule']);
  assert.match(chips[0].label, /^전체 200\+$/);
  assert.equal(chips.find(c => c.value === 'schedule').label, '일정 2');
  assert.ok(!chips.some(c => c.value === 'work'), '업무일지 has no chip (decision 1)');
  assert.ok(!chips.some(c => /일기/.test(c.label)));
});

test('byRecent: newer first, then id', () => {
  const list = [{id: 'b', occurred_at: '2026-01-01'}, {id: 'a', occurred_at: '2026-01-01'}, {id: 'c', occurred_at: '2026-05-01'}, {id: 'z', occurred_at: null}];
  assert.deepEqual(list.sort(byRecent).map(x => x.id), ['c', 'a', 'b', 'z']);
});

test('openTarget picks the screen from the source field', () => {
  assert.deepEqual(openTarget({source: 'note', kind: 'update', id: 'n'}), {view: 'basket', note: 'memo', id: 'n'});
  assert.deepEqual(openTarget({source: 'note', kind: 'note', id: 'n'}), {view: 'basket', note: 'doc', id: 'n'});
  assert.deepEqual(openTarget({source: 'note', kind: 'work', id: 'n', day: '2026-10-01'}), {view: 'journal', day: '2026-10-01'});
  assert.deepEqual(openTarget({source: 'document', id: 'd'}), {view: 'library', id: 'd'});
  assert.deepEqual(openTarget({source: 'meeting', id: 'm'}), {view: 'meetings', id: 'm'});
  assert.deepEqual(openTarget({source: 'progress', id: 'x', project_id: 'p'}), {view: 'projects', id: 'p'});
  assert.deepEqual(openTarget({source: 'milestone', id: 'x', project_id: 'p'}), {view: 'projects', id: 'p'});
  assert.deepEqual(openTarget({source: 'org_update', id: 'x', organization_id: 'o'}), {view: 'team', id: 'o'});
  assert.deepEqual(openTarget({source: 'organization', id: 'o'}), {view: 'team', id: 'o'});
  assert.deepEqual(openTarget({source: 'google_task', id: 't'}), {view: 'tasks', id: 't'});
  assert.deepEqual(openTarget({source: 'google_event', id: 'e', calendar_id: 'c'}), {view: 'calendar', id: 'e', calendarId: 'c'});
  assert.equal(openTarget({source: 'diary', id: 'x'}), null);
  assert.equal(openTarget({source: 'progress', id: 'x'}), null);
});

test('dateLabel and placeLabel', () => {
  assert.equal(dateLabel({occurred_at: '2026-10-02T16:00:00Z'}), '2026. 10. 3.');
  assert.equal(dateLabel({day: '2026-10-01', occurred_at: '2026-09-30T15:00:00Z'}), '2026. 10. 1.');
  assert.equal(dateLabel({}), '');
  assert.equal(placeLabel({title: 'A', organization_name: '조직', project_name: '프로젝트'}), '조직 · 프로젝트');
  assert.equal(placeLabel({title: '프로젝트', project_name: '프로젝트'}), '');
});

test('eventRanges cover 3 months back to 6 months ahead in three reads', () => {
  const r = eventRanges(Date.UTC(2026, 9, 22));
  assert.equal(r.length, 3);
  assert.equal(r[0][0], '2026-07-01T00:00:00.000Z');
  assert.equal(r[2][1], '2027-05-01T00:00:00.000Z');
  for (let i = 1; i < r.length; i++) assert.equal(r[i][0], r[i - 1][1]);
});
