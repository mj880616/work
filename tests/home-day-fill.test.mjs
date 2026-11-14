// HOME-하루채우기(2026-11-09 시안 ④): 오늘 사진 한 줄 규칙·칸 수, 읽을 만한 글·기록 제안 거르기, 화면 연결 자리.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rankDayPhotos, dropBursts, stripFit, eventWindows, isShot, inWindow, BURST_MS} from '../app/home-day-photos-model.mjs';
import {cleanReads, cleanSuggests, suggestTime, readAtLabel, pickedNote, safeUrl, READS_MAX, SUGGEST_MAX} from '../app/home-day-picks-model.mjs';

const at = (hh, mm = 0, ss = 0) => new Date(Date.UTC(2026, 9, 6, hh - 9, mm, ss)).toISOString(); // 2026-10-06 서울 시각
const od = (key, taken, extra = {}) => ({kind:'od', source:'onedrive', key, taken_at:taken, name:`${key}.jpg`, ...extra});
const keys = list => list.map(x => x.key);

test('사진 순서: 별표 → 일정 시간 → 나머지(일기에 넣은 사진 먼저, 찍은 시각 순) → 캡처', () => {
  const items = [
    od('late', at(20)), od('meet', at(10, 30)), od('shot', at(9), {name:'Screenshot_20261006.png'}),
    od('star', at(22)), {kind:'upload', source:'upload', key:'up', file:{file_name:'a.jpg', mime_type:'image/jpeg'}}, od('early', at(8)),
  ];
  const ranked = rankDayPhotos(items, {starred:x => x.key === 'star', windows:[{from:Date.parse(at(10)), to:Date.parse(at(11))}]});
  assert.deepEqual(keys(ranked), ['star', 'meet', 'up', 'early', 'late', 'shot']);
});

test('연속 촬영은 한 장만(별표 → 캡처 아닌 것 → 먼저 찍은 것), 간격이 길면 따로', () => {
  const burst = [od('b1', at(10, 0, 0)), od('b2', at(10, 0, 1)), od('b3', at(10, 0, 3)), od('next', at(10, 0, 3 + BURST_MS / 1000 + 1))];
  assert.deepEqual(keys(dropBursts(burst)), ['b1', 'next']);
  assert.deepEqual(keys(dropBursts(burst, {starred:x => x.key === 'b3'})), ['b3', 'next']);
  const shotFirst = [od('s', at(11, 0, 0), {screenshot:true}), od('p', at(11, 0, 1))];
  assert.deepEqual(keys(dropBursts(shotFirst)), ['p']);
});

test('동영상은 빼고, 캡처는 표시·이름으로만 안다', () => {
  assert.deepEqual(keys(rankDayPhotos([od('v', at(9), {video:true}), od('p', at(9, 30))])), ['p']);
  assert.equal(isShot({name:'스크린샷 2026.png'}), true);
  assert.equal(isShot({screenshot:true}), true);
  assert.equal(isShot({file:{file_name:'캡처.png'}}), true);
  assert.equal(isShot({name:'IMG_0001.jpg'}), false);
});

test('한 줄 칸 수: 다 들어가면 그대로, 넘치면 마지막 칸이 +n', () => {
  // 56px 칸 + 4px 사이: 390 폭 카드 안(약 350px)이면 5칸.
  assert.deepEqual(stripFit(350, 3), {cols:5, shown:3, more:0});
  assert.deepEqual(stripFit(350, 5), {cols:5, shown:5, more:0});
  assert.deepEqual(stripFit(350, 9), {cols:5, shown:4, more:5});
  assert.deepEqual(stripFit(0, 4), {cols:1, shown:0, more:4});
  assert.deepEqual(stripFit(1200, 0), {cols:20, shown:0, more:0});
});

