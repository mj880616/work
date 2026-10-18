import {testOrigin} from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import {noteAction} from './helpers/basket-more.mjs';
import { openHome } from './helpers/home-entry.mjs';
// MD-편집기 1단계: 바구니 메모 수정 화면의 [큰 창에서 수정](옛 [크게 쓰기], UI-디자인손질 8)이 전체 화면 편집기를 열고, 도구 막대가 마크다운 기호를 넣고,
// [쓰기|미리보기](폰)·나란히(넓은 화면) 미리보기가 기존 표시 모듈로 그려지며, 닫으면 글이 수정 칸으로 돌아가
// 기존 [수정 저장]으로 저장되는지, [텔레그램용 복사] 결과와 외부 요청 0건을 확인한다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true});
const ORIGINAL='처음 메모';

async function fixture(page){
 const seen={external:[],errors:[],writes:[]};
 page.on('pageerror',e=>seen.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')seen.errors.push(m.text());});
 page.on('request',request=>{const url=new URL(request.url());if(url.origin!==testOrigin&&url.origin!==SB)seen.external.push(request.url());});
 const notes=[{id:'n',raw_text:ORIGINAL,occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true,attachments:[]}];
 await openHome(page);
 await page.route(SB+'/rest/v1/app_notes**',r=>{
  const req=r.request(),u=new URL(req.url());if(req.method()==='GET')return r.fulfill({json:notes});
  const body=req.postDataJSON();seen.writes.push({method:req.method(),body});
  const n=notes.find(n=>'eq.'+n.id===u.searchParams.get('id'));Object.assign(n,body,{updated_at:'2026-10-06T02:00:00Z'});return r.fulfill({json:[n]});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 return seen;
}
async function press(page,locator,width){
 await expect(locator).toBeVisible();
 if(width<761){await locator.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'nearest'}));const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();
}
async function openEditor(page,width){
 const detail=page.locator('[data-basket-detail]');
 await press(page,page.locator('#homeView [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible'),width);
 await press(page,page.locator('[data-basket-row="n"]'),width);
 await expect(detail.locator('[data-basket-read-text]')).toHaveClass(/md-body/);
 if(width<761)await page.addStyleTag({content:'html,body{overflow-anchor:none}'});
 await noteAction(page,'[data-basket-edit]',{press:l=>press(page,l,width)});
 await press(page,detail.getByRole('button',{name:'큰 창에서 수정',exact:true}),width);
 const editor=page.locator('#mdEditor');
 await expect(editor).toBeVisible();await expect(editor).toHaveAttribute('role','dialog');
 return {detail,editor,area:editor.locator('textarea.md-editor-text'),preview:editor.locator('.md-editor-preview')};
}
const tool=(editor,name)=>editor.getByRole('button',{name,exact:true});
// Puts the caret (or a selection) in the editor without a keyboard event.
const select=(area,from,to=from)=>area.evaluate((el,[a,b])=>{el.focus();el.setSelectionRange(a,b);},[from,to]);

for(const width of [390,1280]){
 test(`md editor opens from basket edit, inserts markdown, previews and returns the text to 수정 저장 ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:860});const seen=await fixture(page);
  const {detail,editor,area,preview}=await openEditor(page,width);
  await expect(area).toHaveValue(ORIGINAL);await expect(area).toBeFocused();
  // The editor covers the screen; on a phone it ends right above the app's bottom tabs (UI-키보드하단바).
  const box=await editor.boundingBox();expect(box.x).toBe(0);expect(box.y).toBe(0);expect(Math.round(box.width)).toBe(width);
  if(width<761){const tabs=await page.locator('.mobile-tabs').boundingBox();expect(Math.round(box.height)).toBe(Math.round(tabs.y));expect(Math.round(tabs.y+tabs.height)).toBe(860);}
  else expect(Math.round(box.height)).toBe(860);
  // Toolbar: one row right under the head; on a phone the row scrolls sideways.
  // UI-버튼작게 ②: buttons are 28px to the eye with a 44px press area (::after).
  const tools=editor.locator('.md-editor-tools');
  for(const b of await tools.locator('button').all()){const r=await b.boundingBox();expect(r.height).toBe(28);expect(await b.evaluate(el=>getComputedStyle(el,'::after').height)).toBe('44px');}
  const toolsBox=await tools.boundingBox(),headBox=await editor.locator('.md-editor-head').boundingBox(),areaBox=await area.boundingBox();
  expect(Math.abs(toolsBox.y-(headBox.y+headBox.height))).toBeLessThan(8);expect(areaBox.y).toBeGreaterThanOrEqual(toolsBox.y+toolsBox.height);
  if(width<761)expect(await tools.evaluate(el=>el.scrollWidth>el.clientWidth&&getComputedStyle(el).flexWrap==='nowrap')).toBe(true);

  // 제목 1 on the caret's line.
  await select(area,2);await press(page,tool(editor,'제목 단계 고르기'),width);await press(page,tool(editor,'제목 1'),width);
  await expect(area).toHaveValue('# 처음 메모');
  // 굵게 wraps the selected word; 되돌리기·다시하기 go through the browser's own history.
  // A toolbar press never takes focus from the text, so the phone keyboard stays open.
  await area.evaluate(el=>{el.__blurs=0;el.addEventListener('blur',()=>el.__blurs++);});
  await select(area,2,4);await press(page,tool(editor,'굵게'),width);await expect(area).toHaveValue('# **처음** 메모');
  await expect(area).toBeFocused();expect(await area.evaluate(el=>el.__blurs)).toBe(0);
  await press(page,tool(editor,'되돌리기'),width);await expect(area).toHaveValue('# 처음 메모');
  await press(page,tool(editor,'다시하기'),width);await expect(area).toHaveValue('# **처음** 메모');
  // Block tools go after the caret's line with a blank line around them.
  const end=async()=>select(area,(await area.inputValue()).length);
  await end();await area.pressSequentially('\n\n');await press(page,tool(editor,'글머리 목록'),width);await area.pressSequentially('할 일');
  await end();await area.pressSequentially('\n');await press(page,tool(editor,'체크 목록'),width);
  await end();await press(page,tool(editor,'표 틀 넣기'),width);
  await end();await press(page,tool(editor,'강조 상자 종류 고르기'),width);await expect(editor.locator('.md-editor-menu button')).toHaveText(['참고','팁','중요','경고','주의']);await press(page,tool(editor,'경고'),width);
  await end();await press(page,tool(editor,'Mermaid 도식 틀 고르기'),width);await expect(editor.locator('.md-editor-menu button')).toHaveText(['흐름도','순서도','타임라인']);await press(page,tool(editor,'흐름도'),width);
  await end();await press(page,tool(editor,'구분선'),width);
  const value=await area.inputValue();
  expect(value).toContain('# **처음** 메모\n\n- 할 일');expect(value).toContain('- 할 일\n- [ ] \n');expect(value).toContain('| 항목 | 내용 | 비고 |\n| --- | --- | --- |');
  expect(value).toContain('> [!WARNING]\n> 내용');expect(value).toContain('```mermaid\nflowchart TD');expect(value.trimEnd().endsWith('---')).toBe(true);
  // The basket field follows every change while the editor is open.
  await expect(detail.locator('[data-basket-text]')).toHaveValue(value);

  // Preview: the shared markdown view (sanitized, diagrams drawn), [쓰기|미리보기] on a phone, side by side when wide.
  if(width<761){
   await expect(preview).toBeHidden();await press(page,tool(editor,'미리보기'),width);
   await expect(preview).toBeVisible();await expect(area).toBeHidden();
  }else{
   await expect(tool(editor,'미리보기')).toBeHidden();await expect(preview).toBeVisible();await expect(area).toBeVisible();
   const a=await area.boundingBox(),p=await preview.boundingBox();expect(p.x).toBeGreaterThanOrEqual(a.x+a.width-1);
  }
  await expect(preview).toHaveClass(/md-body/);await expect(preview.locator('h1 strong')).toHaveText('처음');
  await expect(preview.locator('table th')).toHaveText(['항목','내용','비고']);await expect(preview.locator('blockquote.md-callout-warning')).toContainText('경고');
  await expect(preview.locator('input.md-task')).toHaveCount(1);await expect(preview.locator('hr')).toHaveCount(1);
  await expect(preview.locator('.md-mermaid-figure svg')).toHaveCount(1,{timeout:20000});
  await expect(preview.locator('script,iframe,foreignObject')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`md-editor-preview-${width}.png`)});
  if(width<761){
   // A toolbar press from the preview goes back to writing.
   await press(page,tool(editor,'쓰기'),width);await expect(area).toBeVisible();await expect(preview).toBeHidden();
   await page.screenshot({path:info.outputPath(`md-editor-write-${width}.png`)});
  }else await page.screenshot({path:info.outputPath(`md-editor-write-${width}.png`)});

  // Typing updates the wide preview by itself.
  await end();await area.pressSequentially('\n\n마지막 문단');
  if(width>=1024)await expect(preview).toContainText('마지막 문단');

  // [닫기]: the text returns to the basket field; saving is the existing [수정 저장].
  const final=await area.inputValue();
  await press(page,tool(editor,'닫고 수정 칸으로 돌아가기'),width);
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  const field=detail.locator('[data-basket-text]');await expect(field).toHaveValue(final);await expect(field).toBeFocused();
  await field.evaluate(el=>{el.blur();el.scrollTop=0;el.closest('.basket-editor').scrollIntoView({block:'start'});});
  await page.screenshot({path:info.outputPath(`md-editor-basket-edit-${width}.png`)});
  expect(seen.writes).toEqual([]);
  await press(page,detail.locator('[data-basket-save]'),width);
  await expect(detail.locator('[data-basket-status]')).toContainText('수정한 글을 저장했습니다');
  expect(seen.writes).toHaveLength(1);expect(seen.writes[0]).toMatchObject({method:'PATCH',body:{raw_text:final}});
  await expect(detail.locator('[data-basket-read-text] h1')).toHaveText('처음 메모');
  expect(seen.external).toEqual([]);expect(seen.errors).toEqual([]);
 });
}

