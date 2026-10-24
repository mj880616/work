import {test,expect} from '@playwright/test';
import {renderDocuments} from '../../supabase/functions/drive-summary/core.mjs';
const now=new Date('2026-10-11T01:00:00Z');
const notes=raw=>[{id:'00000000-0000-4000-8000-000000000003',raw_text:raw,occurred_at:now.toISOString(),created_at:now.toISOString(),updated_at:now.toISOString(),ai_export_allowed:true,archived_at:null,attachments:[]}];
// DRIVE-바구니원문제외(#926): the Drive project copy carries only a basket count line. Memo bodies, IDs, links and
// classification instructions must never appear, whatever the raw text looks like.
for(const raw of ['\n 첫 줄\n\n\t끝  ','\r\n\tCRLF\r끝  ','  <script>문자</script> & " \'\n'])test(`Drive HTML import carries only the basket count line ${JSON.stringify(raw)}`,async({page})=>{
 const data={organizations:[],organizationUpdates:[],projects:[],workstreams:[],progress:[],milestones:[],taskLinks:[],documents:[],meetings:[],notes:notes(raw),noteLinks:[]};
 const html=renderDocuments(data,now).project;
 await page.setContent(html);
 await expect(page.getByRole('heading',{name:'정리함'})).toBeVisible();
 await expect(page.getByText('정리함 미분류 메모 1건 (내용은 Web2 바구니에서 확인)')).toBeVisible();
 expect(await page.locator('pre').count()).toBe(0);
 expect(await page.locator('a').count()).toBe(0);
 expect(await page.locator('script').count()).toBe(0);
 expect(html).not.toContain('00000000-0000-4000-8000-000000000003');
 expect(html).not.toContain('문자');expect(html).not.toContain('CRLF');expect(html).not.toContain('첫 줄');
});
