// OPS-요청함대기계산: 요청함 대기 목록을 기억이 아니라 계산으로 뽑는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openItems, summary, classify, splitBlocks, taskName} from '../scripts/ops/inbox-open.mjs';

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
