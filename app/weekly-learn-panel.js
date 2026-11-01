// WEEKLY-환류학습 3·4번 화면(docs/design/weekly-draft-feedback.md 12·13절): [주간 정리] 맨 아래 '주간보고 규칙·환류' 접기 하나와
// 한글 파일 상자 [확정] 뒤 '이번 주 환류 보고' 한 장이 같이 쓰는 그리기·쓰기.
// - 읽기: 그 주까지의 요청 표 행에서 draft->feedback·draft->rules 두 칸만(owner RLS, 서버). 칸이 아직 없으면 아무것도 그리지 않는다.
// - 규칙은 확정·후보·폐기(WEEKLY-규칙합의, weekly-feedback.mjs readRules). AI 초안은 확정만 본다. 후보는 환류 보고 '새 규칙 후보'에만
//   뜨고 [ㅇ](확정) [×](폐기) [고쳐서 확정]. 폐기 줄은 접어 두고 [다시 후보로]. 확정 줄 [지우기]는 폐기로 옮긴다.
// - 쓰기: 규칙 고치기·지우기·더하기·후보 답은 그 규칙이 든 행에, 개선 제안 [승인]/[아니]는 그 주 행에(weekly-draft-store.js changeWeekDocs —
//   다시 읽고 그 칸만 바꿔 draft_saved_at 조건으로 씀). 브라우저 저장소에 아무것도 두지 않는다. 글은 로그에 쓰지 않는다.
// - journal.js 는 다시 그릴 때마다 paintWeeklyLearn(자리, 주)만 부른다. 읽은 값은 주마다 이 모듈이 들고 있다(다시 그려도 다시 읽지 않음).
//   상자가 [확정] 뒤 환류 보고를 받으면 'kptu:weekly-learn-changed'를 보내고, 이 모듈이 다시 읽어 그린다.
import {changeWeekDocs, missingDraft} from './weekly-draft-store.js';
import {withPick} from './weekly-picks.mjs'; // S46-22 답 학습(후보 [ㅇ]·[×]·개선 제안 답도 picks 에)
import {emptyEl} from './wait-state.js';
import {rowMore, partAdd} from './row-more.js'; // WEEKLY-화면디자인정리: 규칙 줄 끝 ⋯ · 제목 줄 오른쪽 [+ 추가]
import {readFeedback, readRules, withRuleText, withoutRule, withRule, takeCandidate, dropCandidate, restoreRetired, withAnswer, feedbackTrend, keptRate, RULES_MAX, RULE_CHARS, SUGGESTION_AREA} from './weekly-feedback.mjs';

const TABLE = '/rest/v1/app_weekly_exec_requests';
const encode = encodeURIComponent;
const emptyDraft = () => ({v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[]});
const slash = day => { const [, m, d] = String(day ?? '').split('-'); return m ? `${Number(m)}/${Number(d)}` : ''; };
const nowIso = () => new Date().toISOString();
const states = new Map(); // 주 → {status, rows, ui}
let last = null;          // {slot, start, rt} — 마지막으로 그린 자리

// 그 주까지 행 12개(최신부터): [{week_start, feedback, rules}] (모양 검사한 값).
export async function readLearnRows(start, rt = window.KPTURuntime) {
  const ws = rt.context.read()?.workspace?.id;
  if (!ws) throw new Error('context');
  let rows;
  try { rows = await rt.api(`${TABLE}?workspace_id=eq.${encode(ws)}&week_start=lte.${start}&select=week_start,feedback:draft->feedback,rules:draft->rules,picks:draft->picks&order=week_start.desc&limit=12`, {singleFlight:false}); }
  catch (error) { if (missingDraft(error)) return null; throw error; }
  if (!Array.isArray(rows)) throw new Error('read');
  return rows.map(r => ({week_start:String(r.week_start ?? ''), feedback:readFeedback(r.feedback), rules:readRules(r.rules), picks:r.picks ?? null}));
}
const rulesRow = rows => rows.find(r => r.rules) ?? null;

