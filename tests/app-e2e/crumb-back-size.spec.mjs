// S70-13 UI-위치줄뒤로작게(사용자 11/25 09:48 "이 버튼이 너무 큼"): 자료실 위치 줄 맨 앞 [‹](위 폴더로·폴더 나무로)가
// 테두리 있는 32px 네모라 위치 줄 글자보다 훨씬 컸다. 위치 줄 [‹]는 ⑥ 아이콘 하나(icon-btn fp-up, 모양은 base-ui.css 한 곳):
// 선·바탕 없음, 보이는 높이는 위치 줄 글자 줄 높이 + 여유 6px 이하(같은 줄 [⋯]와 같은 24px), 누르는 범위 44px(::after), 누르면 위 폴더로.
// 자료실 한 칸·두 칸 칸 머리·[파일] 위치 줄이 같은 부품. 폰 자료실은 공용 '그 폴더만' 위치 줄(.ft-focus-anc)의 원래 작은 꺽쇠(바꾸지 않음).
// 이름은 모두 지어낸 것이다.
import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,menuButton,folderMenuItem} from './helpers/library-folder-server.mjs';
import {start,openFiles,treeGo,enterRow} from './helpers/files-server.mjs';

const FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fb','top-a',{name:'가상 B',parent_id:'fa',sort_order:0})];
const SLACK=6;

// 보이는 크기·선·바탕·누르는 범위(::after 44)와, 위치 줄 줄 높이 전체(맨 위·맨 아래 1px, 보이는 네모 바깥)를 눌러도 이 단추인지.
// 위치 줄은 길면 가로로 넘기거나 자르는 칸이라 줄 바깥으로 나간 범위는 잘린다(줄 높이 28~36px 안은 모두 이 단추).
async function look(btn){
  await btn.scrollIntoViewIfNeeded();
  return btn.evaluate(b=>{
    const r=b.getBoundingClientRect(),s=getComputedStyle(b),a=getComputedStyle(b,'::after');
    const nav=b.closest('.fp-path,.fx-crumb,.lu-pane-head,.ft-focus-anc');
    const line=parseFloat(getComputedStyle(nav).lineHeight)||parseFloat(getComputedStyle(nav).fontSize)*1.2;
    const nr=nav.getBoundingClientRect(),cx=r.left+r.width/2,hit=(x,y)=>document.elementFromPoint(x,y)?.closest('button')===b;
    return {w:r.width,h:r.height,line,row:nr.height,
      border:['Top','Right','Bottom','Left'].map(k=>parseFloat(s[`border${k}Width`])).reduce((x,y)=>x+y,0),
      bg:s.backgroundColor,afterW:a.content==='none'?r.width:parseFloat(a.width),afterH:a.content==='none'?r.height:parseFloat(a.height),
      rowTop:hit(cx,nr.top+1),rowBottom:hit(cx,nr.bottom-1),
      tab:b.tabIndex,text:b.textContent.trim()};
  });
}
function small(m,{cap}={}){
  expect(m.text).toBe('‹');
  expect(m.border,'테두리 없음').toBe(0);
  expect(['rgba(0, 0, 0, 0)','transparent']).toContain(m.bg);
  if(cap)expect(m.h,'보이는 높이 ≤ 같은 줄 [⋯] 높이').toBeLessThanOrEqual(cap);
  else expect(m.h,`보이는 높이 ${m.h} ≤ 위치 줄 글자 줄 ${m.line} + ${SLACK}`).toBeLessThanOrEqual(m.line+SLACK);
  expect(m.h).toBeLessThanOrEqual(m.row);
  expect(m.afterW,'누르는 범위 가로 44').toBeGreaterThanOrEqual(44);
  expect(m.afterH,'누르는 범위 세로 44').toBeGreaterThanOrEqual(44);
  expect(m.rowTop&&m.rowBottom,'위치 줄 줄 높이 전체가 눌림').toBe(true);
  expect(m.tab).toBe(0);
}

