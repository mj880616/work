#!/usr/bin/env node
// 요청함 대기 목록 계산 (OPS-요청함대기계산, 2026-11-02 명진 결정: 기억이 아니라 계산으로 남은 일을 센다).
//
// 쓰는 법: Drive 문서 'Web2 요청함'을 텍스트로 받아 파일로 저장한 뒤
//   node scripts/ops/inbox-open.mjs <요청함.txt> [--roadmap docs/roadmap.md] [--now 2026-11-02T11:30+09:00] [--json]
// 결과: 아직 끝나지 않은 요청 표(markdown) — 상태 분류, 원장 행 유무, 접수 뒤 지난 시간.
// 저장소는 공개다. 요청함 원문은 이 스크립트에 넣지 않고 실행할 때만 읽는다. 결과 표도 PR·문서에 붙이지 않는다
// (제목에 업무 내용이 섞일 수 있음). 결과는 CC 방 보고와 인계서(비공개 프로젝트 문서)에만 쓴다.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const HEAD = /^\[(?:(\d{4})-)?(\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?\]/;
const RECEIPT = /→\s*(접수|대조)\s*:/;
const BLOCKED = '★CC 착수 금지';

// 요청 덩어리로 나눈다: [MM/DD HH:MM]로 시작하는 줄부터 다음 그런 줄 전까지.
export function splitBlocks(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    if (HEAD.test(line)) {
      cur = {title: line.trim(), lines: [line]};
      blocks.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return blocks;
}

// 한 줄에 접수가 여러 번 이어 붙은 경우(제목 줄 끝 등)도 마지막 표시를 쓴다.
function receipts(block) {
  const out = [];
  for (const line of block.lines) {
    const parts = line.split(/(?=→\s*(?:접수|대조)\s*:)/);
    for (const p of parts) if (RECEIPT.test(p)) out.push(p.trim());
  }
  return out;
}

// 상태 분류. done = 끝, 나머지는 모두 '남은 일'로 센다.
export function classify(block) {
  const body = block.lines.join('\n');
  if (body.includes(BLOCKED)) return {state: 'blocked', last: ''};
  const rs = receipts(block);
  if (!rs.length) return {state: 'unreceived', last: ''};
  const last = rs[rs.length - 1];
  if (/대조\s*:\s*남음/.test(last)) return {state: 'partial', last};
  if (/남음|일부 완료/.test(last)) return {state: 'partial', last};
  if (/실기기 확인 대기|폰 확인 대기|명진 실기기/.test(last) && /완료/.test(last)) return {state: 'device-check', last};
  if (/완료\s*#\d+/.test(last) && !/대기|진행/.test(last.replace(/확인 대기/g, ''))) return {state: 'done', last};
  if (/결정 대기|답 대기|명진 결정/.test(last)) return {state: 'decision', last};
  if (/진행\s*중|진행중|세션\s*S\d|PR\s*#?\d+\s*열림|열림/.test(last)) return {state: 'in-progress', last};
  return {state: 'waiting', last};
}

// '→ 접수: 과제이름 — 상태' 에서 과제이름(원장 행 이름 후보)을 뽑는다.
export function taskName(last) {
  const m = /→\s*접수\s*:\s*([^—\n]+?)\s*—/.exec(last || '');
  return m ? m[1].trim() : '';
}

export function inRoadmap(name, roadmap) {
  if (!name || !roadmap) return false;
  return name.split(/\s*[+·,]\s*/).filter(Boolean).some(n => roadmap.includes(`| ${n} |`));
}

function blockTime(title, now) {
  const m = HEAD.exec(title);
  if (!m) return null;
  const year = Number(m[1] || now.getFullYear());
  const d = new Date(`${year}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const OPEN_STATES = ['unreceived', 'waiting', 'partial', 'decision', 'in-progress', 'device-check'];
const LABEL = {
  unreceived: '미접수', waiting: '대기', partial: '일부·남음', decision: '결정 대기',
  'in-progress': '진행 중', 'device-check': '실기기 확인', done: '완료', blocked: '착수 금지',
};

export function openItems(text, {roadmap = '', now = new Date()} = {}) {
  const items = [];
  for (const b of splitBlocks(text)) {
    const {state, last} = classify(b);
    if (!OPEN_STATES.includes(state)) continue;
    const name = taskName(last);
    const t = blockTime(b.title, now);
    items.push({
      title: b.title.replace(/→.*$/, '').trim().slice(0, 120),
      state, label: LABEL[state], task: name,
      ledger: roadmap ? inRoadmap(name, roadmap) : null,
      ageHours: t ? Math.round((now - t) / 36e5) : null,
      last: last.slice(0, 200),
    });
  }
  return items;
}

export function summary(items) {
  const count = {};
  for (const it of items) count[it.label] = (count[it.label] || 0) + 1;
  const noLedger = items.filter(it => it.ledger === false && it.state !== 'device-check').length;
  return {total: items.length, count, noLedger};
}

function toMarkdown(items) {
  const s = summary(items);
  const head = `요청함 남은 요청 ${s.total}건 (${Object.entries(s.count).map(([k, v]) => `${k} ${v}`).join(' · ')})`
    + (items.some(it => it.ledger !== null) ? ` — 원장 행 없음 ${s.noLedger}건` : '');
  const rows = items.map(it => `| ${it.title.replace(/\|/g, '/')} | ${it.label} | ${it.task || '—'} | ${it.ledger === null ? '' : it.ledger ? '있음' : '**없음**'} | ${it.ageHours ?? ''} |`);
  return [head, '', '| 요청 | 상태 | 과제 | 원장 행 | 지난 시간(h) |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--roadmap' && args[args.indexOf(a) - 1] !== '--now');
  if (!file) {
    console.error('usage: node scripts/ops/inbox-open.mjs <요청함.txt> [--roadmap docs/roadmap.md] [--now ISO] [--json]');
    process.exit(2);
  }
  const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const roadmap = opt('--roadmap') ? readFileSync(opt('--roadmap'), 'utf8') : '';
  const now = opt('--now') ? new Date(opt('--now')) : new Date();
  const items = openItems(readFileSync(file, 'utf8'), {roadmap, now});
  console.log(args.includes('--json') ? JSON.stringify({summary: summary(items), items}, null, 2) : toMarkdown(items));
}