// ---- 새 규칙 후보(상자 환류 보고·[주간 정리] 같이 씀) ----
// week: 규칙 칸이 든 행의 주, rules: readRules 값. ui: {busy, fixing(고치는 후보 글), value(고치던 글)}. 후보가 없으면 null.
const candidatePick = text => ({kind:'review', from:'ai', cell:'규칙 후보', org:'', text});
export function candidateList(doc, week, rules, {busy = false, fixing = null, value = null, title = '② 새 규칙 후보'} = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const list = readRules(rules)?.candidates ?? [];
  if (!list.length) return null;
  const part = doc.createDocumentFragment();
  const head = el('p', 'journal-weekly-sub', title); head.dataset.learnCandidatesHead = ''; part.append(head);
  const ul = el('ul', 'journal-kinds-off-list'); ul.dataset.learnCandidates = week;
  for (const c of list) {
    const li = el('li'); li.dataset.learnCandidate = c.text;
    const mk = (label, key, aria) => { const b = el('button', 'mini', label); b.type = 'button'; b.dataset[key] = week; b.dataset.learnRule = c.text; b.disabled = busy; b.setAttribute('aria-label', `${aria}: ${c.text}`); return b; };
    if (fixing === c.text) {
      const input = el('input', 'journal-learn-input'); input.type = 'text'; input.value = value ?? c.text; input.maxLength = RULE_CHARS; input.dataset.learnRuleFixInput = c.text; input.setAttribute('aria-label', '후보 고쳐서 확정');
      const cancel = el('button', 'mini', '취소'); cancel.type = 'button'; cancel.dataset.learnRuleCancel = '';
      li.append(input, ' ', mk('확정', 'learnRuleFixGo', '고친 글로 확정'), ' ', cancel);
    } else li.append(el('span', null, c.text), ' ', mk('ㅇ', 'learnRuleTake', '규칙으로 확정'), ' ', mk('×', 'learnRuleDrop', '후보 빼기'), ' ', mk('고쳐서 확정', 'learnRuleFix', '고쳐서 확정'));
    ul.append(li);
  }
  part.append(ul);
  return part;
}
// 후보·폐기 단추 하나 → {week, change, done}(쓸 것) · {ui:'fix', key} · {ui:'cancel'} · null. root: 고치는 글 칸을 찾을 자리.
export function ruleChange(button, root, at = nowIso()) {
  const d = button.dataset, key = d.learnRule ?? '';
  if (d.learnRuleCancel != null) return {ui:'cancel'};
  if (d.learnRuleFix != null) return {ui:'fix', key};
  const pick = (draft, act) => withPick(draft?.picks, candidatePick(key), act, at);
  if (d.learnRuleTake != null) return {week:d.learnRuleTake, done:'규칙으로 확정했어요. 다음 초안부터 반영돼요.', change:x => ({...(x ?? emptyDraft()), rules:takeCandidate(x?.rules, key, at), picks:pick(x, 'take')})};
  if (d.learnRuleDrop != null) return {week:d.learnRuleDrop, done:'후보를 뺐어요.', change:x => ({...(x ?? emptyDraft()), rules:dropCandidate(x?.rules, key, at), picks:pick(x, 'drop')})};
  if (d.learnRuleFixGo != null) {
    const input = [...(root?.querySelectorAll('[data-learn-rule-fix-input]') ?? [])].find(n => n.dataset.learnRuleFixInput === key);
    const text = String(input?.value ?? '').trim();
    if (!text) return null;
    return {week:d.learnRuleFixGo, done:'고쳐서 확정했어요. 다음 초안부터 반영돼요.', change:x => ({...(x ?? emptyDraft()), rules:takeCandidate(x?.rules, key, at, text), picks:pick(x, 'take')})};
  }
  if (d.learnRuleRestore != null) return {week:d.learnRuleRestore, done:'다시 후보로 올렸어요.', change:x => ({...(x ?? emptyDraft()), rules:restoreRetired(x?.rules, key, at)})};
  return null;
}

