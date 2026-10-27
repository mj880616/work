// ED③ 기록 (설계 11.4 순서 5): the big window of an existing record in the new editor (ed-window.js) — an organization record's edit,
// a project record's edit, and a basket link's summary. It opens on the record's saved form (doc), else on its letters converted once in
// memory (nothing is written by opening). The window saves nothing by itself: save({value, text}) is the screen's own save
// (ok closes the window). textOnly: the field keeps letters only (the link summary), so save gets value = null.
import {openEdWindow} from './ed-window.js';

export function openRecordEditWindow({doc = null, text = '', title = '큰 창에서 수정', aria = '저장', placeholder = '', limit = 0, textOnly = false, save, onClose = () => {}} = {}) {
  return openEdWindow({title, doc, text, limit, textOnly, placeholder, save: {aria, run: save}, onClose});
}
