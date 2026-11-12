// FAMILY-기억알림(요청함 11/12 10:40, 시안 docs/design/mockups/family-note-remind.html, 명진 10:47 "나"·10:56 "보이기"): 가족 '잊지 말기' 노트의 줄을
// 돌아가며 보여 주는 규칙. 화면·서버 호출 없이 node --test로 확인한다(tests/family-remind-model.test.mjs).
// - AI를 쓰지 않는다. 가족 노트는 AI 재료에서 빠지는 노트라(ai_export_allowed=false) 줄(맨 위 문단)을 그대로 보인다.
// - 어느 줄을 언제 보여 줬는지는 그 노트 행의 기존 metadata jsonb 한 칸(metadata.remind = {day, picks, seen})에 둔다(서버 저장, 새 표·DB 변경 없음,
//   기기 저장 없음). 고정·폴더·포스트잇 자리와 같은 읽고-지키며-쓰기(basket-data.js setNoteRemind)라 updated_at(고친 날)은 그대로다.
// - 고르는 규칙: 오래 못 본 줄 먼저(한 번도 안 본 줄이 맨 먼저, 같으면 노트 순서), 하루에 한 번 3줄. 같은 날에는 같은 3줄(폰·PC 같게).
//   [↻ 다른 줄]은 지금 3줄을 빼고 같은 규칙으로 다음 3줄.
// - 폰 알림(supabase/functions/phone-push 주 1회)도 같은 칸·같은 규칙(이 파일과 같은 셈을 서버 쪽 family-remind.ts가 한다).
import {cleanDoc} from './ed-schema.mjs';

export const REMIND_KEY = 'remind';
export const PAST_KEY = 'family_past';
export const PAST_TITLE = '과거 기록';
export const SHOW = 3;
const SEEN_MAX = 300;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[0-9a-z]{1,13}$/;
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const textOf = node => (node?.content || []).map(c => (typeof c?.text === 'string' ? c.text : '')).join('');

