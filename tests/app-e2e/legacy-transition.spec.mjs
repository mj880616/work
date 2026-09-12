import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const richCopy=await readFile(new URL('../../assets/rich-copy.js',import.meta.url),'utf8');

async function mockLegacy(page){
  await page.route('**/work/assets/rich-copy.js*',route=>route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:richCopy}));
  await page.route(`${SB}/**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
}

test('legacy project root shows a direct app transition link',async({page})=>{
  await mockLegacy(page);
  await page.goto('http://127.0.0.1:8123/2in1/');
  const banner=page.locator('#kptuAppTransition');
  await expect(banner).toBeVisible({timeout:10000});
  await expect(banner).toContainText('이 사업은 앱 프로젝트로 이전되었습니다.');
  await expect(banner.locator('a')).toHaveAttribute('href','/work/app/?project=0810f1f4-e31f-48b3-b361-c15492e89b12');
});

test('public subpage is not covered by the internal project transition banner',async({page})=>{
  await mockLegacy(page);
  await page.goto('http://127.0.0.1:8123/2in1/field-testimony-1002/');
  await expect(page.locator('#kptuAppTransition')).toHaveCount(0);
  await expect(page.locator('h1')).toContainText('현장증언');
});
