import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { noteField, edWin, edWinText } from './helpers/note-editor.mjs';
// UI-편집기초점테두리: pressing the note body (or a format button) draws ONE focus ring around the whole editor — the format row
// and the body together — with the same colour and thickness as other input fields (base-ui.css input:focus). The body itself
// draws no outline of its own. The rule is the shared editor part's (ed-doc.css .ed-editor:focus-within). 합성 데이터.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const shot=(info,name)=>process.env.CAPTURE_DIR?`${process.env.CAPTURE_DIR}/${name}`:info.outputPath(name);
async function fixture(page){
 const at='2026-11-10T01:00:00Z',rows=[{id:'n-1',workspace_id:'w',kind:'note',title:'합성 회의 메모',raw_text:'첫 줄 메모\n둘째 줄',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}}],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(r.request().method()!=='GET')return r.fulfill({status:500,json:{}});
  if(q.get('metadata'))return r.fulfill({json:[]});
  return r.fulfill({json:rows.filter(x=>(!q.get('kind')||'eq.'+x.kind===q.get('kind'))&&(!q.get('id')||'eq.'+x.id===q.get('id'))).slice(Number(q.get('offset')||0))});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 return errors;
}
// The look of a focused input field, read from a real input on the same page (so the editor follows the shared input rule).
const inputFocusLook=page=>page.evaluate(()=>{
 const i=document.createElement('input');document.body.append(i);i.focus();
 const s=getComputedStyle(i),look={ink:s.borderTopColor,shadow:s.boxShadow};i.remove();return look;
});
const ringOf=el=>el.evaluate(n=>{const s=getComputedStyle(n);return {shadow:s.boxShadow};});
const outlineOf=el=>el.evaluate(n=>getComputedStyle(n).outlineStyle);

for(const [width,name] of [[412,'phone-412'],[673,'fold-673'],[1280,'pc-1280']]){
 test(`note edit: body or format button focus rings the whole editor (format row + body), body has no own outline ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:860});const errors=await fixture(page);
  await chooseBasketKind(page,'note');await page.locator('[data-note-host] [data-note-row]').filter({hasText:'합성 회의 메모'}).click();
  await noteMenuAction(page,'data-note-edit',{width});
  const field=noteField(page);await expect(field).toBeVisible();
  const editor=page.locator('[data-note-detail] [data-note-body-field] .ed-editor'),bar=editor.locator('.ed-bar');
  const look=await inputFocusLook(page);
  expect((await ringOf(editor)).shadow).toBe('none');
  await field.click();
  await expect(field).toBeFocused();
  const ring=(await ringOf(editor)).shadow;
  // Two rings: the input's border colour 1px, then the input's soft 3px halo (same colour as input:focus box-shadow).
  expect(ring).toContain(look.ink);expect(look.shadow).toContain('3px');
  expect(ring).toContain(look.shadow.replace(/ 0px 0px 0px 3px$/,'').replace(/^(rgba?\([^)]*\)).*/,'$1'));
  expect(await outlineOf(field)).toBe('none');
  // The ring encloses the format row: the row sits inside the editor box that carries the ring.
  const [eb,bb,fb]=await Promise.all([editor.boundingBox(),bar.boundingBox(),field.boundingBox()]);
  expect(bb.y).toBeGreaterThanOrEqual(eb.y-0.5);expect(bb.y+bb.height).toBeLessThanOrEqual(fb.y+0.5);expect(fb.y+fb.height).toBeLessThanOrEqual(eb.y+eb.height+0.5);
  await page.evaluate(()=>scrollTo(0,0));await expect(field).toBeFocused();
  await page.screenshot({path:shot(info,`note-edit-focus-${name}.png`)});
  // A format button with keyboard focus keeps the same one ring (focus is still inside the editor).
  await bar.locator('[data-ed-cmd="strong"]').focus();
  await expect(bar.locator('[data-ed-cmd="strong"]')).toBeFocused();
  expect((await ringOf(editor)).shadow).toBe(ring);
  // Focus leaves the editor → no ring.
  await page.locator('[data-note-title-input]').focus();
  expect((await ringOf(editor)).shadow).toBe('none');
  expect(errors).toEqual([]);
 });
}

test('big write window (same editor part): the same rule applies, the body has no own outline',async({page},info)=>{
 await page.setViewportSize({width:1280,height:860});const errors=await fixture(page);
 await chooseBasketKind(page,'note');await page.locator('[data-note-host] [data-note-row]').filter({hasText:'합성 회의 메모'}).click();
 await noteMenuAction(page,'data-note-edit');await expect(noteField(page)).toBeVisible();
 await page.locator('[data-note-detail] [data-note-big-write]').click();
 const text=edWinText(page);await expect(edWin(page)).toBeVisible();await text.click();await expect(text).toBeFocused();
 const editor=edWin(page).locator('.ed-editor');
 expect((await ringOf(editor)).shadow).not.toBe('none');
 expect(await outlineOf(text)).toBe('none');
 await page.screenshot({path:shot(info,'big-window-focus-pc-1280.png')});
 expect(errors).toEqual([]);
});
