import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const repoRoot = new URL('../../', import.meta.url);

async function read(path) {
  return readFile(new URL(path, repoRoot), 'utf8');
}

test('민자철도 사업현황에 김포 공영화 투쟁 바로가기가 노출된다', async () => {
  const html = await read('private-rail/page.html');
  expect(html).toContain('김포 공영화 투쟁');
  expect(html).toContain('gimpo-publicization');
});

test('김포 공영화 투쟁 상세페이지는 핵심 쟁점과 편집·인쇄 기능을 제공한다', async () => {
  const html = await read('private-rail/gimpo-publicization/index.html');
  expect(html).toContain('김포골드라인 공영화·공공운영 전환');
  expect(html).toContain('5편성 증차에 따른 안전인력 충원');
  expect(html).toContain('민간위탁 운영비 및 적정인력 산정 문제');
  expect(html).toMatch(/민자철도 사업현황/);
  expect(html).toMatch(/인쇄/);
  expect(html).toMatch(/수정/);
  expect(html).toMatch(/저장/);
});

test('국회토론회와 국감 페이지의 사업현황 돌아가기 버튼은 좌측 정렬 규칙을 쓴다', async () => {
  const forum = await read('private-rail/forum-0929/index.html');
  const question = await read('private-rail/question-0912/index.html');
  expect(forum).toMatch(/back-link[^>]*|class=["'][^"']*back-link/);
  expect(question).toMatch(/back-link[^>]*|class=["'][^"']*back-link/);
});