// 줄 글자의 짧은 열쇠(같은 글이면 같은 열쇠 — 줄 순서가 바뀌어도 본 기록이 따라간다). 글 내용은 저장하지 않는다.
export function lineKey(text) {
  let h1 = 0x811c9dc5, h2 = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 13);
}
// 노트 저장 모양(ed1)의 맨 위 문단 중 글이 있는 것만 줄로. {key, text, index(맨 위 자리)}. 같은 글이 두 번이면 처음 것만.
export function remindLines(doc) {
  const base = cleanDoc(doc);
  if (!base) return [];
  const out = [], keys = new Set();
  base.doc.content.forEach((node, index) => {
    if (node?.type !== 'paragraph') return;
    const text = textOf(node).trim();
    if (!text) return;
    const key = lineKey(text);
    if (keys.has(key)) return;
    keys.add(key);
    out.push({key, text, index});
  });
  return out;
}
// 저장된 remind 칸을 믿을 수 있는 모양으로. 모양이 다르면 그 부분만 버린다.
export function readRemind(metadata) {
  const r = plain(metadata) && plain(metadata[REMIND_KEY]) ? metadata[REMIND_KEY] : {};
  const day = typeof r.day === 'string' && DAY.test(r.day) ? r.day : '';
  const picks = Array.isArray(r.picks) ? r.picks.filter(k => typeof k === 'string' && KEY.test(k)).slice(0, SHOW) : [];
  const seen = {};
  if (plain(r.seen)) for (const [k, v] of Object.entries(r.seen)) if (KEY.test(k) && typeof v === 'string' && DAY.test(v)) seen[k] = v;
  return {day, picks, seen};
}
// 오래 못 본 순서(안 본 줄 먼저, 같으면 노트 순서).
function order(lines, seen) {
  return lines.map((line, i) => ({line, i, at: seen[line.key] || ''})).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.i - b.i)).map(x => x.line);
}
function record(lines, remind, picks, today) {
  const seen = {};
  const keep = new Set(lines.map(l => l.key));
  for (const [k, v] of Object.entries(remind.seen)) if (keep.has(k)) seen[k] = v;
  for (const l of picks) seen[l.key] = today;
  const entries = Object.entries(seen).sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0)).slice(0, SEEN_MAX);
  return {day: today, picks: picks.map(l => l.key), seen: Object.fromEntries(entries)};
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// 오늘의 줄. 반환 {picks: 줄들(노트 순서), total, next: 저장할 remind(바뀐 것이 없으면 null)}.
// 오늘 이미 고른 줄이 아직 노트에 있으면 그대로, 빠진 자리만 다음 줄로 채운다.
export function pickToday(lines, remind, today, n = SHOW) {
  const r = remind || {day: '', picks: [], seen: {}};
  if (!lines.length) return {picks: [], total: 0, next: null};
  const byKey = new Map(lines.map(l => [l.key, l]));
  let chosen = r.day === today ? r.picks.map(k => byKey.get(k)).filter(Boolean) : [];
  if (chosen.length < Math.min(n, lines.length)) {
    const have = new Set(chosen.map(l => l.key));
    chosen = chosen.concat(order(lines.filter(l => !have.has(l.key)), r.seen).slice(0, n - chosen.length));
  }
  const picks = chosen.sort((a, b) => a.index - b.index);
  const next = record(lines, r, picks, today);
  return {picks, total: lines.length, next: same(next, {day: r.day, picks: r.picks, seen: r.seen}) ? null : next};
}
// [↻ 다른 줄]: 지금 줄을 빼고 오래 못 본 줄 먼저 다음 n줄(줄이 n개 이하면 그대로).
export function pickOther(lines, remind, today, n = SHOW) {
  const r = remind || {day: '', picks: [], seen: {}};
  if (lines.length <= n) return pickToday(lines, r, today, n);
  const now = new Set(r.day === today ? r.picks : []);
  const rest = order(lines.filter(l => !now.has(l.key)), r.seen);
  const chosen = rest.slice(0, n);
  if (chosen.length < n) chosen.push(...order(lines.filter(l => now.has(l.key)), r.seen).slice(0, n - chosen.length));
  const picks = chosen.sort((a, b) => a.index - b.index);
  return {picks, total: lines.length, next: record(lines, r, picks, today)};
}
// 과거 기록 노트에 넣는 줄: 옮긴 날짜를 앞에('11/12 · 줄'). today = 'YYYY-MM-DD'(서울).
export const pastLine = (text, today) => `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))} · ${text}`;
const para = (node, text) => ({type: 'paragraph', attrs: node?.attrs || {}, content: text ? [{type: 'text', text}] : []});
// 맨 위 문단 가운데 글(앞뒤 공백 무시)이 같은 처음 것 하나를 뺀다. 반환 {doc, index} 또는 null(없음 — 아무것도 안 씀).
export function takeLine(doc, text) {
  const base = cleanDoc(doc);
  if (!base) return null;
  const content = [...base.doc.content];
  const want = String(text || '').trim();
  const index = content.findIndex(node => node?.type === 'paragraph' && textOf(node).trim() === want);
  if (index < 0) return null;
  const node = content.splice(index, 1)[0];
  if (!content.length) content.push(para(null, ''));
  return {doc: cleanDoc({type: 'doc', content}), index, node};
}
// 되돌리기: 뺀 문단을 원래 자리(지금 길이보다 뒤면 끝)에 다시 넣는다. 이미 같은 글이 있으면 null(두 번 넣지 않음).
export function putLine(doc, index, node) {
  const base = cleanDoc(doc) || cleanDoc({type: 'doc', content: []});
  const content = [...base.doc.content];
  const want = textOf(node).trim();
  if (content.some(n => n?.type === 'paragraph' && textOf(n).trim() === want)) return null;
  const blank = content.length === 1 && content[0]?.type === 'paragraph' && !textOf(content[0]);
  if (blank) content.length = 0;
  content.splice(Math.max(0, Math.min(Number.isInteger(index) ? index : content.length, content.length)), 0, node);
  return cleanDoc({type: 'doc', content});
}
// 폰 알림 글(명진 결정 11/12 10:56 "보이기"): 제목 '가족 · 이번 주 기억할 것 n', 본문은 줄 앞부분을 ' · '로 이은 한 줄(줄마다 24자, 전체 120자).
export function pushText(picks) {
  const cut = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);
  const strip = s => String(s).replace(/^[☐☑]\s*/, '');
  return {title: `가족 · 이번 주 기억할 것 ${picks.length}`, body: cut(picks.map(p => cut(strip(p.text), 24)).join(' · '), 120)};
}
