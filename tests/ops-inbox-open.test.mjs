// OPS-요청함대기계산: 요청함 대기 목록을 기억이 아니라 계산으로 뽑는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openItems, summary, classify, splitBlocks, taskName, squareName, statusLines, statusMark} from '../scripts/ops/inbox-open.mjs';

const SAMPLE = `﻿# Web2 요청함
안내 문단은 덩어리가 아니다.
[11/01 10:00] 끝난 요청
- 할 것: 가
→ 접수: A-끝 — 완료 #10 (11/01)
[11/01 11:00] 넘기기만 한 요청
→ 접수: B-대기 — 대기(CC 전달) (11/01)
[11/01 12:00] 접수 표시가 없는 요청
- 할 것: 나
[11/01 13:00] 완료로 적혔지만 대조에서 빠짐
→ 접수: C-일부 — 완료 #11 (11/01)
→ 대조: 남음 — 다 항목
[11/01 14:00] 코드는 끝, 폰 확인만  → 접수: D-폰 — 완료 #12(실기기 확인 대기) (11/01)
[11/01 15:00] 손대지 말 것
★CC 착수 금지 — 명진 직접 세션★
[11/01 16:00] 제목 줄 끝에 이어 붙은 접수  → 접수: V46 인계서 남은 일(10/31)  → 세션 S46-8 (10/31)
[11/01 17:00] 결정 기다림
→ 접수: E-결정 — 대기 · 명진 결정 대기 (11/01)
[11/01 18:00] 일부 완료 표시
→ 접수: F-일부 — 일부 완료 #13 · 남음: 라 (11/02)
`;

const ROADMAP = '| B-대기 | 설명 | 대기 |\n| F-일부 | 설명 | 진행중 |\n';

test('덩어리 나누기: 안내 문단은 빼고 [날짜] 줄만 덩어리로 센다', () => {
  assert.equal(splitBlocks(SAMPLE).length, 9);
});

test('끝난 것·착수 금지는 빼고, 나머지는 모두 남은 일로 센다', () => {
  const items = openItems(SAMPLE, {now: new Date('2026-11-02T12:00:00+09:00')});
  const titles = items.map(i => i.title);
  assert.ok(!titles.some(t => t.includes('끝난 요청')));
  assert.ok(!titles.some(t => t.includes('손대지 말 것')));
  assert.equal(items.length, 7);
  const by = Object.fromEntries(items.map(i => [i.title.slice(14, 22), i.state]));
  assert.equal(items.find(i => i.title.includes('넘기기만')).state, 'waiting');
  assert.equal(items.find(i => i.title.includes('접수 표시가 없는')).state, 'unreceived');
  assert.equal(items.find(i => i.title.includes('대조에서 빠짐')).state, 'partial');
  assert.equal(items.find(i => i.title.includes('폰 확인만')).state, 'device-check');
  assert.equal(items.find(i => i.title.includes('이어 붙은')).state, 'in-progress');
  assert.equal(items.find(i => i.title.includes('결정 기다림')).state, 'decision');
  assert.equal(items.find(i => i.title.includes('일부 완료 표시')).state, 'partial');
  assert.ok(by);
});

test('원장 행 유무와 접수 뒤 지난 시간을 붙인다', () => {
  const items = openItems(SAMPLE, {roadmap: ROADMAP, now: new Date('2026-11-02T11:00:00+09:00')});
  const b = items.find(i => i.task === 'B-대기');
  assert.equal(b.ledger, true);
  assert.equal(b.ageHours, 24);
  assert.equal(items.find(i => i.task === 'E-결정').ledger, false);
  const s = summary(items);
  assert.equal(s.total, 7);
  assert.ok(s.noLedger >= 3);
});

test('과제 이름 뽑기', () => {
  assert.equal(taskName('→ 접수: PHOTO-갤러리편집 — 완료 #1687'), 'PHOTO-갤러리편집');
  assert.equal(taskName(''), '');
  assert.equal(classify({lines: ['[1/1] x']}).state, 'unreceived');
});

