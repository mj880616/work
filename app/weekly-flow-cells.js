// WEEKLY-한흐름확정 ② 화면(docs/design/weekly-one-flow.md 4.1절, 시안 안 B): [주간 정리] 2. 1) 요약 · 3. 2) 투쟁 사업장 현황 · 4. 산하 조직 현황의
// '보고서 칸'을 그 주 임시저장(draft) 한 벌에서 그린다. 보이는 줄 = 한글 파일에 들어갈 줄(weekly-draft-store.js weekCells: 바탕 proposed 위에 고친 rows).
// - 줄 끝 작은 ⋯ → [고치기]·[빼기], 칸 이름 줄 오른쪽 작은 [+ 추가]. 같은 주제인데 이름 부호만 다른 칸은 한 칸(weekly-draft-store.js weekCells).
// - RECORD-한줄 B-5(docs/design/record-one.md 5절): 칸 아래 제안 다섯 종류([넣기]·[이미 있음]·[수정해서 넣기]·[빼기], 'AI 제안' 줄 = ai-assist weekly_line,
//   '지난주에서' 사업영역 제안)는 지웠다 — 전환 주부터 2. 1)·4.·3. 2) 안쪽은 기록 창이 그린다. 지난 동작 기록(draft.picks)은 지우지 않고 그대로 둔다.
// - 누름 한 번 = 서버 쓰기 한 번(changeWeekCell: rows + picks 를 한 PATCH). 실패하면 그 칸에 "저장 못 함 [다시]", 화면 값은 그대로.
// - 투쟁 사업장 칸 구성(이번 주 보고에서 빼기·[+ 사업장 추가])은 draft.site_layout(없으면 지난주 구성을 이어 씀)에 쓴다.
//   WEEKLY-뺀목록삭제(빠짐2·요청함 11/01 23:43): 뺀 사업장 접힌 목록과 [다시 넣기]는 없앴다 — 뺀 사업장은 [+ 사업장 추가] 고르기 목록에 나온다.
// - WEEKLY-줄끌기(요청함 11/01 23:39): 2. 1) 요약·4. 산하 조직 칸 줄은 줄 앞 ⠿ 로 끌어 같은 칸 안 다른 자리나 같은 묶음의 다른 칸으로 옮긴다(폰은 줄을 길게 눌러,
//   키보드는 ⠿ 에서 위·아래 — reorder-drag.js). 줄 ⋯ 의 [아래에 줄 추가]로 그 줄 바로 아래에 더한다. 줄 번호는 늘 보이는 줄 기준(weekly-draft-store.js visibleLines).
// - 칸 하나의 그리기 주인은 이 모듈 하나(journal.js는 자리만 주고 다시 그릴 때 부른다). AI 를 부르지 않는다. 브라우저 저장소에 아무것도 두지 않는다.
import {weekCells, parseCellId, cellId, summaryKey, changeWeekCell, changeWeekDocs, changeWeekMove, withSiteLayout, draftSiteLayout, readCarriedLayout, lineDone, lineKey, visibleLines, CELL_LINE_MAX} from './weekly-draft-store.js';
import {areaInKeys, inSites, SITE_REF_LINE} from './weekly-cell-names.mjs';
import {arrangeSites, siteHidden, siteShown, siteMoved, siteKey, readSiteLayout} from './weekly-schedule-rows.mjs';
import {mountReorder} from './reorder-drag.js';
import {readProposed} from './weekly-feedback.mjs';
import {rowMore} from './row-more.js';
import {CARRIED_TAG} from './weekly-exec-requests.js';
import {emptyEl, waitEl} from './wait-state.js';
import {lineField, fitAll} from './auto-grow.js'; // UI-줄입력늘어나기: 긴 글 한 줄 칸 = 글만큼 늘어나는 공용 칸

