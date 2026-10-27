// ED③ 업데이트 (설계 docs/design/unified-editor.md 11.4 순서 3): the update's big window in the new editor (ed-window.js), for a new update
// (PC top line [+ 추가] → [업데이트], the home and basket update input's [크게]) and for the basket update's [큰 창에서 수정]. An organization's
// or a project's own record input ([크게] there) opens it too (ED③ 기록, 순서 5); the old window is gone (순서 6).
// The window saves nothing by itself: openUpdateWindow hands the save to the opener's own (updateVia, the home input's) or to the same
// existing owner-RLS paths the old window used (update-places.js saveUpdate / saveUpdateWithFiles, the basket upload).
//   - [기록할 곳 ▾] above the text: nothing chosen is the basket (미분류); one or more places as before (update-places.js).
//   - [📎 첨부] under the text: the opener's own file batch (the home input) or this window's.
//   - The saved form (doc) goes with the letters: onto the basket update, or (ED③ 기록, 순서 5) onto one organization's or project's own
//     record. One project's record is a one-line summary, so its letters stop at 500 (textLimitFor).
//   - There is no [업데이트 | 노트] switch here: a note is written from the note input / [+ 추가] → [노트] (note-window.js).
import {openEdWindow} from './ed-window.js';
import {createChoiceSheet} from './choice-sheet.js';
import {validateNoteText, attachNoteDoc} from './basket-data.js';
import {createUploadBatch, uploadBatch} from './basket-upload.js';
import {attachRow} from './note-window.js';
import {readPlaces, placeSources, placeSheetHtml, placeValue, keepPlaces, samePlace, placeList, togglePlace, choiceCountText, placesLabel, PLACE_LIMIT, saveUpdate, saveUpdateWithFiles, rememberPlace, linkFailText, fileFailText, docFailText, textLimitFor} from './update-places.js';

export const UPDATE_TEXT_MAX = 20000;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
function toast(message) {
  const box = document.querySelector('#toast'); if (!box) return;
  box.textContent = message; box.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.add('hidden'), 3200);
}
export const savedMessage = saved => saved.places?.length || saved.place ? `${saved.name || '고른 곳'} 기록에 저장했어요.` : '정리함에 저장했어요.';
let sheet = null, active = null;
function placeSheet() {
  sheet ||= createChoiceSheet({id:'edwPlaceSheet', titleId:'edwPlaceSheetTitle', historyKey:'kptuEdwPlace',
    canOpen:() => !!active && !active.closed(), choices:() => active.load(),
    // UPD-여러곳고르기: a press only marks (pending); [저장] keeps the marks, every other close drops them.
    render:() => { if (active) active.pending = [...active.chosen]; return {title:'기록할 곳 선택', search:'조직·프로젝트 이름 검색', split:true, html:placeSheetHtml(active?.places, active?.pending, esc)}; },
    multi:() => active ? {pressed:value => value === 'basket' ? !active.pending.length : active.pending.some(p => placeValue(p) === value), label:choiceCountText(active.pending)} : null,
    onSelect:(kind, value) => active?.toggle(value), onCommit:() => active?.choose(),
    onError:error => active?.say(error?.message || '기록할 곳을 불러오지 못했어요.')});
  return sheet;
}
function placeRow() {
  const row = document.createElement('div'); row.className = 'edw-place-row';
  const label = document.createElement('span'); label.className = 'edw-place-label'; label.textContent = '기록할 곳';
  const button = document.createElement('button'); button.type = 'button'; button.dataset.edwPlace = ''; button.setAttribute('aria-haspopup', 'dialog');
  row.append(label, button);
  return {row, button};
}