test('자료실 PC 1280 한 칸(나무 | 목록): 위치 줄 [‹]는 작은 아이콘 · 누르면 위 폴더 · 키보드 Enter도',async({page})=>{
  const {errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:[],group:'폴더',init:{viewPrefs:null}});
  await page.locator('#libraryOneBtn').click();
  const path=page.locator('#libraryPath');
  await menuButton(page,'f:fa').click();await folderMenuItem(page,'이 폴더로 들어가기').click();
  await menuButton(page,'f:fb').click();await folderMenuItem(page,'이 폴더로 들어가기').click();
  await expect(path.locator('.fp-here')).toHaveText('가상 B');
  const up=path.locator('[data-lu-path-back]');
  small(await look(up));
  await page.screenshot({path:'test-results/s70-13-lib-one.png'});
  await up.click();
  await expect(path.locator('.fp-here')).toHaveText('가상 A');
  await up.focus();await page.keyboard.press('Enter');
  await expect(path).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('자료실 PC 1280 두 칸: 칸 머리 [‹]도 같은 부품 · 누르면 그 칸 위 폴더',async({page})=>{
  const {errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:[],group:'폴더',init:{viewPrefs:null}});
  const pane=page.locator('#documentList [data-lu-pane-i="1"]');
  await expect(pane).toBeVisible();
  for(const id of ['fa','fb']){await pane.locator(`[data-lu-nav="${id}"]`).click({button:'right'});await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click()}
  await expect(pane.locator('.lu-pane-here')).toHaveText('가상 B');
  const up=pane.locator('.lu-pane-head [data-lu-pane-up]');
  await expect(up).toHaveClass(/\bfp-up\b/);
  small(await look(up));
  await page.screenshot({path:'test-results/s70-13-lib-two.png'});
  await up.click();
  await expect(pane.locator('.lu-pane-here')).toHaveText('가상 A');
  expect(errors).toEqual([]);
});

test('자료실 폰 390: 위치 줄 [‹]는 테두리 없는 작은 꺽쇠 · 누르는 범위 44 · 누르면 위 폴더',async({page})=>{
  const {errors}=await bootLibrary(page,390,{folders:FOLDERS,items:[]});
  await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
  const head=key=>page.locator(`#documentList details[data-lu-node="${key}"] > summary`);
  const path=page.locator('#libraryPath');
  // 들어가기는 ⋯ 첫 줄 [이 폴더로 들어가기](UI-폴더줄크기 S69-99: 두 손가락은 줄 크기라 들어가지 않는다).
  await head('f:fa').locator('[data-lu-node-menu]').click();await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(path).toHaveText('‹자료실›가상 A');
  await head('f:fb').locator('[data-lu-node-menu]').click();await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(path).toHaveText('‹자료실›가상 A›가상 B');
  const up=path.locator('[data-lu-path-back]');
  small(await look(up),{cap:24});
  await page.screenshot({path:'test-results/s70-13-lib-phone.png'});
  await up.click();
  await expect(path).toHaveText('‹자료실›가상 A');
  expect(errors).toEqual([]);
});

test('파일 PC 1280: 위치 줄 [‹]도 같은 부품 · 누르면 위 폴더',async({page})=>{
  const {errors}=await start(page,1280);await openFiles(page,1280);
  const root=page.locator('#filesRoot');
  await treeGo(page,'od','OD!1');
  await enterRow(page,root.locator('[data-fx-row="od:OD!10"]'));
  const crumb=root.locator('.fx-top [data-fx-crumb]');
  await expect(crumb.locator('.fx-crumb-now')).toHaveText('가짜 2026');
  const up=crumb.locator('[data-fx-up]');
  await expect(up).toHaveClass(/\bfp-up\b/);
  small(await look(up));
  await page.screenshot({path:'test-results/s70-13-files-pc.png'});
  await up.click();
  await expect(crumb.locator('.fx-crumb-now')).toHaveText('가짜 문서함');
  expect(errors).toEqual([]);
});

test('파일 폰 390: 별표 목록 위치 줄 [‹]도 같은 부품 · 누르면 폴더 나무',async({page})=>{
  const {errors}=await start(page,390);await openFiles(page,390);
  const root=page.locator('#filesRoot');
  const tree=root.locator('[data-fx-tree]');
  await tree.locator('[data-fx-shelf="starred"]').click();
  await expect(tree).toBeHidden();
  const up=root.locator('.fx-top [data-fx-crumb] [data-fx-up]');
  await expect(up).toHaveClass(/\bfp-up\b/);
  small(await look(up));
  await page.screenshot({path:'test-results/s70-13-files-phone.png'});
  await up.click();
  await expect(tree).toBeVisible();
  expect(errors).toEqual([]);
});
