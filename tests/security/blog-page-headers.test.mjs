import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {askOf,boardHref,postHref,shortDate} from '../../blog/blog-model.mjs';
// BLOG ② 9절 '블로그 밖 화면이 noindex·no-store·credentials omit·CSP'(화면 파일 부분). Worker의 X-Robots-Tag·주소 경로는 router PR(②-b)이 더한다.
const html=readFileSync('blog/index.html','utf8'),js=readFileSync('blog/blog.js','utf8'),model=readFileSync('blog/blog-model.mjs','utf8');
test('page: noindex by default, no referrer, strict CSP (no inline, only the Supabase reader), no frames or forms',()=>{
 assert.match(html,/<meta name="robots" content="noindex,nofollow,noarchive">/);
 assert.match(html,/<meta name="referrer" content="no-referrer">/);
 const csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
 for(const part of ["default-src 'none'","script-src 'self'","style-src 'self'","connect-src https://xmlkxfjeagycwttklxjw.supabase.co","form-action 'none'","base-uri 'self'"])assert.ok(csp.includes(part),part);
 assert.doesNotMatch(csp,/unsafe-|frame-src|\*/);
 assert.doesNotMatch(html,/<script(?![^>]*type="module" src="\.\/blog\.js")[^>]*>/);
 assert.doesNotMatch(html,/style="|\son[a-z]+="/);
});
test('reader call: one endpoint, POST json, no-store, credentials omit, no referrer; no storage, cookies or HTML injection',()=>{
 assert.match(js,/const ENDPOINT = 'https:\/\/xmlkxfjeagycwttklxjw\.supabase\.co\/functions\/v1\/share-page-read';/);
 assert.equal((js.match(/fetch\(/g)||[]).length,1);
 assert.match(js,/cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'/);
 for(const src of [js,model])assert.doesNotMatch(src,/\b(?:local|session)Storage\b|indexed[D]B|document\.cookie|innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|apikey|Authorization/);
 // 검색 허용은 블로그 값이 정확히 true일 때만 연다.
 assert.match(js,/blog\.indexable === true\) robots\.setAttribute\('content', 'index,follow,noarchive'\)/);
});
test('addresses: only /, /board/<key>(?page=N) and /post/<key>; anything else asks nothing',()=>{
 assert.deepEqual(askOf('/',''),{blog:'home'});
 assert.deepEqual(askOf('/work/blog/',''),{blog:'home'});
 assert.deepEqual(askOf('/board/0123456789',''),{blog:'board',board:'0123456789'});
 assert.deepEqual(askOf('/board/0123456789','?page=2'),{blog:'board',board:'0123456789',page:2});
 assert.deepEqual(askOf('/post/abcdef0123',''),{blog:'post',post:'abcdef0123'});
 for(const [p,s] of [['/','?x=1'],['/board/ABCDEF0123',''],['/board/012345678',''],['/board/0123456789','?page=0'],['/board/0123456789','?page=-1'],
  ['/post/0123456789','?t=1'],['/post/0123456789/',''],['/s/abc',''],['/work/app/',''],['/board/0123456789/x','']])assert.equal(askOf(p,s),null,p+s);
 assert.equal(boardHref('bad'),null);assert.equal(postHref('0123456789'),'/post/0123456789');assert.equal(boardHref('0123456789',2),'/board/0123456789?page=2');
 assert.equal(shortDate('2026-11-25',new Date('2026-12-01T00:00:00Z')),'11.25');assert.equal(shortDate('2025-11-25',new Date('2026-12-01T00:00:00Z')),'2025.11.25');assert.equal(shortDate('x'),'');
});
