// WEEKLY-환류학습 3·4번 화면(docs/design/weekly-draft-feedback.md 12·13절): [주간 정리] 맨 아래 '주간보고 규칙·환류' 접기 하나와
// 한글 파일 상자 [확정] 뒤 '이번 주 환류 보고' 한 장이 같이 쓰는 그리기·쓰기.
// - 읽기: 그 주까지의 요청 표 행에서 draft->feedback·draft->rules 두 칸만(owner RLS, 서버). 칸이 아직 없으면 아무것도 그리지 않는다.
// - 규칙은 확정·후보·폐기(WEEKLY-규칙합의, weekly-feedback.mjs readRules). AI 초안은 확정만 본다. 후보는 환류 보고 '새 규칙 후보'에만
//   뜨고 [넣기](확정) · ⋯ [고쳐서 넣기]·[빼기](폐기, 이유 한 줄은 안 써도 됨 — 요청함 11/01 23:42). 폐기 줄은 접어 두고 [다시 후보로]. 확정 줄 [지우기]는 폐기로 옮긴다.
// - 개선 제안도 같은 네 동작(WEEKLY-개발후보연결 6, 명진 11/02 00:07): [만들기](만들기로 보냄) · ⋯ [고쳐서 만들기]·[빼기](이유) + 묶음 [+ 추가]
//   (내 개선 생각 한 줄 → 동작 기록, '만들기로 보낸 것'에 '손'으로 보임). 제안은 두 줄 — 굵게 '무엇이 좋아지나'(text), 엷게 '어떻게'(how).
// - 성공 알림은 화면에 남기지 않고 작은 알림(small-notice.js notify, 2초)으로. 저장 중·오류만 그 자리 한 줄.
// - 쓰기: 규칙 고치기·지우기·더하기·후보 답은 그 규칙이 든 행에, 개선 제안 [승인]/[아니]는 그 주 행에(weekly-draft-store.js changeWeekDocs —
//   다시 읽고 그 칸만 바꿔 draft_saved_at 조건으로 씀). 브라우저 저장소에 아무것도 두지 않는다. 글은 로그에 쓰지 않는다.
// - journal.js 는 다시 그릴 때마다 paintWeeklyLearn(자리, 주)만 부른다. 읽은 값은 주마다 이 모듈이 들고 있다(다시 그려도 다시 읽지 않음).
//   상자가 [확정] 뒤 환류 보고를 받으면 'kptu:weekly-learn-changed'를 보내고, 이 모듈이 다시 읽어 그린다.
import {changeWeekDocs, missingDraft} from './weekly-draft-store.js';
import {withPick, pickKey, readPicks, reviewDue, withReview, WHY_MAX} from './weekly-picks.mjs';
import {callAiAssist, AI_SUMMARY_TEXT} from './basket-ai-summary.js'; // S46-22 답 학습(후보·개선 제안 답도 picks 에)
import {emptyEl} from './wait-state.js';
import {notify} from './small-notice.js';
import {rowMore, partAdd} from './row-more.js'; // WEEKLY-화면디자인정리: 규칙 줄 끝 ⋯ · 제목 줄 오른쪽 [+ 추가]
import {readFeedback, readRules, withRuleText, withoutRule, withRule, takeCandidate, dropCandidate, withAnswer, answerState, madeOf, feedbackTrend, keptRate, RULES_MAX, RULE_CHARS, SUGGESTION_AREA} from './weekly-feedback.mjs';
import {cellKeptRates} from './weekly-picks.mjs';

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
// 제안 줄 버튼 모양은 [주간 정리] 칸 제안과 같다: 줄 끝 작은 [넣기] + ⋯([고쳐서 넣기]·[빼기]). [빼기]는 그 자리 '이유(안 써도 돼요)' + [빼기 확인].
// week: 규칙 칸이 든 행의 주, rules: readRules 값. ui: {busy, fixing(고치는 후보 글), dropping(이유를 쓰는 후보 글), value(쓰던 글)}. 후보가 없으면 null.
const candidatePick = text => ({kind:'review', from:'ai', cell:'규칙 후보', org:'', text});
const suggestionPick = text => ({kind:'review', from:'ai', cell:'개선 제안', org:'', text});
const handPick = text => ({kind:'review', from:'hand', cell:'개선 제안', org:'', text});
const mkEl = doc => (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
// 줄 하나 고치기·이유 한 줄 칸(취소 왼쪽, 확인 오른쪽 — UI-저장자리). Enter = 확인, Esc = 취소(learnKeys).
function inlineForm(doc, {value, max, aria, placeholder = '', inputData, goText, goData, cancelData = {learnRuleCancel:''}, busy}) {
  const el = mkEl(doc);
  const f = el('span', 'journal-file-edit weekly-flow-edit journal-learn-inline');
  const input = el('input', 'journal-learn-input'); input.type = 'text'; input.value = value ?? ''; input.maxLength = max; input.setAttribute('aria-label', aria);
  if (placeholder) input.placeholder = placeholder;
  for (const [k, v] of Object.entries(inputData)) input.dataset[k] = v;
  const cancel = el('button', 'mini', '취소'); cancel.type = 'button'; for (const [k, v] of Object.entries(cancelData)) cancel.dataset[k] = v;
  const go = el('button', 'mini primary', goText); go.type = 'button'; for (const [k, v] of Object.entries(goData)) go.dataset[k] = v;
  input.disabled = cancel.disabled = go.disabled = !!busy;
  f.append(input, ' ', cancel, go);
  return f;
}
export function candidateList(doc, week, rules, {busy = false, fixing = null, dropping = null, value = null, title = '② 새 규칙 후보'} = {}) {
  const el = mkEl(doc);
  const list = readRules(rules)?.candidates ?? [];
  if (!list.length) return null;
  const part = doc.createDocumentFragment();
  const head = el('p', 'journal-weekly-sub', title); head.dataset.learnCandidatesHead = ''; part.append(head);
  const ul = el('ul', 'journal-kinds-off-list'); ul.dataset.learnCandidates = week;
  for (const c of list) {
    const li = el('li'); li.dataset.learnCandidate = c.text;
    if (fixing === c.text) li.append(inlineForm(doc, {value:value ?? c.text, max:RULE_CHARS, aria:'후보 고쳐서 넣기', inputData:{learnRuleFixInput:c.text}, goText:'넣기', goData:{learnRuleFixGo:week, learnRule:c.text}, busy}));
    else if (dropping === c.text) li.append(el('span', null, c.text), ' ', inlineForm(doc, {value:value ?? '', max:WHY_MAX, aria:`빼는 이유(안 써도 돼요): ${c.text}`, placeholder:'이유(안 써도 돼요)', inputData:{learnWhyInput:c.text}, goText:'빼기 확인', goData:{learnRuleDrop:week, learnRule:c.text}, busy}));
    else {
      const take = el('button', 'mini', '넣기'); take.type = 'button'; take.dataset.learnRuleTake = week; take.dataset.learnRule = c.text; take.disabled = busy; take.setAttribute('aria-label', `규칙으로 넣기: ${c.text}`);
      li.append(el('span', null, c.text), ' ', take, rowMore(doc, {label:`후보 고쳐서 넣기·빼기: ${c.text}`, data:{learnRuleMore:''}, items:[
        {text:'고쳐서 넣기', data:{learnRuleFix:week, learnRule:c.text}, disabled:busy, aria:`고쳐서 넣기: ${c.text}`},
        {text:'빼기', data:{learnRuleDropAsk:week, learnRule:c.text}, disabled:busy, danger:true, aria:`후보 빼기: ${c.text}`}]}));
    }
    ul.append(li);
  }
  part.append(ul);
  return part;
}
const inputIn = (root, data, key) => [...(root?.querySelectorAll(`[data-${data}]`) ?? [])].find(n => n.dataset[data.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === key);
// 후보·폐기 단추 하나 → {week, change, done}(쓸 것) · {ui:'fix'|'drop', key} · {ui:'cancel'} · null. root: 고치는 글·이유 칸을 찾을 자리.
export function ruleChange(button, root, at = nowIso()) {
  const d = button.dataset, key = d.learnRule ?? '';
  if (d.learnRuleCancel != null) return {ui:'cancel'};
  if (d.learnRuleFix != null) return {ui:'fix', key};
  if (d.learnRuleDropAsk != null) return {ui:'drop', key};
  const pick = (draft, act, extra = {}) => withPick(draft?.picks, {...candidatePick(key), ...extra}, act, at);
  if (d.learnRuleTake != null) return {week:d.learnRuleTake, done:'규칙으로 넣었어요. 다음 초안부터 반영돼요.', change:x => ({...(x ?? emptyDraft()), rules:takeCandidate(x?.rules, key, at), picks:pick(x, 'take')})};
  if (d.learnRuleDrop != null) {
    const why = String(inputIn(root, 'learn-why-input', key)?.value ?? '').trim().slice(0, WHY_MAX);
    return {week:d.learnRuleDrop, done:'후보를 뺐어요.', change:x => ({...(x ?? emptyDraft()), rules:dropCandidate(x?.rules, key, at), picks:pick(x, 'drop', why ? {why} : {})})};
  }
  if (d.learnRuleFixGo != null) {
    const text = String(inputIn(root, 'learn-rule-fix-input', key)?.value ?? '').trim();
    if (!text) return null;
    // 고쳐서 넣기 = 'edit'(before = 후보 글) — 학습 셈에서는 받은 것.
    return {week:d.learnRuleFixGo, done:'고쳐서 넣었어요. 다음 초안부터 반영돼요.', change:x => ({...(x ?? emptyDraft()), rules:takeCandidate(x?.rules, key, at, text), picks:withPick(x?.picks, {...candidatePick(key), key:pickKey(candidatePick(key)), text, before:key}, text === key ? 'take' : 'edit', at)})};
  }
  return null;
}
// 개선 제안 단추 하나 → {week, change, done} · {ui:'sfix'|'sdrop', week, id} · {ui:'sadd'} · {ui:'cancel'} · null.
//   [넣기] data-learn-answer="주:id:yes" · ⋯ [고쳐서 넣기] data-learn-answer-fix="주:id" → 칸 → [넣기] data-learn-answer="주:id:yes" + 고친 글
//   ⋯ [빼기] data-learn-answer-drop="주:id" → 이유 칸 → [빼기 확인] data-learn-answer="주:id:no" + 이유 · 묶음 [+ 추가] data-learn-idea-add="주" → 칸 → [더하기] data-learn-idea-go="주"
export function answerPress(button, root, at = nowIso()) {
  const d = button.dataset;
  if (d.learnAnswerCancel != null) return {ui:'cancel'};
  if (d.learnAnswerFix) { const [week, id] = d.learnAnswerFix.split(':'); return {ui:'sfix', week, id}; }
  if (d.learnAnswerDrop) { const [week, id] = d.learnAnswerDrop.split(':'); return {ui:'sdrop', week, id}; }
  if (d.learnIdeaAdd) return {ui:'sadd', week:d.learnIdeaAdd};
  if (d.learnIdeaGo) {
    const text = String(root?.querySelector('[data-learn-idea-input]')?.value ?? '').trim().slice(0, 200);
    if (!text) return null;
    return {week:d.learnIdeaGo, done:'내 개선 생각을 만들기로 보낸 것에 더했어요.', change:x => ({...(x ?? emptyDraft()), picks:withPick(x?.picks, handPick(text), 'add', at)})};
  }
  if (d.learnAnswer) {
    const [week, id, answer] = d.learnAnswer.split(':');
    const text = answer === 'yes' ? String(inputIn(root, 'learn-answer-fix-input', id)?.value ?? '').trim() : '';
    const why = answer === 'no' ? String(inputIn(root, 'learn-answer-why-input', id)?.value ?? '').trim().slice(0, WHY_MAX) : '';
    return {week, id, answer, done:answer === 'yes' ? (text ? '고쳐서 만들기로 보냈어요.' : '만들기로 보냈어요.') : '뺐어요. 다음 제안에 참고해요.', change:x => answerChange(x, id, answer, at, {text, why})};
  }
  return null;
}

// 개선 제안 두 줄(WEEKLY-개발후보연결 5): 굵게 '무엇이 좋아지나'(text) + 엷게 '어떻게'(how, 옛 제안엔 없음).
export function suggestionText(doc, s) {
  const box = doc.createElement('span'); box.className = 'journal-learn-suggest-text';
  const gain = doc.createElement('strong'); gain.className = 'journal-learn-gain'; gain.textContent = s.text; box.append(gain);
  if (s.how) { const how = doc.createElement('small'); how.className = 'journal-learn-how'; how.textContent = s.how; how.dataset.learnHow = ''; box.append(how); }
  return box;
}
// 칸(묶음)별 '그대로 쓴 비율'(WEEKLY-환류전칸 3, 서버 actionDigest kept_percent 와 같은 셈) 한 줄. 동작이 없으면 null.
export function cellRatesLine(doc, picks) {
  const rates = cellKeptRates(picks).filter(r => r.percent != null);
  if (!rates.length) return null;
  const p = doc.createElement('p'); p.className = 'journal-muted journal-learn-cell-rates'; p.dataset.learnCellRates = String(rates.length);
  p.textContent = `칸별 그대로 쓴 비율: ${rates.map(r => `${r.group} ${r.percent}%(${r.answered})`).join(' · ')}`;
  return p;
}
// ---- 환류 보고 한 장(상자·[주간 정리] 같이 씀) ----
// feedback: 그 주 고침 기록(review 가 있으면 개선 제안까지), previous: 지난 주 고침 기록들. answerable: [승인]/[아니] 단추를 그릴지.
// rules: {week, rules} — 규칙 칸이 든 행의 주와 그 칸. 있으면 '새 규칙 후보'를 그 칸 후보로 [ㅇ][×][고쳐서 확정]과 함께 그린다.
//   없으면(칸을 아직 못 읽음) 이번 보고의 후보 글만 단추 없이 보인다. fixing·value: 고치는 후보.
export function reviewCard(doc, feedback, previous = [], {answerable = true, busy = false, rules = null, fixing = null, dropping = null, value = null, sfix = null, sdrop = null, sadd = false, picks = null} = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const f = readFeedback(feedback);
  if (!f) return null;
  const t = feedbackTrend(f, previous), c = f.counts;
  const box = el('section', 'journal-weekly-part journal-learn-review'); box.dataset.learnReview = f.week;
  const rate = keptRate(c);
  const head = `이번 주 환류 보고 — AI 초안 줄 ${c.proposed}개 중 ${c.kept}개 그대로${rate == null ? '' : `(${rate}%)`}${t?.avg == null ? '' : ` · 지난 ${t.prev.filter(p => p.rate != null).length}주 평균 ${t.avg}% (${t.better >= 0 ? '+' : ''}${t.better})`}`;
  const h = el('p', 'journal-learn-head', head); h.dataset.learnReviewHead = ''; box.append(h);
  const nums = el('p', 'journal-muted', `① 남김 ${c.kept} · 고침 ${c.changed} · 뺌 ${c.dropped} · 더함 ${c.added}`); nums.dataset.learnReviewCounts = ''; box.append(nums);
  const rates = cellRatesLine(doc, picks); if (rates) box.append(rates);
  const r = f.review;
  const cands = rules ? candidateList(doc, rules.week, rules.rules, {busy:busy || !answerable, fixing, dropping, value}) : null;
  if (!r) { const p = el('p', 'journal-muted', '규칙 후보·개선 제안은 아직이에요(정리 중이거나 준비 중).'); p.dataset.learnReviewPending = ''; box.append(p); if (cands) box.append(cands); return box; }
  if (cands) box.append(cands);
  else if (!rules && r.candidates.length) {
    box.append(el('p', 'journal-weekly-sub', '② 새 규칙 후보'));
    const ul = el('ul', 'journal-kinds-off-list'); ul.dataset.learnCandidates = '';
    for (const t of r.candidates) ul.append(el('li', null, t));
    box.append(ul);
  }
  if (r.suggestions.length || answerable) {
    // ③ 개선 제안: 줄마다 [넣기] · ⋯([고쳐서 넣기]·[빼기]), 묶음 제목 줄 오른쪽 작은 [+ 추가](내 개선 생각 한 줄).
    const sec = el('div', 'journal-part-has-add journal-learn-suggest'); sec.dataset.learnSuggestPart = '';
    sec.append(el('p', 'journal-weekly-sub', '③ 시스템 설계를 이렇게 바꾸면 더 가까워집니다'));
    if (answerable && !sadd) { const add = el('button', 'journal-part-add-button', '+ 추가'); add.type = 'button'; add.dataset.learnIdeaAdd = f.week; add.disabled = busy; add.setAttribute('aria-label', '내 개선 생각 더하기'); sec.append(partAdd(doc, [add])); }
    const ul = el('ul', 'journal-kinds-off-list'); ul.dataset.learnSuggestions = '';
    for (const s of r.suggestions) {
      const li = el('li'); li.dataset.learnSuggestion = s.id;
      if (s.area) { const tag = el('small', 'journal-learn-area', SUGGESTION_AREA[s.area]); tag.dataset.learnArea = s.area; li.append(tag, ' '); }
      const id = `${f.week}:${s.id}`;
      if (answerable && sfix === s.id) { li.append(inlineForm(doc, {value:value ?? s.text, max:200, aria:'개선 제안 고쳐서 만들기', inputData:{learnAnswerFixInput:s.id}, goText:'만들기', goData:{learnAnswer:`${id}:yes`}, cancelData:{learnAnswerCancel:''}, busy})); ul.append(li); continue; }
      li.append(suggestionText(doc, s), ' ');
      if (s.answer) { const st = el('small', 'journal-muted', answerState(s)); st.dataset.learnAnswerState = s.answer; if (madeOf(s.made)) st.dataset.learnMade = String(s.made); li.append(st); }
      if (answerable && sdrop === s.id) { li.append(' ', inlineForm(doc, {value:value ?? '', max:WHY_MAX, aria:`빼는 이유(안 써도 돼요): ${s.text}`, placeholder:'이유(안 써도 돼요)', inputData:{learnAnswerWhyInput:s.id}, goText:'빼기 확인', goData:{learnAnswer:`${id}:no`}, cancelData:{learnAnswerCancel:''}, busy})); ul.append(li); continue; }
      if (answerable) {
        const items = [{text:'고쳐서 만들기', data:{learnAnswerFix:id}, disabled:busy, aria:`고쳐서 만들기: ${s.text}`}];
        if (s.answer !== 'no') items.push({text:'빼기', data:{learnAnswerDrop:id}, disabled:busy, danger:true, aria:`개선 제안 빼기: ${s.text}`});
        if (s.answer !== 'yes') { const b = el('button', 'mini', '만들기'); b.type = 'button'; b.dataset.learnAnswer = `${id}:yes`; b.disabled = busy; b.setAttribute('aria-label', `만들기로 보내기: ${s.text}`); li.append(' ', b); }
        li.append(rowMore(doc, {label:`개선 제안 고쳐서 만들기·빼기: ${s.text}`, data:{learnAnswerMore:''}, items}));
      }
      ul.append(li);
    }
    if (answerable && sadd) { const li = el('li'); li.append(inlineForm(doc, {value:value ?? '', max:200, aria:'내 개선 생각', placeholder:'예: 끝난 일은 자동으로 빼 주면 좋겠다', inputData:{learnIdeaInput:''}, goText:'더하기', goData:{learnIdeaGo:f.week}, cancelData:{learnAnswerCancel:''}, busy})); ul.append(li); }
    if (ul.children.length) sec.append(ul);
    if (r.suggestions.length || sadd || answerable) box.append(sec);
  }
  return box;
}
// 개선 제안 하나에 답(그 주 행 feedback.review). 반환 changeWeekDocs 결과.
// S46-22: 답도 학습 기록(picks)에 — 승인 = 받은 제안, 아니 = 거절한 제안(종류 '환류 규칙 후보' 아닌 '개선 제안' 칸).
// 고쳐서 넣기(fix.text) = 'edit'(before = 제안 글), 빼기 이유(fix.why)는 동작 기록에.
export function answerChange(d, id, answer, at = nowIso(), {text: fixed = '', why = ''} = {}) {
  const orig = readFeedback(d?.feedback)?.review?.suggestions?.find(x => x.id === id), text = orig?.before ?? orig?.text ?? '';
  const out = {...(d ?? emptyDraft()), feedback:withAnswer(d?.feedback, id, answer, {text:fixed, why})};
  if (!text) return out;
  const base = suggestionPick(text), edited = answer === 'yes' && fixed && fixed !== text;
  out.picks = withPick(d?.picks, edited ? {...base, key:pickKey(base), text:fixed, before:text} : {...base, ...(answer === 'no' && why ? {why} : {})}, answer === 'yes' ? (edited ? 'edit' : 'take') : 'drop', at);
  return out;
}
// WEEKLY-개발후보연결(S48-49, 설계 25.2 (가)): [만들기]·[고쳐서 만들기] 저장이 성공한 뒤에만 그 제안 한 건을 서버에 알린다({week_start, id}만, 글은 보내지 않음).
//   서버(document-actions dev-inbox)가 로그인·owner·운영자 기능·그 주 행의 answer='yes'를 다시 확인한 뒤 'Web2 요청함' 문서 끝에 한 덩어리를 더한다.
//   저절로·여러 건을 한꺼번에 보내지 않는다. 다시 보내지 않는다(실패해도 재시도 없음 — 같은 제안은 서버가 한 번만 받음).
//   반환: 'sent' | 'already' | 'not_ready'(요청함 문서 설정 전) | 'quiet'(운영자 아님·함수 배포 전 — 조용히) | 'failed'.
export const DEV_INBOX_TEXT = Object.freeze({sent:'요청함에 전했어요.', not_ready:'요청함 전달 준비 중', failed:'요청함 전달은 못 했어요.'});
export async function sendDevInbox(week, id, rt = window.KPTURuntime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week ?? '')) || !/^s[1-4]$/.test(String(id ?? ''))) return 'quiet';
  try {
    const data = await rt.api('/functions/v1/document-actions', {method:'POST', body:{action:'dev-inbox', week_start:week, id}, refreshSession:false, singleFlight:false});
    const r = data?.ok === true ? data.result : '';
    return r === 'sent' || r === 'already' || r === 'not_ready' ? r : 'failed';
  } catch (error) {
    const status = Number(error?.status) || 0;
    return [400, 401, 403, 404, 405].includes(status) ? 'quiet' : 'failed';
  }
}
// 저장 성공 알림 글 + 요청함 전달 결과(보냈으면 한 마디, 준비 중이면 '요청함 전달 준비 중', 실패면 한 마디). 'yes' 답이 아니면 그대로.
export async function devInboxNotice(rc, rt = window.KPTURuntime) {
  if (!rc || rc.answer !== 'yes' || !rc.id) return rc?.done ?? '';
  const r = await sendDevInbox(rc.week, rc.id, rt);
  return DEV_INBOX_TEXT[r] ? `${rc.done} ${DEV_INBOX_TEXT[r]}` : rc.done;
}
export const answerSuggestion = (week, id, answer, rt = window.KPTURuntime, fix = {}) =>
  changeWeekDocs({start:week, change:d => answerChange(d, id, answer, nowIso(), fix)}, rt);
