// Only synthetic rows. Rebuild the two complete handoff examples, including fallback.
// DRIVE-바구니원문제외: the Drive copy no longer carries a basket prompt, so the two *-drive-*.txt examples are no longer
// generated (the committed files are history of the earlier design).
import {writeFileSync} from 'node:fs';
import {buildHandoff} from '../../../app/basket-ai-handoff.js';
import {selectBasketOrganizations} from '../../../supabase/functions/drive-summary/basket.mjs';
const now=new Date('2026-10-11T12:00:00Z');
const organizations=[
 {id:'30000000-0000-4000-8000-000000000001',name:'합성 담당조직 A',active:true},
 {id:'30000000-0000-4000-8000-000000000002',name:'합성 담당조직 B',active:true},
 {id:'30000000-0000-4000-8000-000000000003',name:'합성 다른 조직',active:true},
 {id:'30000000-0000-4000-8000-000000000004',name:'합성 비활성 조직',active:false},
];
const notes=[{id:'10000000-0000-4000-8000-000000000001',updated_at:'2026-10-11T01:02:03.123456Z',occurred_at:'2026-10-10T03:00:00Z',created_at:'2026-10-10T03:00:00Z',ai_export_allowed:true,attachments:[{file_name:'합성 회의 자료.pdf',mime_type:'application/pdf',size_bytes:123,drive_file_id:'synthetic-drive-file'}],raw_text:'합성 담당조직의 다음 회의에서 일정 초안을 검토하기\n첨부는 회의 때 참고할 자료입니다.'}];
for(const fallback of [false,true]){
 const selected=selectBasketOrganizations(organizations,fallback?[]:organizations.slice(0,2).map(o=>({organization_id:o.id})));
 const handoff=fallback?'basket-org-mine-handoff-fallback.txt':'basket-ai-handoff-prompt-example.txt';
 writeFileSync(new URL('../../'+handoff,import.meta.url),buildHandoff(notes,selected.organizations,now,selected.fallback)+'\n');
}
