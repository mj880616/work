// OPS-결정안빠짐방지(2026-11-10 명진 "고른 게 왜 반영 안 되고 다른 게 반영됐나 — 재발방지·전수조사"):
// 요청함에서 '남음'(→ 대조: 남음, 일부 완료 · 남음)인데 열린 원장 행도 열린 PR도 없는 요청을
// '빠진 남은 일'로 따로 센다. 11/09 RECORD-한줄 사고(①만 merge, ②③은 PR 본문 '남은 일'에만 있고
// 원장 행이 없어 대기 줄에서 빠짐)를 표본으로 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openItems, summary, parseOpenPrs, ledgerRows, isOpenRow, hasOpenLedgerRow, hasOpenPr} from '../scripts/ops/inbox-open.mjs';

const INBOX = `■ RECORD-한줄 (조직 기록 한 줄 — 명진 A안)
할 일: ① 임시 한 줄 ② one_line 칸 ③ AI 한 줄
접수 11/09 10:00 요청함 V22 — 명진 A안 → 대조: 완료 #10


---- CC 작업 상황 ----
■ RECORD-한줄 → 완료: #10 merge · 남음: ② one_line 칸 ③ AI 한 줄.


■ PHOTO-같은사진 (같은 사진 판정)
할 일: 가
접수 11/09 11:00 요청함 V22 → 대조: 남음 (서버 재확인이 크기만 봄)


■ NEWS-다받기 (언론사 다 받기)
할 일: 나
접수 11/09 12:00 요청함 V22 → 대조: 남음 (새 언론사 실제 넣기)


■ LIB-나무접기 (나무 다시 눌러 접기)
할 일: 다
접수 11/09 13:00 요청함 V22 → 대조: 남음 (다시 눌러 접기 안 됨 — #50 열림)


■ MTG-회의명 (회의명 묶기)
할 일: 라
접수 11/09 14:00 요청함 V22 → 대조: 남음 (DB 확인 — 원장 MTG-회의명조직묶기)


■ UI-대기 (그냥 대기)
할 일: 마
접수 11/09 15:00 요청함 V22


[11/09 16:00] 옛 형식 일부 완료
→ 접수: WEEKLY-상세 — 완료 #11 (11/09)
→ 대조: 남음 — 한글 파일 결과
`;

const ROADMAP = `| 작업 | 설명 | 상태 | PR | 비고 |
| --- | --- | --- | --- | --- |
| RECORD-한줄 | 임시 한 줄 | 완료 | #10 | |
| ★NEWS-다받기 | 언론사 | 일부 완료(① 완료) | #9 | |
| MTG-회의명조직묶기 | 회의명 묶기 남은 일 | 대기 | | |
| UI-대기 | 대기 | 대기 | | |
| WEEKLY-상세 | 상세 | 완료 | #11 | |
`;

const PRS = JSON.stringify([{number: 50, title: '[S1] 자료실 나무 고침'}, {number: 60, title: '[S2] PHOTO-다른일 손보기'}]);
const NOW = new Date('2026-11-10T12:00:00+09:00');

test('원장 행 읽기와 열린 행 판정: 완료·종료는 닫힘, 일부·남음이 적히면 열림', () => {
  const rows = ledgerRows(ROADMAP);
  assert.ok(rows.some(r => r.name === 'NEWS-다받기'), '이름 앞 ★는 뗀다');
  assert.ok(!rows.some(r => r.name === '---'));
  assert.equal(isOpenRow('완료'), false);
  assert.equal(isOpenRow('종료'), false);
  assert.equal(isOpenRow('완료(확인 대기)'), false);
  assert.equal(isOpenRow('일부 완료(남은 일은 비고)'), true);
  assert.equal(isOpenRow('대기'), true);
  assert.equal(isOpenRow('진행중'), true);
});

test('열린 PR 목록: JSON과 #번호 줄 둘 다 읽는다', () => {
  assert.deepEqual(parseOpenPrs(PRS).map(p => p.number), [50, 60]);
  assert.deepEqual(parseOpenPrs('#70 가\n71 나\n\n'), [{number: 70, title: '가'}, {number: 71, title: '나'}]);
  assert.deepEqual(parseOpenPrs(''), []);
  assert.equal(hasOpenPr(['X-1'], '→ 대조: 남음 (#50 열림)', parseOpenPrs(PRS)), true);
  assert.equal(hasOpenPr(['PHOTO-다른일'], '', parseOpenPrs(PRS)), true);
  assert.equal(hasOpenPr(['PHOTO-같은사진'], '', parseOpenPrs(PRS)), false);
  assert.equal(hasOpenLedgerRow(['MTG-회의명'], ROADMAP), true, '이름으로 시작하는 열린 행');
  assert.equal(hasOpenLedgerRow(['RECORD-한줄'], ROADMAP), false, '완료 행만 있으면 열린 행 없음');
});

test('빠진 남은 일: 남음인데 열린 원장 행·열린 PR 없음만 센다', () => {
  const items = openItems(INBOX, {roadmap: ROADMAP, now: NOW, openPrs: parseOpenPrs(PRS)});
  const by = Object.fromEntries(items.map(i => [i.task, i]));
  // RECORD-한줄 사고: 원장 행은 '완료'뿐이고 ②③을 맡은 PR이 없음 → 빠짐.
  assert.equal(by['RECORD-한줄'].state, 'partial');
  assert.equal(by['RECORD-한줄'].gap, true);
  assert.equal(by['PHOTO-같은사진'].gap, true, '원장 행도 PR도 없음');
  assert.equal(by['WEEKLY-상세'].gap, true, '옛 [날짜] 덩어리도 접수 줄의 과제 이름으로 본다');
  assert.equal(by['NEWS-다받기'].gap, false, '일부 완료 행이 열려 있음');
  assert.equal(by['LIB-나무접기'].gap, false, '대조 줄이 적은 #50이 열려 있음');
  assert.equal(by['MTG-회의명'].gap, false, '대조 줄이 적은 원장 행이 열려 있음');
  assert.equal(by['UI-대기'].gap, false, '남음이 아닌 대기는 빠진 남은 일이 아니다');
  assert.equal(summary(items).missing, 3);
});

test('원장·열린 PR 중 하나라도 안 주면 판정하지 않는다(옛 쓰는 법 그대로)', () => {
  const noPr = openItems(INBOX, {roadmap: ROADMAP, now: NOW});
  assert.ok(noPr.every(i => i.gap === null));
  assert.equal(summary(noPr).missing, 0);
  const noLedger = openItems(INBOX, {now: NOW, openPrs: []});
  assert.ok(noLedger.every(i => i.gap === null));
});

test('열린 PR이 하나도 없으면(빈 목록) 원장만으로 판정한다', () => {
  const items = openItems(INBOX, {roadmap: ROADMAP, now: NOW, openPrs: []});
  const by = Object.fromEntries(items.map(i => [i.task, i]));
  assert.equal(by['LIB-나무접기'].gap, true, '#50이 닫혔으면 빠짐');
  assert.equal(by['NEWS-다받기'].gap, false);
});
