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

// ---- SEARCH ② 첨부 파일 안 글자: app/document-text-read.js (screen side). No network: the runtime is a stub. ----
const dtr=await import('../app/document-text-read.js');
const DOC_ID='e0000000-0000-4000-8000-0000000000a1',WS_ID='e0000000-0000-4000-8000-0000000000b1';
test('requestDocumentText: one document-text call with the id only, no session refresh, never throws',async()=>{
  const calls=[];
  const rt={api:async(path,o)=>{calls.push([path,o]);return {ok:true,status:'ready',reason:'ok'}}};
  assert.deepEqual(await dtr.requestDocumentText(DOC_ID,{rt}),{ok:true,status:'ready'});
  assert.deepEqual(calls.map(([p,o])=>[p,o.method,o.body,o.refreshSession,o.singleFlight]),[['/functions/v1/document-actions','POST',{action:'document-text',document_id:DOC_ID},false,false]]);
  // Bad id or no runtime: nothing is sent.
  for(const id of ['x',null,DOC_ID+'0'])assert.deepEqual(await dtr.requestDocumentText(id,{rt}),{ok:false});
  assert.equal(calls.length,1);
  assert.deepEqual(await dtr.requestDocumentText(DOC_ID,{rt:null}),{ok:false});
  // Failures and odd answers are quiet.
  assert.deepEqual(await dtr.requestDocumentText(DOC_ID,{rt:{api:async()=>{throw new Error('boom')}}}),{ok:false});
  assert.deepEqual(await dtr.requestDocumentText(DOC_ID,{rt:{api:async()=>({ok:true,status:'weird'})}}),{ok:false});
});
test('readTextLater: starts a read for an upload answer with a document id only; never waits or throws',async()=>{
  const calls=[];const rt={api:async(path,o)=>{calls.push(o.body);return {ok:true,status:'error'}}};
  assert.equal(dtr.readTextLater({id:DOC_ID,title:'x'},{rt}),undefined);
  dtr.readTextLater(null,{rt});dtr.readTextLater({id:'nope'},{rt});dtr.readTextLater(undefined,{rt});
  await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(calls,[{action:'document-text',document_id:DOC_ID}]);
  dtr.readTextLater({id:DOC_ID},{rt:{api:async()=>{throw new Error('x')}}});
  await new Promise(r=>setTimeout(r,0));
});
test('readMissingTexts (backfill, prepared only): lists unread documents of this workspace, newest first, capped, one at a time',async()=>{
  const calls=[];let n=0;
  const rows=[{id:'e0000000-0000-4000-8000-0000000000c1'},{id:'e0000000-0000-4000-8000-0000000000c2'},{id:'e0000000-0000-4000-8000-0000000000c3'}];
  const rt={context:{read:()=>({workspace:{id:WS_ID}})},api:async(path,o={})=>{calls.push([path,o.body??null]);if(path.startsWith('/rest/v1/'))return rows;n++;return n===2?{ok:true,status:'error'}:n===3?Promise.reject(new Error('x')):{ok:true,status:'ready'}}};
  assert.deepEqual(await dtr.readMissingTexts({rt,limit:500}),{asked:3,ready:1,error:1,failed:1,stop:null});
  const list=new URL('https://x'+calls[0][0]);
  assert.equal(list.pathname,'/rest/v1/app_documents');
  assert.equal(list.searchParams.get('workspace_id'),'eq.'+WS_ID);
  assert.equal(list.searchParams.get('or'),'(extraction_status.is.null,extraction_status.not.in.(ready,error))');
  assert.equal(list.searchParams.get('order'),'created_at.desc');
  assert.equal(list.searchParams.get('limit'),String(dtr.BACKFILL_MAX));
  assert.equal(list.searchParams.get('select'),'id');
  assert.deepEqual(calls.slice(1).map(c=>c[1].document_id),rows.map(r=>r.id));
  // Stops before the next request when the screen is no longer current; no workspace → nothing sent.
  let current=true;const rt2={...rt,api:async(path,o)=>{if(path.startsWith('/rest/'))return rows;current=false;return {ok:true,status:'ready'}}};
  assert.deepEqual(await dtr.readMissingTexts({rt:rt2,isCurrent:()=>current}),{asked:1,ready:1,error:0,failed:0,stop:'stale'});
  assert.equal((await dtr.readMissingTexts({rt:{api:async()=>[],context:{read:()=>({})}}})).stop,'invalid_request');
  assert.equal((await dtr.readMissingTexts({rt:{...rt,api:async()=>{throw new Error('x')}}})).stop,'list_failed');
});
test('readMissingTexts skip: documents already sent in this session are not sent again, and the cap still holds',async()=>{
  const ids=[1,2,3,4].map(n=>'e0000000-0000-4000-8000-0000000000d'+n);
  const sent=[],urls=[];
  const rt={context:{read:()=>({workspace:{id:WS_ID}})},api:async(path,o={})=>{if(path.startsWith('/rest/v1/')){urls.push(path);return ids.map(id=>({id}))}sent.push(o.body.document_id);return Promise.reject(new Error('x'))}};
  const skip=new Set();
  assert.equal((await dtr.readMissingTexts({rt,limit:2,skip})).asked,2);
  assert.equal((await dtr.readMissingTexts({rt,limit:2,skip})).asked,2);
  assert.equal((await dtr.readMissingTexts({rt,limit:2,skip})).asked,0);
  assert.deepEqual(sent,ids);
  assert.equal(new URL('https://x'+urls[1]).searchParams.get('limit'),'4');
});
test('startAutoTextRead: at most 5 per start, one run at a time, quiet on failure, stops when the screen is left, halts when everything failed',async()=>{
  const mk=n=>Array.from({length:n},(_,i)=>({id:'e0000000-0000-4000-8000-0000000001'+String(i).padStart(2,'0')}));
  const rows=mk(20);let sent=[],release=null,fail=false;
  const rt={context:{read:()=>({workspace:{id:WS_ID}})},api:async(path,o={})=>{
    if(path.startsWith('/rest/v1/'))return rows.filter(r=>!sent.includes(r.id)||fail);
    sent.push(o.body.document_id);if(release)await release;if(fail)throw new Error('x');return {ok:true,status:'ready'}}};
  // Hard cap 5 even when asked for more.
  const r1=await dtr.startAutoTextRead({rt,scopeKey:'s1',limit:99});
  assert.equal(r1.asked,5);assert.equal(sent.length,5);
  // Already running: the second start is skipped (null), nothing extra is sent.
  let gate;release=new Promise(r=>{gate=r});
  const a=dtr.startAutoTextRead({rt,scopeKey:'s1'});
  assert.equal(dtr.startAutoTextRead({rt,scopeKey:'s1'}),null);
  gate();release=null;assert.equal((await a).asked,5);assert.equal(sent.length,10);
  // Screen left before the first request: nothing sent.
  assert.equal(dtr.startAutoTextRead({rt,scopeKey:'s2',isCurrent:()=>false}),null);
  // Left in the middle: stops before the next request.
  let cur=true;const before=sent.length;
  const mid=await dtr.startAutoTextRead({rt:{...rt,api:async(p,o)=>{const r=await rt.api(p,o);if(!p.startsWith('/rest/'))cur=false;return r}},scopeKey:'s3',isCurrent:()=>cur});
  assert.equal(mid.stop,'stale');assert.equal(sent.length-before,1);
  // Everything failed: quiet (no throw), and no more starts for this scope.
  fail=true;const f=await dtr.startAutoTextRead({rt,scopeKey:'s4'});
  assert.equal(f.failed,f.asked);assert.ok(f.asked>0);
  assert.equal(dtr.startAutoTextRead({rt,scopeKey:'s4'}),null);
  assert.ok(dtr.startAutoTextRead({rt,scopeKey:'s5'}));
});
test('the auto text read is wired only to the library screen, next to the auto tidy',async()=>{
  const {readdirSync,readFileSync:rf}=await import('node:fs');
  const dir=new URL('../app/',import.meta.url);
  const users=readdirSync(dir).filter(f=>/\.(m?js|html)$/.test(f)&&f!=='document-text-read.js').filter(f=>/readMissingTexts|startAutoTextRead/.test(rf(new URL(f,dir),'utf8')));
  assert.deepEqual(users,['library-upload.js']);
});
