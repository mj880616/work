// ED-폰마크다운붙여넣기 ②: markdownLettersOf — which saved forms get the whole-text [서식으로 바꾸기], and the letters it converts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownLettersOf} from '../app/ed-markdown.mjs';
import {looksLikeMarkdown} from '../app/note-markdown.mjs';

const p = (...inline) => ({type:'paragraph', attrs:{style:'body2'}, content:inline});
const t = (text, marks) => (marks ? {type:'text', text, marks} : {type:'text', text});
const form = (...content) => ({v:'ed1', doc:{type:'doc', content}});
const of = value => markdownLettersOf(value, looksLikeMarkdown);

test('plain lines with markdown signs give their letters back, one line per paragraph, empty paragraph = blank line', () => {
  assert.equal(of(form(p(t('## 공통')), p(), p(t('**굵게** 한 줄')), p(t('1. 첫째')))), '## 공통\n\n**굵게** 한 줄\n1. 첫째');
});

test('paragraphs with line breaks (an old plain note) are kept apart by a blank line', () => {
  assert.equal(of(form(p(t('## 공통'), {type:'hard_break'}, t('둘째 줄')), p(t('**셋**')))), '## 공통\n둘째 줄\n\n**셋**');
});

test('no markdown signs, or nothing at all: no offer', () => {
  assert.equal(of(form(p(t('2026.10.21. 회의')), p(t('- 참석: 3명')))), null);
  assert.equal(of(form(p())), null);
  assert.equal(of(null), null);
  assert.equal(of({v:'ed1', doc:{type:'doc', content:[]}}), null);
});

test('anything already formatted is left alone (heading, list, mark, alignment, indent, photo, table)', () => {
  assert.equal(of(form({type:'heading', attrs:{level:2}, content:[t('제목')]}, p(t('## 공통')))), null);
  assert.equal(of(form(p(t('## 공통')), {type:'bullet_list', content:[]})), null);
  assert.equal(of(form(p(t('## 공통')), p(t('굵', [{type:'strong'}])))), null);
  assert.equal(of(form({type:'paragraph', attrs:{style:'body2', align:'center'}, content:[t('## 공통')]})), null);
  assert.equal(of(form({type:'paragraph', attrs:{style:'body2', indent:1}, content:[t('## 공통')]})), null);
  assert.equal(of(form(p(t('## 공통')), {type:'photo', attrs:{src:null, alt:'사진'}})), null);
  assert.equal(of(form(p(t('## 공통')), {type:'table', content:[]})), null);
});

test('a bare doc (no ed1 wrapper) is read the same way', () => {
  assert.equal(of({type:'doc', content:[p(t('| 항목 | 값 |')), p(t('|---|---|')), p(t('| 가 | 1 |'))]}), '| 항목 | 값 |\n|---|---|\n| 가 | 1 |');
});