test('md editor telegram copy turns markdown into plain Telegram text',async({page})=>{
 await page.setViewportSize({width:390,height:860});const seen=await fixture(page);
 const {editor,area}=await openEditor(page,390);
 await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.__copied=text;};});
 const FENCE='```';
 await area.fill(['# 주간 정리','**굵게** 와 *기울임*, ~~취소~~, `코드`','- 첫째','  - 하위','1. 하나','- [ ] 할 일','- [x] 끝난 일','> 인용','','> [!NOTE]','> 참고 내용','','---','','| 항목 | 담당 |','| --- | --- |','| 성명 | 홍보 |','','[기사](https://example.com/a)',FENCE+'mermaid','flowchart TD','A-->B',FENCE].join('\n'));
 // MD-내보내기: [내보내기] → the shared bottom choice sheet → ① 텔레그램용 복사.
 await press(page,tool(editor,'내보내기'),390);
 await page.locator('#mdExportSheet').getByRole('button',{name:'텔레그램용 복사',exact:true}).tap();
 await expect(page.locator('#mdExportSheet')).not.toHaveAttribute('open','');await expect(editor).toBeVisible();
 await expect(editor.locator('.md-editor-status')).toHaveText('텔레그램용 글을 복사했어요. 텔레그램에 붙여 넣으세요.');
 expect(await page.evaluate(()=>window.__copied)).toBe(['주간 정리','굵게 와 기울임, 취소, 코드','• 첫째','  • 하위','1. 하나','☐ 할 일','☑ 끝난 일','▎ 인용','','[참고]','참고 내용','','──────────','','항목: 성명, 담당: 홍보','','기사 (https://example.com/a)','(도식은 텔레그램에서 보이지 않아 뺐습니다)'].join('\n'));
 // The stored text is untouched: copying never rewrites the editor.
 expect(await area.inputValue()).toContain('# 주간 정리');
 expect(seen.external).toEqual([]);expect(seen.errors).toEqual([]);
});

