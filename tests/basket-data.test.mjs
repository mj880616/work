import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNoteText, noteState, visibleNotes, filedProjects, notePlaces, noteClassified, BASKET_PLACES, createNote, updateNote, readBasket } from '../app/basket-data.js';

test('text validation rejects whitespace and over 20000 Unicode characters without trimming originals',()=>{
 assert.throws(()=>validateNoteText(' \n\t '),/입력/);
 assert.throws(()=>validateNoteText('가'.repeat(20001)),/20,000/);
 assert.equal(validateNoteText(' \n메모\n '),' \n메모\n ');
 assert.equal(validateNoteText('😀'.repeat(20000)).length,40000);
});
test('archive wins, only confirmed note links count, all destinations remain visible',()=>{
 const links=[{note_id:'n',status:'suggested',project:{name:'제안'}},{note_id:'n',status:'confirmed',project_id:'p',project:{name:'프로젝트'}},{note_id:'n',status:'confirmed',organization_id:'o',organization:null},{note_id:'other',status:'confirmed',project_id:'p',project:{name:'다른 메모'}}];
 assert.deepEqual(noteState({id:'n'},links),{status:'확정',destinations:['프로젝트: 프로젝트','연결 대상 없음']});
 assert.equal(noteState({id:'n',archived_at:'now'},links).status,'보관');
 assert.equal(noteState({id:'new'},links).status,'미분류');
 const notes=[{id:'archived',archived_at:'now'},{id:'new'},{id:'n'}];
 assert.deepEqual(visibleNotes(notes,links,'unclassified').map(n=>n.id),['new']);
 assert.deepEqual(visibleNotes(notes,links,'classified').map(n=>n.id),['n']);
 assert.deepEqual(visibleNotes(notes,links,'archived').map(n=>n.id),['archived']);
});
const runtime=api=>({context:{read:()=>({workspace:{id:'w'},user:{id:'u'}})},api});
test('create uses current workspace, preserves text, AI field omitted by default and no task endpoint',async()=>{
 const calls=[];const rt=runtime(async(path,options)=>{calls.push({path,options});return [{id:'n',...options.body}];});
 await createNote({raw_text:' 할일 메모\n ',ai_export_allowed:false},rt);
 assert.equal(calls.length,1);assert.equal(calls[0].path,'/rest/v1/app_notes');
 assert.deepEqual(calls[0].options.body,{workspace_id:'w',raw_text:' 할일 메모\n ',ai_export_allowed:false});
 assert.equal(calls[0].options.prefer,'return=representation');
 await createNote({raw_text:'메모'},rt);assert.equal(Object.hasOwn(calls[1].options.body,'ai_export_allowed'),false);
});
test('patch updates timestamp, sends only allowed fields and requires an RLS-visible result',async()=>{
 let sent;const rt=runtime(async(path,options)=>{sent={path,options};return [{id:'n',...options.body}];});
 await updateNote('n',{raw_text:' 수정\n ',workspace_id:'forged',ai_export_allowed:false},rt);
 assert.match(sent.path,/id=eq.n&workspace_id=eq.w/);assert.equal(sent.options.method,'PATCH');
 assert.equal(sent.options.body.workspace_id,undefined);assert.equal(sent.options.body.raw_text,' 수정\n ');assert.ok(Date.parse(sent.options.body.updated_at));
 await assert.rejects(updateNote('n',{archived_at:null},runtime(async()=>[])),/권한|확인/);
 await assert.rejects(createNote({raw_text:'메모'},runtime(async()=>{throw Error('RLS 거부');})),/RLS 거부/);
});
test('read pages notes and note-only links without silently truncating at REST row cap',async()=>{
 const paths=[];const rt=runtime(async path=>{paths.push(path);const u=new URL(path,'https://test');const offset=Number(u.searchParams.get('offset'));if(u.pathname.endsWith('app_notes'))return offset===0?Array.from({length:100},(_,i)=>({id:'n'+i})):offset===100?[{id:'last'}]:[];return offset===0?Array.from({length:100},()=>({note_id:'n0',status:'confirmed'})):[];});
 const result=await readBasket(rt);assert.equal(result.notes.length,101);assert.equal(result.links.length,200);
 assert.ok(paths.filter(p=>p.includes('app_notes')).every(p=>p.includes('order=occurred_at.desc,id.desc')));
 assert.ok(paths.filter(p=>p.includes('app_record_links')).every(p=>p.includes('note_id=in.')&&p.includes('workspace_id=eq.w')));
});

// UI-바구니거르기: with [전체] gone, a memo with only a stored suggestion waits in [미분류] (row says "정리 제안 있음")
// instead of disappearing from every segment; it is not [분류] until confirmed.
test('persisted suggested links stay in unclassified until confirmed, confirmed wins',()=>{
 const links=[{note_id:'n',status:'suggested',project_id:'p'}];
 assert.equal(noteState({id:'n'},links).status,'분류 제안됨');
 assert.deepEqual(visibleNotes([{id:'n'}],links,'unclassified').map(n=>n.id),['n']);
 assert.deepEqual(visibleNotes([{id:'n'}],links,'classified'),[]);
});

