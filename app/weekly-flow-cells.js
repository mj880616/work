// WEEKLY-한흐름확정 ② 화면(docs/design/weekly-one-flow.md 4.1절, 시안 안 B): [주간 정리] 2. 1) 요약 · 3. 2) 투쟁 사업장 현황 · 4. 산하 조직 현황의
// '보고서 칸'을 그 주 임시저장(draft) 한 벌에서 그린다. 보이는 줄 = 한글 파일에 들어갈 줄(weekly-draft-store.js weekCells: 바탕 proposed 위에 고친 rows).
// - 줄 끝 작은 ⋯ → [고치기]·[빼기], 칸 이름 줄 오른쪽 작은 [+ 추가], 칸 아래 흐린 '제안'(이번 주 기록·자료·조직 AI 요약·캘린더 추천) → [넣기]·⋯([고쳐서 넣기]·[빼기] — 빼기는 이유 한 줄, 안 써도 됨).
// - 누름 한 번 = 서버 쓰기 한 번(changeWeekCell: rows + picks 를 한 PATCH). 실패하면 그 칸에 "저장 못 함 [다시]", 화면 값은 그대로.
// - 투쟁 사업장 칸 구성(이번 주 보고에서 빼기·[+ 사업장 추가])은 draft.site_layout(없으면 지난주 구성을 이어 씀)에 쓴다.
//   WEEKLY-뺀목록삭제(빠짐2·요청함 11/01 23:43): 뺀 사업장 접힌 목록과 [다시 넣기]는 없앴다 — 뺀 사업장은 [+ 사업장 추가] 고르기 목록에 나온다.
// - WEEKLY-줄끌기(요청함 11/01 23:39): 2. 1) 요약·4. 산하 조직 칸 줄은 줄 앞 ⠿ 로 끌어 같은 칸 안 다른 자리나 같은 묶음의 다른 칸으로 옮긴다(폰은 줄을 길게 눌러,
//   키보드는 ⠿ 에서 위·아래 — reorder-drag.js). 줄 ⋯ 의 [아래에 줄 추가]로 그 줄 바로 아래에 더한다. 줄 번호는 늘 보이는 줄 기준(weekly-draft-store.js visibleLines).
// - 제안 거르기·학습 열쇠는 한글 파일 상자와 같다(weekly-picks.mjs sortPicks, 칸 이름 'section:key#n', 캘린더 추천 'orgref:조직 id').
// - 칸 하나의 그리기 주인은 이 모듈 하나(journal.js는 자리만 주고 다시 그릴 때 부른다). AI 를 부르지 않는다. 브라우저 저장소에 아무것도 두지 않는다.
import {weekCells, parseCellId, cellId, summaryKey, changeWeekCell, changeWeekDocs, changeWeekMove, withSiteLayout, draftSiteLayout, readCarriedLayout, lineDone, lineKey, visibleLines, CELL_LINE_MAX} from './weekly-draft-store.js';
import {sortPicks, droppedOf, keptOf, pickKey, WHY_MAX} from './weekly-picks.mjs';
import {learnFor} from './weekly-picks.js';
import {arrangeSites, siteHidden, siteShown, siteMoved, siteKey, readSiteLayout} from './weekly-schedule-rows.mjs';
import {mountReorder} from './reorder-drag.js';
import {askTargets, lineRequest, readAnswer, suggestKey, PICK_MS, PER_OPEN} from './weekly-line-suggest.mjs';
import {whereOf} from './weekly-feedback.mjs';
import {callAiAssist, AI_SUMMARY_TEXT} from './basket-ai-summary.js';
import {readProposed} from './weekly-feedback.mjs';
import {matchOrg} from './org-name-match.mjs';
import {reportLine as orgRefLine, alreadyIn as orgRefIn} from './calendar-ref-model.mjs';
import {rowMore} from './row-more.js';
import {CARRIED_TAG} from './weekly-exec-requests.js';
import {shortDay} from './journal-data.js';
import {emptyEl, waitEl} from './wait-state.js';

export const FLOW_SECTIONS = Object.freeze(['summary', 'sites', 'orgs']);
const TAG = Object.freeze({record:'기록', doc:'자료', ai:'AI 요약', calendar:'캘린더', line:'AI 제안'});
// 줄 제안(ai-assist weekly_line) 답의 일상어 — 화면에는 쓰지 않고(조용히 끔) 실패 판정에만.
const LINE_TEXT = Object.freeze({...AI_SUMMARY_TEXT});
// 줄 제안을 [주간 정리] 한 번 열 때 묻는 횟수 상한(설계 3.2절: 화면이 넓어져 상자 12회 → 8회).
export const LINE_PER_OPEN = Math.min(8, PER_OPEN);
const UNDO_MS = 5000;
// 화면 상태(기기 메모리만): 고치는 줄·더하는 칸·고쳐서 넣는 제안·빼는 이유를 쓰는 제안·쓰는 중·실패·되돌리기.
const uiOf = new WeakMap();
const freshUi = start => ({start, editing:null, adding:null, addAt:-1, taking:null, dropping:null, busy:'', failed:null, undo:null, carried:{start:'', status:'', layout:null}, mat:null, matFlight:null,
  line:{cache:new Map(), asked:0, off:false, flight:false, timer:0, focus:null}, siteNote:'', siteAdding:false});

const particle = name => { const code = String(name).charCodeAt(String(name).length - 1); return code >= 0xAC00 && code <= 0xD7A3 ? ((code - 0xAC00) % 28 ? '을' : '를') : '을(를)'; };
const lineOf = s => String(s ?? '').replace(/^\s*-\s*/, '').trim();
const strip = s => lineOf(s).replace(/\s+/g, '').toLowerCase();
const cellName = (section, key, n) => `${section}:${key}${n ? `#${n}` : ''}`;
const labelOf = (section, key, n) => `${section === 'summary' ? key.split('›').map(x => x || '—').join(' › ') : key}${n ? ` (${n + 1}번째)` : ''}`;