test('일정 시간 칸: 종일 일정은 빼고, 끝이 없으면 1시간', () => {
  const w = eventWindows([{start:'2026-10-06', end:'2026-10-07', allDay:true}, {start:'2026-10-06T10:00:00+09:00', end:'2026-10-06T11:00:00+09:00'}, {start:'2026-10-06T15:00:00+09:00'}]);
  assert.equal(w.length, 2);
  assert.equal(w[1].to - w[1].from, 3600000);
  assert.equal(inWindow(Date.parse(at(10, 59)), w), true);
  assert.equal(inWindow(Date.parse(at(11, 0)), w), false);
  assert.equal(inWindow(null, w), false);
});

test('읽을 만한 글: 세 줄이 다 있는 것만, 같은 글 하나, 최대 3개, 원문은 https만', () => {
  const ok = n => ({id:`n${n}`, title:`○○ 소식 ${n}`, what:'무슨 일 한 줄', why:'담당조직 ○○와 이어짐', source:'○○신문', at:at(8, 10), url:`https://example.org/${n}`});
  const list = cleanReads([ok(1), ok(1), {...ok(2), why:''}, ok(3), {...ok(4), url:'javascript:alert(1)'}, ok(5)]);
  assert.deepEqual(list.map(x => x.id), ['n1', 'n3', 'n4']);
  assert.equal(list.length, READS_MAX);
  assert.equal(list[2].url, '');
  assert.equal(safeUrl('http://example.org'), '');
  assert.deepEqual(cleanReads(null), []);
});

test('기록 제안: 글 있는 것만 최대 2개, 오늘·오후 6시 뒤에만', () => {
  const list = cleanSuggests([{id:'a', text:'○○ 면담 이야기', basis:'15:00 일정'}, {id:'b', text:''}, {id:'c', text:'끝낸 할 일 돌아보기'}, {id:'d', text:'셋째'}]);
  assert.deepEqual(list.map(x => x.id), ['a', 'c']);
  assert.equal(list.length, SUGGEST_MAX);
  assert.equal(suggestTime({day:'2026-10-06', today:'2026-10-06', hour:18}), true);
  assert.equal(suggestTime({day:'2026-10-06', today:'2026-10-06', hour:17}), false);
  assert.equal(suggestTime({day:'2026-10-05', today:'2026-10-06', hour:20}), false);
});

test('시각 글자: 오늘 HH:MM, 어제, 그 앞 월.일 / 고른 때 아침·저녁', () => {
  assert.equal(readAtLabel(at(8, 10), '2026-10-06'), '08:10');
  assert.equal(readAtLabel('2026-10-05T03:00:00Z', '2026-10-06'), '어제');
  assert.equal(readAtLabel('2026-10-01T03:00:00Z', '2026-10-06'), '10.1');
  assert.equal(readAtLabel('', '2026-10-06'), '');
  assert.equal(pickedNote(at(7), '2026-10-06'), '오늘 아침 선택');
  assert.equal(pickedNote(at(19), '2026-10-06'), '오늘 저녁 선택');
  assert.equal(pickedNote('2026-10-05T10:00:00Z', '2026-10-06'), '');
});

test('화면 연결: [하루] 오늘 한 일 아래 한 자리, 공용 부품, 일기 저장 함수 안 부름', () => {
  const journal = readFileSync(new URL('../app/journal.js', import.meta.url), 'utf8');
  const fill = readFileSync(new URL('../app/home-day-fill.js', import.meta.url), 'utf8');
  const done = journal.indexOf('data-journal-done-tasks'), slot = journal.indexOf('data-journal-fill'), materials = journal.indexOf('<div class="journal-materials"');
  assert.ok(done > 0 && slot > done && materials > slot, '오늘 한 일 → 세 칸 → 재료 순서');
  assert.match(fill, /act-photo-thumb/);
  assert.match(fill, /class="row-act" data-journal-photos-open/);
  assert.match(fill, /class="secondary" data-journal-suggest-write/);
  // 기기 저장(브라우저 저장소) 금지는 Browser storage audit 검사가 app/ 전체에서 본다.
  assert.doesNotMatch(fill, /\b(addStar|removeStar|uploadDiary|removeDiaryPhoto|saveDiaryText|createDiary|odDelete)\b/);
});