// MD-내보내기 8-11a: ② 한글용 복사 puts the union numbering (docs/hwp-style-map.md) on the clipboard as HTML + plain text.
const HANGUL_MD=['# 사업 계획','1. 추진 배경','   - 산별전환 **본격화**','     - 교육','       - 장소','         - 서울','           - 본관','             - 3층','2. 일정','','* 세부 참고','','| 항목 | 담당 |','| --- | --- |','| 성명 & 보도 | 홍보 |'].join('\n');
const HANGUL_TEXT=['사업 계획','1. 추진 배경','  1) 산별전환 본격화','    (1) 교육','      ① 장소','        가. 서울','          가) 본관','            (가) 3층','2. 일정','','* 세부 참고','','항목\t담당','성명 & 보도\t홍보'].join('\n');
test('md editor 한글 copy writes the union numbering as HTML and plain text',async({page})=>{
 await page.setViewportSize({width:390,height:860});const seen=await fixture(page);
 const {editor,area}=await openEditor(page,390);
 await page.evaluate(()=>{navigator.clipboard.write=async items=>{window.__rich=await Promise.all(items[0].types.map(async t=>[t,await (await items[0].getType(t)).text()]));};});
 await area.fill(HANGUL_MD);
 await press(page,tool(editor,'내보내기'),390);
 await page.locator('#mdExportSheet').getByRole('button',{name:'한글용 복사',exact:true}).tap();
 await expect(page.locator('#mdExportSheet')).not.toHaveAttribute('open','');await expect(editor).toBeVisible();
 await expect(editor.locator('.md-editor-status')).toHaveText('한글용 글을 복사했어요. 한글에 붙여 넣으세요.');
 const rich=Object.fromEntries(await page.evaluate(()=>window.__rich));
 expect(Object.keys(rich).sort()).toEqual(['text/html','text/plain']);
 expect(rich['text/plain']).toBe(HANGUL_TEXT);
 // The HTML, read back by the browser: bold kept, a real two-column table, indentation as spaces.
 const parsed=await page.evaluate(html=>{const d=new DOMParser().parseFromString(html,'text/html');return {lines:[...d.body.querySelectorAll('p')].map(p=>p.textContent.replace(/ /g,' ')),bold:[...d.body.querySelectorAll('b')].map(b=>b.textContent),cells:[...d.body.querySelectorAll('tr')].map(tr=>[...tr.children].map(c=>c.tagName+':'+c.textContent))};},rich['text/html']);
 expect(parsed.lines).toEqual([...HANGUL_TEXT.split('\n').slice(0,12)]);
 expect(parsed.bold).toEqual(['사업 계획','본격화']);
 expect(parsed.cells).toEqual([['TH:항목','TH:담당'],['TD:성명 & 보도','TD:홍보']]);
 // Copying never rewrites the editor's text; Telegram copy still gives its own plain text.
 await expect(area).toHaveValue(HANGUL_MD);
 await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.__copied=text;};});
 await press(page,tool(editor,'내보내기'),390);
 await page.locator('#mdExportSheet').getByRole('button',{name:'텔레그램용 복사',exact:true}).tap();
 await expect(editor.locator('.md-editor-status')).toHaveText('텔레그램용 글을 복사했어요. 텔레그램에 붙여 넣으세요.');
 expect(await page.evaluate(()=>window.__copied)).toContain('1. 추진 배경\n   • 산별전환 본격화');
 expect(seen.writes).toEqual([]);expect(seen.external).toEqual([]);expect(seen.errors).toEqual([]);
});

