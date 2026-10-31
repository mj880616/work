// WEEKLY-환류학습 3·4번 화면(docs/design/weekly-draft-feedback.md 12·13절): [주간 정리] 맨 아래 '주간보고 규칙·환류' 접기 하나와
// 한글 파일 상자 [확정] 뒤 '이번 주 환류 보고' 한 장이 같이 쓰는 그리기·쓰기.
// - 읽기: 그 주까지의 요청 표 행에서 draft->feedback·draft->rules 두 칸만(owner RLS, 서버). 칸이 아직 없으면 아무것도 그리지 않는다.
// - 쓰기: 규칙 고치기·지우기·더하기는 그 규칙이 든 행에, 개선 제안 [승인]/[아니]는 그 주 행에(weekly-draft-store.js changeWeekDocs —
//   다시 읽고 그 칸만 바꿔 draft_saved_at 조건으로 씀). 브라우저 저장소에 아무것도 두지 않는다. 글은 로그에 쓰지 않는다.
// - journal.js 는 다시 그릴 때마다 paintWeeklyLearn(자리, 주)만 부른다. 읽은 값은 주마다 이 모듈이 들고 있다(다시 그려도 다시 읽지 않음).
//   상자가 [확정] 뒤 환류 보고를 받으면 'kptu:weekly-learn-changed'를 보내고, 이 모듈이 다시 읽어 그린다.
import {changeWeekDocs, missingDraft} from './weekly-draft-store.js';
import {sortPicks, droppedOf, keptOf, withPick, emptyLearn} from './weekly-picks.mjs'; // S46-22 규칙 후보 [×]·답 학습
import {readFeedback, readRules, withRuleText, withoutRule, withRule, withAnswer, feedbackTrend, keptRate, RULES_MAX, RULE_CHARS, SUGGESTION_AREA} from './weekly-feedback.mjs';

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