// OPS-요청함■세기: 11/06부터 요청함 방이 쓰는 '■ 과제이름 (…)' 덩어리도 요청 하나로 센다.
const SQUARE_SAMPLE = `[11/06 09:00] 옛 형식 요청
→ 접수: G-옛 — 대기(CC 전달) (11/06)


■ UI-보기줄자리 (앞 결정 11/07 보기 탭 자리 규칙 이어서)
원문(11/10 11:23): "가"
할 일: ① 나
→ 덧붙임 알림(11/10 11:54): 시안 ㅇ
완료 기준: 다
접수 11/10 11:24 요청함 V24 — 명진 목록 전달


■ MENU-조직보고이름 (메뉴 '담당조직' → '조직 보고')
할 일: 라
접수 11/09 08:00 요청함 V23 — 명진 ㅇ → 대조: 완료 #20


■ LIB-화면끌어놓기 이어서 (앞 작업 10/26)
할 일: 마
접수 11/08 10:00 요청함 V21 — 명진 ㅇ → 대조: 남음 (바 빠짐)


---- CC 작업 상황 ----
■ UI-보기줄자리 → 진행 중: #30 열림.
■ [11/08 09:34] 옛 형식 요청 → 완료: #31 merge.
→ 접수: 여기는 어느 요청에도 붙지 않음 — 완료 #99


■ ORG-막힘 ★급★ (조직 보고 막힘)
★CC 착수 금지 — 명진 직접 세션★
접수 11/10 09:00 요청함 V24
`;

test('■ 덩어리 나누기: CC 상황 한 줄 요약은 요청이 아니다', () => {
  const blocks = splitBlocks(SQUARE_SAMPLE);
  assert.deepEqual(blocks.map(b => b.square || 'date'), ['date', 'UI-보기줄자리', 'MENU-조직보고이름', 'LIB-화면끌어놓기', 'ORG-막힘']);
  assert.equal(squareName('■ FORGET-원문열기·뒤로가기 (잊지 말기)'), 'FORGET-원문열기·뒤로가기');
  // 상황 요약 뒤 줄은 앞 덩어리에 붙지 않는다.
  assert.ok(!blocks[3].lines.some(l => l.includes('#99')));
});

test('■ 덩어리: 과제 이름·접수 시각·상태(표시 없으면 대기)·원장 행', () => {
  const items = openItems(SQUARE_SAMPLE, {roadmap: '| UI-보기줄자리 | 설명 | 대기 |\n', now: new Date('2026-11-10T13:24:00+09:00')});
  const by = Object.fromEntries(items.map(i => [i.task, i]));
  assert.deepEqual(Object.keys(by).sort(), ['G-옛', 'LIB-화면끌어놓기', 'UI-보기줄자리'].sort());
  // 덩어리 안 표시는 없지만 뒤의 CC 상황 줄 '→ 진행 중: #30 열림'이 상태가 된다(S56-3b).
  assert.equal(by['UI-보기줄자리'].state, 'in-progress');
  assert.equal(by['UI-보기줄자리'].ageHours, 2);
  assert.equal(by['UI-보기줄자리'].ledger, true);
  assert.equal(by['LIB-화면끌어놓기'].state, 'partial');
  assert.equal(by['LIB-화면끌어놓기'].ledger, false);
  // 옛 [날짜] 덩어리 결과는 그대로.
  assert.equal(by['G-옛'].state, 'waiting');
  assert.equal(by['G-옛'].ageHours, 100);
});

test('■ 덩어리가 섞여도 옛 [날짜] 표본 계산은 그대로', () => {
  const mixed = SAMPLE + '\n\n■ Z-새 (뒤)\n할 일: 가\n접수 11/02 10:00 요청함\n';
  const before = openItems(SAMPLE, {now: new Date('2026-11-02T12:00:00+09:00')});
  const after = openItems(mixed, {now: new Date('2026-11-02T12:00:00+09:00')}).filter(i => i.task !== 'Z-새');
  assert.deepEqual(after, before);
});

