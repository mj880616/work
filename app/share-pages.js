// SHARE-현장공유 PR 2(화면): the top of the "공유 페이지" menu (#sharePagesRoot). This module is the only renderer of that
// region: my share pages list + [새 공유 페이지], and the editor (title, blocks, 초안/게시, project link, links).
// The old Web1 cards below stay with web1-board.js, folded under "이전 페이지" (S7: not moved).
// Storage is the owner-RLS tables from PR 1 through the shared runtime (authenticated REST); no new RPC.
// A link value (token) is read from the DB only when [복사] is pressed and goes straight to the clipboard: it is never
// drawn, kept in this module, logged or stored in the browser. Lists read only id·label·expiry·off·created.
import {BLOCK_TYPES, ALL_TYPES, BLOCK_LABELS, ITEM_FIELDS, LIMITS, newBlock, newItem, moveBlock, normalizeBlocks, pageProblem,
  labelProblem, expiresAt, linkState, shareUrl, blockIsEmpty, blocksToDoc} from './share-pages-model.mjs';
import {renderBlock} from './sr-render.mjs';
import {copyText} from './md-editor.js';
import {mountSplitResize} from './split-resize.js';
import {createDocEditor} from './ed-editor.js';

(() => {
if (window.KPTUSharePages) return;
const root = document.querySelector('#sharePagesRoot');
const view = document.querySelector('#pagesView');
if (!root || !view) return;
const rt = window.KPTURuntime;
const PAGE_COLUMNS = 'id,title,blocks,status,project_id,updated_at';
const LINK_COLUMNS = 'id,label,expires_at,disabled_at,created_at';

const ownerScope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
function workspaceId() {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없어요.');
  return id;
}
const q = encodeURIComponent;
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false));
  return node;
}
const day = iso => { try { return new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', year:'numeric', month:'numeric', day:'numeric'}).format(new Date(iso)); } catch { return ''; } };
const message = (e, fallback) => (e?.status === 401 || e?.code === 'session_required') ? '로그인이 끝났어요. 다시 로그인해 주세요.' : fallback;

let scope = ownerScope(), epoch = 0;
let pages = null, listState = 'idle';
let editing = null; // {id, title, status, project_id, blocks, updated_at, saved, links, linksState}
let busy = false, layer = null;
// ED-통합편집기 ①b: the open 글(doc) block is edited with the new editor (ed-editor.js). One instance at a time, for the
// open block only; it writes each change into that block (block.doc), so a redraw (move, add) keeps the text.
let docEditor = null, docMount = 0;
function dropDocEditor() { docMount++; if (docEditor) { docEditor.destroy(); docEditor = null; } }

const listView = el('div', {class:'sp-list-view', dataset:{spList:''}});
const editorView = el('div', {class:'sp-editor', hidden:true, dataset:{spEditor:''}});
root.replaceChildren(listView, editorView);

// ── list ──
function renderList() {
  const status = el('p', {class:'sp-status', role:'status', 'aria-live':'polite', dataset:{spListStatus:''}});
  const head = el('div', {class:'sp-head'}, el('h2', {text:'내 공유 페이지'}),
    el('button', {type:'button', class:'primary', dataset:{spNew:''}, text:'새 공유 페이지'}));
  const body = [];
  if (listState === 'loading' && !pages) status.textContent = '불러오는 중…';
  else if (listState === 'error') {
    status.textContent = '공유 페이지 목록을 불러오지 못했어요.';
    body.push(el('button', {type:'button', class:'secondary', dataset:{spReload:''}, text:'다시 불러오기'}));
  } else if (pages && !pages.length) body.push(el('p', {class:'sp-empty', text:'아직 만든 공유 페이지가 없어요. [새 공유 페이지]로 시작해 보세요.'}));
  if (pages?.length) body.push(el('ul', {class:'sp-list', 'aria-label':'내 공유 페이지'}, pages.map(page => el('li', {},
    el('button', {type:'button', class:'sp-row', dataset:{spOpen:page.id}},
      el('span', {class:'sp-row-title', text:page.title || '제목 없음'}),
      el('span', {class:`sp-pill ${page.status === 'published' ? 'is-on' : ''}`, text:page.status === 'published' ? '게시' : '초안'}))))));
  listView.replaceChildren(head, status, ...body);
  view.dataset.sharePagesReady = '1';
}
async function loadList({force = false} = {}) {
  if (!force && (listState === 'loading' || (pages && listState === 'ready'))) { renderList(); return; }
  const run = ++epoch, owner = scope;
  listState = 'loading'; renderList();
  try {
    const rows = await rt.api(`/rest/v1/app_share_pages?workspace_id=eq.${q(workspaceId())}&select=id,title,status,project_id,updated_at&order=updated_at.desc`, {singleFlight:false});
    if (run !== epoch || owner !== scope) return;
    if (!Array.isArray(rows)) throw new Error('bad list');
    pages = rows; listState = 'ready';
  } catch (e) {
    if (run !== epoch || owner !== scope) return;
    listState = 'error';
  }
  renderList();
}

// ── editor ──
const snapshotOf = page => JSON.stringify({title:String(page.title || '').trim(), status:page.status, project_id:page.project_id || null, blocks:normalizeBlocks(page.blocks)});
const dirty = () => !!editing && snapshotOf(editing) !== editing.saved;
const editorStatus = text => { const node = editorView.querySelector('[data-sp-status-line]'); if (node) node.textContent = text; };
const linkStatus = text => { const node = editorView.querySelector('[data-sp-link-status]'); if (node) node.textContent = text; };

function itemRow(block, b, i) {
  const fields = ITEM_FIELDS[block.type], item = block.items[i], n = i + 1;
  const row = el('li', {class:`sp-item sp-item-${block.type}`});
  if (block.type === 'stages') row.append(el('label', {class:'sp-current'},
    el('input', {type:'radio', name:`sp-stage-${b}`, value:String(i), checked:block.current === i, dataset:{spCurrent:String(b)}}),
    el('span', {text:'지금'})));
  for (const [field, label, max, multiline] of fields) {
    const input = el(multiline ? 'textarea' : 'input', {
      class:'sp-input', rows:multiline ? 2 : undefined, type:multiline ? undefined : (field === 'url' ? 'url' : 'text'),
      maxLength:max, value:item[field] ?? '', placeholder:label,
      'aria-label':`${BLOCK_LABELS[block.type]} ${n}번째 줄 ${label}`, inputMode:field === 'url' ? 'url' : undefined,
      dataset:{spB:String(b), spI:String(i), spF:field}});
    if (multiline) input.value = item[field] ?? '';
    row.append(input);
  }
  row.append(el('button', {type:'button', class:'sp-tool', dataset:{spItemDel:`${b}:${i}`}, 'aria-label':`${BLOCK_LABELS[block.type]} ${n}번째 줄 지우기`, text:'줄 삭제'}));
  return row;
}
// SHARE-보이는편집: the blocks are shown exactly as the Web1 reader draws them (sr-render.mjs + sr-blocks.css, from the
// saved form normalizeBlocks gives). Pressing a block turns only that block into its input fields in place; [완료] shows
// it again as it will look, [취소] puts back what it was when opened. One block is open at a time (editing.open).
function blockTools(block, b, count) {
  const label = BLOCK_LABELS[block.type], n = b + 1;
  return [
    el('button', {type:'button', class:'sp-tool', disabled:b === 0, dataset:{spMove:`${b}:-1`}, 'aria-label':`${n}번째 블록 ${label} 위로`, text:'위로'}),
    el('button', {type:'button', class:'sp-tool', disabled:b === count - 1, dataset:{spMove:`${b}:1`}, 'aria-label':`${n}번째 블록 ${label} 아래로`, text:'아래로'}),
    el('button', {type:'button', class:'sp-tool sp-danger', dataset:{spBlockDel:String(b)}, 'aria-label':`${n}번째 블록 ${label} 지우기`, text:'삭제'})];
}
function editNode(block, b, count) {
  const label = BLOCK_LABELS[block.type], n = b + 1;
  const tools = el('div', {class:'sp-block-tools', role:'group', 'aria-label':`${n}번째 블록 (${label}) 옮기기·지우기`}, blockTools(block, b, count));
  const box = el('section', {class:`sp-block sp-block-${block.type} is-editing`, 'aria-label':`${n}번째 블록 ${label}`, dataset:{spBlock:String(b), spType:block.type}},
    el('div', {class:'sp-block-head'}, el('h3', {text:label}), tools));
  if (block.type === 'doc') {
    const host = el('div', {class:'sp-doc-host', dataset:{spDocHost:String(b)}}, el('p', {class:'sp-hint', text:'편집기를 여는 중…'}));
    box.append(host);
    const mount = ++docMount;
    createDocEditor({host, value:block.doc, label:`${n}번째 블록 글`, placeholder:'여기에 쓰세요',
      onChange:value => { if (editing && editing.blocks[b] === block) block.doc = value; }}).then(ed => {
      if (mount !== docMount || !host.isConnected) { ed.destroy(); return; }
      host.querySelector('.sp-hint')?.remove();
      docEditor = ed;
      if (editing?.focusDoc) { editing.focusDoc = false; ed.focus(); }
    }).catch(() => { if (mount === docMount && host.isConnected) host.replaceChildren(el('p', {class:'sp-hint', role:'alert', text:'편집기를 열지 못했어요. [취소] 뒤 다시 눌러 주세요.'})); });
  } else if (block.type === 'summary') {
    box.append(el('textarea', {class:'sp-input', rows:2, maxLength:LIMITS.summary, placeholder:'예: 3차 교섭 결렬, 10월 말 조정 신청 예정',
      'aria-label':`${n}번째 블록 한 줄 현황 글`, value:block.text || '', dataset:{spB:String(b), spF:'text'}}));
    box.querySelector('textarea').value = block.text || '';
  } else {
    box.append(el('input', {type:'text', class:'sp-input sp-block-title', maxLength:LIMITS.blockTitle, value:block.title || '',
      placeholder:`블록 제목 (비우면 "${label}")`, 'aria-label':`${n}번째 블록 제목`, dataset:{spB:String(b), spF:'title'}}));
    box.append(el('ol', {class:'sp-items'}, block.items.map((_, i) => itemRow(block, b, i))));
    box.append(el('button', {type:'button', class:'sp-tool sp-add-item', dataset:{spItemAdd:String(b)}, disabled:block.items.length >= LIMITS.items,
      'aria-label':`${n}번째 블록 ${label}에 줄 추가`, text:'+ 줄 추가'}));
  }
  box.append(el('div', {class:'sp-block-done'},
    el('button', {type:'button', class:'sp-tool', dataset:{spCancel:String(b)}, 'aria-label':`${n}번째 블록 ${label} 고친 것 취소`, text:'취소'}),
    el('button', {type:'button', class:'sp-tool sp-done', dataset:{spDone:String(b)}, 'aria-label':`${n}번째 블록 ${label} 고치기 완료`, text:'완료'})));
  return box;
}
function viewNode(block, b, count) {
  const label = BLOCK_LABELS[block.type], n = b + 1;
  const shown = normalizeBlocks([block])[0];
  const drawn = renderBlock(shown) || el('p', {class:'sp-hint', text:'표시할 수 없는 블록이에요.'});
  drawn.setAttribute('inert', '');
  const empty = blockIsEmpty(shown);
  const box = el('div', {class:`sp-vblock${empty ? ' is-empty' : ''}`, role:'group', 'aria-label':`${n}번째 블록 ${label}`, dataset:{spBlock:String(b), spType:block.type}},
    drawn,
    empty ? el('p', {class:'sp-vblock-empty', 'aria-hidden':'true', text:'비어 있어요. 눌러서 채워 주세요.'}) : null,
    el('button', {type:'button', class:'sp-vblock-edit', dataset:{spEdit:String(b)}, 'aria-label':`${n}번째 블록 ${label} 고치기`},
      el('span', {class:'sp-vblock-hint', 'aria-hidden':'true', text:'고치기'})),
    el('details', {class:'sp-more', dataset:{spMore:String(b)}},
      el('summary', {class:'sp-more-button', 'aria-label':`${n}번째 블록 ${label} 메뉴`}, el('span', {'aria-hidden':'true', text:'⋯'})),
      el('div', {class:'sp-more-panel', role:'group', 'aria-label':`${n}번째 블록 ${label} 옮기기·지우기`}, blockTools(block, b, count))));
  return box;
}
// [+ 블록] between two blocks: the picked kind goes in at that place and opens.
function insertSlot(at, count) {
  return el('details', {class:'sp-slot', dataset:{spSlot:String(at)}},
    el('summary', {class:'sp-slot-button', 'aria-label':`${at}번째와 ${at + 1}번째 블록 사이에 블록 넣기`}, el('span', {'aria-hidden':'true', text:'+ 블록'})),
    el('div', {class:'sp-slot-panel', role:'group', 'aria-label':`${at}번째 블록 다음에 넣을 블록`}, ['doc', ...BLOCK_TYPES].map(type =>
      el('button', {type:'button', class:'sp-tool', disabled:count >= LIMITS.blocks, dataset:{spInsert:`${at}:${type}`},
        'aria-label':`${at}번째 블록 다음에 ${BLOCK_LABELS[type]} 넣기`, text:BLOCK_LABELS[type]}))));
}
function renderBlocks() {
  const host = editorView.querySelector('[data-sp-blocks]');
  if (!host || !editing) return;
  dropDocEditor();
  const count = editing.blocks.length, nodes = [];
  editing.blocks.forEach((block, b) => {
    if (b > 0) nodes.push(insertSlot(b, count));
    nodes.push(b === editing.open ? editNode(block, b, count) : viewNode(block, b, count));
  });
  host.replaceChildren(...(count ? nodes
    : [el('p', {class:'sp-empty', text:'아래 [+ 글]로 시작해 보세요. 진행 단계·일정 같은 칸이 필요하면 옆 버튼으로 더해요.'})]));
  for (const button of editorView.querySelectorAll('[data-sp-add-block]')) button.disabled = count >= LIMITS.blocks;
  paintConvert();
}
function openBlock(index) {
  if (!editing?.blocks[index]) return;
  editing.open = index; editing.openBefore = JSON.parse(JSON.stringify(editing.blocks[index]));
  editing.focusDoc = editing.blocks[index].type === 'doc';
  renderBlocks();
  if (!editing.focusDoc) editorView.querySelector(`[data-sp-block="${index}"]`)?.querySelector('input,textarea')?.focus();
}
function closeBlock({cancel = false} = {}) {
  const index = editing?.open ?? -1;
  if (index < 0) return;
  if (!cancel && docEditor && editing.blocks[index]?.type === 'doc') editing.blocks[index].doc = docEditor.getValue();
  if (cancel && editing.openBefore && editing.blocks[index]) editing.blocks[index] = editing.openBefore;
  editing.open = -1; editing.openBefore = null;
  renderBlocks();
  editorView.querySelector(`[data-sp-edit="${index}"]`)?.focus();
}
function addBlock(type, at) {
  if (!editing || editing.blocks.length >= LIMITS.blocks || !ALL_TYPES.includes(type)) return;
  editing.blocks.splice(at, 0, newBlock(type));
  openBlock(at);
}
function renderLinks() {
  const host = editorView.querySelector('[data-sp-links]');
  if (!host || !editing) return;
  if (!editing.id) { host.replaceChildren(el('p', {class:'sp-hint', text:'링크는 페이지를 한 번 저장한 뒤 만들 수 있어요.'})); return; }
  const form = el('div', {class:'sp-link-form'},
    el('label', {class:'sp-field'}, el('span', {text:'받는 사람 이름표'}),
      el('input', {type:'text', class:'sp-input', maxLength:LIMITS.label, placeholder:'예: ○○지부', dataset:{spLinkLabel:''}})),
    el('label', {class:'sp-field'}, el('span', {text:'기한 (선택, 비우면 없음)'}),
      el('input', {type:'date', class:'sp-input', dataset:{spLinkExpiry:''}})),
    el('button', {type:'button', class:'secondary', dataset:{spLinkCreate:''}, text:'링크 만들기'}));
  const items = [];
  if (editing.linksState === 'loading') items.push(el('p', {class:'sp-hint', text:'링크를 불러오는 중…'}));
  else if (editing.linksState === 'error') items.push(el('p', {class:'sp-hint', text:'링크 목록을 불러오지 못했어요.'}),
    el('button', {type:'button', class:'secondary', dataset:{spLinksReload:''}, text:'다시 불러오기'}));
  else if (!editing.links.length) items.push(el('p', {class:'sp-hint', text:'아직 만든 링크가 없어요. 받는 곳마다 따로 만들면 하나만 끌 수 있어요.'}));
  else items.push(el('ul', {class:'sp-link-list', 'aria-label':'만든 링크'}, editing.links.map(link => {
    const state = linkState(link), name = link.label || '이름표 없음';
    const stateText = state === 'off' ? '꺼짐' : state === 'expired' ? '기한 지남' : link.expires_at ? `${day(link.expires_at)}까지` : '기한 없음';
    return el('li', {class:`sp-link sp-link-${state}`, dataset:{spLink:link.id}},
      el('div', {class:'sp-link-main'}, el('span', {class:'sp-link-name', text:name}),
        el('span', {class:'sp-link-meta', text:`${stateText} · ${day(link.created_at)} 만듦`})),
      el('div', {class:'sp-link-actions'},
        el('button', {type:'button', class:'sp-tool', disabled:state !== 'on', dataset:{spLinkCopy:link.id}, 'aria-label':`${name} 링크 복사`, text:'복사'}),
        state === 'off' ? null : el('button', {type:'button', class:'sp-tool sp-danger', dataset:{spLinkOff:link.id}, 'aria-label':`${name} 링크 끄기`, text:'끄기'})));
  })));
  host.replaceChildren(form, el('p', {class:'sp-status', role:'status', 'aria-live':'polite', dataset:{spLinkStatus:''}}), ...items,
    el('p', {class:'sp-hint', text:'링크를 끄면 그 링크로는 바로 못 열어요. 이미 본 내용이나 캡처는 지울 수 없어요. 자료 칸의 Drive 파일은 Drive 공유 설정을 따로 확인하세요.'}));
}
function paintStatusButtons() {
  for (const button of editorView.querySelectorAll('[data-sp-set-status]')) button.setAttribute('aria-pressed', String(button.dataset.spSetStatus === editing.status));
}
async function paintProjects() {
  const select = editorView.querySelector('[data-sp-project]');
  if (!select || !editing) return;
  const catalog = window.KPTUProjectCatalog, ctx = rt.context.read();
  const fill = () => { select.innerHTML = catalog?.options ? catalog.options(editing.project_id || '') : '<option value="">프로젝트 없음</option>'; select.value = editing.project_id || ''; };
  fill();
  try { if (catalog?.load && ctx?.workspace?.id && ctx?.user?.id) { await catalog.load({workspaceId:ctx.workspace.id, userId:ctx.user.id}); if (editorView.contains(select)) fill(); } } catch {}
}
function renderEditor() {
  if (!editing) return;
  // The title sits where the reader shows it, in the reader's title look (sr-title).
  const title = el('input', {type:'text', class:'sr-title sp-title', maxLength:LIMITS.title, value:editing.title, placeholder:'제목 (예: ○○민자철도 교섭 현황)',
    'aria-label':'제목', dataset:{spTitle:''}});
  editorView.replaceChildren(
    el('div', {class:'sp-editor-head'},
      el('button', {type:'button', class:'sp-back', dataset:{spClose:''}, 'aria-label':'공유 페이지 목록으로'}, el('span', {'aria-hidden':'true', text:'‹'}), ' 공유 페이지'),
      el('h2', {class:'a11y-only', id:'spEditorTitle', text:editing.id ? '공유 페이지 고치기' : '새 공유 페이지'})),
    el('div', {class:'sp-settings'},
      el('div', {class:'sp-field'}, el('span', {id:'spStatusLabel', text:'상태'}),
        el('div', {class:'sp-seg', role:'group', 'aria-labelledby':'spStatusLabel'},
          el('button', {type:'button', dataset:{spSetStatus:'draft'}, text:'초안'}),
          el('button', {type:'button', dataset:{spSetStatus:'published'}, text:'게시'}))),
      el('label', {class:'sp-field'}, el('span', {text:'연결 프로젝트 (선택)'}), el('select', {class:'sp-input', dataset:{spProject:''}}))),
    el('p', {class:'sp-hint', text:'게시 상태일 때만 링크를 받은 사람이 볼 수 있어요. 초안으로 바꾸면 모든 링크에서 바로 안 보여요.'}),
    el('section', {class:'sp-canvas', 'aria-labelledby':'spCanvasTitle'},
      el('p', {class:'sp-canvas-cap', id:'spCanvasTitle', text:'받는 사람에게 보이는 모양 · 블록을 누르면 그 자리에서 고쳐요'}),
      el('div', {class:'sr-wrap sp-canvas-page'}, title, el('div', {class:'sp-blocks', dataset:{spBlocks:''}})),
      el('div', {class:'sp-add', role:'group', 'aria-label':'블록 추가'}, ['doc', ...BLOCK_TYPES].map(type =>
        el('button', {type:'button', class:'sp-tool', dataset:{spAddBlock:type}, text:`+ ${BLOCK_LABELS[type]}`}))),
      el('div', {class:'sp-convert', hidden:true, dataset:{spConvertRow:''}},
        el('button', {type:'button', class:'sp-tool', dataset:{spConvert:''}, text:'새 편집기로 바꾸기'}),
        el('button', {type:'button', class:'sp-tool', hidden:true, dataset:{spConvertUndo:''}, text:'바꾸기 취소'}),
        el('p', {class:'sp-hint', dataset:{spConvertHint:''}}))),
    el('div', {class:'sp-save-row'},
      el('button', {type:'button', class:'primary', dataset:{spSave:''}, text:'저장'}),
      el('p', {class:'sp-status', role:'status', 'aria-live':'polite', dataset:{spStatusLine:''}})),
    el('section', {class:'sp-links', 'aria-labelledby':'spLinksTitle'}, el('h3', {id:'spLinksTitle', text:'링크'}), el('div', {dataset:{spLinks:''}})));
  title.value = editing.title;
  paintStatusButtons(); renderBlocks(); renderLinks(); void paintProjects();
  mountCanvasWidth();
}
// SHARE-편집폭: on PC the right edge of the '받는 사람에게 보이는 모양' box can be dragged (split-resize.js one-edge mode, remembered on this
// device). Only this editing screen changes; the reader (Web1) keeps its own 640px width.
function mountCanvasWidth() {
  mountSplitResize({container:editorView, name:'share-edit', label:'받는 사람에게 보이는 모양 칸 폭 조절', list:() => editorView.querySelector('.sp-canvas'), pane:() => editorView.querySelector('.sp-canvas'),
    active:() => !!editing && !editorView.hidden && window.matchMedia?.('(min-width:1024px)').matches,
    edge:{widthVar:'--sp-canvas-w', minVar:'--sp-canvas-min', defaultRatio:0.85, valueLabel:'칸 폭'}});
}
function showEditor(page) {
  editing = {id:page?.id || null, title:page?.title || '', status:page?.status === 'published' ? 'published' : 'draft', project_id:page?.project_id || null,
    blocks:Array.isArray(page?.blocks) ? structuredClone(page.blocks) : [], updated_at:page?.updated_at || null, links:[], linksState:page?.id ? 'loading' : 'none',
    open:-1, openBefore:null, converted:null, focusDoc:false};
  // ED-통합편집기 ①b (결정 6 가): a new page starts with one empty 글 block, already open in the new editor.
  if (!page) { editing.blocks = [newBlock('doc')]; editing.open = 0; editing.focusDoc = true; }
  editing.saved = snapshotOf(editing);
  listView.hidden = true; editorView.hidden = false; view.dataset.spEditing = '1';
  layer ||= window.KPTURouter?.layer?.open('share-page-editor', {close:() => closeEditor({fromBack:true})}) || null;
  const focusDoc = editing.focusDoc;
  renderEditor();
  if (!focusDoc) editorView.querySelector('[data-sp-title]')?.focus();
  if (editing.id) void loadLinks();
}
function closeEditor({fromBack = false, force = false} = {}) {
  if (!editing) return true;
  if (busy && !force) return false;
  if (!force && dirty() && !window.confirm('저장하지 않은 내용이 있어요. 버리고 목록으로 돌아갈까요?')) return false;
  dropDocEditor();
  const opened = layer; layer = null; editing = null;
  editorView.replaceChildren(); editorView.hidden = true; listView.hidden = false; delete view.dataset.spEditing;
  if (!fromBack) opened?.close();
  void loadList({force:true});
  listView.querySelector('[data-sp-new]')?.focus({preventScroll:true});
  return true;
}
async function openPage(id) {
  if (busy) return;
  const run = ++epoch, owner = scope;
  const status = listView.querySelector('[data-sp-list-status]');
  if (status) status.textContent = '불러오는 중…';
  try {
    const rows = await rt.api(`/rest/v1/app_share_pages?id=eq.${q(id)}&workspace_id=eq.${q(workspaceId())}&select=${PAGE_COLUMNS}`, {singleFlight:false});
    if (run !== epoch || owner !== scope) return;
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('missing');
    showEditor(rows[0]);
  } catch (e) {
    if (run !== epoch || owner !== scope) return;
    if (status) status.textContent = message(e, '이 공유 페이지를 열지 못했어요. 목록을 다시 불러와 주세요.');
  }
}
async function loadLinks() {
  if (!editing?.id) return;
  const page = editing, owner = scope;
  page.linksState = 'loading'; renderLinks();
  try {
    const rows = await rt.api(`/rest/v1/app_share_page_links?page_id=eq.${q(page.id)}&workspace_id=eq.${q(workspaceId())}&select=${LINK_COLUMNS}&order=created_at.asc`, {singleFlight:false});
    if (editing !== page || owner !== scope) return;
    if (!Array.isArray(rows)) throw new Error('bad links');
    page.links = rows; page.linksState = 'ready';
  } catch {
    if (editing !== page || owner !== scope) return;
    page.linksState = 'error';
  }
  renderLinks();
}

async function save() {
  if (!editing || busy) return;
  const page = editing, owner = scope;
  if (docEditor && page.blocks[page.open]?.type === 'doc') page.blocks[page.open].doc = docEditor.getValue();
  const blocks = normalizeBlocks(page.blocks), title = String(page.title || '').trim();
  const problem = pageProblem({title, blocks});
  if (problem) { editorStatus(problem); return; }
  busy = true; editorView.querySelector('[data-sp-save]').disabled = true; editorStatus('저장하는 중…');
  try {
    const body = {title, blocks, status:page.status, project_id:page.project_id || null};
    let rows;
    if (!page.id) rows = await rt.api(`/rest/v1/app_share_pages?select=${PAGE_COLUMNS}`, {method:'POST', prefer:'return=representation', body:{workspace_id:workspaceId(), ...body}});
    else rows = await rt.api(`/rest/v1/app_share_pages?id=eq.${q(page.id)}&workspace_id=eq.${q(workspaceId())}${page.updated_at ? `&updated_at=eq.${q(page.updated_at)}` : ''}&select=${PAGE_COLUMNS}`,
      {method:'PATCH', prefer:'return=representation', body:{...body, updated_at:new Date().toISOString()}});
    if (editing !== page || owner !== scope) return;
    if (!Array.isArray(rows) || rows.length !== 1) {
      editorStatus(page.id ? '다른 곳에서 먼저 바뀌어 저장하지 않았어요. 목록으로 나가 다시 열어 주세요.' : '저장 결과를 확인하지 못했어요.');
      return;
    }
    const row = rows[0], first = !page.id;
    Object.assign(page, {id:row.id, title:row.title, status:row.status, project_id:row.project_id || null,
      blocks:Array.isArray(row.blocks) ? structuredClone(row.blocks) : blocks, updated_at:row.updated_at});
    page.saved = snapshotOf(page);
    page.open = -1; page.openBefore = null; page.converted = null;
    if (first) { page.linksState = 'ready'; page.links = []; }
    renderEditor();
    editorStatus(page.status === 'published' ? '저장했어요. 게시 중이에요.' : '저장했어요. 아직 초안이라 링크로는 안 보여요.');
    editorView.querySelector('[data-sp-save]')?.focus({preventScroll:true});
  } catch (e) {
    if (editing === page) editorStatus(message(e, '저장하지 못했어요. 글은 그대로 있으니 다시 눌러 주세요.'));
  } finally {
    busy = false;
    const button = editorView.querySelector('[data-sp-save]'); if (button) button.disabled = false;
  }
}
async function createLink() {
  if (!editing?.id || busy) return;
  const page = editing, owner = scope;
  const label = String(editorView.querySelector('[data-sp-link-label]')?.value || '').trim();
  const day = editorView.querySelector('[data-sp-link-expiry]')?.value || '';
  const problem = labelProblem(label);
  if (problem) { linkStatus(problem); return; }
  let expires_at;
  try { expires_at = expiresAt(day); } catch (e) { linkStatus(e.message); return; }
  busy = true; linkStatus('링크를 만드는 중…');
  try {
    const rows = await rt.api(`/rest/v1/app_share_page_links?select=${LINK_COLUMNS}`, {method:'POST', prefer:'return=representation', body:{workspace_id:workspaceId(), page_id:page.id, label, expires_at}});
    if (editing !== page || owner !== scope) return;
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('no row');
    page.links = [...page.links, rows[0]]; page.linksState = 'ready';
    renderLinks();
    linkStatus(`"${label}" 링크를 만들었어요. [복사]를 눌러 보내세요.`);
    editorView.querySelector(`[data-sp-link-copy="${CSS.escape(rows[0].id)}"]`)?.focus();
  } catch (e) {
    if (editing === page) linkStatus(message(e, '링크를 만들지 못했어요.'));
  } finally { busy = false; }
}
async function copyLink(id) {
  if (!editing?.id) return;
  const page = editing;
  linkStatus('링크를 복사하는 중…');
  try {
    const rows = await rt.api(`/rest/v1/app_share_page_links?id=eq.${q(id)}&page_id=eq.${q(page.id)}&workspace_id=eq.${q(workspaceId())}&select=token`, {singleFlight:false});
    if (editing !== page) return;
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('missing');
    const ok = await copyText(shareUrl(rows[0].token));
    linkStatus(ok ? '링크를 복사했어요. 메신저에 붙여 넣어 보내세요.' : '복사하지 못했어요. 다시 눌러 주세요.');
  } catch (e) {
    if (editing === page) linkStatus(message(e, '링크를 복사하지 못했어요.'));
  }
}
async function turnOff(id) {
  if (!editing?.id || busy) return;
  const page = editing, link = page.links.find(x => x.id === id);
  if (!link || !window.confirm(`"${link.label || '이름표 없음'}" 링크를 끌까요? 이 링크로는 바로 못 열게 돼요.`)) return;
  busy = true; linkStatus('링크를 끄는 중…');
  try {
    const rows = await rt.api(`/rest/v1/app_share_page_links?id=eq.${q(id)}&page_id=eq.${q(page.id)}&workspace_id=eq.${q(workspaceId())}&select=${LINK_COLUMNS}`,
      {method:'PATCH', prefer:'return=representation', body:{disabled_at:new Date().toISOString()}});
    if (editing !== page) return;
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].disabled_at) throw new Error('not off');
    page.links = page.links.map(x => x.id === id ? rows[0] : x);
    renderLinks();
    linkStatus(`"${link.label || '이름표 없음'}" 링크를 껐어요.`);
  } catch (e) {
    if (editing === page) linkStatus(message(e, '링크를 끄지 못했어요. 다시 눌러 주세요.'));
  } finally { busy = false; }
}

