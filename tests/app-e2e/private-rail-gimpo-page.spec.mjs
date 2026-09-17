import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const repoRoot = new URL('../../', import.meta.url);

async function read(path) {
  return readFile(new URL(path, repoRoot), 'utf8');
}

test('민자철도 사업현황에 김포 공영화 투쟁 바로가기가 노출된다', async () => {
  const html = await read('private-rail/index.html');
  expect(html).toContain('김포 공영화 투쟁');
  expect(html).toContain('/work/p/gimpo-publicization/');
});

test('김포 공영화 투쟁 허브는 3개 대응영역과 행감 하위페이지를 제공한다', async () => {
  const html = await read('p/gimpo-publicization/index.html');
  expect(html).toContain('name="kptu-page-slug" content="gimpo-publicization"');
  expect(html).toContain('하반기 임단투');
  expect(html).toContain('시의회 대응');
  expect(html).toContain('언론 대응');
  expect(html).toContain('/work/p/gimpo-publicization-audit/');
  expect(html).toContain('id="editPageBtn"');
  expect(html).toContain('id="printPageBtn"');
  expect(html).toContain('← 민자철도 사업현황');
});

test('김포시 행정사무감사 대응 하위페이지는 편집·인쇄와 상위페이지 복귀를 지원한다', async () => {
  const html = await read('p/gimpo-publicization-audit/index.html');
  expect(html).toContain('name="kptu-page-slug" content="gimpo-publicization-audit"');
  expect(html).toContain('김포시 행정사무감사 대응');
  expect(html).toContain('/work/p/gimpo-publicization/');
  expect(html).toContain('← 김포 공영화 투쟁');
  expect(html).toContain('id="editPageBtn"');
  expect(html).toContain('id="printPageBtn"');
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
