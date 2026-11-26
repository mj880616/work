// S69 READ-첨부본문(사용자 11/24): 기관 게시판 글처럼 쪽에는 그림·마침표뿐이고 본문이 첨부 PDF·HWP에 있으면, 저장한 글 원문 받기(note-import)가
// 그 첨부 글자를 본문으로 돌려준다. 같은 안전 규칙(https만·이름 풀이 뒤 공개 주소만·크기 상한), 외부 서비스·AI 없음. 막힌 첨부는 읽지 않을 뿐 쪽 결과는 그대로.
// 네트워크 없음: 사이트·Supabase·이름 풀이·PDF·HWP는 모두 지어낸 것(example.org).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fakePdf} from '../helpers/fake-pdf.mjs';
import {makeHwp} from '../helpers/hwp-synth.mjs';

const H = await import('../../supabase/functions/note-import/handler.ts');
const T = await import('../../supabase/functions/_shared/attach-text.ts');
const AT = await import('../../supabase/functions/news-feed/attach.ts');

const NOW = Date.parse('2026-11-24T03:00:00Z');
const SB = 'https://synthetic.supabase.test', SERVICE = 'synthetic-service-role-key-000000';
const WS = 'a0000000-0000-4000-8000-000000000001', USER = 'b0000000-0000-4000-8000-000000000001', JWT = 'synthetic.user.jwt-owner-0001';
const FN = 'https://synthetic.supabase.test/functions/v1/note-import';
const PUBLIC_IP = '93.184.216.34';
const PAGE = 'https://www.example.org/portal/bbs/view.do?nttId=1';
const LINES = ['청년고용 부진 및 정책 과제', '최근 청년층 고용률이 하락하고 있으며 중소기업 입사 뒤 대기업으로 옮기는 길이 좁아지고 있다.', '이에 따라 일자리 정책의 방향을 다시 짚어 볼 필요가 있다.'];
const BOARD = (links) => `<html lang="ko"><head><meta property="og:title" content="[제2026-27호] 합성 보고서 제목"><meta property="og:site_name" content="합성기관"></head>
<body><div class="bd-view"><h1>[제2026-27호] 합성 보고서 제목</h1><div class="dbdata"><p><img src="https://www.example.org/img/graph.png" alt="그래프"></p><p>.</p></div>
<div class="addfile"><h3>첨부파일</h3><ul>${links}</ul></div></div></body></html>`;
const html = body => ({body, headers: {'content-type': 'text/html; charset=utf-8'}});
const bin = (bytes, type = 'application/octet-stream') => ({body: bytes, headers: {'content-type': type, 'content-length': String(bytes.length)}});

function world(sites, dns = {}) {
  const calls = [], logs = [];
  const res = (v, s = 200) => new Response(v === null ? null : JSON.stringify(v), {status: s, headers: {'content-type': 'application/json'}});
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    calls.push({url: u.href, method});
    if (u.origin === SB) {
      if (u.pathname === '/auth/v1/user') return init.headers.Authorization === `Bearer ${JWT}` ? res({id: USER}) : res({}, 401);
      const p = u.pathname.replace('/rest/v1/', '');
      if (p === 'app_workspace_members' && method === 'GET') return res([{workspace_id: WS}]);
      if (p === 'app_news_days' && method === 'GET') return res([]);
      return res(null, 204);
    }
    const site = sites[u.href];
    if (site === undefined) return new Response('', {status: 404});
    return new Response(site.body ?? '', {status: site.status ?? 200, headers: site.headers ?? {}});
  };
  const names = {'www.example.org': [PUBLIC_IP], 'files.example.org': [PUBLIC_IP], 'inside.example.org': ['10.0.0.5'], ...dns};
  const resolve = async host => { const v = names[host]; if (!v) throw new Error('no'); return v; };
  const env = n => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE})[n];
  const handler = H.createNoteImportHandler({env, resolve, fetch: doFetch, now: () => NOW, sleep: async () => {}, log: (code, detail) => logs.push({code, ...(detail ?? {})})});
  return {handler, calls, logs};
}
const imp = async (w, url = PAGE) => {
  const out = await w.handler(new Request(FN, {method: 'POST', headers: {authorization: `Bearer ${JWT}`, 'content-type': 'application/json'}, body: JSON.stringify({url})}));
  return {status: out.status, body: await out.json()};
};
const KEYS = ['author', 'blocks', 'chars', 'lang', 'ok', 'published_at', 'reason', 'site', 'state', 'title', 'truncated', 'url'];