// 그 주 draft 의 칸 목록(바탕 순서, 고친 칸만 있는 칸은 뒤에). [{id, section, key, n, lines}]
export function flowCells(draft, section) {
  const out = [];
  for (const [id, lines] of weekCells(draft)) { const c = parseCellId(id); if (c.section === section) out.push({id, ...c, lines:visibleLines(lines)}); }
  return out;
}
// 투쟁 사업장: 바탕에 없지만 구성(order)에 넣은 사업장(내 담당 조직 = 4번 칸 이름만)은 빈 칸으로 더한다(한글 파일 상자 missingSites 와 같은 규칙).
export function siteCells(draft, layout) {
  const cells = flowCells(draft, 'sites'), l = readSiteLayout(layout);
  if (!l) return cells;
  const have = new Set(cells.map(c => siteKey(c.key))), mine = new Map(flowCells(draft, 'orgs').map(c => [siteKey(c.key), c.key]));
  for (const name of l.order) { const k = siteKey(name); if (!have.has(k) && mine.has(k)) { have.add(k); cells.push({id:cellId('sites', mine.get(k), 0), section:'sites', key:mine.get(k), n:0, lines:[]}); } }
  return cells;
}
// WEEKLY-한흐름확정 ③(확정 규칙 '내 담당 사업은 사업 요약표에 모두 들어간다'): 내 사업영역(사업 목록 1단 이름, names) 가운데 칸이 하나도 없는
// 사업영역은 빈 칸(사업영역 › —)을 뒤에 더한다. 칸 이름은 한글 파일 쪽(journal-hwpx.js withAreaRows 로 더한 줄)과 같은 summaryKey.
const areaNorm = s => String(s ?? '').replace(/\s+/g, '').replace(/[‧·․]/g, '·');
export const areaCellKey = name => summaryKey({area:name, task:''});
export function summaryCells(draft, names = []) {
  const cells = flowCells(draft, 'summary');
  const have = new Set(cells.map(c => areaNorm(c.key.split('›')[0])));
  for (const name of names ?? []) {
    const n = areaNorm(name); if (!n || have.has(n)) continue;
    have.add(n); const key = areaCellKey(name);
    cells.push({id:cellId('summary', key, 0), section:'summary', key, n:0, lines:[], added:true});
  }
  return cells;
}
// 칸 줄 + 이번 주 재료 → 칸마다 제안(draft.mjs weekMaterial 과 같은 이름 맞춤). 이미 칸에 든 글은 빼다.
export function flowMaterial(weekMaterial, model, draft) {
  const summary = summaryCells(draft, model?.summary?.names), orgs = flowCells(draft, 'orgs');
  const rows = summary.map((c, index) => { const [area, task = ''] = c.key.split('›'); return {index, area, task}; });
  const orgRows = orgs.map((c, index) => ({index, org:c.key}));
  const m = weekMaterial(model, rows, orgRows, {});
  const out = new Map();
  const put = (cell, list) => { const have = new Set(cell.lines.map(strip)); out.set(cell.id, list.filter(x => !have.has(strip(x.text)))); };
  summary.forEach((c, i) => put(c, m.byRow.get(i) ?? []));
  orgs.forEach((c, i) => put(c, m.byOrg.get(i) ?? []));
  // CAL-조직참고캘린더: 내 프로필에서 고른 조직 칸에만 캘린더 추천(상자 rawMaterial 과 같은 줄·같은 열쇠).
  const refs = model?.orgRefs, section = refs?.org ? (model?.orgs?.sections ?? []).find(s => s.id === refs.org) : null;
  if (section && refs.items?.length) {
    const cell = orgs.find(c => matchOrg(c.key, [{id:section.id, name:section.name, aliases:[]}]));
    if (cell) out.set(cell.id, [...(out.get(cell.id) ?? []), ...refs.items.filter(item => !orgRefIn(cell.lines, item)).map(item => ({day:'', text:orgRefLine(item), orgRef:true, orgId:section.id, src:'calendar'}))]);
  }
  return out;
}
const describe = (c) => x => ({kind:x.orgRef ? 'calendar' : 'material', from:x.src ?? (x.summary ? 'ai' : 'record'), cell:x.orgRef ? `orgref:${x.orgId}` : cellName(c.section, c.key, c.n),
  org:c.section === 'summary' ? '' : x.from ?? '', text:`${x.day ? `${shortDay(x.day)} ` : ''}${lineOf(x.text)}`});