test('md editor 한글 copy falls back to the copy command with both kinds, and says when copying fails',async({page})=>{
 await page.setViewportSize({width:390,height:860});const seen=await fixture(page);
 const {editor,area}=await openEditor(page,390);
 // An older WebView: no async rich clipboard. The copy event must still carry text/html and text/plain.
 await page.evaluate(()=>{navigator.clipboard.write=async()=>{throw new Error('no rich clipboard');};
  window.addEventListener('copy',e=>{window.__event={html:e.clipboardData.getData('text/html'),text:e.clipboardData.getData('text/plain'),prevented:e.defaultPrevented};});});
 await area.fill('- **하나**\n  - 둘');
 await press(page,tool(editor,'내보내기'),390);
 await page.locator('#mdExportSheet').getByRole('button',{name:'한글용 복사',exact:true}).tap();
 await expect(editor.locator('.md-editor-status')).toHaveText('한글용 글을 복사했어요. 한글에 붙여 넣으세요.');
 expect(await page.evaluate(()=>window.__event)).toEqual({html:'<p style="margin:0">1. <b>하나</b></p><p style="margin:0">&nbsp;&nbsp;1) 둘</p>',text:'1. 하나\n  1) 둘',prevented:true});
 // Nothing works: the same failure line as Telegram, and the text stays.
 await page.evaluate(()=>{document.execCommand=()=>false;});
 await press(page,tool(editor,'내보내기'),390);
 await page.locator('#mdExportSheet').getByRole('button',{name:'한글용 복사',exact:true}).tap();
 await expect(editor.locator('.md-editor-status')).toHaveText('복사하지 못했어요. 다시 눌러 주세요.');
 await expect(area).toHaveValue('- **하나**\n  - 둘');
 expect(seen.writes).toEqual([]);expect(seen.external).toEqual([]);expect(seen.errors).toEqual([]);
});