test('쪽 본문이 마침표뿐 + 첨부 PDF → PDF 글자가 본문(글자 블록만), 모양은 그대로', async () => {
  const pdf = 'https://www.example.org/portal/cmmn/file/fileDown.do?atchFileId=F1&fileSn=1';
  const w = world({[PAGE]: html(BOARD(`<li><a href="/portal/cmmn/file/fileDown.do?atchFileId=F1&amp;fileSn=1" title="합성보고서.pdf 내려받기">합성보고서.pdf</a></li>`)), [pdf]: bin(fakePdf(LINES), 'application/pdf')});
  const out = await imp(w);
  assert.equal(out.status, 200);
  assert.deepEqual(Object.keys(out.body).sort(), KEYS);
  assert.equal(out.body.state, 'ok');
  assert.equal(out.body.title, '[제2026-27호] 합성 보고서 제목');
  const text = out.body.blocks.map(b => b.text).join('\n');
  assert.match(text, /청년층 고용률이 하락하고/);
  assert.match(text, /일자리 정책의 방향/);
  for (const b of out.body.blocks) assert.deepEqual(Object.keys(b).sort(), ['t', 'text']);
  assert.ok(w.calls.some(c => c.url === pdf), '첨부를 받았다');
  assert.ok(w.logs.some(l => l.code === 'attach_read' && l.kind === 'pdf'));
});

test('HWP·PDF가 함께 있으면 HWP 먼저(자료실과 같은 자체 읽기)', async () => {
  const hwp = 'https://files.example.org/a/합성보고서.hwp', pdf = 'https://files.example.org/a/합성보고서.pdf';
  const bytes = makeHwp({sections: [['한글 파일 첫 문단: 청년층 고용률이 하락하고 있으며 정책 과제를 정리했다.', '한글 파일 둘째 문단: 중소기업 입사 뒤 대기업으로 옮기는 길.']]});
  const w = world({[PAGE]: html(BOARD(`<li><a href="${pdf}">PDF</a></li><li><a href="${encodeURI(hwp)}">HWP</a></li>`)), [encodeURI(hwp)]: bin(new Uint8Array(bytes)), [pdf]: bin(fakePdf(LINES))});
  const out = await imp(w);
  assert.equal(out.body.state, 'ok');
  assert.match(out.body.blocks.map(b => b.text).join('\n'), /한글 파일 첫 문단/);
  assert.ok(!w.calls.some(c => c.url === pdf), 'HWP에서 글자를 얻으면 PDF는 받지 않는다');
});

test('첨부가 안쪽 주소로 풀리면 받지 않고 쪽 결과 그대로(쪽 읽기는 막지 않음)', async () => {
  const w = world({[PAGE]: html(BOARD(`<li><a href="https://inside.example.org/x/보고서.pdf">보고서.pdf</a></li>`))});
  const out = await imp(w);
  assert.equal(out.status, 200);
  assert.notEqual(out.body.state, 'ok');
  assert.ok(!w.calls.some(c => c.url.startsWith('https://inside.example.org')), '안쪽 주소로는 요청을 보내지 않는다');
});

