// Only synthetic rows. Rebuild the two complete guidance examples, including fallback.
import {writeFileSync} from 'node:fs';
import {buildHandoff} from '../../../app/basket-ai-handoff.js';
import {renderBasket,selectBasketOrganizations} from '../../../supabase/functions/drive-summary/basket.mjs';
import {kstWindow} from '../../../supabase/functions/drive-summary/core.mjs';
const now=new Date('2026-10-11T12:00:00Z');
const organizations=[
 {id:'30000000-0000-4000-8000-000000000001',name:'합성 담당조직 A',active:true},
 {id:'30000000-0000-4000-8000-000000000002',name:'합성 담당조직 B',active:true},
 {id:'30000000-0000-4000-8000-000000000003',name:'합성 다른 조직',active:true},
 {id:'30000000-0000-4000-8000-000000000004',name:'합성 비활성 조직',active:false},
];
const notes=[{id:'10000000-0000-4000-8000-000000000001',updated_at:'2026-10-11T01:02:03.123456Z',occurred_at:'2026-10-10T03:00:00Z',created_at:'2026-10-10T03:00:00Z',ai_export_allowed:true,attachments:[{file_name:'합성 회의 자료.pdf',mime_type:'application/pdf',size_bytes:123,drive_file_id:'synthetic-drive-file'}],raw_text:'합성 담당조직의 다음 회의에서 일정 초안을 검토하기\n첨부는 회의 때 참고할 자료입니다.'}];
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
for(const fallback of [false,true]){
 const selected=selectBasketOrganizations(organizations,fallback?[]:organizations.slice(0,2).map(o=>({organization_id:o.id})));
 const html=renderBasket(notes,[],[],selected.organizations,now,kstWindow(now),selected.fallback).html;
 const text=Array.from(html.matchAll(/<(?:h2|h3|p|pre)(?:\s[^>]*)?>([\s\S]*?)<\/(?:h2|h3|p|pre)>/g),m=>decode(m[1].replace(/<[^>]+>/g,''))).join('\n\n')+'\n';
 const drive=fallback?'basket-org-mine-drive-fallback.txt':'basket-org-only-drive-example.txt';
 const handoff=fallback?'basket-org-mine-handoff-fallback.txt':'basket-ai-handoff-prompt-example.txt';
 writeFileSync(new URL('../../'+drive,import.meta.url),text);
 writeFileSync(new URL('../../'+handoff,import.meta.url),buildHandoff(notes,selected.organizations,now,selected.fallback)+'\n');
}
