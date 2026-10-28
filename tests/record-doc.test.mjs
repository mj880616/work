import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hasDoc,sameRecord,recordPatch,lettersPatch} from '../app/record-doc.mjs';
// ED③ 기록 (설계 11.4 순서 5): the small pure parts of keeping a record's saved form next to its letters.
const DOC={v:'ed1',doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'글'}]}]}};

test('hasDoc: only a well-formed saved form counts', () => {
  assert.equal(hasDoc({doc:DOC}), true);
  assert.equal(hasDoc({doc:null}), false);
  assert.equal(hasDoc({}), false);
  assert.equal(hasDoc(null), false);
  assert.equal(hasDoc({doc:{v:'ed1'}}), false);
});

test('sameRecord: a row changed since it was read is not the same (letters or saved form), line ends do not matter', () => {
  const held = {id:'r', raw_text:'가\n나', doc:DOC};
  assert.equal(sameRecord({id:'r', raw_text:'가\r\n나', doc:structuredClone(DOC)}, held, 'raw_text'), true);
  assert.equal(sameRecord({id:'r', raw_text:'가', doc:DOC}, held, 'raw_text'), false);
  assert.equal(sameRecord({id:'r', raw_text:'가\n나', doc:null}, held, 'raw_text'), false);
  assert.equal(sameRecord({id:'r', summary:'x', doc:null}, {id:'r', summary:'x'}, 'summary'), true);
  assert.equal(sameRecord(null, held, 'raw_text'), false);
  assert.equal(sameRecord(held, undefined, 'raw_text'), false);
});

test('the bodies: a window save writes letters and form together; a letters-only edit drops the form with it', () => {
  assert.deepEqual(recordPatch('summary', {text:'글', value:DOC}), {summary:'글', doc:DOC});
  assert.deepEqual(lettersPatch('raw_text', '글'), {raw_text:'글', doc:null});
});

test('the organization and project screens wire the new window, never the old one, and read the saved form', () => {
  const org = readFileSync('app/workplace-detail.js', 'utf8'), project = readFileSync('app/project-system-v3.js', 'utf8');
  for (const [name, src] of [['org', org], ['project', project]]) {
    assert.ok(!/write-window|md-editor|openMarkdownEditor|openWriteWindow|#mdEditor/.test(src), name);
  }
  assert.match(org, /update-window\.js/);
  // MTG-프로젝트합치기 3단계: 프로젝트 상세에는 진행 기록 입력칸·[크게]가 없다(기록은 사업 보고 한 곳). 지난 기록 고치기는 record-window.js.
  assert.doesNotMatch(project, /update-window\.js/);
  assert.match(org, /record-window\.js/);
  assert.match(project, /record-window\.js/);
  assert.match(org, /select=id,occurred_at,raw_text,detail_text,doc/);
  assert.ok(!/select=id,occurred_at,raw_text,detail_text(?!,doc)/.test(org));
});