test('md editor closes with the phone back button and keeps the text in the edit field',async({page})=>{
 await page.setViewportSize({width:390,height:860});const seen=await fixture(page);
 const {detail,area}=await openEditor(page,390);
 await area.fill('뒤로 가기로 닫은 글');
 await page.goBack();
 await expect(page.locator('#mdEditor')).toHaveCount(0);
 await expect(detail.locator('[data-basket-text]')).toBeVisible();await expect(detail.locator('[data-basket-text]')).toHaveValue('뒤로 가기로 닫은 글');
 expect(new URL(page.url()).searchParams.get('view')).toBe('basket');
 // A smaller screen (keyboard open with resizes-content): the bottom tabs hide and the text runs down to the keyboard;
 // the toolbar stays right under the head.
 await press(page,detail.getByRole('button',{name:'큰 창에서 수정',exact:true}),390);
 await page.setViewportSize({width:390,height:500});
 await expect(page.locator('.mobile-tabs')).toBeHidden();
 const shell=await page.locator('#mdEditor').boundingBox();expect(Math.round(shell.y+shell.height)).toBe(500);
 const bar=await page.locator('#mdEditor .md-editor-tools').boundingBox();expect(bar.y).toBeLessThan(120);
 expect(seen.writes).toEqual([]);expect(seen.errors).toEqual([]);
});

test('md editor keeps native undo, keyboard shortcuts and Escape on a wide screen',async({page})=>{
 await page.setViewportSize({width:1280,height:860});const seen=await fixture(page);
 const {detail,editor,area}=await openEditor(page,1280);
 await select(area,0,2);await page.keyboard.press('Control+b');await expect(area).toHaveValue('**처음** 메모');
 await page.keyboard.press('Control+z');await expect(area).toHaveValue(ORIGINAL);
 await area.press('End');await page.keyboard.type(' 추가');await press(page,tool(editor,'인용'),1280);await expect(area).toHaveValue('> 처음 메모 추가');
 await page.keyboard.press('Control+z');await expect(area).toHaveValue('처음 메모 추가');
 // Escape closes the choice row first, then the editor (text kept).
 await press(page,tool(editor,'제목 단계 고르기'),1280);await page.keyboard.press('Escape');await expect(editor.locator('.md-editor-menu')).toBeHidden();await expect(editor).toBeVisible();
 await area.focus();await page.keyboard.press('Escape');
 await expect(page.locator('#mdEditor')).toHaveCount(0);await expect(detail.locator('[data-basket-text]')).toHaveValue('처음 메모 추가');
 await expect(detail.locator('[data-basket-read-text]')).toBeHidden();
 expect(seen.writes).toEqual([]);expect(seen.errors).toEqual([]);
});

test('md editor follows dark mode through the theme tokens',async({page},info)=>{
 await page.emulateMedia({colorScheme:'dark'});
 await page.setViewportSize({width:390,height:860});const seen=await fixture(page);
 const {editor,area,preview}=await openEditor(page,390);
 // Every surface reads a --kptu-* token, so the dark values from theme-tokens.css apply without editor rules.
 const colors=await editor.evaluate(el=>{
  const root=getComputedStyle(document.documentElement),probe=document.createElement('div');document.body.append(probe);
  const token=name=>{probe.style.color=`var(${name})`;return getComputedStyle(probe).color;};
  const want={surface:token('--kptu-surface'),ink:token('--kptu-ink'),subtle:token('--kptu-surface-subtle')};probe.remove();
  const text=el.querySelector('.md-editor-text'),bar=el.querySelector('.md-editor-bar'),tool=el.querySelector('.md-editor-tools button');
  return {frame:[getComputedStyle(text).borderTopWidth,getComputedStyle(text).borderTopLeftRadius],scheme:root.colorScheme,want,shell:getComputedStyle(el).backgroundColor,text:getComputedStyle(text).backgroundColor,textInk:getComputedStyle(text).color,bar:getComputedStyle(bar).backgroundColor,toolInk:getComputedStyle(tool).color};
 });
 expect(colors.scheme).toContain('dark');
 // The shared .modal textarea rule (ui-standard.css) must not frame the full-screen writing area.
 expect(colors.frame).toEqual(['0px','0px']);
 expect(colors.want.surface).toBe('rgb(31, 31, 27)');
 expect(colors.shell).toBe(colors.want.surface);expect(colors.text).toBe(colors.want.surface);expect(colors.bar).toBe(colors.want.subtle);
 expect(colors.textInk).toBe(colors.want.ink);expect(colors.toolInk).toBe(colors.want.ink);
 await area.fill('# 어두운 화면\n\n> [!NOTE]\n> 강조 상자\n\n| 항목 | 내용 |\n| --- | --- |\n| 가 | 나 |');
 await press(page,tool(editor,'미리보기'),390);await expect(preview.locator('h1')).toHaveText('어두운 화면');
 expect(await preview.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(colors.want.surface);
 await page.screenshot({path:info.outputPath('md-editor-dark-390.png')});
 expect(seen.external).toEqual([]);expect(seen.errors).toEqual([]);
});