// ---- PR-C 화면 연결 ----
test('보낼 일정: 그 주 안만, 한국 시각, 종일은 빈 시각, 다음 날 끝은 23:59, 위험 문자는 빈칸', async () => {
  const {sendEvents, sendDone, sendTitle, weekStartOf} = await import('../app/home-day-picks-model.mjs');
  assert.equal(weekStartOf('2026-11-09'), '2026-11-09'); assert.equal(weekStartOf('2026-11-15'), '2026-11-09');
  const events = [
    {title:'오전 일정', start:'2026-11-09T10:00:00+09:00', end:'2026-11-09T11:30:00+09:00'},
    {title:'밤샘', start:'2026-11-09T22:00:00+09:00', end:'2026-11-10T02:00:00+09:00'},
    {title:'여러 날', allDay:true, start:'2026-11-06', end:'2026-11-11'},
    {title:'지난주', allDay:true, start:'2026-11-02', end:'2026-11-03'},
    {title:'다음 주', start:'2026-11-16T09:00:00+09:00', end:'2026-11-16T10:00:00+09:00'},
    {title:'취소', status:'cancelled', start:'2026-11-09T09:00:00+09:00'},
    {title:'방향\u202e바꿈\n줄', start:'2026-11-10T09:00:00+09:00'},
    {title:'', start:'2026-11-10T09:00:00+09:00'},
  ];
  assert.deepEqual(sendEvents(events, '2026-11-09'), [
    {day:'2026-11-09', start:'10:00', end:'11:30', title:'오전 일정'},
    {day:'2026-11-09', start:'22:00', end:'23:59', title:'밤샘'},
    {day:'2026-11-09', start:'', end:'', title:'여러 날'},
    {day:'2026-11-10', start:'09:00', end:'', title:'방향 바꿈 줄'},
  ]);
  assert.equal(sendEvents(Array(50).fill(events[0]), '2026-11-09').length, 40);
  assert.equal(sendTitle('가'.repeat(130)).length, 120);
  const tasks = [{title:'보도자료', status:'completed', completed:'2026-11-09T01:00:00Z'}, {title:'어제 것', status:'completed', completed:'2026-11-08T14:00:00Z'},
    {title:'아직', status:'needsAction'}, {title:'밤 늦게', status:'completed', completed:'2026-11-09T14:59:00Z'}];
  assert.deepEqual(sendDone(tasks, '2026-11-09'), ['보도자료', '밤 늦게']);
});

test('받은 줄: 쓴 제안은 빼고, 모양이 틀린 칸은 빈 값, 한도 알림 문구', async () => {
  const {openSuggests, picksState, limitNote} = await import('../app/home-day-picks-model.mjs');
  const items = [{id:'s1', text:'오늘 회의', basis:'회의'}, {id:'s2', text:'오늘 통화', basis:'통화'}];
  assert.deepEqual(openSuggests(items, ['s1']).map(x => x.id), ['s2']);
  assert.deepEqual(openSuggests(items, null).map(x => x.id), ['s1', 's2']);
  assert.deepEqual(picksState({reads:'x', reads_at:'bad', suggests:items, suggests_done:['s2']}),
    {reads:{items:[], picked_at:null}, suggests:{items, done:['s2']}});
  assert.equal(limitNote('monthly_limit'), '이번 달 AI 한도에 닿았어요.');
  assert.equal(limitNote('daily_limit'), '오늘 AI 횟수를 다 썼어요.');
  assert.equal(limitNote('ai_busy'), '');
});