// text: the input's letters (kept as written), or doc: a saved form kept in this tab's memory from an earlier unsaved close.
// place: null (basket), {kind, id} or a list. places: the opener's already read lists (optional). sources: reads for the place lists.
// updateVia(letters, places, doc) → {ok, message?, linkError?, fileError?, docError?} | undefined: the opener's own save (the home input
// keeps its files, photo reading and screen state that way); undefined leaves it to this window's own save.
// own: {place, name} the opener's own record, kept chosen. upload: {getBatch(), isBusy(), onChange(), reset()} the opener's file batch.
// onPlace(places) after [저장] in the sheet. onSaved({kind:'update', place, places, name}) after a save.
// onClose(text, {saved, places, value}) when it closes: text/value = what was written (letters / saved form), saved = it was saved.
export function openUpdateWindow({text = '', doc = null, title = '쓰기', draft = true, place = null, places = null, sources = null, rt = window.KPTURuntime,
  updateVia = null, own = null, upload = null, onPlace = () => {}, onSaved = () => {}, onClose = () => {}} = {}) {
  const owner = rt.session.read()?.user?.id;
  let handle = null, saved = null, flight = null, closed = false, busy = false, ownBatch = upload ? null : createUploadBatch();
  const batch = () => upload ? upload.getBatch() : ownBatch;
  const ownPlace = own?.place || null;
  const say = message => { if (!closed) handle?.say(message); };
  const head = placeRow();
  const files = attachRow({id:'edwUpdateAttach', getBatch:batch, isBusy:() => busy || !!upload?.isBusy?.(), say:message => { upload?.onChange?.(); say(message); paint(); }});
  const state = {
    places, chosen:placeList(place), pending:[],
    closed:() => closed,
    say,
    load() {
      if (state.places) return Promise.resolve(state.places);
      flight ||= (async () => {
        await Promise.all([import('./organization-order.js'), import('./project-catalog.js')]);
        const read = await readPlaces(sources || placeSources(rt), {rt, isCurrent:() => !closed && rt.session.read()?.user?.id === owner});
        if (!read) throw new Error('기록할 곳을 불러오지 못했어요.');
        state.places = read; state.chosen = state.chosen.filter(p => (ownPlace && samePlace(p, ownPlace)) || keepPlaces(read, [p]).length); paint();
        return read;
      })().catch(error => { flight = null; throw error; });
      return flight;
    },
    toggle(value) {
      const next = togglePlace(state.pending, value);
      if (next) state.pending = next; else say(`한 번에 ${PLACE_LIMIT}곳까지 고를 수 있어요.`);
    },
    choose() { state.chosen = [...state.pending]; onPlace(state.chosen); paint(); say(state.chosen.length ? `${name()} 기록에 저장돼요.` : '정리함에 저장돼요.'); },
  };
  const name = () => placesLabel(state.places, state.chosen, p => ownPlace && samePlace(p, ownPlace) ? own.name || '' : '');
  function paint() {
    const label = state.chosen.length ? name() || '고른 곳' : '정리함(미분류)';
    head.button.textContent = label + ' ▾'; head.button.title = '기록할 곳: ' + label;
    head.button.setAttribute('aria-label', state.chosen.length && name() ? '기록할 곳 선택: ' + name() : '기록할 곳 선택');
  }
  head.button.addEventListener('click', () => void placeSheet().open('place', head.button));
  paint();

  // The window's own save (no updateVia): the basket update with the text, its files and the saved form.
  async function saveOwn(letters, target, doc1) {
    const list = batch(), isCurrent = () => rt.session.read()?.user?.id === owner, onChange = () => files.picker.render();
    if (!list.entries.length) return saveUpdate({places:target, text:letters, owner, doc:doc1}, rt);
    let result;
    if (target.length) result = await saveUpdateWithFiles({places:target, text:letters, batch:list, doc:doc1, isCurrent, sameOwner:isCurrent, onChange}, rt);
    else {
      result = await uploadBatch(list, {raw_text:letters, rt, isCurrent, onChange});
      if (doc1 && letters.trim()) { try { await attachNoteDoc(result.note_id, doc1, rt); } catch { result = {...result, docError:true}; } }
    }
    if (!list.blocked && list.entries.every(entry => entry.kind === 'success')) { if (upload) upload.reset?.(); else ownBatch = createUploadBatch(); }
    return result;
  }
  async function run({value, text: letters}) {
    if (rt.session.read()?.user?.id !== owner) return {ok:false, message:'로그인 정보가 바뀌었어요. 다시 열어 주세요.'};
    const count = files.pending(), target = [...state.chosen], label = name();
    busy = true; files.picker.render();
    let warning = '';
    try {
      if (!count) { if (!letters.trim()) return {ok:false, message:'글을 입력해 주세요.'}; if (!target.length || target.length > 1) validateNoteText(letters); }
      const doc1 = letters.trim() ? value : null;
      let result = updateVia ? await updateVia(letters, target, doc1) : undefined;
      if (result === undefined) result = await saveOwn(letters, target, doc1);
      if (result?.ok === false) return result;
      const fileError = result?.fileError || (result?.filed?.ok === false ? result.filed.message || 'FILES' : '');
      if (result?.linkError || fileError || result?.docError) warning = [result?.linkError ? linkFailText : '', fileError ? fileFailText : '', result?.docError ? docFailText : ''].filter(Boolean).join(' ');
      saved = {kind:'update', place:target.length === 1 ? target[0] : null, places:target, name:label};
      // UI-기록할곳되돌리기: places picked here (not the opener's own record alone) come first on the 최근 line next time.
      if (!(target.length === 1 && ownPlace && samePlace(target[0], ownPlace))) rememberPlace(target);
      if (!target.length) window.dispatchEvent(new CustomEvent('kptu:basket-note-created'));
    } catch (error) { return {ok:false, message:error?.message || '저장하지 못했어요. 다시 눌러 주세요.'}; }
    finally { busy = false; if (!closed) files.picker.render(); }
    toast(warning || savedMessage(saved)); onSaved(saved);
    return {ok:true};
  }
  handle = openEdWindow({title, doc, text, draft, saveUnchanged:true, limit:() => files.pending() ? UPDATE_TEXT_MAX : textLimitFor(state.chosen), head:head.row, foot:files.node,
    dirty:() => files.pending() > 0, placeholder:'업데이트 입력(정리함에 저장)', save:{aria:'업데이트로 저장', run},
    onClose:({text: letters, value}) => { closed = true; if (active === state) active = null; sheet?.dismiss(); onClose(letters, {saved, places:[...state.chosen], value}); }});
  if (!handle) return null;
  active = state;
  if (state.chosen.length && !state.places) void state.load().catch(() => {});
  return handle;
}

// [큰 창에서 수정] on the basket update: doc (its saved form) or text (old letters, converted in memory; nothing is written by opening).
// save({value, text}) → Promise<{ok, message?}> is the basket screen's own save (an ok closes the window). attach: {getBatch, isBusy} for [📎 첨부].
export function openUpdateEditWindow({doc = null, text = '', save, attach = null, onClose = () => {}} = {}) {
  let handle = null;
  const files = attach ? attachRow({id:'edwUpdateEditAttach', getBatch:attach.getBatch, isBusy:attach.isBusy, say:message => handle?.say(message)}) : null;
  handle = openEdWindow({title:'큰 창에서 수정', doc, text, limit:UPDATE_TEXT_MAX, foot:files?.node || null,
    dirty:() => (files?.pending() || 0) > 0, placeholder:'업데이트를 쓰세요',
    save:{aria:'업데이트 저장', run:({value, text: letters}) => save({value, text:letters})}, onClose});
  if (handle && files) handle.renderFiles = () => files.picker.render();
  return handle;
}
