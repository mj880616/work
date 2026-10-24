// CALL-통화메뉴·TG-소식메뉴 4단계: 화면 순수 규칙(app/feed-model.mjs). 모든 글·방 이름은 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupByDay, sortFeed, dayLabel, hhmm, kstDay, readPoint, readPoints, speakerLines, telegramLines, callFiltered, telegramToday, telegramHeadText,
  roomsOf, roomTone, roomInitial, pinnedOf, linkSummaryDefault, missingTable} from '../app/feed-model.mjs';

test('목록 묶기: 날짜 내림차순, 같은 날은 시각 내림차순, 날짜마다 한 묶음', () => {
  const rows = [
    {id:'a', day:'2026-10-21', occurred_at:'2026-10-21T06:47:00Z'},
    {id:'b', day:'2026-10-23', occurred_at:'2026-10-23T01:18:00Z'},
    {id:'c', day:'2026-10-23', occurred_at:'2026-10-23T07:42:00Z'},
    {id:'d', day:'2026-10-22', occurred_at:'2026-10-22T09:30:00Z'},
  ];
  const g = groupByDay(rows);
  assert.deepEqual(g.map(x => x.day), ['2026-10-23', '2026-10-22', '2026-10-21']);
  assert.deepEqual(g[0].items.map(r => r.id), ['c', 'b']);
  assert.equal(g[0].label, '10. 23. (금)');
  assert.deepEqual(sortFeed(rows).map(r => r.id), ['c', 'b', 'd', 'a']);
  assert.deepEqual(groupByDay([]), []);
});

test('시각·날짜는 한국 시각', () => {
  assert.equal(hhmm('2026-10-23T07:42:00Z'), '16:42');
  assert.equal(kstDay('2026-10-23T16:30:00Z'), '2026-10-24');
  assert.equal(dayLabel('2026-10-19'), '10. 19. (월)');
  assert.equal(dayLabel('잘못된 날'), '');
});

test('머리표 읽기: [확정]·[예정]·[확인]은 작은 표시, 나머지는 그대로', () => {
  assert.deepEqual(readPoint('[확정] 요구안 12명 유지'), {tag:'확정', kind:'done', text:'요구안 12명 유지'});
  assert.deepEqual(readPoint('[예정] 10. 28.(화) 3차 교섭'), {tag:'예정', kind:'plan', text:'10. 28.(화) 3차 교섭'});
  assert.deepEqual(readPoint('[확인] 회신 기한'), {tag:'확인', kind:'check', text:'회신 기한'});
  assert.deepEqual(readPoint('가상지부가 다시 연락하기로 함'), {tag:'', kind:'', text:'가상지부가 다시 연락하기로 함'});
  // 모르는 머리표·빈 내용은 글 그대로 둔다(지어내지 않음).
  assert.deepEqual(readPoint('[보류] 무엇'), {tag:'', kind:'', text:'[보류] 무엇'});
  assert.deepEqual(readPoint('[확정]   '), {tag:'', kind:'', text:'[확정]'});
  assert.equal(readPoints(['[예정] 가', '', 3, null, '나']).length, 2);
  assert.deepEqual(readPoints('글'), []);
});

test('머리표 모양은 서버(collector-feed pointsOf)와 같다', () => {
  const src = readFileSync(new URL('../supabase/functions/collector-feed/call-analysis.ts', import.meta.url), 'utf8');
  for (const tag of ['확정', '예정', '확인']) assert.ok(src.includes(`tag("${tag}"`), tag);
  assert.ok(src.includes('`[${t}] ${p}`'));
});

test('화자 줄: 나/상대 표기/화자1, 맞지 않는 줄은 앞 줄에 이어 붙임', () => {
  const lines = speakerLines('나: 화요일 두 시 어때요?\n가상지부 홍길동 위원장: 됩니다.\n이어지는 말\n\n화자2: 네');
  assert.deepEqual(lines, [
    {who:'나', me:true, text:'화요일 두 시 어때요?'},
    {who:'가상지부 홍길동 위원장', me:false, text:'됩니다. 이어지는 말'},
    {who:'화자2', me:false, text:'네'},
  ]);
  assert.deepEqual(speakerLines('머리 없는 첫 줄'), [{who:'', me:false, text:'머리 없는 첫 줄'}]);
  assert.deepEqual(speakerLines(''), []);
});

