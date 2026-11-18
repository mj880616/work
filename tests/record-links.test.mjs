// S62-02 MTG-원문칸넘침: 사업 보고 내용 안 주소(http·https만)를 링크·북마크 줄로 나누는 순수 함수. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recordLinkParts,bookmarkLine,linkHost} from '../app/record-links.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('줄 안 주소는 조각으로, 끝 문장부호·닫는 괄호는 주소에서 뺀다',()=>{
  assert.deepEqual(recordLinkParts('기사: https://news.example.org/a/b?id=1. 끝'),[{text:'기사: '},{url:'https://news.example.org/a/b?id=1'},{text:'. 끝'}]);
  assert.deepEqual(recordLinkParts('(https://example.com/x)'),[{text:'('},{url:'https://example.com/x'},{text:')'}]);
  assert.deepEqual(recordLinkParts('https://en.example.org/wiki/A_(b)'),[{url:'https://en.example.org/wiki/A_(b)'}]);
  assert.deepEqual(recordLinkParts('두 개 http://a.example.com 와 https://b.example.com/긴주소'),[{text:'두 개 '},{url:'http://a.example.com'},{text:' 와 '},{url:'https://b.example.com/긴주소'}]);
  assert.deepEqual(recordLinkParts('주소 없음'),[{text:'주소 없음'}]);
});
test('http·https만 링크(javascript:·ftp:·data: 아님)',()=>{
  for(const bad of ['javascript:alert(1)','ftp://example.com/a','data:text/html,x','mailto:a@example.com'])assert.deepEqual(recordLinkParts(bad),[{text:bad}],bad);
  assert.equal(linkHost('javascript:alert(1)'),'');assert.equal(linkHost('https://www.example.co.kr/a'),'example.co.kr');
});
test('줄 전체가 주소 하나면 북마크 줄',()=>{
  assert.equal(bookmarkLine('  https://news.example.org/article/20261114000123  '),'https://news.example.org/article/20261114000123');
  assert.equal(bookmarkLine('기사 https://news.example.org/a'),'');
  assert.equal(bookmarkLine('https://a.example.com https://b.example.com'),'');
  assert.equal(bookmarkLine(''),'');
});
test('보기: 링크는 새 창(noopener), 바깥 주소를 읽어 오지 않는다, 긴 말은 칸 안에서 줄바꿈',()=>{
  const v=read('app/record-text-view.js'),css=read('app/meeting-ui.css');
  assert.match(v,/a\.target = '_blank'; a\.rel = 'noopener noreferrer';/);
  assert.doesNotMatch(v,/fetch\(|XMLHttpRequest|innerHTML/);
  assert.match(css,/\.mrd-text\{white-space:pre-wrap;overflow-wrap:anywhere;/);
});
