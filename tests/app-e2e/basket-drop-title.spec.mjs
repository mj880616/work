import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// BASKET-드롭제목: a file dropped on the basket input is sent with its own name (the same request as the [첨부] picker), and
// the row shows that name. Names stored before the multipart fix (#925) were cut at the first ';' or '=' with the opening
// quote kept (`"회의록`, or a bare `"`); those rows show the readable part, or just "파일", without changing the stored row.
async function fixture(page,width){
 const errors=[],uploads=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.setViewportSize({width,height:900});
 await openHome(page);
 const notes=[
  {id:'old-bare',raw_text:'',occurred_at:'2026-10-21T15:29:00Z',ai_export_allowed:true,attachments:[{file_name:'"',mime_type:'application/octet-stream',size_bytes:2048,drive_file_id:'f_bare'}]},
  {id:'old-cut',raw_text:'',occurred_at:'2026-10-21T15:00:00Z',ai_export_allowed:true,attachments:[{file_name:'"회의록',mime_type:'application/x-hwp',size_bytes:4096,drive_file_id:'f_cut'}]},
 ];
 await page.route(SB+'/rest/v1/app_notes**',r=>{
  const req=r.request(),u=new URL(req.url());
  if(req.method()==='GET'){if(u.searchParams.get('kind')==='eq.note')return r.fulfill({json:[]});return r.fulfill({json:notes});}
  writes.push({method:req.method(),url:req.url()});return r.fulfill({status:500,json:{}});
 });
 // Like the fixed basket-files: the stored name is the multipart filename as the browser sent it.
 await page.route(SB+'/functions/v1/basket-files',r=>{
  const raw=r.request().postDataBuffer().toString('utf8');uploads.push(raw);
  const name=raw.match(/filename="([^"]*)"/)?.[1]??'';
  const note={id:'dropped',raw_text:'',occurred_at:'2026-10-22T00:29:00Z',ai_export_allowed:true,attachments:[{file_name:name,mime_type:'application/x-hwp',size_bytes:12,drive_file_id:'f_drop'}]};
  notes.unshift(note);
  return r.fulfill({json:{ok:true,note_id:note.id,attachments:note.attachments}});
 });
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await expect(page.locator('[data-basket-row="old-bare"]')).toBeVisible();
 return {errors,uploads,writes,notes};
}
const title=(page,id)=>page.locator(`[data-basket-row="${id}"] .basket-title`);

for(const width of [390,1280]){
 test(`old cut attachment names show readably and unchanged in storage ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await expect(title(page,'old-bare')).toHaveText('파일');
  await expect(title(page,'old-cut')).toHaveText('파일 · 회의록');
  await expect(page.locator('[data-basket-rows]')).not.toContainText('"');
  await page.locator('[data-basket-row="old-bare"]').click();
  await expect(page.locator('[data-basket-attachments]')).toContainText('파일');
  await expect(page.locator('[data-basket-attachments]')).not.toContainText('"');
  expect(f.notes.find(n=>n.id==='old-bare').attachments[0].file_name).toBe('"');
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });
}

test('a file dropped on the basket input on a PC keeps its whole name, as the [첨부] picker does',async({page})=>{
 const f=await fixture(page,1280);
 const box=page.locator('#basketView [data-basket-list] [data-home-quick]');
 const name='회의록; 최종=v2.hwp';
 const dt=await page.evaluateHandle(name=>{const d=new DataTransfer();d.items.add(new File(['hwp'],name,{type:'application/x-hwp'}));return d;},name);
 await box.locator('[data-quick-input]').dispatchEvent('dragenter',{dataTransfer:dt});
 await box.locator('[data-quick-input]').dispatchEvent('drop',{dataTransfer:dt});
 await expect(box.locator('[data-basket-file]')).toContainText(name);
 await box.locator('[data-quick-save]').click();
 await expect(page.locator('#toast')).toHaveText('바구니에 저장했습니다.');
 expect(f.uploads).toHaveLength(1);
 expect(f.uploads[0]).toContain(`filename="${name}"`);expect(f.uploads[0]).not.toContain('name="raw_text"');
 await expect(title(page,'dropped')).toHaveText(`파일 · ${name}`);
 await expect(page.locator('[data-basket-row="dropped"]')).toContainText('첨부 1개');
 // The [첨부] picker sends the same filename part for the same name.
 await box.locator('input[type=file]').setInputFiles([{name,mimeType:'application/x-hwp',buffer:Buffer.from('hwp')}]);
 await box.locator('[data-quick-save]').click();
 await expect.poll(()=>f.uploads.length).toBe(2);
 expect(f.uploads[1].match(/filename="[^"]*"/)?.[0]).toBe(f.uploads[0].match(/filename="[^"]*"/)?.[0]);
 await dt.dispose();
 expect(f.errors).toEqual([]);
});