function hasContent(block) {
  if (block.type === 'summary' || block.type === 'doc') return !blockIsEmpty(block);
  return !!String(block.title || '').trim() || (block.items || []).some(item => Object.values(item).some(v => String(v || '').trim()));
}
// [새 편집기로 바꾸기] (결정 6 가, 설계 4.2): all blocks become one 글 block, every letter kept (blocksToDoc). Until the
// page is saved, [바꾸기 취소] puts the old blocks back; after saving there is no history of the old shapes.
function paintConvert() {
  const row = editorView.querySelector('[data-sp-convert-row]');
  if (!row || !editing) return;
  const old = editing.blocks.some(b => b.type !== 'doc');
  row.hidden = !old && !editing.converted;
  row.querySelector('[data-sp-convert]').hidden = !old;
  row.querySelector('[data-sp-convert-undo]').hidden = !editing.converted;
  row.querySelector('[data-sp-convert-hint]').textContent = editing.converted
    ? '바꿨어요. 저장하기 전에는 [바꾸기 취소]로 옛 블록으로 돌아가요.'
    : '진행 단계 막대 같은 칸 모양은 번호 목록·표로 바뀌고 글은 모두 남아요.';
}
function convertBlocks() {
  if (!editing || !editing.blocks.some(b => b.type !== 'doc')) return;
  if (!window.confirm('모든 블록을 새 편집기 글 하나로 바꿀까요? 글은 모두 남고, 진행 단계 막대 같은 모양은 번호 목록·표로 바뀌어요. 저장하기 전에는 [바꾸기 취소]로 되돌릴 수 있어요.')) return;
  if (docEditor && editing.blocks[editing.open]?.type === 'doc') editing.blocks[editing.open].doc = docEditor.getValue();
  editing.converted = JSON.parse(JSON.stringify(editing.blocks));
  editing.blocks = [blocksToDoc(editing.blocks)];
  editing.open = -1; editing.openBefore = null;
  renderBlocks();
  editorStatus('새 편집기 글 하나로 바꿨어요. 확인한 뒤 [저장]을 눌러 주세요.');
  editorView.querySelector('[data-sp-convert-undo]')?.focus();
}
function undoConvert() {
  if (!editing?.converted) return;
  editing.blocks = editing.converted; editing.converted = null;
  editing.open = -1; editing.openBefore = null;
  renderBlocks();
  editorStatus('옛 블록으로 돌아갔어요.');
  editorView.querySelector('[data-sp-convert]')?.focus();
}
// After a move the same button keeps focus; in a shown block it is inside the ⋯ menu, which stays open for the next move.
function focusAfterMove(index, delta) {
  const node = editorView.querySelector(`[data-sp-block="${index}"]`);
  const menu = node?.querySelector('[data-sp-more]');
  if (menu) menu.open = true;
  const same = node?.querySelector(`[data-sp-move="${index}:${delta}"]`);
  (same && !same.disabled ? same : node?.querySelector(`[data-sp-move="${index}:${-delta}"]`))?.focus();
}
function closeMenus(except) {
  for (const menu of root.querySelectorAll('details.sp-more[open],details.sp-slot[open]')) if (menu !== except) menu.open = false;
}