// ---- 환류 보고 한 장(상자·[주간 정리] 같이 씀) ----
// feedback: 그 주 고침 기록(review 가 있으면 개선 제안까지), previous: 지난 주 고침 기록들. answerable: [승인]/[아니] 단추를 그릴지.
// rules: {week, rules} — 규칙 칸이 든 행의 주와 그 칸. 있으면 '새 규칙 후보'를 그 칸 후보로 [ㅇ][×][고쳐서 확정]과 함께 그린다.
//   없으면(칸을 아직 못 읽음) 이번 보고의 후보 글만 단추 없이 보인다. fixing·value: 고치는 후보.
export function reviewCard(doc, feedback, previous = [], {answerable = true, busy = false, rules = null, fixing = null, value = null} = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const f = readFeedback(feedback);
  if (!f) return null;
  const t = feedbackTrend(f, previous), c = f.counts;
  const box = el('section', 'journal-weekly-part journal-learn-review'); box.dataset.learnReview = f.week;
  const rate = keptRate(c);
  const head = `이번 주 환류 보고 — AI 초안 줄 ${c.proposed}개 중 ${c.kept}개 그대로${rate == null ? '' : `(${rate}%)`}${t?.avg == null ? '' : ` · 지난 ${t.prev.filter(p => p.rate != null).length}주 평균 ${t.avg}% (${t.better >= 0 ? '+' : ''}${t.better})`}`;
  const h = el('p', 'journal-learn-head', head); h.dataset.learnReviewHead = ''; box.append(h);
  const nums = el('p', 'journal-muted', `① 남김 ${c.kept} · 고침 ${c.changed} · 뺌 ${c.dropped} · 더함 ${c.added}`); nums.dataset.learnReviewCounts = ''; box.append(nums);
  const r = f.review;
  const cands = rules ? candidateList(doc, rules.week, rules.rules, {busy:busy || !answerable, fixing, value}) : null;
  if (!r) { const p = el('p', 'journal-muted', '규칙 후보·개선 제안은 아직이에요(정리 중이거나 준비 중).'); p.dataset.learnReviewPending = ''; box.append(p); if (cands) box.append(cands); return box; }
  if (cands) box.append(cands);
  else if (!rules && r.candidates.length) {
    box.append(el('p', 'journal-weekly-sub', '② 새 규칙 후보'));
    const ul = el('ul', 'journal-kinds-off-list'); ul.dataset.learnCandidates = '';
    for (const t of r.candidates) ul.append(el('li', null, t));
    box.append(ul);
  }
  if (r.suggestions.length) {
    box.append(el('p', 'journal-weekly-sub', '③ 시스템 설계를 이렇게 바꾸면 더 가까워집니다'));
    const ul = el('ul', 'journal-kinds-off-list'); ul.dataset.learnSuggestions = '';
    for (const s of r.suggestions) {
      const li = el('li'); li.dataset.learnSuggestion = s.id;
      if (s.area) { const tag = el('small', 'journal-learn-area', SUGGESTION_AREA[s.area]); tag.dataset.learnArea = s.area; li.append(tag, ' '); }
      li.append(el('span', null, s.text), ' ');
      if (s.answer) li.append(el('small', 'journal-muted', s.answer === 'yes' ? '승인함 — 다음 개발 후보' : '아니'));
      if (answerable) for (const [answer, label] of [['yes', '승인'], ['no', '아니']]) {
        if (s.answer === answer) continue;
        const b = el('button', 'mini', label); b.type = 'button'; b.dataset.learnAnswer = `${f.week}:${s.id}:${answer}`; b.disabled = busy;
        b.setAttribute('aria-label', `${label}: ${s.text}`); li.append(' ', b);
      }
      ul.append(li);
    }
    box.append(ul);
  }
  return box;
}
// 개선 제안 하나에 답(그 주 행 feedback.review). 반환 changeWeekDocs 결과.
// S46-22: 답도 학습 기록(picks)에 — 승인 = 받은 제안, 아니 = 거절한 제안(종류 '환류 규칙 후보' 아닌 '개선 제안' 칸).
export function answerChange(d, id, answer, at = nowIso()) {
  const text = readFeedback(d?.feedback)?.review?.suggestions?.find(x => x.id === id)?.text ?? '';
  const out = {...(d ?? emptyDraft()), feedback:withAnswer(d?.feedback, id, answer)};
  if (text) out.picks = withPick(d?.picks, {kind:'review', from:'ai', cell:'개선 제안', org:'', text}, answer === 'yes' ? 'take' : 'drop', at);
  return out;
}
export const answerSuggestion = (week, id, answer, rt = window.KPTURuntime) =>
  changeWeekDocs({start:week, change:d => answerChange(d, id, answer)}, rt);

