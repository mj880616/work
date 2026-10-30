// SEC-정리묶음 PR 2: 낮은 보안 손질이 되돌아가지 않게 막는 정적·단위 시험. 값은 모두 지어낸 것이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {httpUrl, driveOpenUrl} from '../../app/file-actions.js';
import {HTML_SANDBOX} from '../../app/share-html-model.mjs';

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('자료 링크 주소는 http·https만 링크가 된다', () => {
  assert.equal(httpUrl('https://drive.google.com/file/d/x/view'), 'https://drive.google.com/file/d/x/view');
  assert.equal(httpUrl('http://example.test/a'), 'http://example.test/a');
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:x', 'data:text/html,x', 'vbscript:x', 'file:///etc/x', '', null, undefined, '/relative', 'drive.google.com/x'])
    assert.equal(httpUrl(bad), '', String(bad));
  assert.equal(driveOpenUrl({driveUrl: 'javascript:x', driveId: ''}), '');
});

test('조직·프로젝트·옛 자료 목록은 저장된 drive_url을 거른 뒤에만 링크로 걸고 rel=noopener noreferrer를 붙인다', () => {
  const wd = read('app/workplace-detail.js'), ps = read('app/project-system-v3.js'), team = read('app/team.js');
  assert.match(wd, /href=httpUrl\(x\.drive_url\)/);
  assert.match(wd, /class="wd-doc-main" href="\$\{wdE\(href\)\}" target="_blank" rel="noopener noreferrer"/);
  assert.match(ps, /href=httpUrl\(x\.drive_url\)/);
  assert.match(ps, /class="ps3-line-main" href="\$\{esc\(href\)\}" target="_blank" rel="noopener noreferrer"/);
  assert.match(team, /\/\^https\?:\\\/\\\/\/i\.test\(d\.drive_url\|\|''\)\?`<a class="mini" href="\$\{esc\(d\.drive_url\)\}" target="_blank" rel="noopener noreferrer">/);
  for (const [name, src] of [['workplace-detail', wd], ['project-system-v3', ps]]) assert.doesNotMatch(src, /href="\$\{\w+\(x\.drive_url\)\}"/, name);
});

test('한글 변환 창의 글자 이스케이프는 작은따옴표까지 바꾼다', () => {
  const line = read('app/hwp-convert.js').split('\n').find(l => l.startsWith('const esc='));
  const esc = new Function(`${line};return esc;`)();
  assert.equal(esc(`a'b"<&>`), 'a&#39;b&quot;&lt;&amp;&gt;');
});

test('공유 HTML 격리 칸: 두 사본이 같고, 같은 주소 권한·위 창 이동 권한은 없다', () => {
  const copy = /export const HTML_SANDBOX = '([^']+)'/.exec(read('share/share.js'))?.[1];
  assert.equal(copy, HTML_SANDBOX);
  const flags = HTML_SANDBOX.split(/\s+/);
  for (const banned of ['allow-same-origin', 'allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-modals', 'allow-downloads'])
    assert.equal(flags.includes(banned), false, banned);
  // 아래 둘은 확인 결과 필요해서 남긴다(PR 본문): 칸 밖 링크가 정상 탭으로 열리게(escape), 계산기·검색창 같은 form 제출 처리(forms).
  assert.deepEqual(flags.sort(), ['allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-scripts']);
});

test('Edge 함수는 Google·AI·DB 쪽 오류 원문을 그대로 throw해 응답에 싣지 않는다', () => {
  const root = new URL('../../supabase/functions/', import.meta.url).pathname;
  const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const bad = [];
  const patterns = [
    /throw new Error\(\s*\w+\??\.error\??\.message/,           // Google·OpenAI JSON 오류 글
    /throw new Error\(\s*\w+\??\.error_description/,            // Google 토큰 오류 글
    /throw new Error\([^)]*await \w+\.text\(\)/,                // 응답 원문 통째로
  ];
  for (const file of walk(root)) {
    if (!/\.(ts|mjs)$/.test(file)) continue;
    const rel = relative(root, file);
    if (rel.startsWith('team-ai/')) continue; // 은퇴 함수: 원본은 SEC-정리묶음 PR 1에서 삭제(그 PR merge 뒤엔 폴더가 없다)
    const src = readFileSync(file, 'utf8');
    for (const re of patterns) if (re.test(src)) bad.push(`${rel}: ${re}`);
  }
  assert.deepEqual(bad, []);
});

test('auth-handoff는 공개 키가 없을 때 서버 키로 대신하지 않는다', () => {
  const src = read('supabase/functions/auth-handoff/index.ts');
  assert.match(src, /const ANON = Deno\.env\.get\('SUPABASE_ANON_KEY'\) \|\| '';/);
  assert.doesNotMatch(src, /SUPABASE_ANON_KEY'\)\s*\|\|\s*SERVICE/);
  assert.match(src, /if\(!SB\|\|!SERVICE\|\|!ANON\) return reply\(\{ error: 'server_misconfigured'/);
});