// [+ 추가]로 더한 내 개선 생각(동작 기록 'add', 개선 제안 칸) — 개발 후보 목록에 '손'으로.
export const handIdeas = (rows = []) => rows.flatMap(r => (readPicks(r.picks)?.items ?? []).filter(x => x.kind === 'review' && x.cell === '개선 제안' && x.act === 'add').map(x => ({week:r.week_start, text:x.text, hand:true})));
// 화면 상태(ui: {fixing, dropping, sfix, sdrop, sadd, value}) 하나를 단추에 맞게 바꾼다. 쓰기 단추면 {week, change, done} 를, 화면만 바뀌면 'ui' 를, 아니면 null.
export function learnPress(b, root, ui, at = nowIso()) {
  const clear = () => { ui.fixing = null; ui.dropping = null; ui.sfix = null; ui.sdrop = null; ui.sadd = false; ui.value = null; };
  const rc = ruleChange(b, root, at) ?? answerPress(b, root, at);
  if (!rc) return null;
  if (rc.ui) {
    clear();
    if (rc.ui === 'fix') ui.fixing = rc.key; else if (rc.ui === 'drop') ui.dropping = rc.key;
    else if (rc.ui === 'sfix') ui.sfix = rc.id; else if (rc.ui === 'sdrop') ui.sdrop = rc.id; else if (rc.ui === 'sadd') ui.sadd = true;
    ui.focus = rc.ui !== 'cancel';
    return 'ui';
  }
  return rc;
}
export const learnFocus = root => root?.querySelector('.journal-learn-inline input');
// 한 줄 칸에서 Enter = 확인, Esc = 취소.
export function learnKeys(event) {
  const input = event.target.closest?.('.journal-learn-inline input');
  if (!input) return;
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); input.parentElement.querySelector('button.primary')?.click(); }
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.parentElement.querySelector('[data-learn-rule-cancel], [data-learn-answer-cancel]')?.click(); }
}

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
  if (s.status === 'ok') void reviewOnOpen(start, s, rt);
}
// ---- 확정 전 환류 정리(명진 결정 11/01 ③, 설계 3.2절 ②) ----
// [주간 정리]를 열 때 이 주 동작 기록이 마지막 정리 뒤 30건 넘게 모이고 6시간이 지났으면 weekly_review 를 한 번 부른다(주 3회 상한, 이 화면을 연 동안 주마다 한 번만 시도).
// 서버가 정리를 저장하면(규칙 후보) 그 주 picks.reviews 에 부른 시각을 남기고 다시 읽는다. 서버가 아직 동작 기록만으로 정리하지 못하면(404) 조용히 넘어간다.
// 글은 로그·오류 보고에 쓰지 않는다.
const tried = new Set();
const REVIEW_TEXT = Object.freeze({...AI_SUMMARY_TEXT});
async function reviewOnOpen(start, s, rt) {
  if (tried.has(start)) return;
  const due = reviewDue(s.rows.find(r => r.week_start === start)?.picks ?? null, {when:'open'});
  if (!due.due) return;
  tried.add(start);
  let r;
  try { r = await callAiAssist({kind:'weekly_review', week_start:start}, {rt}, REVIEW_TEXT); } catch { return; }
  if (!r?.ok || r.data?.kind !== 'weekly_review' || r.data.week_start !== start) return;
  try { await changeWeekDocs({start, change:d => ({...(d ?? emptyDraft()), picks:withReview(d?.picks ?? null, nowIso())})}, rt); } catch { /* 시각만 못 남김 — 다음에 다시 셈 */ }
  s.ui.msg = ''; s.ui.error = false; notify('고친 것을 모아 새 규칙 후보를 정리했어요.');
  const rows = await readLearnRows(start, rt).catch(() => null);
  if (rows) s.rows = rows;
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
  const typing = slot.querySelector('[data-journal-learn-rule-input], [data-journal-learn-add-input], .journal-learn-inline input');
  if (typing) s.ui.value = typing.value;
  s.ui.open = open;
  if (s.status === 'missing' || s.status === 'loading') { slot.replaceChildren(); return; }
  const box = el('details', 'journal-weekly-chapter journal-weekly-memory journal-weekly-fold'); box.dataset.journalWeeklyLearn = start; box.open = open;
  box.addEventListener('toggle', () => { s.ui.open = box.open; });
  if (s.status === 'failed') { box.append(el('summary', null, '주간보고 규칙·환류'), el('p', 'journal-muted', '읽지 못했어요. 업무일지를 다시 열면 다시 읽어요.')); slot.replaceChildren(box); return; }
  const rr = rulesRow(s.rows), rules = rr?.rules?.lines ?? [], cands = rr?.rules?.candidates ?? [];
  const mine = s.rows.find(r => r.week_start === start)?.feedback ?? null;
  const prev = s.rows.filter(r => r.week_start < start).map(r => r.feedback).filter(Boolean);
  const dev = [...s.rows.flatMap(r => (r.feedback?.review?.suggestions ?? []).filter(x => x.answer === 'yes').map(x => ({week:r.week_start, text:x.text, how:x.how, area:x.area, made:madeOf(x.made)}))), ...handIdeas(s.rows)];
  const minePicks = s.rows.find(r => r.week_start === start)?.picks ?? null;
  const sum = el('summary');
  sum.append(el('span', 'journal-heading', '주간보고 규칙·환류'), ' ', el('small', 'journal-others-count', `확정 규칙 ${rules.length}줄${cands.length ? ` · 후보 ${cands.length}` : ''} · ${mine ? `이번 주 ${keptRate(mine.counts) ?? 0}% 그대로` : '이번 주 환류 없음'}${dev.length ? ` · 만들기로 보낸 것 ${dev.length}` : ''}`));
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
  // S48-33(요청함 11/01 23:43 '뺀 것 목록 두지 않기'): 뺀 규칙(폐기, rules.retired)은 AI 초안·후보에 쓰지 않고 화면에도 목록을 두지 않는다(데이터는 그대로).
  box.append(part);
  // 이번 주 환류 보고(새 규칙 후보 포함) · 개발 후보. 이번 주 보고가 없으면 후보만 따로.
  const ruleOpt = rr ? {week:rr.week_start, rules:rr.rules} : null, fix = {fixing:s.ui.fixing, dropping:s.ui.dropping, value:s.ui.value, sfix:s.ui.sfix, sdrop:s.ui.sdrop, sadd:s.ui.sadd};
  const card = mine ? reviewCard(doc, mine, prev, {busy:s.ui.busy, rules:ruleOpt, picks:minePicks, ...fix}) : null;
  if (card) box.append(card);
  else { const rates = cellRatesLine(doc, minePicks); if (rates) box.append(rates); } // 확정 전에도 이번 주 동작으로 칸별 비율
  if (!card && ruleOpt) {
    const list = candidateList(doc, ruleOpt.week, ruleOpt.rules, {busy:s.ui.busy, fixing:fix.fixing, dropping:fix.dropping, value:fix.value, title:'새 규칙 후보'});
    if (list) { const sec = el('section', 'journal-weekly-part'); sec.dataset.journalLearnCandidates = ''; sec.append(list); box.append(sec); }
  }
  if (dev.length) {
    const d = el('section', 'journal-weekly-part'); d.dataset.journalLearnDev = '';
    d.append(el('h5', 'journal-weekly-sub', '만들기로 보낸 것'));
    // CC 전달 길(설계 25.2)이 생기기 전까지는 사실대로 한 줄(길이 생기면 이 줄을 지운다).
    const wait = el('p', 'journal-muted', 'CC에게 저절로 가는 길은 준비 중이에요.'); wait.dataset.journalLearnDevWait = ''; d.append(wait);
    const list = el('ul', 'journal-kinds-off-list');
    for (const x of dev) { const li = el('li'); li.append(el('span', 'journal-weekly-day', slash(x.week)), ' '); if (x.area) li.append(el('small', 'journal-learn-area', SUGGESTION_AREA[x.area]), ' '); if (x.hand) li.append(el('small', 'journal-learn-area', '손'), ' '); li.append(suggestionText(doc, x)); if (x.made) { const m = el('small', 'journal-muted', `만듦 #${x.made}`); m.dataset.learnMade = String(x.made); li.append(' ', m); } list.append(li); }
    d.append(list); box.append(d);
  }
  const say = el('p', 'journal-line-status', s.ui.msg); say.dataset.journalLearnStatus = ''; say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  if (s.ui.error) say.classList.add('journal-failed');
  box.append(say);
  box.addEventListener('click', event => { const b = event.target.closest('button'); if (b && !b.disabled) void act(b, start, s, rt); });
  box.addEventListener('keydown', learnKeys);
  slot.replaceChildren(box);
  const focus = slot.querySelector('[data-journal-learn-rule-input], [data-journal-learn-add-input], .journal-learn-inline input');
  if (focus && (s.ui.focus || typing === doc.activeElement)) { focus.focus(); s.ui.focus = false; }
}

