// SEARCH-비슷한것찾기 ①(S70-67, 사용자 11/26 08:22~08:24 "아주 똑같은 글자를 입력 안 해도 비슷한 게 있으면 보여준다" · "추천대로"):
// 모든 찾기(홈 '전체 검색'의 브라우저 쪽 묶음, 각 화면 '<메뉴>에서 찾기')가 함께 쓰는 글자 비슷 찾기 규칙 한 곳. 순수 함수(DOM·네트워크 없음), AI 없음.
//  - 띄어쓰기 무시('국토 부' → 국토부), 대소문자 무시
//  - 초성('ㄱㅌㅂ' → 국토부, '국ㅌㅂ'처럼 섞어도 됨)
//  - 치는 중인 마지막 글자(자모 경계: '국톱'·'국토ㅂ' → 국토부)
//  - 앞부분 일치('민자' → 민자철도, 글 맨 앞·낱말 맨 앞이면 점수 더)
//  - 오타 허용(4~6글자 낱말은 1글자, 7글자 이상은 2글자까지 다르거나 더해져도 맞음. 짧은 낱말은 너무 많이 맞아 보지 않음)
// 결과: {score, ranges}. score가 클수록 잘 맞음(정확히 같음 > 띄어쓰기만 다름 > 치는 중 > 초성 > 오타). ranges = 원래 글자에서 맞은 구간 [시작, 끝)들.
// 화면은 compileFind(검색어)를 한 번 만들고 줄마다 test·best를 부른다. 맞은 정도 순 정렬은 rankFound, 굵게 칠할 조각은 markParts.

const SYL0 = 0xac00, SYL1 = 0xd7a3;
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅗㅏ', 'ㅗㅐ', 'ㅗㅣ', 'ㅛ', 'ㅜ', 'ㅜㅓ', 'ㅜㅔ', 'ㅜㅣ', 'ㅠ', 'ㅡ', 'ㅡㅣ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄱㅅ', 'ㄴ', 'ㄴㅈ', 'ㄴㅎ', 'ㄷ', 'ㄹ', 'ㄹㄱ', 'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅁ', 'ㅂ', 'ㅂㅅ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
// 낱자 하나를 친 그대로(겹낱자는 풀어서). 'ㅘ' → 'ㅗㅏ', 'ㄳ' → 'ㄱㅅ'.
const COMPAT = {'ㄳ': 'ㄱㅅ', 'ㄵ': 'ㄴㅈ', 'ㄶ': 'ㄴㅎ', 'ㄺ': 'ㄹㄱ', 'ㄻ': 'ㄹㅁ', 'ㄼ': 'ㄹㅂ', 'ㄽ': 'ㄹㅅ', 'ㄾ': 'ㄹㅌ', 'ㄿ': 'ㄹㅍ', 'ㅀ': 'ㄹㅎ', 'ㅄ': 'ㅂㅅ',
  'ㅘ': 'ㅗㅏ', 'ㅙ': 'ㅗㅐ', 'ㅚ': 'ㅗㅣ', 'ㅝ': 'ㅜㅓ', 'ㅞ': 'ㅜㅔ', 'ㅟ': 'ㅜㅣ', 'ㅢ': 'ㅡㅣ'};

export const isSyllable = ch => { const c = ch?.codePointAt?.(0) ?? -1; return c >= SYL0 && c <= SYL1; };
export const isInitial = ch => typeof ch === 'string' && ch.length === 1 && CHO.includes(ch);
const isJamo = ch => typeof ch === 'string' && ch.length === 1 && ch >= 'ㄱ' && ch <= 'ㅣ';
export function initialOf(ch) {
  if (!isSyllable(ch)) return null;
  return CHO[Math.floor((ch.codePointAt(0) - SYL0) / 588)];
}
// 글자 하나 → 자모 글줄('국' → 'ㄱㅜㄱ', '과' → 'ㄱㅗㅏ'). 한글이 아니면 그대로.
export function jamoOf(ch) {
  if (isSyllable(ch)) {
    const i = ch.codePointAt(0) - SYL0;
    return CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
  }
  return COMPAT[ch] || ch;
}
// 글 전체 초성('국토부 협의' → 'ㄱㅌㅂ ㅎㅇ'). 한글이 아닌 글자는 그대로.
export const initialsOf = text => [...String(text ?? '')].map(ch => initialOf(ch) || ch).join('');

