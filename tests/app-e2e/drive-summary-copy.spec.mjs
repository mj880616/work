import {test,expect} from '@playwright/test';
import {renderDocuments} from '../../supabase/functions/drive-summary/core.mjs';
const now=new Date('2026-10-11T01:00:00Z');
const notes=raw=>[{id:'00000000-0000-4000-8000-000000000003',raw_text:raw,occurred_at:now.toISOString(),created_at:now.toISOString(),updated_at:now.toISOString(),ai_export_allowed:true,archived_at:null,attachments:[]}];
for(const raw of ['\n 첫 줄\n\n\t끝  ','\r\n\tCRLF\r끝  ','  <script>문자</script> & " \'\n'])test(`Drive HTML import preserves all raw whitespace ${JSON.stringify(raw)}`,async({page})=>{
 const data={organizations:[],organizationUpdates:[],projects:[],workstreams:[],progress:[],milestones:[],taskLinks:[],documents:[],meetings:[],notes:notes(raw),noteLinks:[]};
 const html=renderDocuments(data,now).project;
 await page.setContent(html);expect(await page.locator('pre[style]').textContent()).toBe(raw);
 await expect(page.getByRole('link',{name:/desk.bokdoong.com/})).toHaveAttribute('href','https://desk.bokdoong.com/work/app/?view=basket&note=00000000-0000-4000-8000-000000000003');
 expect(await page.locator('script').count()).toBe(0);
});