test('첨부가 크기 상한을 넘거나 PDF가 아니면(오류 쪽) 쓰지 않는다', async () => {
  const big = 'https://www.example.org/big.pdf', fake = 'https://www.example.org/fake.pdf';
  const w = world({[PAGE]: html(BOARD(`<li><a href="/big.pdf">큰.pdf</a></li><li><a href="/fake.pdf">가짜.pdf</a></li>`)),
    [big]: {body: '', headers: {'content-type': 'application/pdf', 'content-length': String(T.ATTACH_MAX_BYTES + 1)}},
    [fake]: html('<html><body>로그인이 필요합니다</body></html>')});
  const out = await imp(w);
  assert.notEqual(out.body.state, 'ok');
});

test('쪽 본문이 충분하면 첨부를 받지 않는다', async () => {
  const long = '<p>' + '노동자들이 오늘 합성 기사 본문 문단을 읽는다. '.repeat(20) + '</p>';
  const w = world({[PAGE]: html(`<html><body><article><h1>합성</h1>${long}<a href="/a.pdf">a.pdf</a></article></body></html>`), 'https://www.example.org/a.pdf': bin(fakePdf(LINES))});
  const out = await imp(w);
  assert.equal(out.body.state, 'ok');
  assert.ok(!w.calls.some(c => c.url.endsWith('/a.pdf')));
});

test('첨부 링크 찾기: 주소 끝·링크 글자·title로 PDF·HWP·HWPX만, javascript:·mailto는 버림, HWPX→HWP→PDF 차례', () => {
  const links = T.attachmentLinks(`<a href="javascript:down('1')">a.pdf</a><a href="mailto:x@example.org">b.hwp</a>
    <a href="/f/1.pdf">보기</a><a href='/down?id=2' title="표.hwp">내려받기</a><a href=/down?id=3>원문.HWPX</a><a href="/f/1.pdf">중복</a><a href="/photo.jpg">사진</a>`, 'https://www.example.org/bbs/view');
  assert.deepEqual(links, [
    {url: 'https://www.example.org/down?id=3', kind: 'hwpx'},
    {url: 'https://www.example.org/down?id=2', kind: 'hwp'},
    {url: 'https://www.example.org/f/1.pdf', kind: 'pdf'},
  ]);
  assert.deepEqual(T.attachmentLinks('', 'https://www.example.org/'), []);
});

test('파일 종류는 머리 바이트로만 정한다', () => {
  assert.equal(T.sniffKind(fakePdf(['가나다'])), 'pdf');
  assert.equal(T.sniffKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0])), 'hwp');
  assert.equal(T.sniffKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0])), 'hwpx');
  assert.equal(T.sniffKind(new TextEncoder().encode('<html>....</html>')), null);
});

test('needsAttachment: 전문이 충분하면 아니오, 유료벽·봇 확인은 아니오', () => {
  const page = (state, blocks) => ({state, blocks});
  assert.equal(AT.needsAttachment(page('ok', {state: 'ok', chars: 500, blocks: []})), false);
  assert.equal(AT.needsAttachment(page('ok', {state: 'ok', chars: 10, blocks: []})), true);
  assert.equal(AT.needsAttachment(page('ok', {state: 'image_only', chars: 1, blocks: []})), true);
  assert.equal(AT.needsAttachment(page('paywall', {state: 'lead', chars: 10, blocks: []})), false);
  assert.equal(AT.needsAttachment(page('bot_check', {state: 'failed', chars: 0, blocks: []})), false);
});

test('첨부 읽기는 자체 부품만(외부 서비스·AI·Drive 없음)', () => {
  for (const f of ['supabase/functions/_shared/attach-text.ts', 'supabase/functions/_shared/pdf-text.mjs', 'supabase/functions/news-feed/attach.ts']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /https:\/\/(?!github\.com)[a-z]/i, `${f}: 바깥 주소 없음`);
    assert.doesNotMatch(src, /openai|googleapis|npm:|jsr:|esm\.sh|from "https?:/i, `${f}: 외부 서비스·라이브러리 없음`);
  }
});
