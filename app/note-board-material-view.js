// S71-54 NOTE-주제재료잇기: 재료 칩 한 번 누름 = 보드 위에서 열어 보기(보드를 떠나지 않음 — S71-49 '보드 위에서 보기'와 같은 원칙).
// PC(761px~)는 보드 칸 오른쪽 옆 칸(판 위에 겹침, 판은 그대로 움직임), 폰은 아래에서 올라오는 판(하단바 위). 이 파일이 그 칸의 유일한 그리기 주인.
// - 노트: 제목 + 본문(노트 읽기와 같은 그리기 — 새 편집기 글은 paintDoc, 마크다운은 renderMarkdownInto, 아니면 글 그대로). 잠긴 노트는 '잠긴 노트예요' 한 줄만.
//   [노트 열기]를 눌렀을 때만 노트 화면으로 간다(보드를 떠나는 것은 그 단추 하나).
// - 자료실 자료: 이름·파일 이름·올린 날 + [자료실에서 보기]·[드라이브에서 열기](주소가 있을 때). 자료 줄은 owner RLS로 그때 읽는다(기기 저장 없음).
// - 링크는 이 칸을 쓰지 않는다(부르는 쪽이 새 탭으로 연다, noopener).
// 닫기: ✕ · Esc · 폰 뒤로가기(라우터 layer가 있으면). 닫으면 누른 칩으로 초점.
import {renderMarkdownInto, showPlainText} from './markdown-view.js';
import {paintDoc} from './note-body.js';
import {noteMarkdown} from './note-markdown.mjs';
import {iconSvg} from './tree-icons.js';
import {waitEl} from './wait-state.js';

const wide = () => !!globalThis.matchMedia?.('(min-width:761px)')?.matches;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

/** host(): 보드 칸(옆 칸을 붙일 곳). readDoc(id) → 자료 줄 또는 null. openNote(id) · openDoc(id) · openDrive(url): 보드를 떠나는 단추. */
export function createMaterialView({host, rt = globalThis.window?.KPTURuntime, titleOf, hidden = () => false, readDoc, openNote, openDoc, openDrive}) {
  let panel = null, now = null, layer = null;
  function ensure() {
    const h = host(); if (!h) return null;
    if (panel && panel.parentNode === h) return panel;
    panel?.remove();
    panel = el('aside', 'nbm-view'); panel.hidden = true; panel.dataset.nbmView = ''; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false'); panel.tabIndex = -1;
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
    panel.addEventListener('pointerdown', e => e.stopPropagation()); // 판 끌기·고르기로 번지지 않게
    h.append(panel);
    return panel;
  }
  function head(kind, title) {
    const top = el('div', 'nbm-view-head');
    const ico = el('span', 'nbm-view-ico'); ico.innerHTML = iconSvg(kind === 'note' ? 'doc' : 'clip', {size:14});
    const name = el('h3', 'nbm-view-title', title); name.id = 'nbmViewTitle';
    const x = el('button', 'icon-btn nbm-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', '닫기'); x.title = '닫기 (Esc)'; x.addEventListener('click', () => close());
    top.append(ico, name, x); return top;
  }
  const act = (label, fn, cls = 'secondary') => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', fn); return b; };
  async function open(m, {note = null, trigger = null} = {}) {
    const p = ensure(); if (!p) return;
    const run = Symbol('view'); now = {m, trigger, run};
    p.classList.toggle('nbm-view-sheet', !wide());
    p.setAttribute('aria-labelledby', 'nbmViewTitle');
    const body = el('div', 'nbm-view-body'), acts = el('div', 'nbm-view-acts');
    if (m.kind === 'note') {
      const locked = !note || hidden(note);
      p.replaceChildren(head('note', locked ? (note ? '잠긴 노트' : '노트') : titleOf(note)), body, acts);
      if (!note) body.append(el('p', 'nbm-view-empty', '이 노트를 찾지 못했어요. 삭제했거나 아직 읽지 못했어요.'));
      else if (locked) body.append(el('p', 'nbm-view-empty', '잠긴 노트예요. 노트 화면에서 풀고 보세요.'));
      else {
        const text = el('div', 'nbm-view-text basket-read-text'); body.append(text);
        const raw = String(note.raw_text || '');
        if (!paintDoc(text, note, {rt})) {
          if (!raw.trim()) showPlainText(text, '본문이 없는 노트입니다.');
          else if (noteMarkdown(note)) { showPlainText(text, raw); void renderMarkdownInto(text, raw, {isCurrent:() => now?.run === run}); }
          else showPlainText(text, raw);
        }
      }
      if (note) acts.append(act('노트 열기', async () => { await close({focus:false}); openNote(m.ref); }));
    } else {
      p.replaceChildren(head('doc', m.name || '자료'), body, acts);
      body.append(waitEl({rows:2}));
      p.hidden = false; show(p);
      let doc = null; try { doc = await readDoc(m.ref); } catch { doc = null; }
      if (now?.run !== run) return;
      body.replaceChildren();
      if (!doc) body.append(el('p', 'nbm-view-empty', '이 자료를 찾지 못했어요. 삭제했을 수 있어요.'));
      else {
        p.querySelector('.nbm-view-title').textContent = doc.title || doc.file_name || '자료';
        const dl = el('dl', 'nbm-view-meta');
        for (const [k, v] of [['파일', doc.file_name], ['올린 날', String(doc.created_at || '').slice(0, 10)], ['설명', doc.description]]) if (v) dl.append(el('dt', '', k), el('dd', '', String(v)));
        body.append(dl);
        acts.append(act('자료실에서 보기', async () => { await close({focus:false}); openDoc(m.ref); }));
        if (typeof doc.drive_url === 'string' && /^https:\/\//.test(doc.drive_url)) acts.append(act('드라이브에서 열기', () => openDrive(doc.drive_url)));
      }
      return;
    }
    show(p);
  }
  function show(p) {
    p.hidden = false;
    if (!layer) layer = globalThis.window?.KPTURouter?.layer?.open?.('note-board-material', {close:() => close({fromBack:true})}) || null;
    p.focus({preventScroll:true});
  }
  function close({focus = true, fromBack = false} = {}) {
    if (!now) return Promise.resolve();
    const back = now.trigger; now = null;
    if (panel) { panel.hidden = true; panel.replaceChildren(); }
    const l = layer; layer = null;
    if (focus && back?.isConnected) back.focus?.({preventScroll:true});
    return l && !fromBack ? Promise.resolve(l.close?.()) : Promise.resolve(); // 뒤로가기 칸을 다 돌려받은 뒤 다른 화면으로 가게(늦은 뒤로가기가 되돌리지 않게)
  }
  return {open, close, isOpen:() => !!now, current:() => now?.m || null};
}