const SPACE = /\s/;
const SEP = /[\s.,·…:;!?'"“”‘’()[\]{}<>/\\|\-_~+=*&^%$#@`]/;
const lower = s => String(s ?? '').normalize('NFC').toLowerCase();

// 글을 '맞춰 볼 칸'으로: 띄어쓰기를 빼고 소문자로, 칸마다 원래 글자 위치. word = 그 칸이 낱말 맨 앞인가.
function unitsOf(text) {
  const raw = String(text ?? '');
  const nfc = raw.normalize('NFC');
  const keepIndex = nfc.length === raw.length; // 원래 글이 조합형(NFD)이면 구간을 되돌릴 수 없어 굵게는 빼고 찾기만.
  const out = [];
  let prevSep = true, i = 0;
  for (const ch of nfc) {
    if (SPACE.test(ch)) { prevSep = true; i += ch.length; continue; }
    out.push({ch: ch.toLowerCase(), at: keepIndex ? i : -1, len: ch.length, word: prevSep});
    prevSep = SEP.test(ch);
    i += ch.length;
  }
  return out;
}
// 검색어 낱자 q가 글 칸 t와 같은가(초성 낱자는 그 초성으로 시작하는 글자와 같다). via: 'same' | 'initial' | null
function same(q, t) {
  if (q === t) return 'same';
  if (isInitial(q) && initialOf(t) === q) return 'initial';
  return null;
}

// 검색 낱말 하나(띄어쓰기 없음)를 미리 풀어 둔다.
function prepWord(word) {
  const chars = [...lower(word)].filter(ch => !SPACE.test(ch));
  const n = chars.length;
  const last = chars[n - 1];
  // 치는 중인 마지막 글자: 받침이 있는 한글(다음 글자 초성일 수도)이나 홀로 친 모음·자음. 앞 글자들은 그대로 맞고 끝 글자만 자모로 본다.
  const lastJamo = n && (isSyllable(last) || isJamo(last)) ? jamoOf(last) : '';
  const typos = n >= 7 ? 2 : n >= 4 ? 1 : 0;
  return {chars, n, lastJamo, typos, allInitials: n > 0 && chars.every(isInitial)};
}

// 정확히 이어서 맞는 곳(초성 낱자 허용). 가장 좋은 곳(글 맨 앞 > 낱말 맨 앞 > 앞쪽)을 돌려준다.
function exactAt(units, w) {
  let best = null;
  for (let s = 0; s + w.n <= units.length; s++) {
    let initials = 0, ok = true;
    for (let k = 0; k < w.n; k++) {
      const via = same(w.chars[k], units[s + k].ch);
      if (!via) { ok = false; break; }
      if (via === 'initial') initials++;
    }
    if (!ok) continue;
    const rank = (s === 0 ? 2 : units[s].word ? 1 : 0) * 1000 - s;
    if (!best || rank > best.rank) best = {start: s, end: s + w.n, initials, rank};
    if (s === 0) break;
  }
  return best;
}
// 치는 중인 마지막 글자(자모 경계): 앞 n-1글자는 정확히, 마지막 글자의 자모는 다음 글 칸(들)의 자모 앞부분이면 맞음.
// '국톱'(ㄱㅜㄱ·ㅌㅗㅂ) → '국토부'(…ㅌㅗ·ㅂㅜ): 'ㅌㅗㅂ'이 'ㅌㅗ'+'ㅂㅜ'의 앞부분. '국토ㅂ'은 초성 규칙으로 이미 맞는다.
function partialAt(units, w) {
  if (!w.lastJamo || w.n < 1) return null;
  const head = {chars: w.chars.slice(0, -1), n: w.n - 1};
  for (let s = 0; s + head.n < units.length; s++) {
    let ok = true;
    for (let k = 0; k < head.n; k++) if (!same(head.chars[k], units[s + k].ch)) { ok = false; break; }
    if (!ok) continue;
    const at = s + head.n, a = jamoOf(units[at].ch), J = w.lastJamo;
    if (!isSyllable(units[at].ch)) continue;
    if (a.startsWith(J)) return {start: s, end: at + 1, initials: 0};
    // 받침이 다음 글자 초성으로 넘어간 경우(마지막 글자 한 칸만 넘어감).
    if (J.startsWith(a) && at + 1 < units.length) {
      const rest = J.slice(a.length);
      if (rest && isSyllable(units[at + 1].ch) && jamoOf(units[at + 1].ch).startsWith(rest)) return {start: s, end: at + 2, initials: 0};
    }
  }
  return null;
}
// 오타 허용(어디서든 이어지는 한 토막과 낱말의 편집 거리 ≤ k). 거리와 그 토막을 돌려준다.
function typoAt(units, w) {
  const k = w.typos, n = w.n, m = units.length;
  if (!k || !m) return null;
  // D[j] = 낱말 앞 i글자와 '글 j칸에서 끝나는 토막'의 최소 거리, S[j] = 그 토막 시작.
  let D = new Array(m + 1).fill(0), S = Array.from({length: m + 1}, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const nd = new Array(m + 1), ns = new Array(m + 1);
    nd[0] = i; ns[0] = 0;
    for (let j = 1; j <= m; j++) {
      const sub = D[j - 1] + (same(w.chars[i - 1], units[j - 1].ch) ? 0 : 1);
      const del = D[j] + 1, ins = nd[j - 1] + 1;
      if (sub <= del && sub <= ins) { nd[j] = sub; ns[j] = S[j - 1]; }
      else if (del <= ins) { nd[j] = del; ns[j] = S[j]; }
      else { nd[j] = ins; ns[j] = ns[j - 1]; }
    }
    D = nd; S = ns;
  }
  let best = null;
  for (let j = 1; j <= m; j++) {
    if (D[j] > k) continue;
    const start = S[j];
    const len = j - start;
    if (len < (n >= 7 ? n - 1 : n)) continue; // 낱말보다 짧은 토막(글자를 지워서 맞춘 것)은 버림 — 앞부분만 같은 다른 낱말이 너무 많이 맞는다
    const off = Math.abs(len - n);
    if (!best || D[j] < best.dist || D[j] === best.dist && off < best.off) best = {start, end: j, dist: D[j], off, initials: 0};
  }
  return best;
}

// 낱말 하나가 글에 맞는 정도. 없으면 null.
function scoreWord(units, w) {
  if (!w.n) return null;
  const bonus = s => (s === 0 ? 30 : units[s]?.word ? 15 : 0);
  const exact = exactAt(units, w);
  if (exact) {
    const base = exact.initials === w.n ? 60 : exact.initials ? 75 : 100;
    return {score: base + bonus(exact.start), start: exact.start, end: exact.end};
  }
  const part = partialAt(units, w);
  if (part) return {score: 85 + bonus(part.start), start: part.start, end: part.end};
  if (w.allInitials) return null; // 초성만 친 낱말은 오타를 보지 않는다(너무 많이 맞음)
  const typo = typoAt(units, w);
  if (typo) return {score: 50 - 15 * typo.dist + Math.floor(bonus(typo.start) / 3), start: typo.start, end: typo.end};
  return null;
}
const toRanges = (units, spans) => {
  const out = [];
  // 한 토막(이어진 칸들)은 사이 빈칸까지 한 구간으로('국토 부'를 통째로 굵게).
  for (const [a, b] of spans) {
    const first = units[a], last = units[b - 1];
    if (!first || !last || first.at < 0 || last.at < 0) return [];
    out.push([first.at, last.at + last.len]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of out) { const l = merged.at(-1); if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
  return merged;
};

export const FIND_MAX = 200;
// 검색어 → 맞춰 보기. also = 비슷한 말(뜻 비슷 찾기 ②가 돌려준 낱말): 검색어로 못 맞추면 그중 하나라도 맞으면 맞음(점수는 낮게).
// 돌려주는 것: {empty, text, test(글) → {score, ranges}|null, best(...글) → {score, ranges, field}|null}
export function compileFind(query, {also = []} = {}) {
  const text = String(query ?? '').slice(0, FIND_MAX).trim();
  const words = text.split(/\s+/).filter(Boolean);
  const whole = prepWord(words.join(''));
  const parts = words.length > 1 ? words.map(prepWord) : null;
  const extra = [...new Set((Array.isArray(also) ? also : []).map(v => String(v ?? '').trim()).filter(v => v && lower(v) !== lower(text)))]
    .slice(0, 12).map(v => prepWord(v.replace(/\s+/g, '')));
  const empty = !whole.n;
  function test(value) {
    if (empty) return null;
    const units = unitsOf(value);
    if (!units.length) return null;
    // 1) 검색어 전체를 띄어쓰기 없이 한 낱말로
    const one = scoreWord(units, whole);
    if (one && one.score >= 50) return {score: one.score, ranges: toRanges(units, [[one.start, one.end]])};
    // 2) 낱말마다(모두 맞아야 함)
    if (parts) {
      const got = [];
      for (const w of parts) { const r = scoreWord(units, w); if (!r) { got.length = 0; break; } got.push(r); }
      if (got.length) {
        const score = Math.round(got.reduce((s, r) => s + r.score, 0) / got.length) - 5;
        return {score, ranges: toRanges(units, got.map(r => [r.start, r.end]))};
      }
    }
    if (one) return {score: one.score, ranges: toRanges(units, [[one.start, one.end]])};
    // 3) 비슷한 말(정확·앞부분·초성만, 오타 없음)
    let hit = null;
    for (const w of extra) {
      const r = exactAt(units, w);
      if (r && (!hit || r.rank > hit.rank)) hit = r;
    }
    if (hit) return {score: 30 + (hit.start === 0 ? 5 : 0), ranges: toRanges(units, [[hit.start, hit.end]]), also: true};
    return null;
  }
  function best(...values) {
    let out = null;
    values.forEach((v, field) => {
      if (v == null || v === '') return;
      const r = test(typeof v === 'string' ? v : String(v));
      if (r && (!out || r.score > out.score)) out = {...r, field};
    });
    return out;
  }
  return {empty, text, words, also: extra.length ? extra.map(w => w.chars.join('')) : [], test, best};
}

// 맞은 것만 맞은 정도 순으로(같으면 원래 순서). texts(item) = 맞춰 볼 글들(앞의 칸이 먼저 굵게 칠할 칸).
export function rankFound(items, find, texts) {
  if (!find || find.empty) return [...(items || [])];
  const scored = [];
  (items || []).forEach((item, i) => {
    const hit = find.best(...[].concat(texts(item)));
    if (hit) scored.push({item, i, score: hit.score});
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map(x => x.item);
}

// 굵게 칠할 구간: 검색어 전체로 맞으면 그 구간, 아니면 낱말마다·비슷한 말마다 맞은 구간을 모두(여러 칸에 나뉘어 맞은 줄도 칸마다 칠한다).
const pieces = new WeakMap();
export function markRanges(text, find) {
  if (!find || find.empty) return [];
  const s = String(text ?? '');
  const whole = find.test(s);
  if (whole && !whole.also) return whole.ranges || [];
  const all = [];
  if (!pieces.has(find)) pieces.set(find, [...(find.words || []), ...(find.also || [])].map(w => compileFind(w)));
  for (const one of pieces.get(find)) {
    const r = one.test(s);
    if (r && r.score >= 50) all.push(...(r.ranges || []));
  }
  all.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of all) { const l = merged.at(-1); if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
  return merged;
}

// 굵게 칠할 조각: text를 [{text, mark}]로. 화면은 조각마다 textContent로 그린다(global-search-model highlightParts와 같은 모양).
export function markParts(text, find) {
  const s = String(text ?? '');
  if (!s) return [];
  const ranges = markRanges(s, find);
  if (!ranges.length) return [{text: s, mark: false}];
  const parts = [];
  let pos = 0;
  for (const [a, b] of ranges) {
    if (a > pos) parts.push({text: s.slice(pos, a), mark: false});
    parts.push({text: s.slice(a, b), mark: true});
    pos = b;
  }
  if (pos < s.length) parts.push({text: s.slice(pos), mark: false});
  return parts;
}

// 뜻 비슷 찾기 ②를 부를 만한가: 글자 비슷 찾기 결과가 적거나(3개 미만) 입력이 문장(낱말 3개 이상이거나 '관련·지난·회의' 같은 말이 섞임)일 때.
export const FEW_FOUND = 3;
export function looksSentence(query) {
  const t = String(query ?? '').trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  return words.length >= 3 || /(관련|관한|대한|했던|하던|지난|이번|다음|작년|올해|어제|오늘|내일|주$|달$|월$)/.test(t) && words.length >= 2;
}
export function wantsMeaning(query, found) {
  const t = String(query ?? '').trim();
  if ([...t.replace(/\s+/g, '')].length < 2 || [...t].length > 100) return false;
  if (t.replace(/\s+/g, '').split('').every(isInitial)) return false; // 초성만은 AI가 풀 수 없다
  return looksSentence(t) || (Number.isFinite(found) && found < FEW_FOUND);
}
// 기간 안인가(뜻 비슷 찾기가 돌려준 {from, to}: 'YYYY-MM-DD' 또는 ''). 날짜가 없는 항목은 기간으로 거르지 않는다.
export function inPeriod(day, period) {
  if (!period || (!period.from && !period.to)) return true;
  const d = String(day ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return true;
  if (period.from && d < period.from) return false;
  if (period.to && d > period.to) return false;
  return true;
}
