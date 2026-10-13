export const at=new Date('2026-10-03T15:30:00Z');
const note=(id,raw_text,attachments=[])=>({id,raw_text,attachments,occurred_at:at.toISOString(),created_at:at.toISOString(),updated_at:'2026-10-03T15:30:00.000001Z',ai_export_allowed:true,archived_at:null});
export function profiles(){
 const empty={organizations:[],organizationUpdates:[],projects:[],workstreams:[],progress:[],milestones:[],taskLinks:[],documents:[],meetings:[],noteLinks:[],notes:[]};
 const ocr=state=>({drive_file_id:'f',file_name:'사진<&>.png',mime_type:'image/png',size_bytes:1,ocr:state==='unread'?{state,original_file_id:'f',cleanup_state:'none'}:{state,original_file_id:'f',attempt_id:'10000000-0000-4000-8000-000000000001',cleanup_state:'delete_failed',temp_document_id:'temp',text:state==='empty'?'':'\r\n한글😀&<>"\u0001'}});
 return {
  empty,
  controls:{...empty,notes:[note('control','  원문\r\n\r\t한글😀<&>"\u0001'),note('long','x'.repeat(4095)+'😀\r\n')]},
  ocr:{...empty,notes:['unread','reading','done','empty','failed'].map((state,i)=>note('ocr'+i,'원문'+state,[ocr(state)]))},
  context:{...empty,organizations:[{id:'org',name:'담당조직',recent_month_summary:'요약\r\n<&>'},{id:'other',name:'다른조직'}],organizationAssignees:[{organization_id:'org'}],projects:[{id:'p',project_system:'v2',name:'사업',status:'active'},{id:'child',parent_id:'p',name:'하위',status:'active'},{id:'done',name:'완료',status:'done'}],workstreams:[{id:'w',project_id:'p',phase:'consultation',title:'협의'}],progress:[{id:'u',project_id:'p',workstream_id:'w',effective_on:'2026-10-01',summary:'진행',next_step:'다음',status_label:'예정'}],milestones:[{id:'m',project_id:'p',title:'주요일정',start_at:'2026-10-05T00:00:00Z'}],meetings:[{id:'meet',project_id:'p',series_name:'회의',round_no:2,meeting_at:'2026-10-01T00:00:00Z'}],taskLinks:[{project_id:'p'}],documents:[{project_id:'child'}],notes:[note('a','유효'),{...note('old','old'),occurred_at:'2026-01-01T00:00:00Z'},note('linked','linked')],noteLinks:[{note_id:'linked',status:'confirmed'}]},
  hundred:{...empty,notes:Array.from({length:100},(_,i)=>note(`n${i}`,'짧은 원문'))},
 };
}
