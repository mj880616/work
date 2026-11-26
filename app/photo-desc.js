// S71-62 PHOTO-설명(사용자 결정 2026-11-26: 설명과 태그를 나누지 않고 '설명' 하나로).
// - 크게 보기 [수정 ▾] '설명' = 그 한 장의 설명 바꾸기(지금 설명이 칸에 채워짐). 고르기 [메뉴] '설명 붙이기' = 고른 사진마다 있던 설명 뒤에 더하기.
// - 칸 하나에 문장이든 낱말이든 자유롭게. 칸 아래 자주 쓴 낱말 칩(서버 desc-words)을 누르면 칸 끝에 한 번 넣는다. 따로 '태그' 칸·목록 관리는 없다.
// - 저장 자리는 그 사진 구글 드라이브 파일의 '설명' 칸(서버 gdrive-photos desc-set, 목록 안 내 사진만). 드라이브가 바로 색인해 사진 찾기에 잡힌다.
//   기기 저장 없음. 글은 그릴 때 늘 글자(textContent)로만 넣는다.
import {gdDescGet, gdDescSet, gdDescWords} from './gdrive-photos.js';
import {DESC_MAX, tidyDesc, descLength as len, addWord, canSave} from './photo-desc-model.mjs';
import {notify} from './small-notice.js';
import {waitInlineHtml} from './wait-state.js';

