import test from 'node:test';
import assert from 'node:assert/strict';
// MD-표시보완: ChatGPT 공유 링크 판별(정확한 도메인만), 붙여 넣은 HTML 문서 판별, 칸막이 문서(CSP 먼저)와 2MB 상한.
import {chatgptShareUrl, chatgptShareLinks, extractHtmlDocument, frameDocument, FRAME_CSP, HTML_MAX_BYTES, htmlFileName, isHtmlName, utf8Bytes, CHATGPT_HTML_REQUEST} from '../app/chatgpt-html.mjs';

const ID = '670f1a2b-3c4d-8e9f-a0b1-c2d3e4f5a6b7';

test('only https://chatgpt.com/share/<id> is a share link', () => {
  assert.equal(chatgptShareUrl(`https://chatgpt.com/share/${ID}`), `https://chatgpt.com/share/${ID}`);
  assert.equal(chatgptShareUrl(`https://CHATGPT.com/share/${ID}/`), `https://chatgpt.com/share/${ID}`);
  assert.equal(chatgptShareUrl(`https://chatgpt.com/share/${ID}?utm=x#top`), `https://chatgpt.com/share/${ID}`);
  for (const bad of [
    `http://chatgpt.com/share/${ID}`,
    `https://chatgpt.com.evil.example/share/${ID}`,
    `https://evil-chatgpt.com/share/${ID}`,
    `https://www.chatgpt.com/share/${ID}`,
    `https://chat.openai.com/share/${ID}`,
    `https://chatgpt.com:8443/share/${ID}`,
    `https://user@chatgpt.com/share/${ID}`,
    `https://evil.example/chatgpt.com/share/${ID}`,
    `https://evil.example/?u=https://chatgpt.com/share/${ID}`,
    `https://chatgpt.com/c/${ID}`,
    `https://chatgpt.com/share/${ID}/continue`,
    'https://chatgpt.com/share/short',
    'https://chatgpt.com/share/<script>',
    'javascript:alert(1)//https://chatgpt.com/share/' + ID,
    '', null,
  ]) assert.equal(chatgptShareUrl(bad), null, String(bad));
});

test('share links are found in memo text, deduplicated, trailing punctuation ignored, at most five', () => {
  const text = `원본: https://chatgpt.com/share/${ID}. 다시 (https://chatgpt.com/share/${ID}) 가짜 https://chatgpt.com.evil.example/share/${ID} 그리고 [링크](https://chatgpt.com/share/aaaaaaaa-bbbb)`;
  assert.deepEqual(chatgptShareLinks(text), [`https://chatgpt.com/share/${ID}`, 'https://chatgpt.com/share/aaaaaaaa-bbbb']);
  assert.equal(chatgptShareLinks(Array.from({length: 8}, (_, i) => `https://chatgpt.com/share/abcdefgh-${i}`).join('\n')).length, 5);
  assert.deepEqual(chatgptShareLinks('링크 없음'), []);
});

test('a complete HTML document is recognized whole or as one ```html block; fragments are not', () => {
  const doc = '<!DOCTYPE html>\n<html><head><style>.c{color:red}</style></head><body><div class="c">카드</div></body></html>';
  assert.deepEqual(extractHtmlDocument('  ' + doc + '\n'), {html: doc, before: '', after: ''});
  assert.deepEqual(extractHtmlDocument('<html lang="ko"><body>x</body></html>'), {html: '<html lang="ko"><body>x</body></html>', before: '', after: ''});
  const fenced = extractHtmlDocument('아래 파일입니다.\n\n```html\n' + doc + '\n```\n\n저장해서 여세요.');
  assert.deepEqual(fenced, {html: doc, before: '아래 파일입니다.', after: '저장해서 여세요.'});
  assert.equal(extractHtmlDocument('```HTML\n' + doc + '\n```').html, doc);
  for (const text of ['<div>조각</div>', '```html\n<div>조각</div>\n```', '```js\n' + doc + '\n```', 'HTML 설명: <!doctype html> 로 시작합니다', '<html><body>닫히지 않음', '', '# 제목\n본문'])
    assert.equal(extractHtmlDocument(text), null, text);
});

test('the frame document puts the network-blocking policy first and keeps a leading doctype first', () => {
  const doc = frameDocument('<!doctype html><html><head><title>t</title></head><body>x</body></html>');
  assert.ok(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="' + FRAME_CSP + '">'));
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<html>'));
  assert.ok(frameDocument('<html><body>x</body></html>').startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
  for (const part of ["default-src 'none'", "img-src data:", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-src 'none'", "object-src 'none'"]) assert.ok(FRAME_CSP.includes(part), part);
  assert.doesNotMatch(FRAME_CSP, /https?:|\*|'self'|unsafe-eval/);
  assert.match(doc, /<meta name="referrer" content="no-referrer">/);
  assert.match(doc, /parent\.postMessage\(\{type:"web2-html-height"/);
});

test('size limit, file name and request text', () => {
  assert.equal(HTML_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(utf8Bytes('가a'), 4);
  assert.equal(htmlFileName(new Date('2026-10-15T05:30:00Z')), 'chatgpt-20261015-1430.html');
  assert.ok(isHtmlName('a.HTML') && isHtmlName('b.htm') && !isHtmlName('c.html.txt') && !isHtmlName(''));
  assert.equal(CHATGPT_HTML_REQUEST, '위 답변을 외부 라이브러리·폰트·이미지 주소 없이 인라인 CSS와 인라인 SVG만 쓴 HTML 파일 하나로 만들어 줘. 카드·표·도식 모양을 살려 줘.');
});