// ---- [주간 정리] 맨 아래 '주간보고 규칙·환류' ----
export function paintWeeklyLearn(slot, start, {rt = window.KPTURuntime} = {}) {
  if (!slot) return;
  last = {slot, start, rt};
  let s = states.get(start);
  if (!s) { s = {status:'loading', rows:[], ui:{open:false, editing:-1, adding:false, fixing:null, busy:false, msg:'', error:false}}; states.set(start, s); void load(start, rt); }
  draw(slot, start, s, rt);
}
async function load(start, rt) {
  const s = states.get(start);
  try { const rows = await readLearnRows(start, rt); s.status = rows ? 'ok' : 'missing'; s.rows = rows ?? []; }
  catch { s.status = 'failed'; }
  if (last?.start === start && last.slot.isConnected) draw(last.slot, start, s, rt);
}
if (typeof window !== 'undefined') window.addEventListener('kptu:weekly-learn-changed', () => {
  for (const [start, s] of states) if (s.status !== 'loading') { s.status = 'loading'; void load(start, last?.rt ?? window.KPTURuntime); }
});

function draw(slot, start, s, rt) {
  const doc = slot.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const open = slot.querySelector('details')?.open ?? s.ui.open;
  // 다시 그려도 쓰던 글은 그대로(업무일지가 자료를 받아 다시 그릴 때).
  const typing = slot.querySelector('[data-journal-learn-rule-input], [data-journal-learn-add-input], [data-learn-rule-fix-input]');
  if (typing) s.ui.value = typing.value;
  s.ui.open = open;
  if (s.status === 'missing' || s.status === 'loading') { slot.replaceChildren(); return; }
  const box = el('details', 'journal-weekly-chapter journal-weekly-memory journal-weekly-fold'); box.dataset.journalWeeklyLearn = start; box.open = open;
  box.addEventListener('toggle', () => { s.ui.open = box.open; });
  if (s.status === 'failed') { box.append(el('summary', null, '주간보고 규칙·환류'), el('p', 'journal-muted', '읽지 못했어요. 업무일지를 다시 열면 다시 읽어요.')); slot.replaceChildren(box); return; }
  const rr = rulesRow(s.rows), rules = rr?.rules?.lines ?? [], cands = rr?.rules?.candidates ?? [], retired = rr?.rules?.retired ?? [];
  const mine = s.rows.find(r => r.week_start === start)?.feedback ?? null;
  const prev = s.rows.filter(r => r.week_start < start).map(r => r.feedback).filter(Boolean);
  const dev = s.rows.flatMap(r => (r.feedback?.review?.suggestions ?? []).filter(x => x.answer === 'yes').map(x => ({week:r.week_start, text:x.text, area:x.area})));
  const sum = el('summary');
  sum.append(el('span', 'journal-heading', '주간보고 규칙·환류'), ' ', el('small', 'journal-others-count', `확정 규칙 ${rules.length}줄${cands.length ? ` · 후보 ${cands.length}` : ''} · ${mine ? `이번 주 ${keptRate(mine.counts) ?? 0}% 그대로` : '이번 주 환류 없음'}${dev.length ? ` · 개발 후보 ${dev.length}` : ''}`));
  box.append(sum);
  // 규칙 목록
  const part = el('section', 'journal-weekly-part journal-part-has-add'); part.dataset.journalLearnRules = rr?.week_start ?? '';
  part.append(el('h5', 'journal-weekly-sub', `주간보고 규칙(확정)${rr ? ` (${slash(rr.week_start)} 주 정리)` : ''}`));
  if (!s.ui.adding && rules.length < RULES_MAX) { const add = el('button', 'journal-part-add-button', '+ 추가'); add.type = 'button'; add.dataset.journalLearnAdd = ''; add.disabled = s.ui.busy; add.setAttribute('aria-label', '규칙 더하기'); part.append(partAdd(doc, [add])); }
  if (!rules.length) part.append(emptyEl());
  const ul = el('ul', 'journal-kinds-off-list');
  rules.forEach((rule, i) => {
    const li = el('li'); li.dataset.journalLearnRule = String(i);
    if (s.ui.editing === i) {
      const input = el('input', 'journal-learn-input'); input.type = 'text'; input.value = s.ui.value ?? rule.text; input.maxLength = RULE_CHARS; input.dataset.journalLearnRuleInput = String(i); input.setAttribute('aria-label', '규칙 고치기');
      const save = el('button', 'mini', '저장'); save.type = 'button'; save.dataset.journalLearnSave = String(i);
      const cancel = el('button', 'mini', '취소'); cancel.type = 'button'; cancel.dataset.journalLearnCancel = '';
      li.append(input, ' ', save, ' ', cancel);
    } else {
      li.append(el('span', null, rule.text));
      if (rule.from !== 'auto') li.append(' ', el('small', 'journal-muted', rule.from === 'edited' ? '고침' : '더함'));
      li.append(rowMore(doc, {label:`규칙 메뉴: ${rule.text}`, data:{journalLearnMore:String(i)}, items:[
        {text:'고치기', data:{journalLearnEdit:String(i)}, disabled:s.ui.busy, aria:`규칙 고치기: ${rule.text}`},
        {text:'지우기', data:{journalLearnDelete:String(i)}, disabled:s.ui.busy, aria:`규칙 지우기: ${rule.text}`, danger:true}]}));
    }
    ul.append(li);
  });
  part.append(ul);
  if (s.ui.adding) {
    const row = el('div', 'journal-learn-add');
    const input = el('input', 'journal-learn-input'); input.type = 'text'; input.value = s.ui.value ?? ''; input.maxLength = RULE_CHARS; input.dataset.journalLearnAddInput = ''; input.setAttribute('aria-label', '새 규칙'); input.placeholder = '예: 끝난 일은 결과부터 쓴다';
    const go = el('button', 'mini', '더하기'); go.type = 'button'; go.dataset.journalLearnAddGo = '';
    const cancel = el('button', 'mini', '취소'); cancel.type = 'button'; cancel.dataset.journalLearnCancel = '';
    row.append(input, ' ', go, ' ', cancel); part.append(row);
  }
  // 뺀 규칙(폐기): AI 초안에도 후보에도 쓰지 않는다. 접어 두고 [다시 후보로].
  if (retired.length) {
    const fold = el('details', 'journal-weekly-gone'); fold.dataset.journalLearnRetired = '';
    fold.append(el('summary', null, `뺀 규칙 ${retired.length}개`));
    const list = el('ul', 'journal-kinds-off-list');
    for (const g of retired) { const li = el('li', null, `${g.text} `); const b = el('button', 'mini', '다시 후보로'); b.type = 'button'; b.dataset.learnRuleRestore = rr.week_start; b.dataset.learnRule = g.text; b.disabled = s.ui.busy; b.setAttribute('aria-label', `다시 후보로: ${g.text}`); li.append(b); list.append(li); }
    fold.append(list); part.append(fold);
  }
  box.append(part);
  // 이번 주 환류 보고(새 규칙 후보 포함) · 개발 후보. 이번 주 보고가 없으면 후보만 따로.
  const ruleOpt = rr ? {week:rr.week_start, rules:rr.rules} : null, fix = {fixing:s.ui.fixing, value:s.ui.value};
  const card = mine ? reviewCard(doc, mine, prev, {busy:s.ui.busy, rules:ruleOpt, ...fix}) : null;
  if (card) box.append(card);
  else if (ruleOpt) {
    const list = candidateList(doc, ruleOpt.week, ruleOpt.rules, {busy:s.ui.busy, ...fix, title:'새 규칙 후보'});
    if (list) { const sec = el('section', 'journal-weekly-part'); sec.dataset.journalLearnCandidates = ''; sec.append(list); box.append(sec); }
  }
  if (dev.length) {
    const d = el('section', 'journal-weekly-part'); d.dataset.journalLearnDev = '';
    d.append(el('h5', 'journal-weekly-sub', '개발 후보(승인한 개선 제안)'));
    const list = el('ul', 'journal-kinds-off-list');
    for (const x of dev) { const li = el('li'); li.append(el('span', 'journal-weekly-day', slash(x.week)), ' '); if (x.area) li.append(el('small', 'journal-learn-area', SUGGESTION_AREA[x.area]), ' '); li.append(el('span', null, x.text)); list.append(li); }
    d.append(list); box.append(d);
  }
  const say = el('p', 'journal-line-status', s.ui.msg); say.dataset.journalLearnStatus = ''; say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  if (s.ui.error) say.classList.add('journal-failed');
  box.append(say);
  box.addEventListener('click', event => { const b = event.target.closest('button'); if (b && !b.disabled) void act(b, start, s, rt); });
  slot.replaceChildren(box);
  const focus = slot.querySelector('[data-journal-learn-rule-input], [data-journal-learn-add-input], [data-learn-rule-fix-input]');
  if (focus && (s.ui.focus || typing === doc.activeElement)) { focus.focus(); s.ui.focus = false; }
}