// ---- 환류 보고 한 장(상자·[주간 정리] 같이 씀) ----
// feedback: 그 주 고침 기록(review 가 있으면 규칙 후보·개선 제안까지), previous: 지난 주 고침 기록들. answerable: [승인]/[아니] 단추를 그릴지.
// picks: 그 주 draft.picks(규칙 후보 [×]·다시 넣기). 없으면 [×]를 그리지 않는다.
const candidatePick = text => ({kind:'review', from:'ai', cell:'규칙 후보', org:'', text});
const pickData = x => JSON.stringify({kind:x.kind, from:x.from, cell:x.cell, org:x.org, text:x.text, key:x.key});
export function reviewCard(doc, feedback, previous = [], {answerable = true, busy = false, picks = undefined} = {}) {
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
  if (!r) { const p = el('p', 'journal-muted', '규칙 후보·개선 제안은 아직이에요(정리 중이거나 준비 중).'); p.dataset.learnReviewPending = ''; box.append(p); return box; }
  if (r.candidates.length) {
    box.append(el('p', 'journal-weekly-sub', '② 새 규칙 후보'));
    const ul = el('ul', 'journal-kinds-off-list'); ul.dataset.learnCandidates = '';
    const can = picks !== undefined;
    const {shown, gone} = sortPicks(r.candidates, candidatePick, {dropped:droppedOf(picks), kept:keptOf(picks), learn:emptyLearn()});
    for (const x of shown) {
      const li = el('li', null, `${x.raw} `);
      if (can) { const b = el('button', 'mini', '×'); b.type = 'button'; b.dataset.learnPickDrop = f.week; b.dataset.learnPick = pickData(x); b.disabled = busy; b.title = '이 후보 빼기'; b.setAttribute('aria-label', `후보 빼기: ${x.raw}`); li.append(b); }
      ul.append(li);
    }
    box.append(ul);
    if (can && gone.length) {
      const fold = el('details', 'journal-weekly-gone'); fold.dataset.learnPickGone = '';
      fold.append(el('summary', null, `뺀 후보 ${gone.length}개`));
      const list = el('ul', 'journal-kinds-off-list');
      for (const g of gone) { const li = el('li', null, `${g.raw} `); const b = el('button', 'mini', '다시 넣기'); b.type = 'button'; b.dataset.learnPickPut = f.week; b.dataset.learnPick = pickData(g); b.disabled = busy; b.setAttribute('aria-label', `다시 넣기: ${g.raw}`); li.append(b); list.append(li); }
      fold.append(list); box.append(fold);
    }
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
// 규칙 후보 [×]·다시 넣기(그 주 행 picks). button: data-learn-pick-drop|put = 주, data-learn-pick = 제안.
export function candidateChange(button) {
  let item = null; try { item = JSON.parse(button.dataset.learnPick ?? ''); } catch { item = null; }
  if (!item?.key) return null;
  const week = button.dataset.learnPickDrop ?? button.dataset.learnPickPut, act = button.dataset.learnPickDrop != null ? 'drop' : 'none';
  return {week, item, act, change:d => ({...(d ?? emptyDraft()), picks:withPick(d?.picks, item, act, nowIso())})};
}

// ---- [주간 정리] 맨 아래 '주간보고 규칙·환류' ----
export function paintWeeklyLearn(slot, start, {rt = window.KPTURuntime} = {}) {
  if (!slot) return;
  last = {slot, start, rt};
  let s = states.get(start);
  if (!s) { s = {status:'loading', rows:[], ui:{open:false, editing:-1, adding:false, busy:false, msg:'', error:false}}; states.set(start, s); void load(start, rt); }
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
  const typing = slot.querySelector('[data-journal-learn-rule-input], [data-journal-learn-add-input]');
  if (typing) s.ui.value = typing.value;
  s.ui.open = open;
  if (s.status === 'missing' || s.status === 'loading') { slot.replaceChildren(); return; }
  const box = el('details', 'journal-weekly-chapter journal-weekly-memory'); box.dataset.journalWeeklyLearn = start; box.open = open;
  box.addEventListener('toggle', () => { s.ui.open = box.open; });
  if (s.status === 'failed') { box.append(el('summary', null, '주간보고 규칙·환류'), el('p', 'journal-muted', '읽지 못했어요. 업무일지를 다시 열면 다시 읽어요.')); slot.replaceChildren(box); return; }
  const rr = rulesRow(s.rows), rules = rr?.rules?.lines ?? [], mine = s.rows.find(r => r.week_start === start)?.feedback ?? null;
  const prev = s.rows.filter(r => r.week_start < start).map(r => r.feedback).filter(Boolean);
  const dev = s.rows.flatMap(r => (r.feedback?.review?.suggestions ?? []).filter(x => x.answer === 'yes').map(x => ({week:r.week_start, text:x.text, area:x.area})));
  const sum = el('summary');
  sum.append(el('span', 'journal-heading', '주간보고 규칙·환류'), ' ', el('small', 'journal-others-count', `규칙 ${rules.length}줄 · ${mine ? `이번 주 ${keptRate(mine.counts) ?? 0}% 그대로` : '이번 주 환류 없음'}${dev.length ? ` · 개발 후보 ${dev.length}` : ''}`));
  box.append(sum);
  // 규칙 목록
  const part = el('section', 'journal-weekly-part'); part.dataset.journalLearnRules = rr?.week_start ?? '';
  part.append(el('h5', 'journal-weekly-sub', `주간보고 규칙${rr ? ` (${slash(rr.week_start)} 주 정리)` : ''}`));
  if (!rules.length) part.append(el('p', 'journal-muted', '아직 없어요. [확정]하면 고침 기록에서 저절로 정리돼요.'));
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
      const edit = el('button', 'mini', '고치기'); edit.type = 'button'; edit.dataset.journalLearnEdit = String(i); edit.disabled = s.ui.busy; edit.setAttribute('aria-label', `규칙 고치기: ${rule.text}`);
      const del = el('button', 'mini', '지우기'); del.type = 'button'; del.dataset.journalLearnDelete = String(i); del.disabled = s.ui.busy; del.setAttribute('aria-label', `규칙 지우기: ${rule.text}`);
      li.append(' ', edit, ' ', del);
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
  } else if (rules.length < RULES_MAX) { const add = el('button', 'mini', '규칙 더하기'); add.type = 'button'; add.dataset.journalLearnAdd = ''; add.disabled = s.ui.busy; part.append(add); }
  box.append(part);
  // 이번 주 환류 보고 · 개발 후보
  const card = mine ? reviewCard(doc, mine, prev, {busy:s.ui.busy, picks:s.rows.find(r => r.week_start === start)?.picks ?? null}) : null;
  if (card) box.append(card);
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
  const focus = slot.querySelector('[data-journal-learn-rule-input], [data-journal-learn-add-input]');
  if (focus && (s.ui.focus || typing === doc.activeElement)) { focus.focus(); s.ui.focus = false; }
}

async function act(b, start, s, rt) {
  const redraw = () => { if (last?.start === start && last.slot.isConnected) draw(last.slot, start, s, rt); };
  const rr = rulesRow(s.rows), target = rr?.week_start ?? start;
  if (b.dataset.journalLearnEdit != null) { s.ui.editing = Number(b.dataset.journalLearnEdit); s.ui.adding = false; s.ui.msg = ''; s.ui.value = null; s.ui.focus = true; redraw(); return; }
  if (b.dataset.journalLearnAdd != null) { s.ui.adding = true; s.ui.editing = -1; s.ui.msg = ''; s.ui.value = null; s.ui.focus = true; redraw(); return; }
  if (b.dataset.journalLearnCancel != null) { s.ui.adding = false; s.ui.editing = -1; s.ui.value = null; redraw(); return; }
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
  } else if (b.dataset.learnPick) {
    const c = candidateChange(b); if (!c) return;
    week = c.week; change = c.change; done = c.act === 'drop' ? '후보를 뺐어요.' : '다시 넣었어요.';
  }
  if (!change) return;
  s.ui.busy = true; s.ui.msg = '저장하는 중…'; s.ui.error = false; redraw();
  try {
    const r = await changeWeekDocs({start:week, change}, rt);
    if (r.missing) throw new Error('missing');
    s.ui.msg = done; s.ui.editing = -1; s.ui.adding = false; s.ui.value = null;
    const rows = await readLearnRows(start, rt).catch(() => null);
    if (rows) s.rows = rows;
  } catch (error) { s.ui.msg = error?.code === 'too_many' ? error.message : '저장하지 못했어요. 다시 해 주세요.'; s.ui.error = true; }
  finally { s.ui.busy = false; redraw(); }
}