test('부탁은 같은 날·같은 때 10분 안 한 번, 받은 결과·한도·실패를 나눔, 쓴 제안 표시는 s1~s9만', async () => {
  const {askDayPicks, forgetAsked, markSuggestDone} = await import('../app/home-day-picks-data.js');
  const rt = {context:{read:() => ({user:{id:'u'}, workspace:{id:'w'}})}, calls:[], api:async (path, opt) => { rt.calls.push([path, opt]); return opt ? null : [{suggests_done:['s1']}]; }};
  forgetAsked();
  const sent = [];
  const call = async body => { sent.push(body); return {ok:true, data:{ok:true, kind:'home_day_picks', picks:{reads:[], suggests:[{id:'s1', text:'a', basis:'b'}], suggests_done:[]}}}; };
  const first = await askDayPicks({day:'2026-11-09', slot:'am', events:[], done:['x']}, rt, {now:0, call});
  assert.deepEqual(sent, [{kind:'home_day_picks', day:'2026-11-09', events:[], done:['x']}]);
  assert.equal(first.state.suggests.items.length, 1);
  assert.deepEqual(await askDayPicks({day:'2026-11-09', slot:'am', events:[], done:[]}, rt, {now:60000, call}), {skipped:true});
  assert.equal(sent.length, 1);
  assert.deepEqual(await askDayPicks({day:'2026-11-09', slot:'pm', events:[], done:[]}, rt, {now:60000, call:async () => ({ok:false, code:'monthly_limit'})}), {limit:'monthly_limit'});
  assert.equal(await askDayPicks({day:'2026-11-10', slot:'am', events:[], done:[]}, rt, {now:0, call:async () => ({ok:false, code:'ai_busy'})}), null);
  assert.equal(await markSuggestDone('2026-11-09', 'x9', rt), false);
  assert.equal(await markSuggestDone('2026-11-09', 's2', rt), true);
  const patch = rt.calls.find(([, opt]) => opt?.method === 'PATCH');
  assert.match(patch[0], /^\/rest\/v1\/app_home_day_picks\?workspace_id=eq\.w&day=eq\.2026-11-09$/);
  assert.deepEqual(patch[1].body, {suggests_done:['s1', 's2']});
});