root.addEventListener('click', event => {
  const target = event.target.closest?.('button');
  if (!target || !root.contains(target)) return;
  const d = target.dataset;
  if ('spNew' in d) { if (!busy) showEditor(null); return; }
  if ('spReload' in d) { void loadList({force:true}); return; }
  if (d.spOpen) { void openPage(d.spOpen); return; }
  if (!editing) return;
  if ('spClose' in d) { closeEditor(); return; }
  if ('spSave' in d) { void save(); return; }
  if (d.spSetStatus) { editing.status = d.spSetStatus === 'published' ? 'published' : 'draft'; paintStatusButtons(); return; }
  if (d.spAddBlock) { addBlock(d.spAddBlock, editing.blocks.length); return; }
  if (d.spInsert) { const [at, type] = d.spInsert.split(':'); addBlock(type, Number(at)); return; }
  if (d.spEdit !== undefined) { openBlock(Number(d.spEdit)); return; }
  if (d.spDone !== undefined) { closeBlock(); return; }
  if (d.spCancel !== undefined) { closeBlock({cancel:true}); return; }
  if (d.spMove) {
    const [index, delta] = d.spMove.split(':').map(Number), to = index + delta;
    if (to < 0 || to >= editing.blocks.length) return;
    editing.blocks = moveBlock(editing.blocks, index, delta);
    if (editing.open === index) editing.open = to; else if (editing.open === to) editing.open = index;
    renderBlocks(); focusAfterMove(to, delta);
    return;
  }
  if (d.spBlockDel !== undefined) {
    const index = Number(d.spBlockDel), block = editing.blocks[index];
    if (!block || (hasContent(block) && !window.confirm(`${BLOCK_LABELS[block.type]} 블록을 지울까요?`))) return;
    editing.blocks.splice(index, 1);
    if (editing.open === index) { editing.open = -1; editing.openBefore = null; } else if (editing.open > index) editing.open--;
    renderBlocks();
    const near = editorView.querySelector(`[data-sp-block="${Math.min(index, editing.blocks.length - 1)}"]`);
    (near?.querySelector('[data-sp-edit]') || near?.querySelector('[data-sp-block-del]') || editorView.querySelector('[data-sp-add-block]'))?.focus();
    return;
  }
  if (d.spItemAdd !== undefined) {
    const b = Number(d.spItemAdd), block = editing.blocks[b];
    if (!block?.items || block.items.length >= LIMITS.items) return;
    block.items.push(newItem(block.type)); renderBlocks();
    editorView.querySelector(`[data-sp-b="${b}"][data-sp-i="${block.items.length - 1}"]`)?.focus();
    return;
  }
  if (d.spItemDel) {
    const [b, i] = d.spItemDel.split(':').map(Number), block = editing.blocks[b];
    if (!block?.items) return;
    block.items.splice(i, 1);
    if (block.type === 'stages' && block.current >= block.items.length) block.current = Math.max(0, block.items.length - 1);
    renderBlocks();
    editorView.querySelector(`[data-sp-item-add="${b}"]`)?.focus();
    return;
  }
  if ('spConvert' in d) { convertBlocks(); return; }
  if ('spConvertUndo' in d) { undoConvert(); return; }
  if ('spLinkCreate' in d) { void createLink(); return; }
  if ('spLinksReload' in d) { void loadLinks(); return; }
  if (d.spLinkCopy) { void copyLink(d.spLinkCopy); return; }
  if (d.spLinkOff) { void turnOff(d.spLinkOff); return; }
});
root.addEventListener('input', event => {
  if (!editing) return;
  const t = event.target;
  if ('spTitle' in t.dataset) { editing.title = t.value; return; }
  if (t.dataset.spB === undefined || !t.dataset.spF) return;
  const block = editing.blocks[Number(t.dataset.spB)];
  if (!block) return;
  if (t.dataset.spI === undefined) block[t.dataset.spF] = t.value;
  else { const item = block.items?.[Number(t.dataset.spI)]; if (item) item[t.dataset.spF] = t.value; }
});
root.addEventListener('change', event => {
  if (!editing) return;
  const t = event.target;
  if ('spProject' in t.dataset) { editing.project_id = t.value || null; return; }
  if (t.dataset.spCurrent !== undefined) { const block = editing.blocks[Number(t.dataset.spCurrent)]; if (block) block.current = Number(t.value); }
});
root.addEventListener('keydown', event => {
  if (event.key === 'Enter' && 'spLinkLabel' in (event.target.dataset || {})) { event.preventDefault(); void createLink(); }
  if (event.key !== 'Escape' || !editing || event.defaultPrevented) return;
  // Esc closes an open ⋯ / [+ 블록] menu (focus back on its button), otherwise finishes the open block keeping what was typed.
  const menu = event.target.closest?.('details[open]');
  if (menu && root.contains(menu)) { event.preventDefault(); menu.open = false; menu.querySelector('summary')?.focus(); return; }
  if (editing.open >= 0 && event.target.closest?.('.sp-block.is-editing')) { event.preventDefault(); closeBlock(); }
});
// One menu open at a time; a press outside closes them.
root.addEventListener('toggle', event => { if (event.target.open && event.target.matches?.('details.sp-more,details.sp-slot')) closeMenus(event.target); }, true);
document.addEventListener('click', event => { if (editing && !event.target.closest?.('details.sp-more,details.sp-slot')) closeMenus(null); });
// Leaving the menu keeps the editor as it is (nothing is lost); the router forgets our history entry.
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view !== 'pages') { layer = null; return; }
  if (!editing) { void loadList(); return; }
  // Back in the menu with the editor still open: one history entry again so Back closes it first (not while traversing).
  if (event.detail?.source !== 'popstate') layer ||= window.KPTURouter?.layer?.open('share-page-editor', {close:() => closeEditor({fromBack:true})}) || null;
});
window.addEventListener('kptu:session-changed', () => {
  const next = ownerScope();
  if (next === scope) return;
  dropDocEditor();
  scope = next; epoch++; pages = null; listState = 'idle'; editing = null; layer = null; busy = false;
  editorView.replaceChildren(); editorView.hidden = true; listView.hidden = false; delete view.dataset.spEditing;
  renderList();
});

window.KPTUSharePages = {reload:() => loadList({force:true})};
renderList();
void loadList();
})();
