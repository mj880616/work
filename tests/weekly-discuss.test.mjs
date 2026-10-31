// S46-27 주간보고 '1. 요청사항' 세 칸: 3) 상집 논의 요청 줄(app/weekly-discuss.mjs)·같은 임시저장 칸(weekly-draft-store.js draft.discuss)·한글 파일 차례.
// 이름·안건·조직은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanDiscussRow, readDiscuss, withDiscussRow, withoutDiscussRow, movedDiscussRow, discussLines, discussFromRequest, DISCUSS_MAX} from '../app/weekly-discuss.mjs';
import {makeDraft, readDraft, merge3, keepDocsOnly, draftDiscuss, withDiscuss, withHq, draftCells, hasContent} from '../app/weekly-draft-store.js';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {openHwpx, packHwpx, validateHwpx, readXml} from '../app/weekly-hwpx/hwpx.mjs';
import {extractBlankTemplate} from '../app/weekly-hwpx/template.mjs';
import {buildReport} from '../app/weekly-hwpx/report.mjs';
import {textOf} from '../app/weekly-hwpx/xml.mjs';
import {makeFakeReport, DEMO_DATA} from '../scripts/weekly-hwpx/fixture.mjs';
import {weeklyLines} from '../app/weekly-lines.mjs';

const A = {id:'d1', title:'가상 안건 갑', note:'가상 설명', org:'가상 지부'};
const B = {id:'d2', title:'가상 안건 을'};

test('줄 모양: 안건 필수·한 줄·길이 자르기, 모르는 칸 버림, 같은 id 한 번', () => {
  assert.deepEqual(cleanDiscussRow({...A, extra:1}), A);
  assert.equal(cleanDiscussRow({id:'d3', title:'  '}), null);
  assert.equal(cleanDiscussRow({id:'bad id', title:'가'}), null);
  assert.deepEqual(cleanDiscussRow({id:'d4', title:'가\n나', note:'', org:''}), {id:'d4', title:'가 나'});
  assert.equal([...cleanDiscussRow({id:'d5', title:'가'.repeat(500)}).title].length, 120);
  assert.deepEqual(readDiscuss([A, A, B, null, 'x']), [A, B]);
});

test('더하기·고치기·빼기·옮기기, 가득 차면 null', () => {
  let rows = withDiscussRow([], {title:'가상 새 안건'});
  assert.equal(rows.length, 1); assert.match(rows[0].id, /^[A-Za-z0-9_-]{1,40}$/);
  rows = withDiscussRow([A, B], {id:'d1', title:'고친 안건', org:''});
  assert.deepEqual(rows, [{id:'d1', title:'고친 안건'}, B]);
  assert.deepEqual(withoutDiscussRow([A, B], 'd1'), [B]);
  assert.deepEqual(movedDiscussRow([A, B], 'd2', 0).map(r => r.id), ['d2', 'd1']);
  assert.equal(withDiscussRow([A], {title:''}), null);
  const full = Array.from({length:DISCUSS_MAX}, (_, i) => ({id:`f${i}`, title:`가상 ${i}`}));
  assert.equal(withDiscussRow(full, {title:'하나 더'}), null);
});

test('한글 파일·복사 줄과 1)에서 옮기기', () => {
  assert.deepEqual(discussLines([A, B]), ['- 가상 안건 갑 — 가상 설명 (가상 지부)', '- 가상 안건 을']);
  assert.deepEqual(discussFromRequest({what:'가상 토론회', time:'14:00', place:'가상 회관'}, '10.15.(목)'), {title:'가상 토론회', note:'10.15.(목) / 14:00 / 가상 회관'});
});

test('임시저장 칸: 상자·[주간 정리]가 같은 draft.discuss를 다시 실어 보내고, 3자 비교로 합친다', () => {
  const d = withDiscuss(null, [A]);
  assert.deepEqual(draftDiscuss(d), [A]);
  assert.equal(hasContent(d), false); // 고친 칸이 아니다(이어 쓰기 질문 없음)
  // 상자가 통째로 쓰는 draft에도 남는다
  const box = makeDraft({discuss:[A, B], hq:[]});
  assert.deepEqual(readDraft(box).discuss, [A, B]);
  assert.deepEqual(draftCells(box).get('discuss'), [A, B]);
  // [처음부터]에도 남는다
  assert.deepEqual(keepDocsOnly(box).discuss, [A, B]);
  // 한쪽만 바꾸면 그쪽, 양쪽이 다르게 바꾸면 충돌(서버 값을 둠)
  const base = withDiscuss(null, [A]);
  const mine = withHq(base, []), theirs = withDiscuss(base, [A, B]);
  assert.deepEqual(merge3(base, mine, theirs).draft.discuss, [A, B]);
  const other = withDiscuss(base, [B]);
  const both = merge3(base, theirs, other);
  assert.deepEqual(both.conflicts.map(c => c.cell), ['discuss']);
  assert.deepEqual(both.draft.discuss, [B]);
  // 다 빼면 칸이 없어진다
  assert.equal('discuss' in withDiscuss(d, []), false);
});

const sample = () => openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib);
const order = pkg => readXml(pkg, 'Contents/section0.xml').root.children.filter(n => n.name === 'hp:p').map(p => textOf(p));

test('한글 파일: 1. 요청사항 아래 1) 임원 배정 요청 표 → 2) 주요 일정 줄 → 3) 상집 논의 요청 줄, 내용이 없으면 제목만 두고 빈 칸', () => {
  const blank = extractBlankTemplate(makeFakeReport(sample()));
  const lines = ['- 가상 안건 갑 — 가상 설명 (가상 지부)', '- 가상 안건 을'];
  const {pkg} = buildReport(blank, {...DEMO_DATA, schedule:['- 가상 본부 일정'], discuss:lines});
  assert.deepEqual(validateHwpx(packHwpx(pkg, zlib), zlib).errors, []);
  const t = order(pkg), at = t.indexOf('3) 상집 논의 요청');
  assert.ok(t.indexOf('1) 임원 배정 요청') < t.indexOf('2) 주요 일정') && t.indexOf('2) 주요 일정') < at, JSON.stringify(t.slice(0, 12)));
  assert.deepEqual(t.slice(at + 1, at + 3), lines);
  assert.equal(t[at + 3], '2. 기본․영역․의제 사업');
  // 빈 칸: 제목 다음은 빈 문단 하나('없음' 글자 없음)
  const empty = buildReport(blank, {...DEMO_DATA, discuss:[]}).pkg, e = order(empty), ea = e.indexOf('3) 상집 논의 요청');
  assert.equal(e[ea + 1], '');
  assert.equal(e[ea + 2], '2. 기본․영역․의제 사업');
  assert.ok(!e.includes('없음'));
  // 개인본 대조(weekly-lines.mjs)는 3) 줄을 1절 글 줄로 읽는다(제목은 빠짐)
  const read = weeklyLines(t.join('\n'));
  assert.ok(read.some(l => l.section === 'requests' && l.text === lines[0]));
  assert.ok(!read.some(l => l.text === '3) 상집 논의 요청'));
});
