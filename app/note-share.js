// S71-69 SHARE-글공유 ②: 노트 [공유] 화면 쪽(계산은 note-share-model.mjs). basket-notes.js가 노트 ⋯(목록 줄·노트 화면 같은 메뉴)에서 부른다.
// - 글: 폰(좁은 화면, 기기 공유 창 있음) = 기기 공유 창 {title, text}, PC·펼친 폴드·공유 창 없는 곳(폰 앱 화면) = 복사 + '복사했어요'.
// - 고르기 창: 공용 아래 시트·PC 작은 목록(choice-sheet.js — 큰 쓰기 창 [내보내기]와 같은 부품).
// - 파일(HTML·PDF): 폰 = 기기 공유 창에 파일로(못 하면 내려받기), PC = 내려받기. 폰 앱 화면의 PDF는 앱 다리(app-share.js)로 안드로이드 공유 창.
// 공유는 사용자가 누를 때만 시작한다. 파일은 이 기기 메모리에서만 만들고(서버 사본 없음), 기기 저장소에 두지 않는다.
import {createChoiceSheet} from './choice-sheet.js';
import {menusSettling} from './menu-dismiss.js';
import {copyText} from './copy-text.js';
import {notify} from './small-notice.js';
import {wideShare} from './link-share-model.mjs';
import {appShare, docMimeOf} from './app-share.js';
import {download} from './note-board-export.js';
import {NOTE_SHARE_TITLE, NOTE_SHARE_NOTE, noteShareChoices} from './note-share-model.mjs';

const say = (text, opts = {}) => notify(text, {record: false, ...opts});
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// 글 보내기. 돌려주는 값: 'shared' · 'cancel' · 'copied' · 'failed' · 'none'.
export async function shareNoteText(data, {nav = globalThis.navigator, wide = wideShare(), copy = copyText, tell = say} = {}) {
  if (!data?.text) { tell(NOTE_SHARE_NOTE.noText, {error: true}); return 'none'; }
  if (!wide && typeof nav?.share === 'function') {
    try { await nav.share(data.title ? {title: data.title, text: data.text} : {text: data.text}); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancel'; }
  }
  const ok = await copy(data.text).catch(() => false);
  tell(ok ? NOTE_SHARE_NOTE.copied : NOTE_SHARE_NOTE.copyFail, {error: !ok});
  return ok ? 'copied' : 'failed';
}

// 파일 보내기. 돌려주는 값: 'shared' · 'cancel' · 'again'(누른 효력이 끝나 막힘 — 알림 [보내기]로 한 번 더) · 'saved'(내려받음) · 'failed'.
export async function shareNoteFile(file, {nav = globalThis.navigator, wide = wideShare(), app = appShare(), save = download, tell = say} = {}) {
  if (!file?.size) { tell(NOTE_SHARE_NOTE.failed, {error: true}); return 'failed'; }
  if (!wide) {
    if (typeof nav?.share === 'function' && nav.canShare?.({files: [file]})) {
      try { await nav.share({files: [file], title: file.name}); return 'shared'; }
      catch (e) {
        if (e?.name === 'AbortError') return 'cancel';
        if (e?.name === 'NotAllowedError') {
          tell(NOTE_SHARE_NOTE.again, {ms: 15000, actions: [{label: '보내기', run: ({close}) => { close(); void shareNoteFile(file, {nav, wide, app, save, tell}); }}]});
          return 'again';
        }
      }
    } else if (app?.known?.() && docMimeOf(file.name)) {
      const r = await app.share([{file}]);
      if (r === 'shared') return 'shared';
    }
  }
  save(file, file.name, file.type);
  tell(NOTE_SHARE_NOTE.saved);
  return 'saved';
}

// 고르기 창 하나(노트 화면마다 같은 것). open(trigger, {canLink, onPick(value)}).
let sheet = null, pending = null;
export function openNoteShareChoices(trigger, {canLink = true, onPick} = {}) {
  sheet ||= createChoiceSheet({id: 'noteShareSheet', titleId: 'noteShareSheetTitle', historyKey: 'kptuNoteShare',
    canOpen: () => !!pending, choices: async () => {},
    render: () => ({title: NOTE_SHARE_TITLE, html: noteShareChoices({canLink: pending?.canLink}).map(([value, label]) => `<button type="button" class="home-choice-row" data-sheet-value="${esc(value)}" data-note-share="${esc(value)}">${esc(label)}</button>`).join('')}),
    // 글만 보내기는 바로(누른 효력이 살아 있을 때 공유 창). 파일·링크는 창이 닫힌 뒤에(열린 창 밖은 눌리지 않아 내려받기·확인 창이 막힌다).
    onSelect: (kind, value) => {
      const p = pending; pending = null;
      if (value === 'text') { p?.onPick?.(value); return; }
      void (async () => { const el = document.getElementById('noteShareSheet'); for (let i = 0; i < 80 && el?.open; i++) await new Promise(r => setTimeout(r, 25)); p?.onPick?.(value); })();
    }});
  pending = {canLink, onPick};
  // ⋯ 메뉴 항목은 그 메뉴 겹의 뒤로가기(popstate)를 받은 바로 그 자리(같은 사건의 microtask)에서 불린다. 거기서 바로 열면 고르기 창이
  // 기록 칸을 넣은 뒤 같은 popstate를 늦게 받아 '내 칸이 아닌 뒤로가기'로 보고 곧장 닫힌다. 그래서 메뉴 닫기가 끝나고(menu-dismiss.js),
  // 그 사건 처리가 다 끝난 다음 차례(setTimeout 0)에 연다.
  return Promise.resolve(menusSettling()).then(() => new Promise(r => setTimeout(r, 0))).then(() => (pending ? sheet.open('share', trigger) : undefined));
}