export const FLOW_SECTIONS = Object.freeze(['summary', 'sites', 'orgs']);
const UNDO_MS = 5000;
// 화면 상태(기기 메모리만): 고치는 줄·더하는 칸·쓰는 중·실패·되돌리기.
const uiOf = new WeakMap();
const freshUi = start => ({start, editing:null, adding:null, addAt:-1, busy:'', failed:null, undo:null, carried:{start:'', status:'', layout:null}, siteNote:'', siteAdding:false});

const particle = name => { const code = String(name).charCodeAt(String(name).length - 1); return code >= 0xAC00 && code <= 0xD7A3 ? ((code - 0xAC00) % 28 ? '을' : '를') : '을(를)'; };
const lineOf = s => String(s ?? '').replace(/^\s*-\s*/, '').trim();
const strip = s => lineOf(s).replace(/\s+/g, '').toLowerCase();
const labelOf = (section, key, n) => `${section === 'summary' ? key.split('›').map(x => x || '—').join(' › ') : key}${n ? ` (${n + 1}번째)` : ''}`;

// 그 주 draft 의 칸 목록(바탕 순서, 고친 칸만 있는 칸은 뒤에). [{id, section, key, n, lines}]
export function flowCells(draft, section) {
  const out = [];
  for (const [id, lines] of weekCells(draft)) { const c = parseCellId(id); if (c.section === section) out.push({id, ...c, lines:visibleLines(lines)}); }
  return out;
}
// S52-25 WEEKLY-투쟁사업장참고: 지금 '3. 투쟁 사업장 현황'에 들어간 사업장 이름(구성 = 이번 주 것, 없으면 읽어 둔 지난주 구성 — 3장 칸과 같은 계산).
// slot = 주간 정리 안 아무 칸 자리(같은 화면 상태를 씀), row = 그 주 임시저장 행. 아직 그리기 전이면 draft 구성만으로.
export function shownSiteNames(slot, row) {
  const draft = row?.draft ?? null; if (!draft) return [];
  const root = slot?.closest?.('[data-journal-weekly-root]') ?? slot?.closest?.('.journal-weekly-body') ?? slot, ui = root ? uiOf.get(root) : null;
  return siteNamesOf(draft, draftSiteLayout(draft) ?? ui?.carried?.layout ?? null);
}
function siteNamesOf(draft, layout) {
  const cells = siteCells(draft, layout);
  return arrangeSites(cells.map((c, index) => ({index, org:c.key})), layout).shown.map(r => r.org);
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
// S52-24: 사업영역 이름이 칸의 사업영역 이름이나 세부 과제 이름(예: '의제 › 주제/A')과 부호·띄어쓰기만 다르면 이미 있는 칸이다(weekly-cell-names.mjs areaInKeys).
export const areaCellKey = name => summaryKey({area:name, task:''});
export function summaryCells(draft, names = []) {
  const cells = flowCells(draft, 'summary');
  const keys = cells.map(c => c.key);
  for (const name of names ?? []) {
    if (!String(name ?? '').trim() || areaInKeys(name, keys)) continue;
    const key = areaCellKey(name); keys.push(key);
    cells.push({id:cellId('summary', key, 0), section:'summary', key, n:0, lines:[], added:true});
  }
  return cells;
}
// STAB-주간정리4장다시그림: 3장 사업장 구성이 정해졌는지 — 이번 주 구성이 있거나, 이어 쓸 지난 구성을 다 읽었거나, 3장이 구성을 읽지 않는 때(바탕 전).
// 4장 조직보고 창은 이 구성으로 '참고' 줄을 고르므로 정해지기 전에는 그리지 않고, 정해지면(읽기 끝 → 다시 그리기 한 번) 한 번에 그린다.
export function siteLayoutSettled(slot, row, start) {
  const draft = row?.draft ?? null; if (!draft || draftSiteLayout(draft)) return true;
  if (!readProposed(draft.proposed) && !flowCells(draft, 'sites').length) return true;
  const root = slot?.closest?.('[data-journal-weekly-root]') ?? slot?.closest?.('.journal-weekly-body') ?? slot, ui = root ? uiOf.get(root) : null;
  return !!ui && ui.start === start && ui.carried.start === start && ui.carried.status === 'ok';
}

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
    cells.forEach(c => list.append(cellBox(c)));
    parts.push(list);
    if (ui.siteNote) { const p = el('p', 'journal-line-status', ui.siteNote); p.dataset.flowSiteNote = ''; p.setAttribute('role', 'status'); parts.push(p); }
  } else {
    // S52-25 WEEKLY-투쟁사업장참고: 4장(표 준비 전 칸 줄)에서 3장에 들어간 조직 칸은 '참고' 한 줄(제안 없음). 쓴 줄은 지우지 않고 접어 보인다.
    const sitesNow = section === 'orgs' ? siteNamesOf(draft, draftSiteLayout(draft) ?? ui.carried.layout) : [];
    for (const c of cells) parts.push(section === 'orgs' && inSites(sitesNow, c.key) ? refBox(c) : cellBox(c));
  }
  if (!cells.length) parts.push(emptyEl(section === 'sites' ? '넣은 사업장이 없어요' : '내 칸이 없어요'));
  if (section === 'sites') {
    const bar = el('div', 'weekly-flow-site-add');
    const add = btn('+ 사업장 추가', {flowSiteAdd:''}, 'journal-part-add-button'); add.disabled = !siteOptions.length || !!ui.busy; add.setAttribute('aria-expanded', String(!!ui.siteAdding));
    bar.append(add);
    if (ui.siteAdding && siteOptions.length) {
      const pick = el('select', 'journal-hwpx-target'); pick.dataset.flowSitePick = ''; pick.setAttribute('aria-label', '넣을 사업장(내 담당 조직)');
      const none = el('option', '', '사업장 선택'); none.value = ''; pick.append(none);
      for (const n of siteOptions) { const o = el('option', '', n); o.value = n; pick.append(o); }
      bar.append(' ', pick);
    }
    parts.push(bar);
  }
  // 줄 ⠿ 에 초점이 있는 채로 다시 그려지면(재료·학습을 늦게 읽어 다시 그림) 같은 줄 손잡이로 초점을 돌려준다 — 키보드로 옮기던 중 초점이 사라지지 않게.
  const active = doc.activeElement, held = active && slot.contains(active) && active.matches?.('[data-flow-line-grip]') ? active.closest('li[data-flow-line-id]')?.dataset.flowLineId : null;
  slot.replaceChildren(...parts);
  fitAll(slot); // UI-줄입력늘어나기
  if (held && !ui.focusLine) [...slot.querySelectorAll('li[data-flow-line-id]')].find(n => n.dataset.flowLineId === held)?.querySelector('[data-flow-line-grip]:not(:disabled)')?.focus();
  if (!slot.dataset.flowWired) wire();
  if (ui.focusLine && !ui.busy && section !== 'sites') { const k = ui.focusLine; ui.focusLine = null; [...slot.querySelectorAll('li[data-flow-line-id]')].find(n => n.dataset.flowLineId === k)?.querySelector('[data-flow-line-grip]')?.focus(); }
  if (ui.focusSite && !ui.busy && section === 'sites') { const name = ui.focusSite; ui.focusSite = null; [...slot.querySelectorAll('[data-reorder-id]')].find(n => n.dataset.reorderId === name)?.querySelector('[data-reorder-handle]')?.focus(); }

  function refBox(c) {
    const box = el('div', 'weekly-flow-cell'); box.dataset.flowCell = c.id; box.dataset.flowSiteRef = '';
    const head = el('div', 'weekly-flow-name'), name = el('span', 'weekly-flow-label'); name.append(el('b', null, labelOf(section, c.key, c.n))); head.append(name); box.append(head);
    const ul = el('ul', 'weekly-flow-lines'), li = el('li'); li.append(el('span', 'weekly-flow-text', SITE_REF_LINE)); li.dataset.flowSiteRefLine = ''; ul.append(li); box.append(ul);
    if (c.lines.length) {
      const fold = el('details', 'journal-org-raw weekly-flow-records'); fold.dataset.flowRefFold = c.id;
      fold.open = !!slot.querySelector(`details[data-flow-ref-fold="${CSS.escape(c.id)}"]`)?.open;
      const kept = el('ul', 'weekly-flow-lines weekly-flow-kept'); for (const t of c.lines) kept.append(el('li', null, t));
      fold.append(el('summary', null, `쓴 줄 ${c.lines.length}개`), kept); box.append(fold);
    }
    return box;
  }
  function cellBox(c) {
    const box = el('div', 'weekly-flow-cell'); box.dataset.flowCell = c.id;
    const head = el('div', 'weekly-flow-name');
    const name = el('span', 'weekly-flow-label');
    if (section === 'summary') { const [area, task] = c.key.split('›'); name.append(el('b', null, area || '—'), ` › ${task || '—'}${c.n ? ` (${c.n + 1}번째)` : ''}`); }
    else name.append(el('b', null, labelOf(section, c.key, c.n)));
    head.append(name);
    // 이번 주에 손대지 않은 칸이 지난주 보고서 줄 그대로면 작은 '지난주에서'(1) 임원 배정 요청과 같은 표시, 화면에만).
    if (section === 'summary' && c.lines.length && !touched.has(c.id) && baseLines.has(c.id)) {
      const tag = el('span', 'journal-exec-carried', CARRIED_TAG); tag.dataset.flowCarried = ''; tag.title = '이번 주에 손대지 않아 지난주 보고서 줄 그대로예요'; head.append(tag);
    }
    const busy = !!ui.busy;
    // ORG-기록하나로 O-4 ②: 전환 주부터 3. 2) 사업장 칸 안쪽 = 조직보고 창(쟁의 단계 줄 + 같은 조직 기록 3~7줄, journal.js가 줌). 칸 구성(빼기·순서·추가)은 그대로.
    const win = section === 'sites' && typeof ctx.siteBody === 'function' ? ctx.siteBody(c) : null;
    const add = btn('+ 추가', {flowAdd:c.id}, 'journal-part-add-button'); add.disabled = busy; add.setAttribute('aria-label', `${labelOf(section, c.key, c.n)} 칸에 줄 추가`);
    if (!win) head.append(add);
    if (section === 'sites') {
      box.dataset.reorderId = c.key;
      const grip = btn('⠿', {reorderHandle:''}, 'mini journal-hwpx-grip'); grip.setAttribute('aria-label', `${c.key} 순서 옮기기(위·아래 화살표)`); grip.disabled = busy;
      head.prepend(grip);
      head.append(rowMore(doc, {label:`${c.key} 사업장 칸 메뉴`, data:{flowSiteMore:c.key}, items:[{text:'이번 주 보고에서 빼기', data:{flowSiteHide:c.key}, disabled:busy}]}));
    }
    box.append(head);
    if (win) { box.append(win); return box; }
    // 바탕이 바뀌어 이름이 맞는 칸이 없는 고친 칸: 버리지 않고 보이되, 한글 파일에는 들어가지 않는다고 한 줄.
    if (proposed && section !== 'sites' && !inBase.has(c.id) && !(section === 'summary' && areaKeys.has(c.key))) { const p = el('p', 'journal-muted weekly-flow-orphan', '바탕에 없는 칸 — 파일에는 안 들어가요'); p.dataset.flowOrphan = ''; box.append(p); }
    // 바탕이 내 개인본이고 그보다 나중 팀 확정본에서 이 칸 글이 다르면 작은 '확정본에서 바뀜'(눌러 그 글 보기·[이 글로 바꾸기], 참고용).
    const theirs = team?.get(c.id);
    if (theirs && theirs.map(strip).filter(Boolean).join('\n') !== c.lines.map(strip).filter(Boolean).join('\n')) {
      const fold = el('details', 'journal-hwpx-team-fold weekly-flow-team'); fold.dataset.flowTeam = c.id;
      const mark = el('summary', 'journal-exec-carried', '팀 확정본에서 바뀜'); mark.title = `팀 확정본${ctx.teamTitle ? `(${ctx.teamTitle})` : ''}에서 이 칸 글이 달라요`;
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
      if (ui.editing?.cell === c.id && ui.editing.index === i) { li.append(editForm(c.id, ui.editing.value ?? text, {flowFixSave:c.id}, '줄 수정')); ul.append(li); return; }
      if (canMove) { const grip = btn('⠿', {flowLineGrip:'', reorderHandle:''}, 'mini journal-hwpx-grip weekly-flow-grip'); grip.setAttribute("aria-label", `줄 자리 바꾸기(끌기·위아래 화살표): ${text}`); grip.disabled = busy || !!ui.editing || !!ui.adding; li.append(grip); }
      li.append(el('span', 'weekly-flow-text', text));
      li.append(rowMore(doc, {label:`줄 수정·빼기: ${text}`, data:{flowLineMore:''}, items:[
        {text:'수정', data:{flowFix:c.id, flowIndex:String(i)}, disabled:busy},
        {text:'아래에 줄 추가', data:{flowAddBelow:c.id, flowIndex:String(i)}, disabled:busy, aria:`이 줄 아래에 줄 추가: ${text}`},
        {text:'빼기', data:{flowCut:c.id, flowIndex:String(i)}, disabled:busy, danger:true, aria:`이번 주 보고에서 빼기: ${text}`}]}));
      ul.append(li);
      if (ui.adding === c.id && ui.addAt === i + 1) ul.append(addRow());
    });
    if (!c.lines.length) { const li = el('li', 'weekly-flow-empty', '빈 칸'); li.dataset.flowEmpty = ''; ul.append(li); }
    if (ui.adding === c.id && !(ui.addAt >= 1 && ui.addAt <= c.lines.length)) ul.append(addRow());
    box.append(ul);
    if (ui.undo?.cell === c.id) { const p = el('p', 'journal-line-status'); p.dataset.flowUndo = ''; p.setAttribute('role', 'status'); p.append('줄을 뺐어요 ', btn('되돌리기', {flowUndo:c.id})); box.append(p); }
    if (ui.failed?.cell === c.id) { const p = el('p', 'journal-line-status journal-failed', `저장 못 함 — ${ui.failed.text} `); p.dataset.flowFailed = ''; p.setAttribute('role', 'alert'); p.append(btn('다시', {flowRetry:c.id})); box.append(p); }
    return box;
  }
  function editForm(cell, value, data, aria) {
    const f = el('span', 'journal-file-edit weekly-flow-edit');
    const input = lineField(doc, {value, maxLength: CELL_LINE_MAX}); input.dataset.flowInput = cell; input.setAttribute('aria-label', aria); input.disabled = !!ui.busy;
    const cancel = btn('취소', {flowCancel:cell}); const save = btn('저장', data, 'mini primary'); cancel.disabled = save.disabled = !!ui.busy;
    f.append(input, ' ', cancel, save); // UI-저장자리: [취소] 왼쪽, [저장] 맨 오른쪽
    return f;
  }
  function wire() {
    slot.dataset.flowWired = '1';
    if (section === 'sites') slot.__drag = mountReorder(slot, {onDrop:({id, index}) => slot.__flow?.moveSite(id, index), onStep:(id, dir) => slot.__flow?.stepSite(id, dir), canDrag:() => !slot.__flow?.ui.busy});
    else slot.__lineDrag = mountReorder(slot, {listSelector:'ul[data-flow-line-list]', itemSelector:'li[data-flow-line-id]', handleSelector:'[data-flow-line-grip]',
      onDrop:({id, list, index}) => slot.__flow?.moveLine(id, list, index), onStep:(id, dir) => slot.__flow?.stepLine(id, dir),
      canDrag:() => { const u = slot.__flow?.ui; return !!u && !u.busy && !u.editing && !u.adding; }});
    slot.addEventListener('change', event => { const sel = event.target.closest?.('select[data-flow-site-pick]'); if (sel?.value) slot.__flow?.addSite(sel.value); });
    slot.addEventListener('click', event => {
      const b = event.target.closest('button');
      if (!b || b.disabled || !slot.contains(b)) return;
      const cur = slot.__flow; if (!cur) return;
      cur.click(b);
    });
    slot.addEventListener('keydown', event => {
      const input = event.target.closest?.('[data-flow-input]');
      if (!input) return;
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); input.parentElement.querySelector('button.primary')?.click(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.parentElement.querySelector('[data-flow-cancel]')?.click(); }
    });
    slot.addEventListener('input', event => {
      const input = event.target.closest?.('[data-flow-input]'), cur = slot.__flow;
      if (!input || !cur) return;
      const u = cur.ui;
      if (u.editing?.cell === input.dataset.flowInput) u.editing.value = input.value;
      else if (u.adding === input.dataset.flowInput) u.addValue = input.value;
    });
  }
  // 누르기 처리는 이번 그림의 ctx 로(그릴 때마다 바꿔 끼움).
  slot.__flow = {ui, click:b => onClick(b), moveSite:(name, index) => setLayout('move', name, index), stepSite:(name, dir) => stepSite(name, dir), addSite:name => setLayout('show', name),
    moveLine:(id, list, index) => moveLine(id, list, index), stepLine:(id, dir) => stepLine(id, dir)};
  const focusInput = id => requestAnimationFrame(() => slot.querySelector(`[data-flow-input="${CSS.escape(id)}"]`)?.focus());
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
    const d = b.dataset;
    if (d.flowReload !== undefined) { ctx.reload?.(); return; }
    if (d.flowSiteAdd !== undefined) { ui.siteAdding = !ui.siteAdding; ctx.redraw?.(); if (ui.siteAdding) requestAnimationFrame(() => slot.querySelector('select[data-flow-site-pick]')?.focus()); return; }
    if (d.flowTeamUse) { const lines = team?.get(d.flowTeamUse); if (lines) void write(d.flowTeamUse, {act:'none', lines:[...lines]}); return; }
    if (d.flowCancel !== undefined) { ui.editing = null; ui.adding = null; ui.addAt = -1; ui.addValue = ''; ctx.redraw?.(); return; }
    if (d.flowFix) { ui.editing = {cell:d.flowFix, index:Number(d.flowIndex), value:null}; ui.adding = null; ctx.redraw?.(); focusInput(d.flowFix); return; }
    if (d.flowAdd) { ui.adding = d.flowAdd; ui.addAt = -1; ui.addValue = ''; ui.editing = null; ctx.redraw?.(); focusInput(d.flowAdd); return; }
    if (d.flowAddBelow) { ui.adding = d.flowAddBelow; ui.addAt = Number(d.flowIndex) + 1; ui.addValue = ''; ui.editing = null; ctx.redraw?.(); focusInput(d.flowAddBelow); return; }
    const value = () => String(b.parentElement.querySelector('[data-flow-input]')?.value ?? '').trim();
    if (d.flowFixSave) { const v = value(); if (!v) return; const index = ui.editing.index; void write(d.flowFixSave, {act:'fix', index, text:v}, {after:() => { ui.editing = null; }}); return; }
    if (d.flowAddSave) { const v = value(); if (!v) return; const at = ui.addAt; void write(d.flowAddSave, {act:'add', text:v.startsWith('-') ? v : `- ${v}`, ...(at >= 0 ? {insertAt:at} : {})}, {after:() => { ui.adding = null; ui.addAt = -1; ui.addValue = ''; }}); return; }
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
