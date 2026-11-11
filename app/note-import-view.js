// NOTE-주소로 가져오기 2단계(화면): 열린 노트 맨 위 원문 칸의 유일한 renderer(설계 5절 '원문 링크 줄을 한 곳에서만 그린다').
// 위에서부터: 가져오는 중 한 줄(아래 회색 빈 줄과 함께) 또는 실패 안내 한 줄([다시 시도][주소만 두기], 빨간 큰 오류 창 없음) → 원문 링크 한 줄(+가져온 날) → 저자·발행일.
// 글자는 모두 textContent로 넣는다(서버·바깥 글에서 온 사이트 이름·저자를 HTML로 넣지 않음). 링크는 https 주소만(note-import-model.mjs noteSource).
import {iconNode} from './tree-icons.js';
import {waitEl} from './wait-state.js';
import {noteSource, failInfo, sourceLabel, sourceByline, fetchedText} from './note-import-model.mjs';
import {isImporting, importFailReason, retryNoteImport, keepUrlOnly} from './note-import.js';

const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };

// 그 노트가 지금 어떤 상태인가: {source, busy, fail} — fail은 안내할 이유(없으면 null).
export function noteImportState(note) {
  const source = noteSource(note);
  if (!source) return {source: null, busy: false, fail: null};
  const busy = isImporting(note.id);
  if (busy) return {source, busy, fail: null};
  // 서버에 '가져오는 중'으로 남았는데 이 접속에 그 일이 없으면 끊긴 것이다(앱을 닫았거나 표시를 남기지 못함).
  const fail = source.state === 'fetching' ? importFailReason(note.id) || 'stopped' : source.state === 'failed' && !source.kept ? importFailReason(note.id) || source.reason || 'busy' : null;
  return {source, busy: false, fail};
}

// host: 노트 읽기 화면의 [data-note-source]. note: 열린 노트. onChange(saved?): 눌러서 상태가 바뀐 뒤(부른 화면이 다시 그린다). say(text): 그 화면의 상태 줄.
// 반환: {busy} — 가져오는 중이면 부른 화면이 본문 자리(주소만)를 잠시 감춘다.
export function paintNoteSource(host, note, {rt = window.KPTURuntime, onChange = () => {}, say = () => {}} = {}) {
  const {source, busy, fail} = noteImportState(note);
  host.replaceChildren();
  host.hidden = !source;
  if (!source) return {busy: false};
  if (busy) {
    // 기다림 표시는 공용 부품(wait-state.js): 움직이는 막대는 화면 맨 위 한 곳, 여기는 글 한 줄과 아래 회색 빈 줄뿐이다.
    const line = el('p', 'ni-prog', '가져오는 중 · 이 화면을 나가도 계속해요'); line.setAttribute('role', 'status'); line.dataset.niBusy = '';
    host.append(line);
  } else if (fail) {
    const info = failInfo(fail), line = el('div', 'ni-warn'); line.setAttribute('role', 'status'); line.dataset.niFail = fail;
    line.append(el('span', 'ni-warn-text', info.text));
    const acts = el('span', 'ni-warn-acts');
    if (info.retry) {
      const retry = el('button', 'secondary', '다시 시도'); retry.type = 'button'; retry.dataset.niRetry = '';
      retry.addEventListener('click', async () => { retry.disabled = true; if (await retryNoteImport(note, {rt})) onChange(); else { retry.disabled = false; say('다시 시도하지 못했어요. 다시 눌러 주세요.'); } });
      acts.append(retry);
    }
    const keep = el('button', 'secondary', '주소만 두기'); keep.type = 'button'; keep.dataset.niKeep = '';
    keep.addEventListener('click', async () => {
      keep.disabled = true;
      try { onChange(await keepUrlOnly(note, {rt})); } catch { keep.disabled = false; say('안내를 거두지 못했어요. 다시 눌러 주세요.'); }
    });
    acts.append(keep); line.append(acts); host.append(line);
  }
  const src = el('div', 'ni-src'), link = el('a', 'ni-src-link');
  link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.append(el('span', 'ni-src-name', sourceLabel(source)));
  const out = el('span', 'ni-src-out', '↗'); out.setAttribute('aria-hidden', 'true');
  link.append(out); link.setAttribute('aria-label', `원문 열기: ${sourceLabel(source)}`);
  src.append(iconNode('link', {size: 14}), link);
  const day = source.state === 'ok' ? fetchedText(source.fetched_at) : '';
  if (day) src.append(el('span', 'ni-src-day', day + (source.reason === 'lead' || source.reason === 'cut' ? ' · 앞부분만' : '')));
  host.append(src);
  const by = source.state === 'ok' ? sourceByline(source) : '';
  if (by) host.append(el('div', 'ni-by', by));
  if (busy) host.append(waitEl({rows: 5}));
  return {busy};
}