let dialog = null, state = null, layer = null, words = null, wordsFor = '';
const $ = sel => dialog.querySelector(sel);
const FAIL_TEXT = {too_long: `설명이 ${DESC_MAX}자를 넘어 붙이지 못했어요`, missing: '사진을 찾지 못했어요', forbidden: '이 사진은 수정할 권한이 없어요', unavailable: '드라이브가 답하지 않았어요'};
function errorText(error) {
  const code = String(error?.message || error?.code || '');
  if (code === 'scope_missing' || code === 'drive_auth_expired' || code === 'drive_not_connected') return '구글 드라이브를 다시 연결해 주세요.';
  if (code === 'photo_not_in_index') return '사진 목록에 없는 사진이에요. 목록을 새로 읽어 주세요.';
  if (code === 'text_invalid') return `설명을 확인해 주세요(${DESC_MAX}자까지).`;
  return '잠시 뒤 다시 해 주세요.';
}

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'photoDescDialog'; dialog.className = 'photo-desc-sheet'; dialog.setAttribute('aria-labelledby', 'photoDescTitle');
  dialog.innerHTML = `<header class="pd-head"><h2 id="photoDescTitle" data-pd-title>설명</h2><button type="button" class="icon-btn" data-pd-close aria-label="닫기">×</button></header>
<div class="pd-body"><label class="sr-only" for="photoDescText">설명</label>
<textarea id="photoDescText" class="pd-text" data-pd-text rows="3" maxlength="${DESC_MAX}" placeholder="무엇이 찍혔는지, 어디서·누구와 — 낱말만 써도 돼요" autocomplete="off"></textarea>
<div class="pd-words" data-pd-words role="group" aria-label="자주 쓴 낱말" hidden></div></div>
<footer class="pd-foot"><p class="status" data-pd-status role="status" aria-live="polite"></p><span class="pd-count" data-pd-count aria-hidden="true"></span><button type="button" class="primary" data-pd-save disabled>저장</button></footer>`;
  document.body.append(dialog);
  dialog.addEventListener('cancel', e => { e.preventDefault(); if (!state?.saving) close(); });
  dialog.addEventListener('click', e => {
    if (e.target === dialog || e.target.closest('[data-pd-close]')) { if (!state?.saving) close(); return; }
    if (e.target.closest('[data-pd-save]')) return void save();
    const chip = e.target.closest('[data-pd-word]');
    if (chip && state && !state.saving) {
      const box = $('[data-pd-text]');
      box.value = addWord(box.value, chip.dataset.pdWord); paint(); box.focus({preventScroll: true});
    }
  });
  dialog.addEventListener('input', () => paint());
  return dialog;
}
const say = (text, error = false) => { const el = $('[data-pd-status]'); el.textContent = text || ''; el.className = 'status' + (error ? ' error' : ''); };
function paint() {
  if (!state) return;
  const value = tidyDesc($('[data-pd-text]').value), n = len(value);
  $('[data-pd-count]').textContent = `${n}/${DESC_MAX}`;
  $('[data-pd-save]').disabled = state.saving || state.loading || !canSave({mode: state.mode, text: value, before: state.before});
  const used = new Set(value.split(' '));
  dialog.querySelectorAll('[data-pd-word]').forEach(b => b.setAttribute('aria-pressed', String(used.has(b.dataset.pdWord))));
}
function paintWords() {
  const box = $('[data-pd-words]');
  const list = Array.isArray(words) ? words.filter(w => typeof w === 'string' && w).slice(0, 12) : [];
  box.replaceChildren(...list.map(w => Object.assign(document.createElement('button'), {type: 'button', className: 'pd-word', textContent: w, title: `'${w}' 넣기`})));
  [...box.children].forEach((b, i) => { b.dataset.pdWord = list[i]; });
  box.hidden = !list.length;
  paint();
}
async function loadWords(rt, owner) {
  if (wordsFor === owner && words) return paintWords();
  wordsFor = owner; words = null; paintWords();
  try { const d = await gdDescWords(rt); if (wordsFor === owner) { words = Array.isArray(d?.words) ? d.words : []; if (state) paintWords(); } }
  catch { /* 칩만 안 보인다 */ }
}
function close() {
  const l = layer; layer = null; l?.close();
  if (dialog?.open) dialog.close();
  const t = state?.trigger; state = null;
  if (t?.isConnected) t.focus({preventScroll: true});
}
async function save() {
  if (!state || state.saving) return;
  const text = tidyDesc($('[data-pd-text]').value);
  if (len(text) > DESC_MAX) return say(`${DESC_MAX}자까지 쓸 수 있어요.`, true);
  const s = state;
  s.saving = true; paint(); say('저장하는 중…');
  try {
    const d = await gdDescSet(s.rt, s.items.map(x => x.gdId), text, s.mode);
    const done = Array.isArray(d?.done) ? d.done : [], failed = Array.isArray(d?.failed) ? d.failed : [];
    if (done.length) { wordsFor = ''; words = null; }
    if (failed.length && !done.length) { if (state !== s) return; s.saving = false; paint(); return say(FAIL_TEXT[failed[0]?.why] || FAIL_TEXT.unavailable, true); }
    // 창(겹)을 먼저 닫고 화면에 알린다 — 화면이 선택을 풀 때 겹 순서가 섞이지 않게.
    if (state === s) close();
    s.onSaved?.(done);
    notify(failed.length ? `설명을 ${done.length}장에 저장했어요(${failed.length}장은 ${FAIL_TEXT[failed[0]?.why] || FAIL_TEXT.unavailable})`
      : s.mode === 'add' ? `설명을 ${done.length}장에 붙였어요` : text ? '설명을 저장했어요' : '설명을 삭제했어요');
  } catch (error) {
    if (state !== s) return;
    s.saving = false; paint(); say(`저장하지 못했어요: ${errorText(error)}`, true);
  }
}
// items = 구글 드라이브 사진들({gdId}). mode 'set'(한 장, current = 이미 아는 설명 또는 undefined = 서버에서 읽음) | 'add'(여러 장).
// onSaved(done = [{id: 드라이브 id, description}]) — 화면이 크게 보기 한 줄·찾기에 바로 쓰게.
export async function openPhotoDesc(trigger, items, {rt = window.KPTURuntime, mode = 'set', current, owner = '', onSaved = null} = {}) {
  const list = (items || []).filter(x => x?.kind === 'gdrive' && x.gdId).slice(0, 50);
  if (!list.length || (mode === 'set' && list.length !== 1)) return false;
  ensureDialog();
  state = {trigger, rt, mode, items: list, onSaved, before: '', saving: false, loading: false};
  const s = state;
  $('[data-pd-title]').textContent = mode === 'add' ? `설명 붙이기 · ${list.length}장` : '설명';
  const box = $('[data-pd-text]');
  box.value = ''; box.placeholder = mode === 'add' ? '선택한 사진마다 있던 설명 뒤에 붙여요' : '무엇이 찍혔는지, 어디서·누구와 — 낱말만 써도 돼요';
  say('');
  if (mode === 'set') {
    if (typeof current === 'string') { s.before = tidyDesc(current); box.value = current; }
    else {
      s.loading = true; $('[data-pd-status]').innerHTML = waitInlineHtml();
      gdDescGet(rt, list[0].gdId).then(d => {
        if (state !== s) return;
        s.loading = false; s.before = tidyDesc(d?.description || '');
        if (!box.value) box.value = d?.description || '';
        say(''); paint(); onSaved?.([{id: list[0].gdId, description: d?.description || '', read: true}]);
      }, error => { if (state !== s) return; s.loading = false; say(`설명을 읽지 못했어요: ${errorText(error)}`, true); paint(); });
    }
  }
  paintWords();
  if (!dialog.open) dialog.showModal();
  if (!layer) layer = window.KPTURouter?.layer?.open('photo-desc', {close: () => { if (state?.saving) return false; layer = null; close(); return true; }}) || null;
  box.focus({preventScroll: true});
  void loadWords(rt, owner);
  return true;
}
export const photoDescOpen = () => !!dialog?.open;
