import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc,press} from './helpers/library-folder-server.mjs';
// LIB-메뉴정리(S70-74, 2026-11-26 사용자 "여기 메뉴 폴더 업로드 이거뭐야; 왜 또 혼자 튀어" "자료 업로드여야 하는거 아냐?"):
// 자료실 ⋯ 메뉴와 빈 자리 우클릭 메뉴의 줄은 모두 글자만(그림 없음) · 같은 왼쪽 끝에서 글자가 시작한다. 폴더를 통째로 고르는 줄 이름은 '폴더째 업로드'.
// 가짜 서버만 쓴다. 이름은 지어낸 것.
const FOLDERS=[libFolder('fa','top-a',{name:'가상 성명',sort_order:1024})];
const DOCS=[libDoc('a-1','top-a'),libDoc('n-1',null)];

async function rowsLookSame(menu){
  const rows=menu.locator('button');
  await expect(rows.first()).toBeVisible();
  await expect(menu.locator('svg,img,.up-clip')).toHaveCount(0); // 한 줄만 그림이 붙지 않게
  const look=await rows.evaluateAll(list=>list.map(b=>{
    const r=document.createRange();r.selectNodeContents(b);const t=r.getBoundingClientRect(),s=getComputedStyle(b);
    return {left:Math.round(t.left-b.getBoundingClientRect().left),align:s.textAlign,justify:s.justifyContent,font:s.fontSize,weight:s.fontWeight,text:b.textContent}}));
  const first=look[0];
  for(const row of look){
    expect(Math.abs(row.left-first.left),`'${row.text}' 글자 시작 자리`).toBeLessThanOrEqual(1);
    expect({align:row.align,justify:row.justify,font:row.font,weight:row.weight},row.text).toEqual({align:first.align,justify:first.justify,font:first.font,weight:first.weight});
  }
  return look.map(r=>r.text);
}

for(const width of [390,1280])test.describe(`자료실 메뉴 줄 ${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`맨 위 ⋯ 메뉴 줄은 모두 글자만 · 같은 왼쪽 끝 · '폴더째 업로드' ${width}`,async({page})=>{
    const {errors}=await bootLibrary(page,width,{folders:FOLDERS,docs:DOCS,group:'폴더'});
    await press(page,page.locator('#libraryTopMenuBtn'),width);
    const menu=page.locator('#luTopMenu');
    const texts=await rowsLookSame(menu);
    expect(texts).not.toContain('폴더 업로드');
    if(width>=761)expect(texts).toContain('폴더째 업로드'); // 폴더 고르기는 PC 브라우저만
    else expect(texts).not.toContain('폴더째 업로드');
    await page.keyboard.press('Escape');await expect(menu).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe('자료실 빈 자리 우클릭 메뉴 줄 1280',()=>{
  test.use({hasTouch:false});
  test('빈 자리 메뉴 줄도 글자만 · 같은 왼쪽 끝',async({page})=>{
    const {errors}=await bootLibrary(page,1280,{folders:FOLDERS,docs:DOCS,group:'폴더'});
    await page.evaluate(()=>{const el=document.querySelector('#libraryListCard'),r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.bottom-6}))});
    const menu=page.locator('#luAreaMenu');
    const texts=await rowsLookSame(menu);
    expect(texts.slice(0,4)).toEqual(['새 폴더','파일 업로드','폴더째 업로드','정돈 제안']);
    await page.keyboard.press('Escape');await expect(menu).toBeHidden();
    expect(errors).toEqual([]);
  });
});
