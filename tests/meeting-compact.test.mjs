import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileKind,fileLine,dueText} from '../app/meeting-compact.js';

test('파일 종류 표시는 자료실과 같은 다섯 종류, 나머지는 확장자 또는 "파일"', () => {
  for (const [name, key, label] of [['a.hwp','hwp','HWP'],['b.HWPX','hwp','HWP'],['c.pdf','pdf','PDF'],['d.xlsx','xls','XLS'],['e.csv','xls','XLS'],['f.docx','doc','DOC'],['g.pptx','ppt','PPT'],['h.zip','other','ZIP'],['i.jpeg','other','JPEG'],['noext','other','파일'],['j.verylongext','other','파일']])
    assert.deepEqual(fileKind(name), {key, label}, name);
});

test('파일 한 줄: 종류·이름·크기·상태·끝 버튼, 이름은 escape', () => {
  const html = fileLine({name:'<b>"자료".pdf', meta:'2KB', state:'uploading', label:'올리는 중…', end:'<button>×</button>', attrs:' data-x="1"', cls:'extra', stateAttr:'data-s'});
  assert.match(html, /^<div class="file-line extra uploading" data-x="1">/);
  assert.match(html, /<span class="file-kind" data-kind="pdf" aria-hidden="true">PDF<\/span>/);
  assert.match(html, /<b>&lt;b&gt;&quot;자료&quot;\.pdf<\/b><small>2KB<\/small>/);
  assert.match(html, /<span class="file-line-state" data-s>올리는 중…<\/span>/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /<button>×<\/button><\/div>$/);
  const plain = fileLine({name:'a.hwp'});
  assert.doesNotMatch(plain, /file-line-state|progressbar|<small>/);
});

test('기한 글자는 할 일 화면과 같은 월·일(요일), 날짜가 없으면 빈 값', () => {
  assert.equal(dueText('2026-10-25'), '10. 25. (일)');
  assert.equal(dueText('2026-10-25T00:00:00Z'), '10. 25. (일)');
  assert.equal(dueText(''), '');
  assert.equal(dueText(null), '');
});
