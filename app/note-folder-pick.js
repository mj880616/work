// 노트 큰 편집창의 [폴더 ▾] 고르기: 노트 화면의 [새 노트를 넣을 폴더] 창과 같은 부품(choice-sheet.js, 같은 줄 모양)을 쓴다.
// 폴더 목록은 노트가 가진 폴더 이름(readNoteDocs, 기존 owner-RLS 읽기 길)이고, 기존 노트의 폴더는 저장할 때 setNoteFolder(기존 서버 길)로 쓴다.
// 기본값: 노트 화면에서 마지막으로 보던 폴더는 서버 화면 설정(viewPrefs note_folder)에서 읽는다. 기기 저장은 쓰지 않는다.
import {createChoiceSheet} from './choice-sheet.js';
import {viewPrefs} from './view-prefs.js';
import {readNoteDocs, noteFolders} from './basket-data.js';
import {folderFromView, folderLabel, folderChoices} from './note-folder-pick.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const row = (value, label, pressed) => `<button type="button" class="home-choice-row home-choice-pick" data-sheet-value="${esc(value)}" aria-pressed="${pressed}"><span class="home-choice-check" aria-hidden="true"></span><span class="home-choice-name">${esc(label)}</span></button>`;
let sheet = null, active = null;
function folderSheet() {
  sheet ||= createChoiceSheet({id:'edwNoteFolderSheet', titleId:'edwNoteFolderSheetTitle', historyKey:'kptuEdwNoteFolder',
    canOpen:() => !!active && !active.closed(), choices:() => active.load(),
    render:() => { const view = folderChoices(active?.names() || [], active?.get() || null);
      return {title:active?.title || '노트를 넣을 폴더', html:[...view.names.map(name => row('f:' + name, name, active.get() === name)), row('none', '폴더 없음', view.none)].join('')}; },
    onSelect:(kind, value) => active?.set(value.startsWith('f:') ? value.slice(2) : null),
    onError:() => active?.fail()});
  return sheet;
}

// initial: 처음 고른 폴더(이름 또는 null). names: 이미 아는 폴더 목록을 돌려 주는 함수(없으면 열 때 서버에서 읽음).
// title: 고르는 창 제목. onChange(): 고른 뒤 단추를 다시 그리라는 알림.
export function createNoteFolderPick({rt = window.KPTURuntime, initial = null, names = null, title = '노트를 넣을 폴더', onChange = null} = {}) {
  const owner = rt.session.read()?.user?.id;
  let value = initial || null, list = names ? names() : null, flight = null, closed = false, failed = false;
  const watchers = onChange ? [onChange] : [], tell = () => watchers.forEach(fn => fn());
  const state = {
    title,
    closed: () => closed || rt.session.read()?.user?.id !== owner,
    names: () => list || (value ? [value] : []),
    get: () => value,
    fail: () => { failed = true; },
    // 폴더 목록을 아직 모르면 한 번 읽는다. 읽지 못해도 창은 지금 폴더와 '폴더 없음'으로 열린다.
    load() {
      if (list) return Promise.resolve(list);
      flight ||= readNoteDocs(rt).then(result => { list = noteFolders(result.notes); if (value && !list.includes(value)) { value = null; tell(); } return list; }).catch(() => { flight = null; return []; });
      return flight;
    },
    set(next) { value = next || null; tell(); },
  };
  return {
    state,
    get: () => value,
    label: () => folderLabel(value),
    load: () => state.load(),
    watch: fn => { watchers.push(fn); },
    // note-window.js의 noteFolder 자리: 단추를 누르면 고르는 창이 단추 아래(PC)나 아래 시트(모바일)로 열린다.
    open(trigger) { active = state; void folderSheet().open('pick', trigger); },
    close() { closed = true; if (active === state) { active = null; sheet?.dismiss(); } },
    failed: () => failed,
  };
}
// 새 노트의 기본 폴더: 노트 화면에서 마지막으로 보던 폴더(서버 화면 설정). 보지 않았거나 전체·'폴더 없음'이면 null.
export function lastViewedFolder() {
  return folderFromView(viewPrefs.get('note_folder'));
}
