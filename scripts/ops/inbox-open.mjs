#!/usr/bin/env node
// 요청함 대기 목록 계산 (OPS-요청함대기계산, 2026-11-02 명진 결정: 기억이 아니라 계산으로 남은 일을 센다).
//
// 쓰는 법: Drive 문서 'Web2 요청함'을 텍스트로 받아 파일로 저장한 뒤
//   node scripts/ops/inbox-open.mjs <요청함.txt> [--roadmap docs/roadmap.md] [--open-prs 열린PR.json] [--now 2026-11-02T11:30+09:00] [--json]
// --open-prs: 열린 PR 목록 파일(`gh pr list --state open --json number,title` 결과 JSON, 또는 '#번호 제목' 줄 텍스트).
//   주면 '빠진 남은 일'(대조·일부 완료로 남음인데 열린 원장 행도 열린 PR도 없는 요청)을 따로 센다(OPS-결정안빠짐방지).
// 요청 덩어리: '[날짜]'로 시작하는 줄, 또는 '■ 과제이름 (…)'으로 시작하는 줄(11/06부터 요청함 방 형식).
// 결과: 아직 끝나지 않은 요청 표(markdown) — 상태 분류, 원장 행 유무, 접수 뒤 지난 시간.
// 저장소는 공개다. 요청함 원문은 이 스크립트에 넣지 않고 실행할 때만 읽는다. 결과 표도 PR·문서에 붙이지 않는다
// (제목에 업무 내용이 섞일 수 있음). 결과는 CC 방 보고와 인계서(비공개 프로젝트 문서)에만 쓴다.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const HEAD = /^\[(?:(\d{4})-)?(\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?\]/;
// 11/06부터 요청함 방은 '■ 과제이름 (…)'으로 시작하는 덩어리로도 요청을 쓴다(OPS-요청함■세기).
// 접수 시각은 덩어리 안 '접수 MM/DD HH:MM' 줄에서 읽는다.
const SQUARE = /^\s*■\s*([^\s(（]+)/;
// CC 작업 상황 절의 한 줄 요약('■ 과제 → 완료: #PR …')은 요청이 아니다. 덩어리를 끝내기만 한다.
const SQUARE_STATUS = /^\s*■[^\n]*?\s→\s*(?:완료|진행\s*중|대기|남음|접수|대조)\s*:/;
const SQUARE_TIME = /접수\s+(?:(\d{4})-)?(\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})/;
const RECEIPT = /→\s*(접수|대조)\s*:/;
// 상황 줄 '■ 과제 → 완료: #PR …'의 '→ 상태:' 부분.
const STATUS_MARK = /→\s*(완료|진행\s*중|대기|남음|접수|대조)\s*:\s*/;
const BLOCKED = '★CC 착수 금지';

// '■ UI-보기줄자리 (앞 결정 …)' → 'UI-보기줄자리'
export function squareName(line) {
  const m = SQUARE.exec(line || '');
  return m ? m[1].replace(/[,:;·.]+$/, '') : '';
}