async function act(b, start, s, rt) {
  const redraw = () => { if (last?.start === start && last.slot.isConnected) draw(last.slot, start, s, rt); };
  const rr = rulesRow(s.rows), target = rr?.week_start ?? start;
  if (b.dataset.journalLearnEdit != null) { s.ui.editing = Number(b.dataset.journalLearnEdit); s.ui.adding = false; s.ui.fixing = null; s.ui.msg = ''; s.ui.value = null; s.ui.focus = true; redraw(); return; }
  if (b.dataset.journalLearnAdd != null) { s.ui.adding = true; s.ui.editing = -1; s.ui.fixing = null; s.ui.msg = ''; s.ui.value = null; s.ui.focus = true; redraw(); return; }
  if (b.dataset.journalLearnCancel != null) { s.ui.adding = false; s.ui.editing = -1; s.ui.value = null; redraw(); return; }
  const rc = learnPress(b, last?.slot, s.ui);
  if (rc === 'ui') { s.ui.editing = -1; s.ui.adding = false; s.ui.msg = ''; redraw(); return; }
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
  } else if (rc?.change) { week = rc.week; change = rc.change; done = rc.done; }
  if (!change) return;
  s.ui.busy = true; s.ui.msg = '저장하는 중…'; s.ui.error = false; redraw();
  try {
    const r = await changeWeekDocs({start:week, change}, rt);
    if (r.missing) throw new Error('missing');
    if (rc?.answer === 'yes') done = await devInboxNotice(rc, rt); // 저장이 성공한 뒤에만 요청함 전달(S48-49)
    s.ui.msg = ''; notify(done); s.ui.editing = -1; s.ui.adding = false; s.ui.fixing = null; s.ui.dropping = null; s.ui.sfix = null; s.ui.sdrop = null; s.ui.sadd = false; s.ui.value = null;
    const rows = await readLearnRows(start, rt).catch(() => null);
    if (rows) s.rows = rows;
  } catch (error) { s.ui.msg = error?.code === 'too_many' ? error.message : '저장하지 못했어요. 다시 해 주세요.'; s.ui.error = true; }
  finally { s.ui.busy = false; redraw(); }
}
