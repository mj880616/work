import { test, expect } from '@playwright/test';

const API='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/pc0921-board?board=private_rail';
const KEY='page_edit_gimpo_public_live';

function json(route,data,status=200){
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
}

test('김포 공영화 투쟁 페이지는 요구안 3개를 순서대로 보여주고 수정·인쇄·사업현황 복귀를 제공한다',async({page})=>{
  const writes=[];
  let savedHtml='';
  await page.route(API,async route=>{
    const req=route.request();
    if(req.method()==='GET')return json(route,savedHtml?[{item_key:KEY,value:savedHtml}]:[]);
    if(req.method()==='POST'){
      const body=req.postDataJSON();
      writes.push(body);
      if(body?.item_key===KEY&&typeof body.value==='string')savedHtml=body.value;
      return json(route,{ok:true});
    }
    return json(route,[]);
  });

  await page.goto('http://127.0.0.1:8123/private-rail/gimpo-public/');

  await expect(page.locator('h1')).toHaveText('김포 공영화 투쟁');
  await expect(page.locator('.issue > h2')).toHaveText([
    '1. 김포골드라인 공영화·공공운영 전환',
    '2. 5편성 증차에 따른 안전인력 충원',
    '3. 민간위탁 운영비 및 적정인력 산정 문제'
  ]);
  await expect(page.locator('#gimpoToolbar .back')).toHaveAttribute('href','/work/private-rail/');
  await expect(page.locator('#gimpoPrint')).toBeVisible();

  const toolbarOrder=await page.locator('#gimpoToolbar').evaluate(el=>[...el.children].map(x=>x.className||x.id));
  expect(String(toolbarOrder[0])).toContain('back');

  page.once('dialog',dialog=>dialog.accept('test-password'));
  await page.locator('#gimpoEdit').click();
  await expect(page.locator('#gimpoContent')).toHaveAttribute('contenteditable','true');

  const firstContext=page.locator('#issue1 .context p').first();
  await firstContext.evaluate(el=>{el.textContent='공공운영 전환 검토 문구 수정본';});
  await page.locator('#gimpoEdit').click();
  await expect(page.locator('#gimpoStatus')).toContainText('저장됨');
  expect(writes.some(x=>x.item_key===KEY&&String(x.value).includes('공공운영 전환 검토 문구 수정본'))).toBeTruthy();

  await page.reload();
  await expect(page.locator('#issue1 .context p').first()).toHaveText('공공운영 전환 검토 문구 수정본');
});

test('국감 페이지의 사업현황 복귀 버튼은 편집·인쇄 도구보다 왼쪽에 고정된다',async({page})=>{
  await page.route(API,route=>json(route,[]));
  await page.goto('http://127.0.0.1:8123/private-rail/question-0912/');
  const back=page.locator('.private-rail-question-back');
  const edit=page.locator('#privateRailQuestionEdit');
  await expect(back).toBeVisible({timeout:10000});
  await expect(edit).toBeVisible();
  const [backBox,editBox]=await Promise.all([back.boundingBox(),edit.boundingBox()]);
  expect(backBox?.x).toBeLessThan(editBox?.x??Infinity);
  expect(backBox?.x??Infinity).toBeLessThan(350);
});

test('민자철도 사업현황에서 김포 공영화 투쟁 페이지로 바로 갈 수 있다',async({page})=>{
  await page.goto('http://127.0.0.1:8123/private-rail/');
  const link=page.locator('a[href="/work/private-rail/gimpo-public/"]');
  await expect(link).toBeVisible({timeout:10000});
  await expect(link).toContainText('김포 공영화 투쟁');
});