test('화면 연결 PR-C: 오늘만 서버에 부탁, [일기 쓰기]는 첫 줄 채운 일기 쓰기 창, 저장 뒤 제안 지움', () => {
  const journal = readFileSync(new URL('../app/journal.js', import.meta.url), 'utf8');
  const diary = readFileSync(new URL('../app/diary.js', import.meta.url), 'utf8');
  const fill = readFileSync(new URL('../app/home-day-fill.js', import.meta.url), 'utf8');
  assert.match(journal, /selected !== today \|\| mode === 'week' \|\| !onHomeView\(\)\) return;/);
  assert.match(journal, /requestDiaryWrite\(day, text, \(\) => \{/);
  assert.match(journal, /markSuggestDone\(day, id, rt\)/);
  assert.match(diary, /takeRequestedWrite\(day, rt\)/);
  assert.match(diary, /edit\.pendingMerge = joinDiaryDocs\(edit\.startDoc, plainToDocKeep/);
  assert.match(diary, /if \(session\.onSaved && text\.trim\(\)\)/);
  assert.match(fill, /openSuggests\(suggests\?\.items, suggests\?\.done\)/);
  assert.match(fill, /data-journal-fill-limit/);
});

// ---- HOME-읽을글밀기(2026-11-11): 숨기거나 보관한 글은 홈 '읽을 만한 글'에서 뺀다 ----
const UUID_A = '11111111-1111-4111-8111-111111111111', UUID_B = '22222222-2222-4222-8222-222222222222', UUID_C = '33333333-3333-4333-8333-333333333333';

test('처리한 글 거르기: 숨김(hidden_at)·보관(starred_at)만 뺀다, 표에 줄이 없는 글·UUID 아닌 id는 그대로', async () => {
  const {newsIdOf, handledNewsIds, visibleReads, READS_DONE_NOTE} = await import('../app/home-day-picks-model.mjs');
  assert.equal(newsIdOf(UUID_A.toUpperCase()), UUID_A);
  assert.equal(newsIdOf('n1'), '');
  assert.equal(newsIdOf("x') or true"), '');
  const handled = handledNewsIds([{id:UUID_A, hidden_at:'2026-11-11T00:00:00Z', starred_at:null}, {id:UUID_B, hidden_at:null, starred_at:'2026-11-11T00:00:00Z'}, {id:UUID_C, hidden_at:null, starred_at:null}, {id:'n9', hidden_at:'x'}, null]);
  assert.deepEqual([...handled].sort(), [UUID_A, UUID_B]);
  const list = [{id:UUID_A}, {id:UUID_B}, {id:UUID_C}, {id:'n1'}];
  assert.deepEqual(visibleReads(list, handled).map(x => x.id), [UUID_C, 'n1']);
  assert.deepEqual(visibleReads(list, new Set()).length, 4);
  assert.deepEqual(visibleReads(list, null).length, 4);
  assert.equal(handledNewsIds(null).size, 0);
  assert.equal(READS_DONE_NOTE, '다 읽었어요');
});

test('처리 표시 읽기: 내 작업공간 뉴스 줄의 id·숨김·별표만 한 번에 읽고, 못 읽으면 ok:false(거르지 않음)', async () => {
  const {readReadMarks} = await import('../app/home-day-picks-data.js');
  const calls = [];
  const rt = {context:{read:() => ({user:{id:'u'}, workspace:{id:'w'}})}, api:async path => { calls.push(path); return [{id:UUID_A, hidden_at:'2026-11-11T00:00:00Z', starred_at:null}, {id:UUID_B, hidden_at:null, starred_at:null}]; }};
  const out = await readReadMarks([UUID_A, UUID_B, UUID_A, 'n1', "x,y"], rt);
  assert.equal(out.ok, true);
  assert.deepEqual([...out.handled], [UUID_A]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], `/rest/v1/app_news_items?workspace_id=eq.w&id=in.(${UUID_A},${UUID_B})&select=id,hidden_at,starred_at&limit=2`);
  assert.deepEqual(await readReadMarks(['n1'], rt), {ok:true, handled:new Set()});
  assert.equal(calls.length, 1, 'UUID가 없으면 서버에 묻지 않는다');
  assert.deepEqual(await readReadMarks([UUID_A], {context:{read:() => ({})}, api:async () => []}), {ok:false});
  assert.deepEqual(await readReadMarks([UUID_A], {context:{read:() => ({workspace:{id:'w'}})}, api:async () => { throw new Error('net'); }}), {ok:false});
});

test('화면 연결 HOME-읽을글밀기: 공용 줄 밀기(bindNowRows) 그대로, 뉴스 글 표시로 거름, 홈에 따로 저장하지 않음', () => {
  const fill = readFileSync(new URL('../app/home-day-fill.js', import.meta.url), 'utf8');
  const acts = readFileSync(new URL('../app/now-row-acts.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/journal.css', import.meta.url), 'utf8');
  assert.match(fill, /import \{bindNowRows, hoverActsHtml\} from '\.\/now-row-acts\.js'/);
  assert.match(fill, /bindNowRows\(readsHost, \{row:'\[data-journal-read\]'/);
  assert.match(fill, /itemOf: el => \{ const id = newsIdOf\(el\.dataset\.journalRead\); return id \? \{type:'news', id\} : null; \}/);
  assert.match(fill, /visibleReads\(known, m\.handled\)/);
  // HOME-읽을글한글만: 처리 여부를 아는 글은 읽는 중에도 보이고(글마다 checked), 같은 사람이면 묶음이 바뀌어도 표시를 이어 쓴다.
  assert.match(fill, /m\.checked\.has\(id\)/);
  assert.match(fill, /const keep = marks\.who === who/);
  assert.match(fill, /READS_DONE_NOTE/);
  assert.doesNotMatch(fill, /isSaved/, '홈에서는 보관한 글이 빠지므로 오른쪽 밀기는 늘 보관');
  assert.match(acts, /titleOf = nwTitle/);
  assert.match(css, /journal-read:hover > \.now-hov/);
  assert.match(css, /touch-action:pan-y/);
  const loader = readFileSync(new URL('../app/view-loader.js', import.meta.url), 'utf8');
  assert.match(loader, /home:\[[^\]]*'\.\/row-swipe\.css'[^\]]*'\.\/od-link\.css'/, '홈에도 줄 밀기·공용 줄 메뉴(우클릭) 모양');
  // 뉴스 쪽 줄 밀기 사용은 그대로(titleOf 기본값이 .nw-title).
  assert.match(acts, /el\.querySelector\('\.nw-title'\)/);
});