test('텔레그램 원문 줄: HH:MM A: 글, (전달), 여러 줄 메시지', () => {
  const lines = telegramLines('16:31 A: 사측 연락 왔습니다\n16:33 B (전달): 공지 원문\n둘째 줄\n16:40 A: 화요일로');
  assert.deepEqual(lines, [
    {at:'16:31', who:'A', forwarded:false, text:'사측 연락 왔습니다'},
    {at:'16:33', who:'B', forwarded:true, text:'공지 원문\n둘째 줄'},
    {at:'16:40', who:'A', forwarded:false, text:'화요일로'},
  ]);
});

test('걸러짐 개수: 최근 7일 통화의 개인+애매, 판정 실패는 따로', () => {
  const days = [
    {source:'call', day:'2026-10-24', personal_count:2, unsure_count:1, failed_count:0},
    {source:'call', day:'2026-10-18', personal_count:1, unsure_count:0, failed_count:2},
    {source:'call', day:'2026-10-17', personal_count:9, unsure_count:9, failed_count:9},
    {source:'telegram', day:'2026-10-24', personal_count:5},
  ];
  assert.deepEqual(callFiltered(days, '2026-10-24'), {personal:3, unsure:1, failed:2, total:4});
  assert.deepEqual(callFiltered([], '2026-10-24'), {personal:0, unsure:0, failed:0, total:0});
});

test('텔레그램 머리줄 숫자는 오늘 줄만', () => {
  const days = [{source:'telegram', day:'2026-10-24', total_count:412, kept_count:9, room_count:5, failed_count:0}, {source:'telegram', day:'2026-10-23', total_count:1}];
  const t = telegramToday(days, '2026-10-24');
  assert.equal(telegramHeadText(t), '오늘 412개 중 중요한 9개 · 방 5곳');
  assert.equal(telegramHeadText(telegramToday(days, '2026-10-25')), '오늘 받은 소식 없음');
});

test('방: 거르기 목록·같은 방은 늘 같은 색·머리글자', () => {
  const rows = [{id:'1', day:'2026-10-23', occurred_at:'2026-10-23T01:00:00Z', room_key:'r1', room_label:'가상지부 단톡'}, {id:'2', day:'2026-10-24', occurred_at:'2026-10-24T01:00:00Z', room_key:'r2', room_label:'예시 간부방'}, {id:'3', day:'2026-10-22', occurred_at:'2026-10-22T01:00:00Z', room_key:'r1', room_label:'가상지부 단톡'}];
  assert.deepEqual(roomsOf(rows), [{key:'r2', label:'예시 간부방'}, {key:'r1', label:'가상지부 단톡'}]);
  assert.equal(roomTone('r1'), roomTone('r1'));
  for (const k of ['a', 'b', 'room:x', '']) assert.ok(roomTone(k) >= 1 && roomTone(k) <= 6);
  assert.equal(roomInitial('○○ 가상방'), '가');
  assert.equal(roomInitial('☆☆'), '·');
  assert.deepEqual(pinnedOf([{id:'a', pinned_at:'2026-10-20T00:00:00Z'}, {id:'b'}, {id:'c', pinned_at:'2026-10-22T00:00:00Z'}]).map(r => r.id), ['c', 'a']);
});

test('조직 연결 요약 기본값: 통화는 핵심내용 줄, 텔레그램은 말풍선 요약', () => {
  assert.equal(linkSummaryDefault({source:'call', title:'제목', points:['가상 교섭 미룸', '[예정] 회신 월요일']}), '- 가상 교섭 미룸\n- 회신 월요일 (예정)');
  assert.equal(linkSummaryDefault({source:'call', title:'제목만', points:[]}), '제목만');
  assert.equal(linkSummaryDefault({source:'telegram', summary:' 자료집 마감 금요일 '}), '자료집 마감 금요일');
  assert.equal(linkSummaryDefault(null), '');
});

test('표가 없으면 준비 중', () => {
  assert.ok(missingTable({status:404}));
  assert.ok(missingTable({status:400, message:"Could not find the table 'public.app_feed_items' in the schema cache", code:'PGRST205'}));
  assert.ok(!missingTable({status:500, message:'boom'}));
  assert.ok(!missingTable({status:401}));
});