// OPS-요청함■세기 이어서(S56-3b): CC 작업 상황 줄 '■ 과제 → 완료: #PR …'을 같은 이름 요청의 상태로 쓴다.
const STATUS_SAMPLE = `■ FEED-즉시수집 ★급★ (최신화 누르면 바로 모으기)
할 일: 가
접수 11/08 13:00 요청함 V21 — 명진 ㅇ


■ MTG-접기 (비정기 회의 접기)
할 일: 나
접수 11/08 18:14 요청함 V21 — 명진 ㅇ


■ WEEKLY-환류 (환류 다듬기)
할 일: 다
접수 11/08 15:26 요청함 V21 — 명진 자료 → 대조: 남음 (칸별 비교 안 됨)


■ UI-용어 (용어 맞추기)
할 일: 라
접수 11/08 14:10 요청함 V21 — 명진 ㅇ → 대조: 완료 #2104·#2175


■ LIB-대조옛것 (대조가 옛것)
할 일: 마
접수 11/08 14:00 요청함 V21 — 명진 ㅇ → 대조: 남음 (#2200 아직 merge 안 됨)


■ NEWS-남음 (상황 줄 남음)
할 일: 바
접수 11/08 14:00 요청함 V21 — 명진 ㅇ


■ CAL-접수뒤 (접수 표시 뒤 상황 줄)
할 일: 사
접수 11/08 14:00 요청함 V21
→ 접수: CAL-접수뒤 — 대기(CC 전달) (11/08)


---- CC 작업 상황 ----
■ FEED-즉시수집 마무리 ★급★ → 완료: #2102 merge · 함수 배포.
■ MTG-접기 → 진행 중: S53-20 DB PR #2124 열림.
■ WEEKLY-환류 → 완료: #2119 merge.
■ UI-용어 → 진행 중: ① #2104 merge. ② #2120 열림.
■ LIB-대조옛것 → 완료: #2200 merge.
■ NEWS-남음 → 완료: #2098 merge · 남음: 텔레그램 밑줄.
■ CAL-접수뒤 → 완료: #2300 merge.
■ 뒤에새요청 → 완료: #2400 merge.


■ 뒤에새요청 (상황 줄보다 뒤에 온 새 요청)
할 일: 아
접수 11/09 09:00 요청함 V22
`;

test('상황 줄 뽑기: 과제 이름은 ■ 뒤 첫 낱말, 상태 낱말 뒤 콜론을 뺀다', () => {
  const ss = statusLines(STATUS_SAMPLE);
  assert.equal(ss.length, 8);
  assert.equal(ss[0].name, 'FEED-즉시수집');
  assert.equal(statusMark(ss[0].line), '→ 완료 #2102 merge · 함수 배포.');
  assert.equal(statusMark(ss[1].line), '→ 진행 중 S53-20 DB PR #2124 열림.');
});

test('상황 줄 완료 #PR → 끝남으로 빠지고, 진행 중 → 진행 중, 남음 → 일부·남음', () => {
  const items = openItems(STATUS_SAMPLE, {now: new Date('2026-11-10T12:00:00+09:00')});
  const by = Object.fromEntries(items.map(i => [i.task, i.state]));
  assert.ok(!('FEED-즉시수집' in by), '완료 #2102 상황 줄이면 끝남');
  assert.ok(!('CAL-접수뒤' in by), '접수 표시보다 뒤 상황 줄이 우선');
  assert.equal(by['MTG-접기'], 'in-progress');
  assert.equal(by['NEWS-남음'], 'partial');
});

test('덩어리 안 대조 표시가 더 최신이면 대조가 우선', () => {
  const items = openItems(STATUS_SAMPLE, {now: new Date('2026-11-10T12:00:00+09:00')});
  const by = Object.fromEntries(items.map(i => [i.task, i.state]));
  // 대조: 남음(PR 번호 없음)은 상황 줄 '완료 #2119'보다 뒤에 다시 확인한 결과다.
  assert.equal(by['WEEKLY-환류'], 'partial');
  // 대조: 완료 #2175가 상황 줄 '진행 중 … #2120'보다 최신 → 끝남.
  assert.ok(!('UI-용어' in by));
  // 대조가 말한 #2200을 상황 줄이 '완료: #2200'으로 적었으면 상황 줄이 더 최신 → 끝남.
  assert.ok(!('LIB-대조옛것' in by));
});

test('상황 줄보다 뒤에 온 같은 이름 요청은 그 상황 줄을 쓰지 않는다', () => {
  const items = openItems(STATUS_SAMPLE, {now: new Date('2026-11-10T12:00:00+09:00')});
  assert.equal(items.find(i => i.task === '뒤에새요청').state, 'waiting');
});
