// BASKET-업데이트통합 PR 2: one write window for a new text, whichever way it is opened (menu [쓰기], 노트 [+], the home and
// basket input's [크게]). It is the shared editor (md-editor.js) with [업데이트 ▾ | 노트] beside the one save icon:
// - 업데이트: ▾ picks where it goes (update-places.js) — nothing chosen is the basket (미분류), or an organization / a project record.
// - 노트: a kind=note row; its title is the first line (as menu [쓰기] always did). [마크다운] starts off (NOTE-마크다운선택).
// Saving is 저장하고 닫기. Every save is an existing owner-RLS path; an opener may route the update through its own save
// (the home input keeps its attachments that way). Texts that already exist (memo·note edit) keep their own editor call.
// UI-크게첨부: under the text, [📎 첨부] (the basket's own picker part, basket-upload.js) while 업데이트 is chosen. The home input
// hands in its own file batch, every other opener uses one this window keeps and sends through the same basket upload path
// (uploadBatch → basket-files) as the home input. BUG-업데이트첨부연결: with places chosen the files still go (as a basket update
// linked to those places, its files put into their documents: update-places.js saveUpdateWithFiles).
// NOTE-파일붙이기: with [노트] chosen the same [📎 첨부] sits at the end of the format row; the note is made first, then its files
// go up with its id (uploadNoteFiles; basket-files puts them in Drive "노트 첨부"). A note may be files only (titled by the first
// file's name). The opener's batch is emptied after that save (upload.reset).
import { openMarkdownEditor } from './md-editor.js';
import { createChoiceSheet } from './choice-sheet.js';
import { createNoteDoc, noteTitleFromText, validateNoteText } from './basket-data.js';
import { createUploadBatch, uploadBatch, uploadNoteFiles, mountBasketPicker, fileTitle } from './basket-upload.js';
import { readPlaces, placeSources, placeSheetHtml, placeValue, keepPlaces, samePlace, placeList, togglePlace, choiceCountText, placesLabel, PLACE_LIMIT, saveUpdate, saveUpdateWithFiles, rememberPlace, linkFailText, fileFailText } from './update-places.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
let sheet = null, active = null;
function placeSheet() {
  sheet ||= createChoiceSheet({id:'mdPlaceSheet', titleId:'mdPlaceSheetTitle', historyKey:'kptuMdPlace',
    canOpen:() => !!active && !active.closed(), choices:() => active.load(),
    // UPD-여러곳고르기: a press only marks (pending); [저장] keeps the marks, every other close drops them.
    render:() => { if (active) active.pending = [...active.chosen]; return {title:'기록할 곳 선택', search:'조직·프로젝트 이름 검색', split:true, html:placeSheetHtml(active?.places, active?.pending, esc)}; },
    multi:() => active ? {pressed:value => value === 'basket' ? !active.pending.length : active.pending.some(p => placeValue(p) === value), label:choiceCountText(active.pending)} : null,
    onSelect:(kind, value) => active?.toggle(value), onCommit:() => active?.choose(),
    onError:error => active?.say(error?.message || '기록할 곳을 불러오지 못했어요.')});
  return sheet;
}
function toast(message) {
  const box = document.querySelector('#toast'); if (!box) return;
  box.textContent = message; box.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.add('hidden'), 3200);
}
export const savedMessage = (saved) => saved.kind === 'note' ? '노트로 저장했어요.' : saved.places?.length || saved.place ? `${saved.name || '고른 곳'} 기록에 저장했어요.` : '정리함에 저장했어요.';

