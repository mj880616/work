import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import MarkdownIt from '../app/markdown-lib/markdown-it-15.0.2/markdown-it.esm.min.mjs';
import {safeHref} from '../app/ed-schema.mjs';
import {toPlain} from '../app/ed-text.mjs';
import {noteStartDoc, needsMarkdown, hasDoc, noteDrivePhotos} from '../app/note-doc.mjs';
import {renderDoc} from '../app/ed-render.mjs';
// ED③ 노트 화면: how a note opens in the new editor (in memory only) and its drive: photos. 합성 글.
const md=new MarkdownIt({html:false,linkify:true,breaks:true,typographer:false});md.linkify.set({fuzzyEmail:false});md.validateLink=u=>!!safeHref(u);
const doc={v:'ed1',doc:{type:'doc',content:[{type:'paragraph',attrs:{style:'body2'},content:[{type:'text',text:'저장된'}]}]}};

test('a note with doc opens its own saved form; markdown is needed only for a markdown note without doc',()=>{
  assert.equal(hasDoc({doc}),true);assert.equal(needsMarkdown({doc,raw_text:'## x'}),false);
  assert.equal(toPlain(noteStartDoc({doc,raw_text:'다른 글'})),'저장된');
  assert.equal(needsMarkdown({raw_text:'## 제목',metadata:{}}),true);assert.equal(needsMarkdown({raw_text:'## 제목',metadata:{markdown:false}}),false);
});
test('an old note written as is keeps every line and break when opened (no "1." "-" or date read as format)',()=>{
  const raw='1. 첫째 할 일\n- 둘째 줄\n2026. 10. 21. 교섭 일정\n\n    들여 쓴 줄';
  const v=noteStartDoc({raw_text:raw,metadata:{markdown:false}},md);
  assert.deepEqual(v.doc.content.map(n=>n.type),['paragraph','paragraph']);
  assert.equal(toPlain(v),raw.replace(/^ +/m,'    '));
});
test('an old markdown note opens as format, with the date-line guard of the old read view',()=>{
  const note={raw_text:'## 쟁점\n\n2026. 10. 21. 교섭\n\n- **기본급** 인상',metadata:{}};
  const v=noteStartDoc(note,md);
  assert.deepEqual(v.doc.content.map(n=>n.type),['heading','paragraph','bullet_list']);
  assert.equal(toPlain(v),'쟁점\n\n2026. 10. 21. 교섭\n\n- 기본급 인상');
  // Without markdown-it (it failed to load) the letters stay as they are: nothing is lost.
  assert.equal(toPlain(noteStartDoc(note,null)),note.raw_text);
});
test('drive: photos are found anywhere in a saved form; the read view marks them for the owner-only note screen',()=>{
  const v={v:'ed1',doc:{type:'doc',content:[{type:'image',attrs:{src:'drive:abc_1',alt:'사진'}},{type:'blockquote',content:[{type:'image',attrs:{src:'drive:def-2'}}]},{type:'image',attrs:{src:'share:x'}}]}};
  assert.deepEqual(noteDrivePhotos(v),['abc_1','def-2']);
  const src=readFileSync('app/ed-render.mjs','utf8');
  assert.match(src,/setAttribute\('data-ed-drive', a\.src\.slice\(6\)\)/);
  assert.doesNotMatch(src.split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n'),/\?\.|\?\?|replaceChildren/,'old Samsung syntax kept');
  void renderDoc;
});
test('the note screen uses the new editor and window; the [마크다운] box is gone; copies use ed-text when a doc exists',()=>{
  const notes=readFileSync('app/basket-notes.js','utf8');
  assert.doesNotMatch(notes,/data-note-markdown|openMarkdownEditor|openWriteWindow|md-editor\.js|write-window\.js/);
  assert.match(notes,/docCopy\(note\) \|\| noteCopyPayload\(note\)/);
  assert.match(notes,/version:fieldBase/);
  const body=readFileSync('app/note-body.js','utf8');
  assert.match(body,/shortcuts: true/);assert.match(body,/toTelegram as docTelegram/);
  const win=readFileSync('app/note-window.js','utf8');
  assert.match(win,/shortcuts: true/);assert.match(win,/markdown: false, doc:/);
  // The share page editor keeps "no format while typing" (결정 2 가): it does not pass shortcuts.
  assert.doesNotMatch(readFileSync('app/share-pages.js','utf8'),/shortcuts\s*:/);
});
