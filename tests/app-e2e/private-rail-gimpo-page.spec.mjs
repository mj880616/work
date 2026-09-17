import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const repoRoot = new URL('../../', import.meta.url);

async function read(path) {
  return readFile(new URL(path, repoRoot), 'utf8');
}

test('민자철도 사업현황에 김포·9호선 안전인력 투쟁 바로가기가 노출된다', async () => {
  const html = await read('private-rail/index.html');
  expect(html).toContain('김포 공영화 및 안전인력 확충 투쟁');
  expect(html).toContain('/work/p/gimpo-publicization/');
  expect(html).toContain('9호선 공영화 및 안전인력 확충 투쟁');
  expect(html).toContain('/work/p/line9-publicization/');
});

test('김포 허브와 하위페이지 명칭을 공영화 및 안전인력 확충 투쟁으로 통일한다', async () => {
  const hub = await read('p/gimpo-publicization/index.html');
  const audit = await read('p/gimpo-publicization-audit/index.html');
  const press = await read('p/gimpo-publicization-press-1008/index.html');
  expect(hub).toContain('<title>김포 공영화 및 안전인력 확충 투쟁</title>');
  expect(hub).toContain('property="og:title" content="김포 공영화 및 안전인력 확충 투쟁"');
  expect(audit).toContain('← 김포 공영화 및 안전인력 확충 투쟁');
  expect(press).toContain('← 김포 공영화 및 안전인력 확충 투쟁');
});

test('김포 허브는 3개 대응영역과 행감·기자회견 하위페이지를 제공한다', async () => {
  const html = await read('p/gimpo-publicization/index.html');
  expect(html).toContain('name="kptu-page-slug" content="gimpo-publicization"');
  expect(html).toContain('하반기 임단투');
  expect(html).toContain('시의회 대응');
  expect(html).toContain('언론 대응');
  expect(html).toContain('/work/p/gimpo-publicization-audit/');
  expect(html).toContain('/work/p/gimpo-publicization-press-1008/');
  expect(html).toContain('id="editPageBtn"');
  expect(html).toContain('id="printPageBtn"');
});

test('9호선 투쟁 허브는 임단투·행감·언론현장 대응을 연결한다', async () => {
  const html = await read('p/line9-publicization/index.html');
  expect(html).toContain('<title>9호선 공영화 및 안전인력 확충 투쟁</title>');
  expect(html).toContain('name="kptu-page-slug" content="line9-publicization"');
  expect(html).toContain('하반기 임단투');
  expect(html).toContain('서울시의회·행정사무감사 대응');
  expect(html).toContain('언론·현장 대응');
  expect(html).toContain('/work/p/line9-publicization-audit/');
  expect(html).toContain('id="editPageBtn"');
  expect(html).toContain('id="printPageBtn"');
  expect(html).toContain('← 민자철도 사업현황');
});

test('9호선 1단계 행감 하위페이지는 핵심 프레임과 후속과제를 제공한다', async () => {
  const html = await read('p/line9-publicization-audit/index.html');
  expect(html).toContain('name="kptu-page-slug" content="line9-publicization-audit"');
  expect(html).toContain('9호선 1단계 서울시 행정사무감사 대응');
  expect(html).toContain('조직진단');
  expect(html).toContain('적정인력');
  expect(html).toContain('박지영');
  expect(html).toContain('양현호');
  expect(html).toContain('강인철');
  expect(html).toContain('← 9호선 공영화 및 안전인력 확충 투쟁');
  expect(html).toContain('id="editPageBtn"');
  expect(html).toContain('id="printPageBtn"');
});

test('공개페이지 편집기는 Web2 로그인 세션과 RLS 기반 저장을 사용하고 두 도구줄 형식을 모두 지원한다', async () => {
  const editor = await read('app/public-page-editor.js');
  expect(editor).toContain("document.querySelector('.print-tools,.tools')");
  expect(editor).toContain('window.KPTURuntime');
  expect(editor).toContain("'/functions/v1/public-page-edit'");
  expect(editor).not.toContain('마스터 비밀번호');
  expect(editor).not.toContain("password:editPassword");

  for (const path of [
    'p/gimpo-publicization/index.html',
    'p/gimpo-publicization-audit/index.html',
    'p/gimpo-publicization-press-1008/index.html',
    'p/line9-publicization/index.html',
    'p/line9-publicization-audit/index.html'
  ]) {
    const html = await read(path);
    expect(html).toContain('app/runtime-client.js');
    expect(html.indexOf('app/runtime-client.js')).toBeLessThan(html.indexOf('app/public-page-editor.js'));
  }
});

test('public-page-edit 함수는 사용자 JWT와 app_pages RLS로만 수정하고 공용 비밀번호·service role을 사용하지 않는다', async () => {
  const fn = await read('supabase/functions/public-page-edit/index.ts');
  expect(fn).toContain("req.headers.get('Authorization')");
  expect(fn).toContain("Deno.env.get('SUPABASE_ANON_KEY')");
  expect(fn).toContain("from('app_pages')");
  expect(fn).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  expect(fn).not.toContain('0822');
  expect(fn).not.toContain('password');
});

test('국회토론회와 국감 페이지의 사업현황 돌아가기 버튼은 좌측 고정 규칙을 쓴다', async () => {
  const forumTools = await read('app/forum-flow-polish.js');
  const questionTools = await read('assets/private-rail-question-tools.js');
  expect(forumTools).toContain("a.className='print-btn back-link'");
  expect(forumTools).toContain("a.style.marginRight='auto'");
  expect(questionTools).toContain('private-rail-question-back back-link');
  expect(questionTools).toContain('margin-right:auto!important');
  expect(questionTools).toContain('bar.append(back,stat,edit,cancel,print)');
});

test('국감 페이지 도구줄은 제목 위에 배치된다', async () => {
  const questionTools = await read('assets/private-rail-question-tools.js');
  expect(questionTools).toContain('hero.before(bar)');
  expect(questionTools).not.toContain('hero.after(bar)');
});