// kind: 'update' | 'note' (preselected). place: null (basket), {kind, id} or a list of them (UPD-여러곳고르기). places: the opener's already read lists (optional).
// sources: reads for the place lists (default: the window's own). updateVia(text, places): the opener's own update save, resolving
// {ok:true} or {ok:false, message}, or undefined to leave that place to this window's own save.
// noteFolder (optional, NOTE-추가폴더표시): {label(), open(trigger)} adds the note's [폴더 ▾] button beside the title box; the opener owns the
// choice and its picker and calls the returned editor's paint() after it changed.
// own: {place, name} — the opener's own record (organization·project detail). It keeps its name and stays chosen even when the
// place lists do not offer it. upload: {getBatch(), isBusy(), onChange()} — the opener's own file batch (the home input); without
// it the window keeps its own. onPlace(places) after [저장] in the sheet. onSaved({kind, place, places, name, id}) after a save
// (place: the one place when exactly one was chosen); onClose(text, {saved, places}) when it closes.
export function openWriteWindow({text = '', kind = 'update', place = null, places = null, title = '쓰기', draft = true, sources = null,
  rt = window.KPTURuntime, updateVia = null, own = null, noteFolder = null, upload = null, onInput = null, onPlace = () => {}, onSaved = () => {}, onClose = () => {}} = {}) {
  const owner = rt.session.read()?.user?.id;
  let editor = null, saved = null, flight = null, closed = false, busy = false, picker = null, ownBatch = upload ? null : createUploadBatch();
  const batch = () => upload ? upload.getBatch() : ownBatch;
  const files = () => batch().entries.filter(entry => entry.kind !== 'success').length;
  const ownPlace = own?.place || null;
  const state = {
    places, chosen:placeList(place), pending:[],
    closed: () => closed,
    say: message => { const status = document.querySelector('#mdEditor .md-editor-status'); if (status && !closed) status.textContent = message; },
    load() {
      if (state.places) return Promise.resolve(state.places);
      flight ||= (async () => {
        await Promise.all([import('./organization-order.js'), import('./project-catalog.js')]);
        const read = await readPlaces(sources || placeSources(rt), {rt, isCurrent:() => !closed && rt.session.read()?.user?.id === owner});
        if (!read) throw new Error('기록할 곳을 불러오지 못했어요.');
        state.places = read; state.chosen = state.chosen.filter(p => (ownPlace && samePlace(p, ownPlace)) || keepPlaces(read, [p]).length); editor?.paint();
        return read;
      })().catch(error => { flight = null; throw error; });
      return flight;
    },
    toggle(value) {
      const next = togglePlace(state.pending, value);
      if (next) state.pending = next; else state.say(`한 번에 ${PLACE_LIMIT}곳까지 고를 수 있어요.`);
    },
    choose() {
      state.chosen = [...state.pending]; onPlace(state.chosen); editor?.paint();
      state.say(state.chosen.length ? `${name()} 기록에 저장돼요.` : '정리함에 저장돼요.');
    },
  };
  const name = () => placesLabel(state.places, state.chosen, p => ownPlace && samePlace(p, ownPlace) ? own.name || '' : '');
  // The window's own basket save: with files, the basket upload path makes the update with the text (as the home input does).
  async function saveOwn(value, target) {
    // The batch is the opener's own (upload) or this window's; the file list has one owner, whichever opened the window.
    const files = batch();
    if (!files.entries.length) return saveUpdate({places:target, text:value, owner}, rt);
    // BUG-업데이트첨부연결: files with chosen places go up as a basket update, then are linked and filed there (update-places.js).
    const isCurrent = () => rt.session.read()?.user?.id === owner, onChange = () => picker?.render();
    const result = target.length ? await saveUpdateWithFiles({places:target, text:value, batch:files, isCurrent, sameOwner:isCurrent, onChange}, rt) : await uploadBatch(files, {raw_text:value, rt, isCurrent, onChange});
    if (!files.blocked && files.entries.every(entry => entry.kind === 'success')) { if (upload) upload.reset?.(); else ownBatch = createUploadBatch(); }
    return result;
  }
  async function run(value, chosen, {title: heading = '', markdown = false} = {}) {
    if (rt.session.read()?.user?.id !== owner) return {ok:false, message:'로그인 정보가 바뀌었어요. 다시 열어 주세요.'};
    const count = files();
    let warning = '';
    busy = true; picker?.render();
    try {
      if (chosen === 'note') {
        const files = batch();
        if (count && (files.blocked || files.note_id)) return {ok:false, message:'앞선 업데이트의 첨부 저장 결과를 먼저 확인해 주세요.'};
        if (!value.trim() && !heading.trim() && !count) return {ok:false, message:'제목이나 본문을 써 주세요.'};
        const first = files.entries.find(entry => entry.kind !== 'success')?.file?.name;
        const note = await createNoteDoc({title:heading.trim() ? heading : noteTitleFromText(value) || fileTitle(first), raw_text:value, markdown:markdown === true}, rt);
        saved = {kind:'note', id:note.id};
        if (count) {
          try { await uploadNoteFiles(note.id, files, {rt, isCurrent:() => rt.session.read()?.user?.id === owner, onChange:() => picker?.render()}); }
          catch (error) { warning = `노트는 저장했지만 첨부를 올리지 못했어요. ${error?.message || ''} 노트를 열어 다시 붙여 주세요.`.replace(/\s+/g, ' '); }
          if (upload) upload.reset?.(); else ownBatch = createUploadBatch();
        }
      } else {
        const target = [...state.chosen], label = name();
        // BUG-업데이트첨부연결: files go along with any place (the basket, or chosen places through the basket's own paths).
        if (!count) { if (!value.trim()) return {ok:false, message:'글을 입력해 주세요.'}; if (!target.length || target.length > 1) validateNoteText(value); }
        let result = updateVia ? await updateVia(value, target) : undefined;
        if (result === undefined) result = await saveOwn(value, target);
        if (result?.ok === false) return result;
        const fileError = result?.fileError || (result?.filed?.ok === false ? result.filed.message || 'FILES' : '');
        if (result?.linkError || fileError) warning = [result?.linkError ? linkFailText : '', fileError ? fileFailText : ''].filter(Boolean).join(' ');
        saved = {kind:'update', place:target.length === 1 ? target[0] : null, places:target, name:label};
        // UI-기록할곳되돌리기: places picked here (not the opener's own record alone) come first on the 최근 line next time.
        if (!(target.length === 1 && ownPlace && samePlace(target[0], ownPlace))) rememberPlace(target);
        if (!target.length) window.dispatchEvent(new CustomEvent('kptu:basket-note-created'));
      }
    } catch (error) { return {ok:false, message:error?.message || '저장하지 못했어요. 다시 눌러 주세요.'}; }
    finally { busy = false; if (!closed) picker?.render(); }
    toast(warning || savedMessage(saved)); onSaved(saved);
    return {ok:true};
  }
  // [📎 첨부] row: the same picker part as the home input and the memo edit screen, on the opener's batch or this window's own.
  const attach = {show:chosen => chosen === 'update' || chosen === 'note', inTools:chosen => chosen === 'note', pending:files, mount({picker: host, files: list, drop}) {
    picker = mountBasketPicker(host, {id:'mdAttachFiles', filesHost:list, dropTarget:drop, getBatch:batch,
      isBusy:() => busy || !!upload?.isBusy?.(), onChange:() => { upload?.onChange?.(); state.say(''); },
      onError:message => state.say(message)});
  }};
  // NOTE-마크다운선택: [노트] shows the [마크다운] box, off for a new note; an update is always markdown (no box).
  editor = openMarkdownEditor({text, title, draft, onInput, attach, folder:noteFolder ? {show:chosen => chosen === 'note', label:noteFolder.label, open:noteFolder.open} : null, markdown:{value:false, show:chosen => chosen === 'note'}, noteTitle:{kind:'note', label:'노트 제목', placeholder:'노트 제목(비우면 본문 첫 줄)'},
    kinds:{label:'저장할 곳', value:kind, options:[['update', '업데이트'], ['note', '노트']], text:value => value === 'update' && state.chosen.length ? name() || null : null,
      menu:{value:'update', aria:() => state.chosen.length && name() ? '기록할 곳 선택: ' + name() : '기록할 곳 선택', open:trigger => void placeSheet().open('place', trigger)}},
    placeholder:chosen => chosen === 'note' ? '노트 본문을 쓰세요' : state.chosen.length ? `${name() || '고른 곳'} 기록을 입력하세요` : '업데이트 입력(정리함에 저장)',
    save:{aria:chosen => chosen === 'note' ? '새 노트로 저장' : state.chosen.length ? `${name() || '고른 곳'} 기록으로 저장` : '정리함에 새 업데이트로 저장', run},
    onClose:value => { closed = true; if (active === state) active = null; sheet?.dismiss(); onClose(value, {saved, places:[...state.chosen]}); }});
  active = state;
  if (state.chosen.length && !state.places) void state.load().catch(() => {});
  return editor;
}