// BUG-자료넣기미분류: [자료로 넣기] makes no record link; the memo's files as a project's documents classify it.
test('a memo whose files are a project document is classified, and follows where the document is now',()=>{
 const note={id:'n',attachments:[{drive_file_id:'drive-a'},{drive_file_id:'drive-b'}]};
 const docs=[{file_id:'drive-a',project_id:'p',project:{name:'민자철도'}},{file_id:'drive-b',project_id:'p',project:{name:'민자철도'}}];
 assert.deepEqual(filedProjects(note,docs),[{project_id:'p',name:'민자철도'}]);
 assert.deepEqual(noteState(note,[],docs),{status:'확정',destinations:['프로젝트 자료: 민자철도']});
 assert.deepEqual(visibleNotes([note,{id:'plain'}],[],'unclassified',docs).map(n=>n.id),['plain']);
 // Moved to another project: the line follows; taken out of every project: unclassified again.
 assert.deepEqual(filedProjects(note,[{file_id:'drive-a',project_id:'q',project:{name:'궤도'}}]),[{project_id:'q',name:'궤도'}]);
 assert.equal(noteState(note,[],[]).status,'미분류');
 assert.equal(noteState({...note,archived_at:'now'},[],docs).status,'보관');
 // Without docs the old two-argument calls behave as before.
 assert.equal(noteState(note,[]).status,'미분류');
});
test('the basket read asks for these attachments\' documents and their project names only, and survives a failed read',async()=>{
 const paths=[];
 const handler=fail=>async path=>{paths.push(path);const u=new URL(path,'https://test');
  if(u.pathname.endsWith('app_notes'))return [{id:'n1',attachments:[{drive_file_id:'drive-a'},{drive_file_id:'bad id'}]},{id:'n2',attachments:[]}];
  if(u.pathname.endsWith('app_record_links'))return [];
  if(u.pathname.endsWith('app_documents')){if(fail)throw Error('x');return [{id:'d1',file_id:'drive-a',project_id:'p'},{id:'d2',file_id:'drive-a',project_id:'q'}];}
  if(u.pathname.endsWith('app_spaces'))return [{id:'p',name:'민자철도'}];
  return [];};
 const result=await readBasket(runtime(handler(false)));
 assert.deepEqual(result.docs,[{id:'d1',file_id:'drive-a',project_id:'p',project:{name:'민자철도'}}]);
 const doc=paths.find(p=>p.startsWith('/rest/v1/app_documents')),space=paths.find(p=>p.startsWith('/rest/v1/app_spaces'));
 assert.match(doc,/^\/rest\/v1\/app_documents\?workspace_id=eq\.w&file_id=in\.\(drive-a\)&select=id,file_id,project_id&order=created_at\.asc,id\.asc/);
 assert.match(space,/^\/rest\/v1\/app_spaces\?workspace_id=eq\.w&id=in\.\(p\)&select=id,name/);
 const failed=await readBasket(runtime(handler(true)));
 assert.equal(failed.notes.length,2);assert.deepEqual(failed.docs,[]);
});

// UI-바구니거르기: [미분류][분류][보류] and, under [분류], where the memo went.
test('segments split unclassified, classified and on-hold memos; place chips follow links, filed documents and tasks',()=>{
 assert.deepEqual(BASKET_PLACES.map(([v])=>v),['all','organization','project','library','task']);
 assert.deepEqual(BASKET_PLACES.map(([,l])=>l),['전체','담당조직','프로젝트','자료실','할 일']);
 const task={task_id:'t1',task_list_id:'l',title:'할 일',created_at:'2026-10-18T00:00:00Z'};
 const notes=[
  {id:'org'},{id:'proj'},{id:'doc'},{id:'meet'},{id:'filed',attachments:[{drive_file_id:'drive-a'}]},
  {id:'task',metadata:{tasks:[task]}},{id:'bad-task',metadata:{tasks:[{task_id:''}]}},{id:'plain'},{id:'suggest'},
  {id:'held',archived_at:'now'},{id:'held-linked',archived_at:'now'},
 ];
 const links=[
  {note_id:'org',status:'confirmed',organization_id:'o'},{note_id:'proj',status:'confirmed',project_id:'p'},
  {note_id:'doc',status:'confirmed',document_id:'d'},{note_id:'meet',status:'confirmed',meeting_id:'m'},
  {note_id:'suggest',status:'suggested',project_id:'p'},{note_id:'held-linked',status:'confirmed',project_id:'p'},
 ];
 const docs=[{file_id:'drive-a',project_id:'p',project:{name:'민자철도'}}];
 const ids=(filter,place)=>visibleNotes(notes,links,filter,docs,place).map(n=>n.id);
 assert.deepEqual(ids('unclassified'),['bad-task','plain','suggest']);
 assert.deepEqual(ids('classified'),['org','proj','doc','meet','filed','task']);
 assert.deepEqual(ids('classified','all'),ids('classified'));
 assert.deepEqual(ids('classified','organization'),['org']);
 // #671 "자료로 넣음" (a project's library document) counts for both 프로젝트 and 자료실.
 assert.deepEqual(ids('classified','project'),['proj','filed']);
 assert.deepEqual(ids('classified','library'),['doc','filed']);
 assert.deepEqual(ids('classified','task'),['task']);
 assert.deepEqual(ids('archived'),['held','held-linked']);
 // Every memo is in exactly one segment.
 assert.equal(ids('unclassified').length+ids('classified').length+ids('archived').length,notes.length);
 assert.deepEqual([...notePlaces(notes[4],links,docs)].sort(),['library','project']);
 assert.equal(noteClassified(notes[5],[],[]),true);assert.equal(noteClassified(notes[9],links,docs),false);
 // An unknown place (an old value) narrows to nothing rather than throwing; the screen only offers the five above.
 assert.deepEqual(ids('classified','unknown'),[]);
 // noteState itself (shared with drive-summary) is unchanged by tasks.
 assert.equal(noteState(notes[5],[]).status,'미분류');
});