// slot: 그 칸 묶음 자리. ctx = {section, start, row(그 주 행 {exists, draft, saved_at} | null), status('ok'|'loading'|'missing'|'failed'),
//   model(weeklySummary), rt, onSaved(row), redraw(), prepare(): 바탕을 여는 쪽(상자) 깨우기, preparing: 바탕 여는 중}
export function paintFlowCells(slot, ctx) {
  if (!slot) return;
  const doc = slot.ownerDocument, root = slot.closest('[data-journal-weekly-root]') ?? slot.closest('.journal-weekly-body') ?? slot;
  let ui = uiOf.get(root);
  if (!ui || ui.start !== ctx.start) { ui = freshUi(ctx.start); uiOf.set(root, ui); }
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (text, data, cls = 'mini') => { const b = el('button', cls, text); b.type = 'button'; Object.assign(b.dataset, data); return b; };
  const {section, row} = ctx, draft = row?.draft ?? null, proposed = readProposed(draft?.proposed);
  slot.dataset.flowSection = section;
  if (ctx.status === 'loading') { slot.replaceChildren(waitEl({rows:2})); return; }
  if (ctx.status === 'missing') { slot.replaceChildren(el('p', 'journal-muted', '임시저장 칸이 아직 준비 전이에요. 칸 줄은 한글 파일을 만들 때 바탕 그대로 들어가요.')); return; }
  if (ctx.status === 'failed') { const p = el('p', 'wait-fail journal-failed', '그 주 임시저장을 불러오지 못했어요. '); p.append(btn('다시', {flowReload:''}, 'wait-retry')); slot.replaceChildren(p); return; }
  const areaNames = ctx.model?.summary?.names ?? [];
  let cells = flowCells(draft, section);
  if (!proposed && !cells.length) {
    // 그 주 처음: 바탕(지난주 개인본, 없으면 팀 확정본)을 한 번 열어 칸을 만든다(상자가 연다 — 한 번 열면 그다음은 draft 만 읽음).
    // 바탕을 여는 동안은 공용 가는 줄(wait-state.js), 못 열었으면 까닭 한 줄.
    const p = ctx.baseNote ? el('p', 'journal-muted', ctx.baseNote) : waitEl({rows:2}); p.dataset.flowNoBase = '';
    slot.replaceChildren(p); ctx.prepare?.(); return;
  }
  // 2. 1) 요약: 내 사업영역 칸 전부(바탕에 내 줄이 없던 사업영역은 빈 칸으로 뒤에).
  if (section === 'summary') cells = summaryCells(draft, areaNames);
  // 투쟁 사업장: 구성(이번 주 것, 없으면 지난주 구성)대로 들어간 사업장만(뺀 사업장은 목록 없이 [+ 사업장 추가]에서 다시 고름).
  let siteOptions = [];
  if (section === 'sites') {
    const own = draftSiteLayout(draft);
    if (!own && ui.carried.start !== ctx.start) {
      ui.carried = {start:ctx.start, status:'loading', layout:null};
      readCarriedLayout(ctx.start, ctx.rt).then(l => { if (ui.carried.start === ctx.start) { ui.carried = {start:ctx.start, status:'ok', layout:l}; ctx.redraw?.(); } });
    }
    const layout = own ?? ui.carried.layout;
    cells = siteCells(draft, layout);
    const rows = cells.map((c, index) => ({index, org:c.key}));
    cells = arrangeSites(rows, layout).shown.map(r => cells[r.index]);
    // [+ 사업장 추가]: 내 담당 조직(4번 칸 이름) 가운데 지금 칸에 없는 것(뺀 사업장 포함 — 넣으면 적어 둔 글이 돌아옴).
    const taken = new Set(cells.map(c => siteKey(c.key)));
    siteOptions = flowCells(draft, 'orgs').map(c => c.key).filter(n => !taken.has(siteKey(n)));
  }
  // 제안 재료(draft.mjs weekMaterial — 무거워서 처음 쓸 때 한 번 가져옴).
  if (section !== 'sites' && !ui.mat && !ui.matFlight) ui.matFlight = import('./weekly-hwpx/draft.mjs').then(m => { ui.mat = m.weekMaterial; ui.matFlight = null; ctx.redraw?.(); }, () => { ui.matFlight = null; });
  const material = section !== 'sites' && ui.mat && ctx.model ? flowMaterial(ui.mat, ctx.model, draft) : new Map();
  const picks = draft?.picks ?? null;
  const opts = {dropped:droppedOf(picks), kept:keptOf(picks), learn:learnFor(ctx.start, picks, {rt:ctx.rt, redraw:ctx.redraw}).learn};
  const parts = [];
  const team = ctx.team instanceof Map ? ctx.team : null;
  const inBase = new Set((proposed?.cells ?? []).map(x => cellId(x.section, x.key, x.n)));
  // 내 사업영역 칸(빈 칸으로 더한 것)은 바탕에 없어도 한글 파일에 들어간다(journal-hwpx.js 가 내 줄을 더함).
  const areaKeys = new Set(areaNames.map(areaCellKey));
  // 바탕 칸 글(이번 주에 손대지 않은 칸 = 지난주 보고서 줄 그대로). AI 초안이 들어간 바탕이면 지난주 글인지 모르므로 표시하지 않는다.
  const baseLines = new Map(proposed && !proposed.ai ? proposed.cells.map(x => [cellId(x.section, x.key, x.n), x.lines.filter(l => String(l).trim())]) : []);
  const touched = new Set((draft?.rows ?? []).map(r => cellId(r.section, r.key, r.n)));
  if (section === 'sites') {
    const list = el('div', 'weekly-flow-sites'); list.dataset.reorderList = 'sites';
    cells.forEach(c => list.append(cellBox(c, [])));
    parts.push(list);
    if (ui.siteNote) { const p = el('p', 'journal-line-status', ui.siteNote); p.dataset.flowSiteNote = ''; p.setAttribute('role', 'status'); parts.push(p); }
  } else for (const c of cells) parts.push(cellBox(c, material.get(c.id) ?? []));
  if (!cells.length) parts.push(emptyEl(section === 'sites' ? '넣은 사업장이 없어요' : '내 칸이 없어요'));
  if (section === 'sites') {
    const bar = el('div', 'weekly-flow-site-add');
    const add = btn('+ 사업장 추가', {flowSiteAdd:''}, 'journal-part-add-button'); add.disabled = !siteOptions.length || !!ui.busy; add.setAttribute('aria-expanded', String(!!ui.siteAdding));
    bar.append(add);
    if (ui.siteAdding && siteOptions.length) {
      const pick = el('select', 'journal-hwpx-target'); pick.dataset.flowSitePick = ''; pick.setAttribute('aria-label', '넣을 사업장(내 담당 조직)');
      const none = el('option', '', '사업장 고르기'); none.value = ''; pick.append(none);
      for (const n of siteOptions) { const o = el('option', '', n); o.value = n; pick.append(o); }
      bar.append(' ', pick);
    }
    parts.push(bar);
  }
  slot.replaceChildren(...parts);
  if (!slot.dataset.flowWired) wire();
  if (ui.focusLine && !ui.busy && section !== 'sites') { const k = ui.focusLine; ui.focusLine = null; [...slot.querySelectorAll('li[data-flow-line-id]')].find(n => n.dataset.flowLineId === k)?.querySelector('[data-flow-line-grip]')?.focus(); }
  if (ui.focusSite && !ui.busy && section === 'sites') { const name = ui.focusSite; ui.focusSite = null; [...slot.querySelectorAll('[data-reorder-id]')].find(n => n.dataset.reorderId === name)?.querySelector('[data-reorder-handle]')?.focus(); }

  function cellBox(c, list) {
    const box = el('div', 'weekly-flow-cell'); box.dataset.flowCell = c.id;
    const head = el('div', 'weekly-flow-name');
    const name = el('span', 'weekly-flow-label');
    if (section === 'summary') { const [area, task] = c.key.split('›'); name.append(el('b', null, area || '—'), ` › ${task || '—'}${c.n ? ` (${c.n + 1}번째)` : ''}`); }
    else name.append(el('b', null, labelOf(section, c.key, c.n)));
    head.append(name);
    // 이 주 기록이 없는 칸이 지난주 보고서 줄 그대로면 작은 '지난주에서'(1) 임원 배정 요청과 같은 표시, 화면에만).
    if (section === 'summary' && !list.length && c.lines.length && !touched.has(c.id) && baseLines.has(c.id)) {
      const tag = el('span', 'journal-exec-carried', CARRIED_TAG); tag.dataset.flowCarried = ''; tag.title = '이 주 기록이 없어 지난주 보고서 줄 그대로예요'; head.append(tag);
    }
    const busy = !!ui.busy;
    const add = btn('+ 추가', {flowAdd:c.id}, 'journal-part-add-button'); add.disabled = busy; add.setAttribute('aria-label', `${labelOf(section, c.key, c.n)} 칸에 줄 추가`);
    head.append(add);
    if (section === 'sites') {
      box.dataset.reorderId = c.key;
      const grip = btn('⠿', {reorderHandle:''}, 'mini journal-hwpx-grip'); grip.setAttribute('aria-label', `${c.key} 순서 옮기기(위·아래 화살표)`); grip.disabled = busy;
      head.prepend(grip);
      head.append(rowMore(doc, {label:`${c.key} 사업장 칸 메뉴`, data:{flowSiteMore:c.key}, items:[{text:'이번 주 보고에서 빼기', data:{flowSiteHide:c.key}, disabled:busy}]}));
    }
    box.append(head);
    // 바탕이 바뀌어 이름이 맞는 칸이 없는 고친 칸: 버리지 않고 보이되, 한글 파일에는 들어가지 않는다고 한 줄.
    if (proposed && section !== 'sites' && !inBase.has(c.id) && !(section === 'summary' && areaKeys.has(c.key))) { const p = el('p', 'journal-muted weekly-flow-orphan', '바탕에 없는 칸 — 파일에는 안 들어가요'); p.dataset.flowOrphan = ''; box.append(p); }
    // 바탕이 내 개인본이고 그보다 나중 팀 확정본에서 이 칸 글이 다르면 작은 '확정본에서 바뀜'(눌러 그 글 보기·[이 글로 바꾸기], 참고용).
    const theirs = team?.get(c.id);
    if (theirs && theirs.map(strip).filter(Boolean).join('\n') !== c.lines.map(strip).filter(Boolean).join('\n')) {
      const fold = el('details', 'journal-hwpx-team-fold weekly-flow-team'); fold.dataset.flowTeam = c.id;
      const mark = el('summary', 'journal-exec-carried', '확정본에서 바뀜'); mark.title = `팀 확정본${ctx.teamTitle ? `(${ctx.teamTitle})` : ''}에서 이 칸 글이 달라요`;
      const use = btn('이 글로 바꾸기', {flowTeamUse:c.id}); use.disabled = busy;
      fold.append(mark, el('p', 'journal-muted', theirs.join(' / ') || '(빈 칸)'), use);
      box.append(fold);
    }
    const ul = el('ul', 'weekly-flow-lines');
    // 끌기(2. 1) 요약·4. 산하 조직): 칸마다 목록 하나(data-flow-line-list = 칸), 줄마다 열쇠 '칸 id\u0001번호'. 투쟁 사업장은 칸째 옮기므로 줄 끌기 없음.
    const canMove = section !== 'sites';
    if (canMove) ul.dataset.flowLineList = ul.dataset.reorderList = c.id; // reorder-drag.js 는 놓은 칸을 data-reorder-list 로 알린다
    const addRow = () => { const li = el('li'); li.dataset.flowAddRow = ''; li.append(editForm(c.id, ui.addValue ?? '', {flowAddSave:c.id}, ui.addAt >= 0 ? '아래에 줄 추가' : '줄 추가')); return li; };
    c.lines.forEach((text, i) => {
      const li = el('li'); li.dataset.flowLine = String(i);
      if (canMove) li.dataset.flowLineId = li.dataset.reorderId = `${c.id}\u0001${i}`; // reorder-drag.js 는 data-reorder-id 로 줄을 안다
      if (ui.editing?.cell === c.id && ui.editing.index === i) { li.append(editForm(c.id, ui.editing.value ?? text, {flowFixSave:c.id}, '줄 고치기')); ul.append(li); return; }
      if (canMove) { const grip = btn('⠿', {flowLineGrip:'', reorderHandle:''}, 'mini journal-hwpx-grip weekly-flow-grip'); grip.setAttribute("aria-label", `줄 자리 바꾸기(끌기·위아래 화살표): ${text}`); grip.disabled = busy || !!ui.editing || !!ui.adding; li.append(grip); }
      // 줄을 고르면(누름·초점) 잠시 뒤 그 칸 줄만 AI 에 묻고 칸 아래 흐린 'AI 제안' 줄(weekly_line). 고르기만 해서는 아무것도 바뀌지 않는다.
      const t = el('span', 'weekly-flow-text', text); t.tabIndex = 0; t.dataset.flowPickLine = String(i); li.append(t);
      li.append(rowMore(doc, {label:`줄 고치기·빼기: ${text}`, data:{flowLineMore:''}, items:[
        {text:'고치기', data:{flowFix:c.id, flowIndex:String(i)}, disabled:busy},
        {text:'아래에 줄 추가', data:{flowAddBelow:c.id, flowIndex:String(i)}, disabled:busy, aria:`이 줄 아래에 줄 추가: ${text}`},
        {text:'빼기', data:{flowCut:c.id, flowIndex:String(i)}, disabled:busy, danger:true, aria:`이번 주 보고에서 빼기: ${text}`}]}));
      ul.append(li);
      if (ui.adding === c.id && ui.addAt === i + 1) ul.append(addRow());
    });
    if (!c.lines.length) { const li = el('li', 'weekly-flow-empty', '빈 칸'); li.dataset.flowEmpty = ''; ul.append(li); }
    if (ui.adding === c.id && !(ui.addAt >= 1 && ui.addAt <= c.lines.length)) ul.append(addRow());
    box.append(ul);
    // 제안: 받은 종류부터, 뺀 것은 접힌 '뺀 제안 n개'에서 다시 넣기. 고른 줄의 AI 줄 제안이 있으면 맨 앞.
    const sorted = sortPicks([...lineSuggestions(c), ...list], x => x.lineAi ? {kind:'ai_line', from:'ai', cell:cellName(c.section, c.key, c.n), org:'', text:`${x.before}→${x.text}`} : describe(c)(x), opts);
    if (sorted.shown.length) {
      const sg = el('ul', 'weekly-flow-lines weekly-flow-suggest'); sg.dataset.flowSuggest = c.id;
      for (const x of sorted.shown) {
        const ai = !!x.raw.lineAi, item = ai ? {kind:'ai_line', from:'ai', cell:x.cell, org:'', text:x.raw.text, before:x.raw.before, line:x.raw.before, key:x.key} : {kind:x.kind, from:x.from, cell:x.cell, org:x.org, text:x.text, key:x.key};
        const text = x.raw.text.startsWith('-') || ai ? x.raw.text : `- ${lineOf(x.raw.text)}`;
        const li = el('li'); li.dataset.flowSuggestItem = x.key; li.dataset.flowPick = JSON.stringify(item); li.dataset.flowText = text;
        if (ai) { li.dataset.flowLineSuggest = String(x.raw.index); li.dataset.flowIndex = String(x.raw.index); }
        if (ui.taking?.key === x.key) { li.append(editForm(c.id, ui.taking.value ?? text, {flowEditSave:c.id}, '고쳐서 넣기')); sg.append(li); continue; }
        // [빼기]를 누르면 그 자리에 작은 한 줄 '이유(안 써도 돼요)' + [빼기 확인](요청함 11/01 23:42). 빈 칸이면 그냥 빠진다.
        if (ui.dropping?.key === x.key) { li.append(el('span', 'weekly-flow-text', ai ? `${x.raw.index + 1}번째 줄 → ${x.raw.text}` : x.text), ' ', whyForm(c.id, x.text)); sg.append(li); continue; }
        li.append(el('span', 'weekly-flow-tag', TAG[ai ? 'line' : x.raw.orgRef ? 'calendar' : x.from] ?? '기록'), el('span', 'weekly-flow-text', ai ? `${x.raw.index + 1}번째 줄 → ${x.raw.text}` : x.text));
        const take = btn('넣기', {flowTake:c.id}, 'mini weekly-flow-take'); take.disabled = busy; take.setAttribute('aria-label', ai ? `${x.raw.index + 1}번째 줄을 이렇게 바꾸기: ${x.raw.text}` : `넣기: ${x.text}`);
        li.append(take, rowMore(doc, {label:`제안 고쳐서 넣기·빼기: ${x.text}`, data:{flowSuggestMore:''}, items:[
          {text:'고쳐서 넣기', data:{flowEdit:c.id}, disabled:busy}, {text:'빼기', data:{flowDrop:c.id}, disabled:busy, danger:true, aria:`제안 빼기: ${x.text}`}]}));
        sg.append(li);
      }
      box.append(sg);
    }
    if (sorted.gone.length) {
      const fold = el('details', 'journal-org-raw weekly-flow-gone'); fold.dataset.flowGone = String(sorted.gone.length);
      fold.append(el('summary', null, `뺀 제안 ${sorted.gone.length}`));
      const gl = el('ul', 'weekly-flow-lines');
      for (const g of sorted.gone) { const li = el('li'); li.dataset.flowPick = JSON.stringify({kind:g.kind, from:g.from, cell:g.cell, org:g.org, text:g.text, key:g.key}); li.append(el('span', 'weekly-flow-text', g.text), ' ', btn('다시 넣기', {flowPut:c.id})); gl.append(li); }
      fold.append(gl); box.append(fold);
    }
    if (ui.undo?.cell === c.id) { const p = el('p', 'journal-line-status'); p.dataset.flowUndo = ''; p.setAttribute('role', 'status'); p.append('줄을 뺐어요 ', btn('되돌리기', {flowUndo:c.id})); box.append(p); }
    if (ui.failed?.cell === c.id) { const p = el('p', 'journal-line-status journal-failed', `저장 못 함 — ${ui.failed.text} `); p.dataset.flowFailed = ''; p.setAttribute('role', 'alert'); p.append(btn('다시', {flowRetry:c.id})); box.append(p); }
    return box;
  }
  // 고른 줄(ui.line.focus)이 이 칸이면, 받은 줄 제안 가운데 지금 칸 줄에 맞는 것만(그 줄 하나).
  function lineSuggestions(c) {
    const g = ui.line, f = g.focus;
    if (!f || f.cell !== c.id) return [];
    const before = c.lines[f.index], text = before != null ? g.cache.get(suggestKey(c.id, before)) : null;
    return text ? [{lineAi:true, index:f.index, before, text, day:''}] : [];
  }
  // 제안 빼기 이유 한 줄(안 써도 됨). [취소]·[빼기 확인], Enter = 확인, Esc = 취소.
  function whyForm(cell, text) {
    const f = el('span', 'journal-file-edit weekly-flow-edit weekly-flow-why');
    const input = el('input'); input.type = 'text'; input.value = ui.dropping?.value ?? ''; input.maxLength = WHY_MAX; input.placeholder = '이유(안 써도 돼요)';
    input.dataset.flowInput = cell; input.dataset.flowWhy = ''; input.setAttribute('aria-label', `빼는 이유(안 써도 돼요): ${text}`); input.disabled = !!ui.busy;
    const cancel = btn('취소', {flowCancel:cell}); const go = btn('빼기 확인', {flowDropGo:cell}, 'mini primary'); cancel.disabled = go.disabled = !!ui.busy;
    f.append(input, ' ', cancel, go);
    // 다시 그리기가 겹쳐도 새로 그린 칸으로 초점이 가게(그린 칸이 화면에 붙은 뒤 한 번).
    if (ui.dropping?.focus) requestAnimationFrame(() => { if (input.isConnected && ui.dropping?.focus) { input.focus(); ui.dropping.focus = false; } });
    return f;
  }
  function editForm(cell, value, data, aria) {
    const f = el('span', 'journal-file-edit weekly-flow-edit');
    const input = el('input'); input.type = 'text'; input.value = value; input.maxLength = CELL_LINE_MAX; input.dataset.flowInput = cell; input.setAttribute('aria-label', aria); input.disabled = !!ui.busy;
    const cancel = btn('취소', {flowCancel:cell}); const save = btn('저장', data, 'mini primary'); cancel.disabled = save.disabled = !!ui.busy;
    f.append(input, ' ', cancel, save); // UI-저장자리: [취소] 왼쪽, [저장] 맨 오른쪽
    return f;
  }
  function wire() {
    slot.dataset.flowWired = '1';
    // 줄 고르기(누름·초점·Enter) → 잠시 뒤 줄 제안을 묻는다(타자마다 아님).
    const pickLine = event => { const t = event.target.closest?.('[data-flow-pick-line]'), cur = slot.__flow; if (t && cur && slot.contains(t)) cur.pickLine(t); };
    slot.addEventListener('focusin', pickLine);
    slot.addEventListener('click', pickLine);
    if (section === 'sites') slot.__drag = mountReorder(slot, {onDrop:({id, index}) => slot.__flow?.moveSite(id, index), onStep:(id, dir) => slot.__flow?.stepSite(id, dir), canDrag:() => !slot.__flow?.ui.busy});
    else slot.__lineDrag = mountReorder(slot, {listSelector:'ul[data-flow-line-list]', itemSelector:'li[data-flow-line-id]', handleSelector:'[data-flow-line-grip]',
      onDrop:({id, list, index}) => slot.__flow?.moveLine(id, list, index), onStep:(id, dir) => slot.__flow?.stepLine(id, dir),
      canDrag:() => { const u = slot.__flow?.ui; return !!u && !u.busy && !u.editing && !u.adding && !u.taking && !u.dropping; }});
    slot.addEventListener('change', event => { const sel = event.target.closest?.('select[data-flow-site-pick]'); if (sel?.value) slot.__flow?.addSite(sel.value); });
    slot.addEventListener('click', event => {
      const b = event.target.closest('button');
      if (!b || b.disabled || !slot.contains(b)) return;
      const cur = slot.__flow; if (!cur) return;
      cur.click(b);
    });
    slot.addEventListener('keydown', event => {
      const input = event.target.closest?.('input[data-flow-input]');
      if (!input) return;
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); input.parentElement.querySelector('button.primary')?.click(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.parentElement.querySelector('[data-flow-cancel]')?.click(); }
    });
    slot.addEventListener('input', event => {
      const input = event.target.closest?.('input[data-flow-input]'), cur = slot.__flow;
      if (!input || !cur) return;
      const u = cur.ui;
      if (u.editing?.cell === input.dataset.flowInput) u.editing.value = input.value;
      else if (u.adding === input.dataset.flowInput) u.addValue = input.value;
      else if (input.dataset.flowWhy != null && u.dropping) u.dropping.value = input.value;
      else if (u.taking) u.taking.value = input.value;
    });
  }
  // 누르기 처리는 이번 그림의 ctx 로(그릴 때마다 바꿔 끼움).
  slot.__flow = {ui, click:b => onClick(b), pickLine:t => pickLine(t), moveSite:(name, index) => setLayout('move', name, index), stepSite:(name, dir) => stepSite(name, dir), addSite:name => setLayout('show', name),
    moveLine:(id, list, index) => moveLine(id, list, index), stepLine:(id, dir) => stepLine(id, dir)};
  const focusInput = id => requestAnimationFrame(() => slot.querySelector(`input[data-flow-input="${CSS.escape(id)}"]`)?.focus());
  function cellOf(id) { const c = parseCellId(id); return {section:c.section, key:c.key, n:c.n, lines:flowCells(draft, c.section).find(x => x.id === id)?.lines ?? []}; }
  async function write(id, op, {after} = {}) {
    const c = cellOf(id);
    ui.busy = id; ui.failed = null; ctx.redraw?.();
    try {
      const r = op.site ? await changeWeekDocs({start:ctx.start, known:row, change:op.site}, ctx.rt)
        : op.move ? await changeWeekMove({start:ctx.start, known:row, ...op.move}, ctx.rt)
        : await changeWeekCell({start:ctx.start, known:row, section:c.section, key:c.key, n:c.n, ...op}, ctx.rt);
      ui.busy = '';
      if (r.missing) { ui.failed = {cell:id, text:'임시저장 칸이 아직 준비 전이에요.', op}; ctx.redraw?.(); return; }
      after?.(r.row);
      ctx.onSaved?.(r.row);
    } catch (error) {
      ui.busy = ''; ui.failed = {cell:id, text:/[가-힣]/.test(error?.message ?? '') ? error.message : '잠시 뒤 다시 눌러 주세요.', op};
      ctx.redraw?.();
    }
  }
  // ---- 줄 제안(weekly_line, docs/design/weekly-one-flow.md 3.2절) ----
  // 고른 칸 하나의 줄만, 이미 받은 줄은 다시 묻지 않는다([주간 정리]를 한 번 열 때 LINE_PER_OPEN 번까지). 서버가 없거나(배포 전) 한 번 실패하면 조용히 끈다.
  // 이 칸 줄 제안을 계속 거절했으면(주간보고 기억) 묻지 않는다. 줄 글은 로그·오류 보고에 넣지 않는다.
  function pickLine(t) {
    const box = t.closest('[data-flow-cell]'), id = box?.dataset.flowCell, index = Number(t.dataset.flowPickLine), g = ui.line;
    if (!id || !Number.isInteger(index)) return;
    const was = g.focus;
    g.focus = {cell:id, index};
    if (was?.cell !== id || was?.index !== index) ctx.redraw?.();
    clearTimeout(g.timer);
    g.timer = setTimeout(() => void askLine(id, index), PICK_MS);
  }
  async function askLine(id, index) {
    const g = ui.line, c = flowCells(draft, parseCellId(id).section).find(x => x.id === id);
    if (!c || g.focus?.cell !== id || g.focus.index !== index || g.off || g.flight || g.asked >= LINE_PER_OPEN || ui.start !== ctx.start) return;
    if (opts.learn.blocks?.({kind:'ai_line', from:'ai', cell:cellName(c.section, c.key, c.n)})) return;
    const targets = askTargets(c.lines, index, g.cache, id);
    if (!targets.length) return;
    const mat = (material.get(id) ?? []).map(x => `${x.day ? `${shortDay(x.day)} ` : ''}${lineOf(x.text)}`);
    const {request, refs} = lineRequest({week:ctx.start, where:whereOf(id), lines:c.lines, targets, material:mat});
    g.asked++; g.flight = true;
    let r;
    try { r = await callAiAssist(request, {rt:ctx.rt}, LINE_TEXT); } catch { r = {ok:false}; }
    g.flight = false;
    if (ui.start !== ctx.start) return;
    if (!r?.ok || r.data?.kind !== 'weekly_line' || r.data.week_start !== ctx.start) { g.off = true; return; }
    for (const [k, v] of readAnswer(r.data, refs, c.lines, id)) g.cache.set(k, v);
    ctx.redraw?.();
  }
  // ---- 줄 끌기(WEEKLY-줄끌기): 같은 칸 안·같은 묶음 다른 칸. 쓰기 한 번(changeWeekMove — 두 칸을 한 draft 로) ----
  function lineRef(id) { const at = String(id).lastIndexOf('\u0001'); return at < 0 ? null : {cell:id.slice(0, at), index:Number(id.slice(at + 1))}; }
  function moveLine(id, toCell, index) {
    const from = lineRef(id);
    if (!from || !toCell || ui.busy || !Number.isInteger(from.index)) return;
    const a = parseCellId(from.cell), b = parseCellId(toCell);
    if (a.section !== section || b.section !== section) return;
    ui.focusLine = `${toCell}\u0001${index}`; // 다시 그린 뒤 옮긴 줄의 손잡이로 초점(키보드로 이어서 옮기기)
    void write(from.cell, {move:{from:{...a, index:from.index}, to:{...b, index}}});
  }
  // 키보드: 위·아래 한 칸. 칸 맨 위에서 위로 → 앞 칸 끝, 맨 아래에서 아래로 → 다음 칸 맨 앞.
  function stepLine(id, dir) {
    const from = lineRef(id); if (!from) return;
    const list = cells.map(c => c.id), at = list.indexOf(from.cell), count = cells[at]?.lines.length ?? 0;
    if (at < 0) return;
    const next = from.index + dir;
    if (next >= 0 && next < count) { moveLine(id, from.cell, next); return; }
    const other = cells[at + dir]; if (!other) return;
    moveLine(id, other.id, dir < 0 ? other.lines.length : 0);
  }
  // ---- 투쟁 사업장 구성(⠿ 순서·[+ 사업장 추가]·빼기) — 모두 draft.site_layout 한 번 쓰기 ----
  function siteRowsNow() { const layout = draftSiteLayout(draft) ?? ui.carried.layout, all = siteCells(draft, layout); return {all, layout, rows:all.map((c, index) => ({index, org:c.key}))}; }
  function setLayout(how, name, index = Infinity) {
    if (ui.busy) return;
    const {all, layout, rows} = siteRowsNow(), at = new Date().toISOString();
    // 바탕에 없는 사업장을 넣으면 그 이름이 구성에 들어가 빈 칸으로 생긴다(siteCells).
    const withName = rows.some(r => siteKey(r.org) === siteKey(name)) ? rows : [...rows, {index:rows.length, org:name}];
    const next = how === 'hide' ? siteHidden(withName, layout, name, at) : how === 'show' ? siteShown(withName, layout, name, at, index) : siteMoved(withName, layout, name, index, at);
    const id = all.find(c => siteKey(c.key) === siteKey(name))?.id ?? cellId('sites', name, 0);
    ui.siteAdding = false;
    ui.siteNote = how === 'show' ? `${name}${particle(name)} 넣었어요.` : how === 'hide' ? `${name}${particle(name)} 뺐어요. [+ 사업장 추가]에서 다시 넣을 수 있어요.` : '';
    void write(id, {site:dr => withSiteLayout(dr, next)});
  }
  function stepSite(name, dir) {
    const {layout, rows} = siteRowsNow(), shown = arrangeSites(rows, layout).shown, at = shown.findIndex(r => siteKey(r.org) === siteKey(name));
    if (at < 0) return;
    ui.focusSite = name; // 쓰기가 끝나 다시 그린 뒤 그 손잡이로 초점(키보드로 이어서 옮기기)
    setLayout('move', name, Math.max(0, at + dir));
  }
  function onClick(b) {
    const d = b.dataset, li = b.closest('li'), pick = () => JSON.parse(li?.dataset.flowPick || 'null');
    if (d.flowReload !== undefined) { ctx.reload?.(); return; }
    if (d.flowSiteAdd !== undefined) { ui.siteAdding = !ui.siteAdding; ctx.redraw?.(); if (ui.siteAdding) requestAnimationFrame(() => slot.querySelector('select[data-flow-site-pick]')?.focus()); return; }
    if (d.flowTeamUse) { const lines = team?.get(d.flowTeamUse); if (lines) void write(d.flowTeamUse, {act:'none', lines:[...lines]}); return; }
    if (d.flowCancel !== undefined) { ui.editing = null; ui.adding = null; ui.addAt = -1; ui.addValue = ''; ui.taking = null; ui.dropping = null; ctx.redraw?.(); return; }
    if (d.flowFix) { ui.editing = {cell:d.flowFix, index:Number(d.flowIndex), value:null}; ui.adding = null; ui.taking = null; ui.dropping = null; ctx.redraw?.(); focusInput(d.flowFix); return; }
    if (d.flowAdd) { ui.adding = d.flowAdd; ui.addAt = -1; ui.addValue = ''; ui.editing = null; ui.taking = null; ui.dropping = null; ctx.redraw?.(); focusInput(d.flowAdd); return; }
    if (d.flowAddBelow) { ui.adding = d.flowAddBelow; ui.addAt = Number(d.flowIndex) + 1; ui.addValue = ''; ui.editing = null; ui.taking = null; ui.dropping = null; ctx.redraw?.(); focusInput(d.flowAddBelow); return; }
    if (d.flowEdit) { const it = pick(); ui.taking = {cell:d.flowEdit, key:it.key, value:null}; ui.editing = null; ui.adding = null; ui.dropping = null; ctx.redraw?.(); focusInput(d.flowEdit); return; }
    const value = () => String(b.parentElement.querySelector('input[data-flow-input]')?.value ?? '').trim();
    if (d.flowFixSave) { const v = value(); if (!v) return; const index = ui.editing.index; void write(d.flowFixSave, {act:'fix', index, text:v}, {after:() => { ui.editing = null; }}); return; }
    if (d.flowAddSave) { const v = value(); if (!v) return; const at = ui.addAt; void write(d.flowAddSave, {act:'add', text:v.startsWith('-') ? v : `- ${v}`, ...(at >= 0 ? {insertAt:at} : {})}, {after:() => { ui.adding = null; ui.addAt = -1; ui.addValue = ''; }}); return; }
    if (d.flowEditSave) { const v = value(); if (!v) return; const it = pick(), index = li?.dataset.flowIndex != null ? Number(li.dataset.flowIndex) : -1; void write(d.flowEditSave, {act:'edit', text:v.startsWith('-') ? v : `- ${v}`, item:it, index}, {after:() => { ui.taking = null; }}); return; }
    if (d.flowTake) {
      const it = pick(), index = li.dataset.flowIndex != null ? Number(li.dataset.flowIndex) : -1;
      void write(d.flowTake, {act:'take', text:li.dataset.flowText, item:it, index}, {after:() => { if (it?.kind === 'ai_line') ui.line.cache.set(suggestKey(d.flowTake, li.dataset.flowText), null); }});
      return;
    }
    if (d.flowDrop) { const it = pick(); ui.dropping = {cell:d.flowDrop, key:it.key, item:it, value:'', focus:true}; ui.editing = null; ui.adding = null; ui.taking = null; ctx.redraw?.(); return; }
    if (d.flowDropGo) {
      const u = ui.dropping; if (!u) return;
      const why = String(b.parentElement.querySelector('input[data-flow-why]')?.value ?? '').trim();
      void write(d.flowDropGo, {act:'drop', item:{...u.item, ...(why ? {why} : {})}}, {after:() => { ui.dropping = null; }});
      return;
    }
    if (d.flowPut) { void write(d.flowPut, {act:'none', item:pick()}); return; }
    if (d.flowCut) {
      const id = d.flowCut, index = Number(d.flowIndex), before = cellOf(id).lines, text = before[index];
      const c = cellOf(id);
      void write(id, {act:'cut', index}, {after:next => {
        clearTimeout(ui.undo?.timer);
        ui.undo = {cell:id, lines:before, key:lineKey({section:c.section, key:c.key, n:c.n, text}), timer:setTimeout(() => { if (ui.undo?.cell === id) { ui.undo = null; ctx.redraw?.(); } }, UNDO_MS)};
        ui.undo.item = lineDone(next?.draft, ui.undo.key);
      }});
      return;
    }
    if (d.flowUndo) { const u = ui.undo; if (!u) return; clearTimeout(u.timer); ui.undo = null; void write(d.flowUndo, {act:'none', lines:u.lines, item:u.item}); return; }
    if (d.flowRetry) { const f = ui.failed; if (f?.op) void write(f.cell, f.op); return; }
    if (d.flowSiteHide !== undefined) setLayout('hide', d.flowSiteHide);
  }
}
export {pickKey};
