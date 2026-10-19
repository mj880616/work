// BASKET-업데이트통합 PR 2: one write window for a new text, whichever way it is opened (menu [쓰기], 노트 [+], the home and
// basket input's [크게]). It is the shared editor (md-editor.js) with [업데이트 ▾ | 노트] beside the one save icon:
// - 업데이트: ▾ picks where it goes (update-places.js) — nothing chosen is the basket (미분류), or an organization / a project record.
// - 노트: a kind=note row; its title is the first line (as menu [쓰기] always did).
// Saving is 저장하고 닫기. Every save is an existing owner-RLS path; an opener may route the update through its own save
// (the home input keeps its attachments that way). Texts that already exist (memo·note edit) keep their own editor call.
import { openMarkdownEditor } from './md-editor.js';
import { createChoiceSheet } from './choice-sheet.js';
import { createNoteDoc, noteTitleFromText, validateNoteText } from './basket-data.js';
import { readPlaces, placeSources, placeSheetHtml, placeFromValue, keepPlace, placeName, saveUpdate } from './update-places.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
let sheet = null, active = null;
function placeSheet() {
  sheet ||= createChoiceSheet({id:'mdPlaceSheet', titleId:'mdPlaceSheetTitle', historyKey:'kptuMdPlace',
    canOpen:() => !!active && !active.closed(), choices:() => active.load(),
    render:() => ({title:'기록할 곳 선택', html:placeSheetHtml(active?.places, active?.place, esc)}),
    onSelect:(kind, value) => active?.choose(value), onError:error => active?.say(error?.message || '기록할 곳을 불러오지 못했어요.')});
  return sheet;
}
function toast(message) {
  const box = document.querySelector('#toast'); if (!box) return;
  box.textContent = message; box.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.add('hidden'), 3200);
}
export const savedMessage = (saved) => saved.kind === 'note' ? '노트로 저장했어요.' : saved.place ? `${saved.name || '고른 곳'} 기록에 저장했어요.` : '바구니에 저장했어요.';

// kind: 'update' | 'note' (preselected). place: null (basket) or {kind, id}. places: the opener's already read lists (optional).
// sources: reads for the place lists (default: the window's own). updateVia(text, place): the opener's own update save, resolving
// {ok:true} or {ok:false, message}. attachments(): how many files the opener holds (they go only with a basket update).
// onSaved({kind, place, name, id}) after a save; onClose(text, {saved, place}) when it closes.
export function openWriteWindow({text = '', kind = 'update', place = null, places = null, title = '쓰기', draft = true, sources = null,
  rt = window.KPTURuntime, updateVia = null, attachments = () => 0, onInput = null, onPlace = () => {}, onSaved = () => {}, onClose = () => {}} = {}) {
  const owner = rt.session.read()?.user?.id;
  let editor = null, saved = null, flight = null, closed = false;
  const state = {
    places, place,
    closed: () => closed,
    say: message => { const status = document.querySelector('#mdEditor .md-editor-status'); if (status && !closed) status.textContent = message; },
    load() {
      if (state.places) return Promise.resolve(state.places);
      flight ||= (async () => {
        await Promise.all([import('./organization-order.js'), import('./project-catalog.js')]);
        const read = await readPlaces(sources || placeSources(rt), {rt, isCurrent:() => !closed && rt.session.read()?.user?.id === owner});
        if (!read) throw new Error('기록할 곳을 불러오지 못했어요.');
        state.places = read; state.place = keepPlace(read, state.place); editor?.paint();
        return read;
      })().catch(error => { flight = null; throw error; });
      return flight;
    },
    choose(value) {
      state.place = placeFromValue(value); onPlace(state.place); editor?.paint();
      state.say(state.place ? `${placeName(state.places, state.place)} 기록에 저장돼요.` : '바구니에 저장돼요.');
    },
  };
  const name = () => placeName(state.places, state.place);
  async function run(value, chosen, {title: heading = ''} = {}) {
    if (rt.session.read()?.user?.id !== owner) return {ok:false, message:'로그인 정보가 바뀌었어요. 다시 열어 주세요.'};
    const files = attachments();
    try {
      if (chosen === 'note') {
        if (files) return {ok:false, message:'첨부는 업데이트(바구니)로만 저장돼요. 업데이트로 바꾸거나 첨부를 빼 주세요.'};
        if (!value.trim() && !heading.trim()) return {ok:false, message:'제목이나 본문을 써 주세요.'};
        const note = await createNoteDoc({title:heading.trim() ? heading : noteTitleFromText(value), raw_text:value}, rt);
        saved = {kind:'note', id:note.id};
      } else {
        const target = state.place, label = name();
        if (target && files) return {ok:false, message:'첨부는 바구니로만 저장돼요. ▾에서 바구니를 고르거나 첨부를 빼 주세요.'};
        if (!(updateVia && !target && files)) { if (!value.trim()) return {ok:false, message:'글을 입력해 주세요.'}; if (!target) validateNoteText(value); }
        const result = updateVia ? await updateVia(value, target) : await saveUpdate({place:target, text:value, owner}, rt);
        if (result?.ok === false) return result;
        saved = {kind:'update', place:target, name:label};
        if (!target) window.dispatchEvent(new CustomEvent('kptu:basket-note-created'));
      }
    } catch (error) { return {ok:false, message:error?.message || '저장하지 못했어요. 다시 눌러 주세요.'}; }
    toast(savedMessage(saved)); onSaved(saved);
    return {ok:true};
  }
  editor = openMarkdownEditor({text, title, draft, onInput, noteTitle:{kind:'note', label:'노트 제목', placeholder:'노트 제목(비우면 본문 첫 줄)'},
    kinds:{label:'저장할 곳', value:kind, options:[['update', '업데이트'], ['note', '노트']], text:value => value === 'update' && state.place ? name() || null : null,
      menu:{value:'update', aria:() => state.place && name() ? '기록할 곳 선택: ' + name() : '기록할 곳 선택', open:trigger => void placeSheet().open('place', trigger)}},
    placeholder:chosen => chosen === 'note' ? '노트 본문을 쓰세요' : state.place ? `${name() || '고른 곳'} 기록을 입력하세요` : '업데이트 입력(바구니에 저장)',
    save:{aria:chosen => chosen === 'note' ? '새 노트로 저장' : state.place ? `${name() || '고른 곳'} 기록으로 저장` : '바구니에 새 업데이트로 저장', run},
    onClose:value => { closed = true; if (active === state) active = null; sheet?.dismiss(); onClose(value, {saved, place:state.place}); }});
  active = state;
  if (state.place && !state.places) void state.load().catch(() => {});
  return editor;
}