async function act(b, start, s, rt) {
  const redraw = () => { if (last?.start === start && last.slot.isConnected) draw(last.slot, start, s, rt); };
  const rr = rulesRow(s.rows), target = rr?.week_start ?? start;
  if (b.dataset.journalLearnEdit != null) { s.ui.editing = Number(b.dataset.journalLearnEdit); s.ui.adding = false; s.ui.fixing = null; s.ui.msg = ''; s.ui.value = null; s.ui.focus = true; redraw(); return; }
  if (b.dataset.journalLearnAdd != null) { s.ui.adding = true; s.ui.editing = -1; s.ui.fixing = null; s.ui.msg = ''; s.ui.value = null; s.ui.focus = true; redraw(); return; }
  if (b.dataset.journalLearnCancel != null) { s.ui.adding = false; s.ui.editing = -1; s.ui.value = null; redraw(); return; }
  const rc = ruleChange(b, last?.slot);
  if (rc?.ui === 'cancel') { s.ui.fixing = null; s.ui.value = null; redraw(); return; }
  if (rc?.ui === 'fix') { s.ui.fixing = rc.key; s.ui.editing = -1; s.ui.adding = false; s.ui.msg = ''; s.ui.value = null; s.ui.focus = true; redraw(); return; }
  let change = null, week = target, done = '';
  if (b.dataset.journalLearnSave != null) {
    const i = Number(b.dataset.journalLearnSave), text = last.slot.querySelector(`[data-journal-learn-rule-input="${i}"]`)?.value ?? '';
    change = d => ({...(d ?? emptyDraft()), rules:text.trim() ? withRuleText(d?.rules, i, text, nowIso()) : withoutRule(d?.rules, i, nowIso())}); done = '규칙을 고쳤어요.';
  } else if (b.dataset.journalLearnDelete != null) {
    const i = Number(b.dataset.journalLearnDelete);
    change = d => ({...(d ?? emptyDraft()), rules:withoutRule(d?.rules, i, nowIso())}); done = '규칙을 지웠어요.';
  } else if (b.dataset.journalLearnAddGo != null) {
    const text = last.slot.querySelector('[data-journal-learn-add-input]')?.value ?? '';
    if (!text.trim()) return;
    change = d => ({...(d ?? emptyDraft()), rules:withRule(d?.rules, text, nowIso())}); done = '규칙을 더했어요.';
  } else if (b.dataset.learnAnswer) {
    const [w, id, answer] = b.dataset.learnAnswer.split(':');
    week = w; change = d => answerChange(d, id, answer); done = answer === 'yes' ? '승인했어요. 개발 후보에 올렸어요.' : '아니로 답했어요.';
  } else if (rc?.change) { week = rc.week; change = rc.change; done = rc.done; }
  if (!change) return;
  s.ui.busy = true; s.ui.msg = '저장하는 중…'; s.ui.error = false; redraw();
  try {
    const r = await changeWeekDocs({start:week, change}, rt);
    if (r.missing) throw new Error('missing');
    s.ui.msg = done; s.ui.editing = -1; s.ui.adding = false; s.ui.fixing = null; s.ui.value = null;
    const rows = await readLearnRows(start, rt).catch(() => null);
    if (rows) s.rows = rows;
  } catch (error) { s.ui.msg = error?.code === 'too_many' ? error.message : '저장하지 못했어요. 다시 해 주세요.'; s.ui.error = true; }
  finally { s.ui.busy = false; redraw(); }
}