function parse(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const blocks = [];
  const statuses = [];
  let cur = null;
  lines.forEach((line, at) => {
    if (HEAD.test(line)) {
      cur = {title: line.trim(), lines: [line], at};
      blocks.push(cur);
    } else if (SQUARE_STATUS.test(line)) {
      cur = null;
      statuses.push({name: squareName(line), at, line: line.trim()});
    } else if (SQUARE.test(line)) {
      cur = {title: line.trim(), lines: [line], square: squareName(line), at};
      blocks.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  });
  return {blocks, statuses};
}

// 요청 덩어리로 나눈다: [MM/DD HH:MM] 또는 '■ 과제이름'으로 시작하는 줄부터 다음 그런 줄 전까지.
export function splitBlocks(text) {
  return parse(text).blocks;
}

// CC 작업 상황 줄('■ 과제 → 완료: #PR …')만 뽑는다. name = ■ 뒤 첫 낱말(★급★ 등 꼬리 무시), at = 줄 번호(0부터).
export function statusLines(text) {
  return parse(text).statuses;
}

// '■ 과제 → 완료: #2102 merge' → '→ 완료 #2102 merge' (접수 표시와 같은 규칙으로 분류하려고 상태 낱말 뒤 ':'를 뺀다).
export function statusMark(line) {
  const m = STATUS_MARK.exec(line || '');
  return m ? `→ ${m[1]} ${line.slice(m.index + m[0].length)}`.trim() : '';
}

const prMax = s => Math.max(0, ...[...String(s).matchAll(/#(\d+)/g)].map(m => Number(m[1])));

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
  // ■ 덩어리는 요청함 방이 과제 이름을 붙여 쓴 것이라 표시가 없으면 '대기'로 센다.
  if (!rs.length) return {state: block.square ? 'waiting' : 'unreceived', last: ''};
  return classifyMark(rs[rs.length - 1]);
}

// 표시 한 줄(접수·대조 또는 상황 줄을 바꾼 것)의 상태.
export function classifyMark(last) {
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

// 덩어리 안 '→ 접수: 과제 — …' 줄 중 마지막 과제 이름(마지막 표시가 '→ 대조:'일 때도 과제 이름을 잃지 않게).
function blockTaskName(block) {
  const rs = receipts(block).map(taskName).filter(Boolean);
  return rs.length ? rs[rs.length - 1] : '';
}

export function inRoadmap(name, roadmap) {
  if (!name || !roadmap) return false;
  return name.split(/\s*[+·,]\s*/).filter(Boolean).some(n => roadmap.includes(`| ${n} |`));
}

// 원장 작업 표 행: '| 이름 | 설명 | 상태 | …' → {name, status}. 이름 앞 ★는 뗀다.
export function ledgerRows(roadmap) {
  const rows = [];
  for (const line of String(roadmap || '').split(/\r?\n/)) {
    const m = /^\|\s*([^|]+?)\s*\|\s*[^|]*\|\s*([^|]*?)\s*\|/.exec(line);
    if (!m || /^-+$/.test(m[1])) continue;
    rows.push({name: m[1].replace(/^★+/, '').trim(), status: m[2]});
  }
  return rows;
}

// 열린 행 = 상태가 완료·종료로 시작하지 않거나, 완료라도 '일부·남음·남은 일'이 적힌 행.
export function isOpenRow(status) {
  const s = String(status || '');
  if (/일부|남음|남은\s*일/.test(s)) return true;
  return !/^\s*(완료|종료)/.test(s);
}

// 남은 일의 이름 후보: 과제 이름 + 표시 줄에 적힌 원장 행 이름 꼴(영문 대문자-…) 낱말.
function gapNames(name, last) {
  const out = new Set();
  for (const n of String(name || '').split(/\s*[+·,]\s*/)) if (n) out.add(n);
  for (const m of String(last || '').matchAll(/\b[A-Z][A-Z0-9]*-[^\s,·()|:—]+/g)) out.add(m[0].replace(/[.,;]+$/, ''));
  return [...out];
}

// 열린 원장 행이 있나: 이름이 같거나 그 이름으로 시작하는(예: 'RECORD-한줄' → 'RECORD-한줄AI요약') 열린 행.
export function hasOpenLedgerRow(names, roadmap) {
  const rows = ledgerRows(roadmap).filter(r => isOpenRow(r.status));
  return names.some(n => rows.some(r => r.name === n || r.name.startsWith(n)));
}

// 열린 PR 목록 파일 읽기: JSON 배열([{number,title}]) 또는 '#번호 제목' 줄.
export function parseOpenPrs(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    return JSON.parse(t).map(p => ({number: Number(p.number), title: String(p.title || '')}));
  }
  return t.split(/\r?\n/).map(l => /^\s*#?(\d+)\s+(.*)$/.exec(l)).filter(Boolean)
    .map(m => ({number: Number(m[1]), title: m[2]}));
}

// 열린 PR이 이 남은 일을 맡고 있나: 표시 줄이 그 PR 번호를 적었거나, PR 제목에 이름이 있으면.
export function hasOpenPr(names, last, openPrs) {
  if (!openPrs || !openPrs.length) return false;
  const nums = new Set([...String(last || '').matchAll(/#(\d+)/g)].map(m => Number(m[1])));
  return openPrs.some(p => nums.has(p.number) || names.some(n => p.title.includes(n)));
}

function blockTime(block, now) {
  if (block.square) {
    const line = block.lines.find(l => SQUARE_TIME.test(l));
    const t = line ? SQUARE_TIME.exec(line) : null;
    return t ? kstDate(t[1], t[2], t[3], t[4], t[5], now) : null;
  }
  const m = HEAD.exec(block.title);
  if (!m) return null;
  return kstDate(m[1], m[2], m[3], m[4], m[5], now);
}

function kstDate(y, mo, da, h, mi, now) {
  const year = Number(y || now.getFullYear());
  const d = new Date(`${year}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}T${(h || '0').padStart(2, '0')}:${mi || '00'}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const OPEN_STATES = ['unreceived', 'waiting', 'partial', 'decision', 'in-progress', 'device-check'];
const LABEL = {
  unreceived: '미접수', waiting: '대기', partial: '일부·남음', decision: '결정 대기',
  'in-progress': '진행 중', 'device-check': '실기기 확인', done: '완료', blocked: '착수 금지',
};

// 같은 과제 이름의 상황 줄이 덩어리보다 뒤에 있으면 그 마지막 상황 줄을 상태로 쓴다(OPS-요청함■세기 이어서).
// 단 덩어리 안 마지막 표시가 '→ 대조:'이면 대조가 더 최신인지 PR 번호로 본다: 대조에 PR 번호가 없거나
// 대조의 가장 큰 PR 번호가 상황 줄의 가장 큰 PR 번호보다 크면 대조가 우선(대조는 완료를 다시 확인한 결과다).
export function statusFor(block, statuses) {
  const own = classify(block);
  if (own.state === 'blocked' || !block.square) return own;
  const after = statuses.filter(s => s.name === block.square && s.at > block.at);
  if (!after.length) return own;
  const s = after[after.length - 1];
  if (/→\s*대조\s*:/.test(own.last)) {
    const mine = prMax(own.last);
    if (!mine || mine > prMax(s.line)) return own;
  }
  return classifyMark(statusMark(s.line));
}

export function openItems(text, {roadmap = '', now = new Date(), openPrs = null} = {}) {
  const items = [];
  const {blocks, statuses} = parse(text);
  for (const b of blocks) {
    const {state, last} = statusFor(b, statuses);
    if (!OPEN_STATES.includes(state)) continue;
    const name = b.square || taskName(last) || blockTaskName(b);
    const t = blockTime(b, now);
    // 빠진 남은 일: '일부·남음'(→ 대조: 남음, 일부 완료 · 남음)인데 열린 원장 행도 열린 PR도 없음.
    // 원장·열린 PR 정보를 둘 다 줬을 때만 판정한다(하나라도 없으면 null).
    let gap = null;
    if (roadmap && openPrs) {
      const names = gapNames(name, last);
      gap = state === 'partial' && !hasOpenLedgerRow(names, roadmap) && !hasOpenPr(names, last, openPrs);
    }
    items.push({
      title: b.title.replace(/→.*$/, '').trim().slice(0, 120),
      state, label: LABEL[state], task: name,
      ledger: roadmap ? inRoadmap(name, roadmap) : null,
      ageHours: t ? Math.round((now - t) / 36e5) : null,
      last: last.slice(0, 200),
      gap,
    });
  }
  return items;
}

export function summary(items) {
  const count = {};
  for (const it of items) count[it.label] = (count[it.label] || 0) + 1;
  const noLedger = items.filter(it => it.ledger === false && it.state !== 'device-check').length;
  const missing = items.filter(it => it.gap === true).length;
  return {total: items.length, count, noLedger, missing};
}

function toMarkdown(items) {
  const s = summary(items);
  const head = `요청함 남은 요청 ${s.total}건 (${Object.entries(s.count).map(([k, v]) => `${k} ${v}`).join(' · ')})`
    + (items.some(it => it.ledger !== null) ? ` — 원장 행 없음 ${s.noLedger}건` : '');
  const gapOn = items.some(it => it.gap !== null);
  const gapHead = gapOn ? `빠진 남은 일 ${s.missing}건 (대조·일부 완료로 남음인데 열린 원장 행·열린 PR 없음 — 바로 원장 '남은 일' 행으로)` : '';
  const rows = items.map(it => `| ${it.title.replace(/\|/g, '/')} | ${it.label} | ${it.task || '—'} | ${it.ledger === null ? '' : it.ledger ? '있음' : '**없음**'} | ${it.ageHours ?? ''} |${gapOn ? ` ${it.gap ? '**빠짐**' : ''} |` : ''}`);
  const cols = gapOn ? '| 요청 | 상태 | 과제 | 원장 행 | 지난 시간(h) | 빠진 남은 일 |' : '| 요청 | 상태 | 과제 | 원장 행 | 지난 시간(h) |';
  const sep = gapOn ? '| --- | --- | --- | --- | --- | --- |' : '| --- | --- | --- | --- | --- |';
  return [head, ...(gapOn ? [gapHead] : []), '', cols, sep, ...rows].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const valued = ['--roadmap', '--now', '--open-prs'];
  const file = args.find((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]));
  if (!file) {
    console.error('usage: node scripts/ops/inbox-open.mjs <요청함.txt> [--roadmap docs/roadmap.md] [--open-prs 열린PR.json] [--now ISO] [--json]');
    process.exit(2);
  }
  const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const roadmap = opt('--roadmap') ? readFileSync(opt('--roadmap'), 'utf8') : '';
  const now = opt('--now') ? new Date(opt('--now')) : new Date();
  const openPrs = opt('--open-prs') ? parseOpenPrs(readFileSync(opt('--open-prs'), 'utf8')) : null;
  const items = openItems(readFileSync(file, 'utf8'), {roadmap, now, openPrs});
  console.log(args.includes('--json') ? JSON.stringify({summary: summary(items), items}, null, 2) : toMarkdown(items));
}
