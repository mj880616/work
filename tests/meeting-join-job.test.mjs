// REC-한회의로잇기 PR-2(설계 docs/design/rec-join.md 3-1·3-5·3-7절): 잇기 작업 규칙과 사용자 입구 순서(Edge meeting-transcribe join-job.mjs).
// DB·네트워크 없이 가짜 io로 본다: 부른 사람 로그인 읽기(owner RLS·휴지통 숨김 흉내) → owner 확인 → 그 뒤에만 서비스 권한.
// 보고·전사 글은 모두 지어낸 것이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as jj from '../supabase/functions/meeting-transcribe/join-job.mjs';
import * as sj from '../supabase/functions/meeting-transcribe/server-job.mjs';
import {Fail,MESSAGES,STATUS} from '../supabase/functions/meeting-transcribe/model.mjs';
import {parseMeetingDraft} from '../supabase/functions/meeting-ai-draft/parse.mjs';
import * as appModel from '../app/meeting-transcript-model.mjs';
import {failText} from '../app/meeting-server-job.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000000`;
const ME=id(1),OTHER=id(2),WS=id(10),WS2=id(20);
const NOW=Date.parse('2026-11-11T05:00:00Z'); // 서울 14:00
const iso=ms=>new Date(ms).toISOString();
const sha=t=>createHash('sha256').update(t,'utf8').digest('hex');
const code=async p=>{try{await p;return 'ok'}catch(e){return e.code||e.status||e.message}};
const ACTIVE=['queued','running'];

// 가짜 DB + io. io.user*는 부른 사람(user)의 로그인으로 읽는 길이라 owner인 작업공간의, 휴지통이 아닌 행만 보인다.
function world(){
  const db={
    members:[{workspace_id:WS,user_id:ME,role:'owner'},{workspace_id:WS2,user_id:OTHER,role:'owner'}],
    meetings:[],serverJobs:[],recordJobs:[],docs:[],joins:[],inserted:[],patches:[],noJoinTable:false,undoError:null,
  };
  const log=[];let seq=100;
  const owns=(u,ws)=>db.members.some(m=>m.workspace_id===ws&&m.user_id===u&&m.role==='owner');
  const gone=()=>{if(db.noJoinTable)throw new Fail('jobs_unavailable')};
  const io=user=>({
    now:()=>NOW,
    kick:jobId=>{log.push(`kick:${jobId}`)},
    isOwner:async(u,ws)=>{log.push('owner');return owns(u,ws)},
    ownerWorkspaces:async u=>{log.push('owner-list');const list=db.members.filter(m=>m.user_id===u&&m.role==='owner').map(m=>m.workspace_id);if(!list.length)throw Object.assign(new Error('RESOURCE_FORBIDDEN'),{status:403});return list},
    userMeeting:async mid=>{log.push('user:meeting');const m=db.meetings.find(x=>x.id===mid);return m&&owns(user,m.workspace_id)&&!m.deleted_at?{...m}:null},
    userMeetingsOfDay:async(ws,from,to)=>{log.push('user:meetings');return db.meetings.filter(m=>m.workspace_id===ws&&owns(user,ws)&&!m.deleted_at&&Date.parse(m.meeting_at)>=Date.parse(from)&&Date.parse(m.meeting_at)<Date.parse(to)).map(m=>({...m}))},
    userRecordingDocs:async(ws,ids)=>{log.push('user:docs');return db.docs.filter(d=>d.workspace_id===ws&&owns(user,ws)&&ids.includes(d.meeting_id)&&d.tags.includes('회의녹음'))},
    userJoinJob:async jid=>{log.push('user:join');gone();const j=db.joins.find(x=>x.id===jid);return j&&owns(user,j.workspace_id)?{...j}:null},
    userJoinList:async(wss,u,since)=>{log.push('user:joins');gone();return db.joins.filter(j=>wss.includes(j.workspace_id)&&owns(user,j.workspace_id)&&j.created_by===u&&j.created_at>=since&&!j.seen_at).map(j=>({...j}))},
    ownServerJob:async(u,jid)=>{log.push('service:server-job');const j=db.serverJobs.find(x=>x.id===jid);return j&&owns(u,j.workspace_id)&&j.created_by===u?{...j}:null},
    recordJobs:async(ws,ids)=>{log.push('service:record-jobs');return db.recordJobs.filter(r=>r.workspace_id===ws&&ids.includes(r.id)).map(r=>({...r}))},
    linkedRecordJobs:async(ws,ids)=>{log.push('service:linked-records');return db.recordJobs.filter(r=>r.workspace_id===ws&&ids.includes(r.meeting_id))},
    linkedServerJobs:async(ws,ids)=>{log.push('service:linked-jobs');return db.serverJobs.filter(j=>j.workspace_id===ws&&ids.includes(j.meeting_id))},
    linkedTranscripts:async(ws,mid)=>{log.push('service:linked-text');return db.serverJobs.filter(j=>j.workspace_id===ws&&j.meeting_id===mid&&j.status==='done').sort((a,b)=>a.created_at<b.created_at?-1:1)},
    joinReady:async()=>{log.push('service:ready');gone()},
    activeJoins:async ws=>{log.push('service:active');gone();return db.joins.filter(j=>j.workspace_id===ws&&ACTIVE.includes(j.status)).map(j=>({...j}))},
    joinSourceText:async(ws,jid)=>{log.push('service:source-text');return db.joins.find(j=>j.workspace_id===ws&&j.id===jid)?.source_text??null},
    sourceJoined:async(ws,sid)=>{log.push('service:joined');return db.joins.some(j=>j.workspace_id===ws&&j.source_job_id===sid&&j.status==='done')},
    // 부분 유일 색인 3개(같은 보고에 진행 중 하나 / 같은 녹음 결과에 진행 중·끝남 하나 / 같은 없어질 보고에 진행 중 하나)를 흉내 낸다.
    insertJoin:async row=>{
      log.push('service:insert');db.inserted.push(row);
      const live=j=>ACTIVE.includes(j.status);
      if(db.joins.some(j=>live(j)&&j.target_meeting_id===row.target_meeting_id)
        ||(row.source_job_id&&db.joins.some(j=>(live(j)||j.status==='done')&&j.source_job_id===row.source_job_id))
        ||(row.source_meeting_id&&db.joins.some(j=>live(j)&&j.source_meeting_id===row.source_meeting_id)))return {conflict:true};
      const job={id:id(++seq),created_at:iso(NOW),updated_at:iso(NOW),lease_until:null,attempts:0,error_code:null,seen_at:null,applied_at:null,undone_at:null,candidates_closed_at:null,...row};
      db.joins.push(job);return {job:{...job}};
    },
    patchJoin:async(jid,patch,guard={})=>{
      log.push('service:patch');db.patches.push(patch);
      const j=db.joins.find(x=>x.id===jid&&Object.entries(guard).every(([k,v])=>x[k]===v));
      if(!j)return [];
      Object.assign(j,jj.joinPatch(patch,iso(NOW)));return [{...j}];
    },
    undo:async(jid,scope)=>{log.push(`service:undo:${scope}`);if(db.undoError)throw new Fail(jj.joinRpcCode(db.undoError));return {scope,undone:scope==='all',kept:scope==='before'}},
  });
  return {db,log,io};
}
// 앞 보고(10:02에 녹음으로 쓴 [회의] 보고) + 뒤 녹음 결과(13:20 시작 10분, 아직 보고로 저장 안 함) + 그 녹음 구간.
function seed(){
  const w=world();
  const T={id:id(30),workspace_id:WS,activity_kind:'meeting',meeting_at:'2026-11-11T01:02:00+00:00',transcript_text:'참석: 김가상\n\n결정\n- 앞 회의에서 정한 것',notes:'화자1: 앞 녹음의 글',deleted_at:null};
  const J={id:id(40),workspace_id:WS,created_by:ME,kind:'recording',status:'done',meeting_id:null,transcript_text:'화자1: 뒤 녹음의 글',parts:[{no:1,seconds:600,job:id(50),text:'화자1: 뒤 녹음의 글'}],created_at:'2026-11-11T04:30:00.000Z'};
  const R={id:id(50),workspace_id:WS,created_by:ME,status:'done',meeting_id:null,trashed_at:null,duration_sec:600};
  w.db.meetings.push(T);w.db.serverJobs.push(J);w.db.recordJobs.push(R);
  return {...w,T,J,R};
}
const startJob=(w,user=ME,extra={})=>jj.startJoin(w.io(user),user,jj.parseJoinStart({target_meeting_id:w.T.id,source:{job_id:w.J.id},...extra}));
const serviceBeforeOwner=log=>{const owner=log.indexOf('owner');return log.some((l,i)=>l.startsWith('service:')&&(owner<0||i<owner))};

test('요청 모양: 고른 보고·재료 id만 꺼낸다(작업공간 값은 읽지 않음), 같은 보고끼리·두 재료·모르는 재료는 거절',()=>{
  const T=id(30),J=id(40),S=id(31);
  assert.deepEqual(jj.parseJoinStart({target_meeting_id:T,source:{job_id:J}}),{targetId:T,mode:'job',sourceJobId:J});
  assert.deepEqual(jj.parseJoinStart({target_meeting_id:T,source:{meeting_id:S}}),{targetId:T,mode:'report',sourceMeetingId:S});
  // 몸통에 작업공간·소유 값이 있어도 결과가 같다(읽지 않는다).
  assert.deepEqual(jj.parseJoinStart({target_meeting_id:T,source:{job_id:J},workspace_id:WS2,created_by:OTHER,owner:true}),{targetId:T,mode:'job',sourceJobId:J});
  for(const bad of [null,[],{},{target_meeting_id:T},{target_meeting_id:'x',source:{job_id:J}},{target_meeting_id:T,source:{job_id:J,meeting_id:S}},
    {target_meeting_id:T,source:{meeting_id:T}},{target_meeting_id:T,source:{text:'글'}},{target_meeting_id:T,source:[J]},{target_meeting_id:T,source:{job_id:'x'}}])
    assert.equal(jj.parseJoinStart(bad),null,JSON.stringify(bad));
  assert.deepEqual(jj.parseJoinText({target:T,records:`${J}, ${S}`,length:'120'}),{targetId:T,mode:'text',recordJobIds:[J,S]});
  assert.deepEqual(jj.parseJoinText({target:T,records:null,length:'1'}).recordJobIds,[]);
  const many=Array.from({length:21},(_,i)=>id(500+i)).join(',');
  for(const bad of [{target:'x',records:'',length:'1'},{target:T,records:'x',length:'1'},{target:T,records:`${J},${J}`,length:'1'},{target:T,records:many,length:'1'},
    {target:T,records:'',length:null},{target:T,records:'',length:'0'},{target:T,records:'',length:'abc'}])
    assert.equal(jj.parseJoinText(bad),null,JSON.stringify(bad).slice(0,80));
  // 글이 한도를 넘는 것은 모양 틀림(bad_request)과 따로 답한다(화면은 400 bad_request를 '옛 서버'로도 읽는다).
  assert.throws(()=>jj.parseJoinText({target:T,records:'',length:String(jj.JOIN_TEXT_MAX_BYTES+1)}),e=>e.code==='text_too_long');
  assert.equal(STATUS.text_too_long,413);
});

test('join_text 몸통: 한도까지만 읽고, 넘치면 text_too_long·UTF-8이 아니면 bad_request',async()=>{
  const stream=chunks=>new ReadableStream({start(c){for(const x of chunks)c.enqueue(x);c.close()}});
  const enc=new TextEncoder();
  assert.equal(await jj.boundedText(stream([enc.encode('화자1: 지어낸 '),enc.encode('글')])),'화자1: 지어낸 글');
  assert.equal(await code(jj.boundedText(stream([enc.encode('가'.repeat(10))]),20)),'text_too_long');
  assert.equal(await code(jj.boundedText(stream([enc.encode('가'.repeat(4)),enc.encode('나'.repeat(4))]),20)),'text_too_long','조각을 모아 세어도 한도');
  assert.equal(await code(jj.boundedText(stream([new Uint8Array([0xff,0xfe,0x41])]))),'bad_request');
  assert.equal(await code(jj.boundedText(null)),'bad_request');
});

test('합친 전문: 보고의 전문이 앞·재료가 뒤, 재료가 더 앞 시각이면 시간순, 사이 줄은 뒤에 오는 쪽의 서울 시각',()=>{
  const at=s=>Date.parse(s);
  // 보고 10:02, 녹음 13:20 → 보고가 앞.
  assert.equal(jj.joinTranscripts({targetText:'화자1: 앞 글\n',targetAt:at('2026-11-11T01:02:00Z'),sourceText:'\n화자1: 뒤 글',sourceAt:at('2026-11-11T04:20:00Z')}),
    '화자1: 앞 글\n\n― 이어서 · 13:20 녹음 ―\n화자1: 뒤 글');
  // 녹음이 보고 일시보다 앞 → 녹음이 앞, 사이 줄은 보고 일시.
  assert.equal(jj.joinTranscripts({targetText:'화자1: 보고 글',targetAt:at('2026-11-11T01:02:00Z'),sourceText:'화자1: 먼저 한 녹음',sourceAt:at('2026-11-11T00:20:00Z')}),
    '화자1: 먼저 한 녹음\n\n― 이어서 · 10:02 녹음 ―\n화자1: 보고 글');
  // 시각을 모르는 재료(입력 창의 글·회의자료 파일)는 늘 뒤, 시각 없는 줄.
  assert.equal(jj.joinTranscripts({targetText:'앞',targetAt:at('2026-11-11T01:02:00Z'),sourceText:'뒤',sourceAt:null}),'앞\n\n― 이어서 ―\n뒤');
  assert.equal(jj.joinTranscripts({targetText:'앞',targetAt:null,sourceText:'뒤',sourceAt:at('2026-11-11T00:20:00Z')}),'앞\n\n― 이어서 · 09:20 녹음 ―\n뒤');
  // 사이 줄은 구간 구분 줄과 같은 긴 줄표라 말소리로 세지 않는다.
  assert.equal(sj.hasWords(jj.joinMark(at('2026-11-11T04:20:00Z'))),false);assert.equal(sj.hasWords(jj.joinMark(null)),false);
  assert.equal(jj.seoulHm(at('2026-11-11T15:05:00Z')),'00:05');
  // 보고 일시: 시간대가 있으면 그대로, 없으면 서울 시각.
  assert.equal(jj.atMs('2026-11-11T01:02:00+00:00'),at('2026-11-11T01:02:00Z'));
  assert.equal(jj.atMs('2026-11-11T10:02'),at('2026-11-11T01:02:00Z'));
  assert.equal(jj.atMs('2026-11-11T10:02:00.000Z'),at('2026-11-11T10:02:00Z'));
  for(const bad of [null,'','2026-11-11','어제',5])assert.equal(jj.atMs(bad),null);
  // 녹음 시작 = 정리를 맡긴 때 − 녹음 길이(화면과 같은 계산). 회의자료 파일은 모름.
  assert.equal(jj.recordingStartMs({kind:'recording',created_at:'2026-11-11T04:30:00Z',parts:[{seconds:300},{seconds:300}]}),at('2026-11-11T04:20:00Z'));
  assert.equal(jj.recordingStartMs({kind:'attached',created_at:'2026-11-11T04:30:00Z',parts:[{seconds:0}]}),null);
  assert.deepEqual(jj.seoulDayRange(at('2026-11-11T04:20:00Z')),['2026-11-10T15:00:00.000Z','2026-11-11T15:00:00.000Z']);
});

test('회의 결과 글: Edge 사본 = 화면 draftText(같은 요약에 같은 글), 요약이 끝나면 done 대신 apply로',()=>{
  const raws=[
    {decisions:'1. 집행 확정\n- 일정 조정\n(2) 장소 확인',information:'• 경과 공유\n가. 다음 회의 안내\n[1] 자료 배포',actions:[{task:'자료 정리',assignee:'[확인 필요]',due:'2026-11-20'}],meeting_date:'2026-11-11',attendees:['김가상','이가상','화자1 [확인 필요]']},
    {decisions:'',information:'공유만 있는 회의',actions:[],attendees:[]},
    {decisions:'결정만 있는 회의',information:'',actions:[],attendees:['박가상']},
    {decisions:'',information:'',actions:[{task:'할 일만 있는 회의',assignee:'',due:''}],attendees:[]},
    {decisions:'',information:'',actions:[],attendees:[]},null,
  ];
  for(const raw of raws)assert.equal(jj.joinResultText(raw),appModel.draftText(appModel.normalizeDraft({draft:raw})),JSON.stringify(raw));
  assert.equal(jj.joinResultText(raws[0]),'참석: 김가상, 이가상\n\n결정\n- 집행 확정\n- 일정 조정\n- 장소 확인\n\n공유\n- 경과 공유\n- 다음 회의 안내\n- 자료 배포');
  assert.equal(jj.joinResultText(raws[3]),'','할 일만 있으면 회의 결과 글은 빔');
  // 요약 단계가 끝난 결과 → apply 단계로(끝 시각은 적지 않는다 — 적용 때 DB 함수가 적는다). 고치기 권한이 있는 칸만.
  const next=jj.joinAfterSummary({started_at:iso(NOW),status:'done',stage:'done',draft:raws[0],step_no:3,finished_at:iso(NOW)});
  assert.deepEqual([next.status,next.stage,next.step_no],['queued','apply',3]);
  assert.equal(next.result_text,jj.joinResultText(raws[0]));assert.equal('finished_at' in next,false);
  for(const k of Object.keys(next))assert.ok(jj.JOIN_UPDATE_COLUMNS.includes(k),k);
  // 요약이 아직 안 끝난 단계는 그대로.
  const mid={status:'queued',summary_parts:[{halves:[]}],step_no:0};
  assert.equal(jj.joinAfterSummary(mid),mid);
  // 회의 결과 글이 비면 보고를 덮지 않고 멈춘다.
  assert.throws(()=>jj.joinAfterSummary({status:'done',stage:'done',draft:raws[3]}),e=>e.code==='draft_failed');
  assert.throws(()=>jj.joinAfterSummary({status:'done',stage:'done',draft:null}),e=>e.code==='draft_failed');
  // 요약 답을 읽지 못해 답 원문을 보존한 초안(parse.mjs)은 글이 비지 않는다 — 그대로 두면 날 답이 보고에 저장된다. 표시된 초안은 저장하지 않는다.
  for(const answer of ['{"decisions":"","information":"","actions":[],"meeting_date":"","attendees":[]}','죄송하지만 요약할 수 없습니다.','{"decisions":"결정","information":"공유","actions":[{"task":"할 일"}]}']){
    const parsed=parseMeetingDraft(answer);
    assert.ok(parsed.warnings.length>0,answer);
    assert.throws(()=>jj.joinAfterSummary({status:'done',stage:'done',draft:parsed.draft,step_no:1},parsed.warnings.length>0),e=>e.code==='draft_failed',answer);
  }
  assert.notEqual(jj.joinResultText(parseMeetingDraft('{"decisions":"","information":"","actions":[]}').draft),'','표시가 없으면 빈 글 보호만으로는 걸리지 않는다');
  // 제대로 읽은 답은 표시가 없고 그대로 apply로 간다.
  const fine=parseMeetingDraft(JSON.stringify(raws[0]));
  assert.deepEqual(fine.warnings,[]);
  assert.equal(jj.joinAfterSummary({status:'done',stage:'done',draft:fine.draft,step_no:1},false).stage,'apply');
  // Edge: serverDraft가 표시하고(WeakSet, 같은 실행 안에서만) runStep이 그 표시를 넘긴다.
  const src=read('supabase/functions/meeting-transcribe/index.ts');
  assert.match(src,/const parsed = parseMeetingDraft\(text\);\n\s*if \(parsed\.warnings\.length\) draftNeedsReview\.add\(parsed\.draft\);\n\s*return parsed\.draft;/);
  assert.match(src,/if \(kind === 'join'\) next = joinAfterSummary\(next, !!next\.draft && typeof next\.draft === 'object' && draftNeedsReview\.has\(next\.draft as object\)\);/);
});

test('글 지문: UTF-8 SHA-256 소문자 16진수(DB 함수와 같은 방법), 없는 글은 빈 글의 지문',async()=>{
  for(const text of ['','결정\n- 지어낸 결정','화자1: 가나다 abc 123 ✓'])assert.equal(await jj.sha256Hex(text),sha(text));
  assert.equal(await jj.sha256Hex(null),sha(''));assert.equal(await jj.sha256Hex(undefined),sha(''));
  assert.match(await jj.sha256Hex('x'),/^[0-9a-f]{64}$/);
  const sql=read('supabase/migrations/20261111142100_meeting_join_jobs.sql');
  assert.match(sql,/pg_catalog\.encode\(pg_catalog\.sha256\(pg_catalog\.convert_to\(coalesce\(s\.transcript_text, ''\), 'UTF8'\)\), 'hex'\)/);
});

test('DB와 맞춤: 넣기·고치기 칸 = migration의 service_role 칸 권한, 읽는 칸 = 표 칸, 고칠 수 없는 칸은 몸통에서 거절',()=>{
  const sql=read('supabase/migrations/20261111142100_meeting_join_jobs.sql');
  const grant=kind=>sql.match(new RegExp(`grant ${kind} \\(([^)]*)\\)\\s+on table public\\.app_meeting_join_jobs to service_role;`))[1].split(',').map(x=>x.trim()).sort();
  assert.deepEqual(grant('insert'),[...jj.JOIN_INSERT_COLUMNS].sort());
  assert.deepEqual(grant('update'),[...jj.JOIN_UPDATE_COLUMNS].sort());
  for(const col of jj.JOIN_RETRY_COLUMNS.split(','))assert.match(sql,new RegExp(`\\n  ${col} `),col);
  assert.equal(jj.JOIN_JOB_TABLE,'app_meeting_join_jobs');
  // 합치기 전 글·재료·적용/되돌리기 기록 칸은 DB 함수만 쓴다.
  for(const col of ['before_result','before_notes','source_text','source_job_id','target_meeting_id','workspace_id','created_by','applied_at','moved','kept_result','undone_at','id'])
    assert.throws(()=>jj.joinPatch({[col]:null},iso(NOW)),/join_patch_column/,col);
  assert.deepEqual(jj.joinPatch({status:'queued',error_code:null},'t'),{status:'queued',error_code:null,updated_at:'t'});
  // 화면에 줄 모양에는 글이 없다.
  const view=jj.joinView({id:id(1),mode:'job',status:'done',stage:'done',target_meeting_id:id(30),transcript_text:'비밀',result_text:'비밀',before_notes:'비밀',before_result:'비밀',draft:{decisions:'비밀'},source_text:'비밀',created_at:iso(NOW)});
  assert.doesNotMatch(JSON.stringify(view),/비밀/);
  for(const k of ['transcript_text','result_text','before_notes','before_result','draft','source_text','workspace_id','created_by'])assert.equal(k in view,false,k);
});

test('DB 함수 오류 → 실패 코드: 고정 글자 6개만 바꾸고, 그 밖·글이 섞인 오류는 failed, 함수·표가 없으면 모름',()=>{
  const map={JOIN_REPORT_CHANGED:'report_changed',JOIN_REPORT_GONE:'report_gone',JOIN_SOURCE_CHANGED:'source_changed',JOIN_SOURCE_GONE:'source_gone',JOIN_ALREADY_JOINED:'already_joined',JOIN_NOT_APPLIED:'not_applied'};
  const sql=read('supabase/migrations/20261111142100_meeting_join_jobs.sql');
  const raised=[...new Set([...sql.matchAll(/raise exception '(JOIN_[A-Z_]+)'/g)].map(m=>m[1]))].sort();
  assert.deepEqual(raised,Object.keys(map).sort(),'함수가 던지는 예외 = 바꾸는 표');
  for(const [message,want] of Object.entries(map))assert.equal(jj.joinRpcCode({code:'P0001',message}),want);
  assert.equal(jj.joinRpcCode({code:'P0001',message:'JOIN_REPORT_CHANGED: 지어낸 보고 글'}),'failed');
  assert.equal(jj.joinRpcCode({code:'23514',message:'new row violates check constraint'}),'failed');
  for(const message of ['constructor','toString','__proto__',''])assert.equal(jj.joinRpcCode({message}),'failed',message);
  for(const c of ['PGRST202','42883','42P01','PGRST205'])assert.equal(jj.joinRpcCode({code:c,message:'x'}),'jobs_unavailable',c);
  assert.equal(jj.joinRpcCode(null),'');
  // 새 실패 코드는 서버 문구·HTTP 상태·화면 문구가 모두 있다(없으면 Fail이 failed로 바꿔 버린다).
  const generic=failText('__unknown__');
  for(const c of [...Object.values(map),'no_first_transcript','bad_target','text_too_long']){
    assert.equal(new Fail(c).code,c,c);assert.ok(MESSAGES[c]&&STATUS[c]>=400,c);
    assert.notEqual(failText(c),generic,c);assert.ok(failText(c).length<=70,c);
    assert.match(c,/^[a-z_]{1,40}$/,'작업 행 error_code 제약');
  }
  // apply 답: 이번에 적용 / 앞 실행이 이미 적용 / 없는 작업 / 적용할 차례 아님.
  assert.equal(jj.applyOutcome({applied:true,found:true,status:'done'}),'done');
  assert.equal(jj.applyOutcome({applied:false,found:true,status:'done',stage:'done',applied_at:iso(NOW)}),'done');
  assert.equal(jj.applyOutcome({applied:false,found:false}),'not_found');
  assert.equal(jj.applyOutcome({applied:false,found:true,status:'running',stage:'apply',applied_at:null}),'failed');
  assert.equal(jj.applyOutcome(null),'failed');
});

test('잇기 시작(녹음 결과): 로그인 읽기 → owner → 서비스 순서, 작업공간은 보고 행에서, 합치기 전 글은 읽은 그대로, 넣는 칸은 권한 안',async()=>{
  const w=seed();
  // 몸통에 남의 작업공간 값을 넣어도 쓰이지 않는다.
  const out=await startJob(w,ME,{workspace_id:WS2});
  assert.equal(out.existing,false);
  const row=w.db.inserted[0];
  assert.equal(row.workspace_id,WS);assert.equal(row.created_by,ME);assert.equal(row.mode,'job');
  assert.equal(row.target_meeting_id,w.T.id);assert.equal(row.source_job_id,w.J.id);assert.equal(row.source_meeting_id,null);assert.equal(row.source_text,null);
  assert.deepEqual(row.source_record_jobs,[w.R.id]);
  assert.equal(row.before_result,w.T.transcript_text);assert.equal(row.before_notes,w.T.notes);
  assert.equal(row.transcript_text,'화자1: 앞 녹음의 글\n\n― 이어서 · 13:20 녹음 ―\n화자1: 뒤 녹음의 글');
  assert.deepEqual([row.status,row.stage,row.step_no,row.step_total,row.summary_parts],['queued','summary',0,1,[]]);
  for(const k of Object.keys(row))assert.ok(jj.JOIN_INSERT_COLUMNS.includes(k),k);
  // 순서: 고른 보고를 부른 사람 로그인으로 → owner 확인 → 그 뒤에만 서비스 권한 → 뒤에서 단계 시작.
  assert.deepEqual(w.log,['user:meeting','owner','service:server-job','service:record-jobs','service:active','service:insert',`kick:${out.job.id}`]);
  assert.equal(serviceBeforeOwner(w.log),false);
  // 보고·녹음 행은 건드리지 않는다(바꾸는 곳은 DB 함수 한 번).
  assert.equal(w.db.meetings[0].notes,'화자1: 앞 녹음의 글');assert.equal(w.db.serverJobs[0].meeting_id,null);assert.equal(w.db.recordJobs[0].meeting_id,null);
});

test('잇기 시작: 녹음이 보고 일시보다 앞이면 녹음을 앞에 둔다',async()=>{
  const w=seed();w.db.serverJobs[0].created_at='2026-11-11T00:30:00.000Z'; // 09:20 시작
  await startJob(w);
  assert.equal(w.db.inserted[0].transcript_text,'화자1: 뒤 녹음의 글\n\n― 이어서 · 10:02 녹음 ―\n화자1: 앞 녹음의 글');
});

test('보안 3-7: 남의 보고·휴지통 보고·없는 보고는 구분 없이 not_found, 그때 서비스 권한은 한 번도 쓰지 않는다',async()=>{
  // 다른 작업공간 사람이 내 보고 id를 넣음(로그인 읽기에서 안 보임).
  let w=seed();
  assert.equal(await code(startJob(w,OTHER)),'not_found');
  assert.deepEqual(w.log,['user:meeting']);assert.equal(w.db.inserted.length,0);
  // 휴지통 보고.
  w=seed();w.db.meetings[0].deleted_at=iso(NOW);
  assert.equal(await code(startJob(w)),'not_found');assert.deepEqual(w.log,['user:meeting']);
  // 없는 보고.
  w=seed();
  assert.equal(await code(jj.startJoin(w.io(ME),ME,{targetId:id(999),mode:'job',sourceJobId:w.J.id})),'not_found');assert.deepEqual(w.log,['user:meeting']);
  // 읽기는 됐지만 owner가 아니게 된 사람(로그인 읽기 길이 넓어져도 owner 확인이 한 번 더 막는다).
  w=seed();w.db.members[0].role='member';
  const leaky=w.io(ME);leaky.userMeeting=async()=>({...w.T});
  assert.equal(await code(jj.startJoin(leaky,ME,{targetId:w.T.id,mode:'job',sourceJobId:w.J.id})),'not_found');
  assert.equal(w.log.some(l=>l.startsWith('service:')),false);
  // [회의]가 아닌 칸: notes가 '특이사항'이라 전문으로 덮으면 안 된다.
  for(const kind of ['policy','oneline','other']){
    w=seed();w.db.meetings[0].activity_kind=kind;
    assert.equal(await code(startJob(w)),'bad_target',kind);assert.equal(w.log.some(l=>l.startsWith('service:')),false);
  }
  w=seed();w.db.meetings[0].activity_kind=null;assert.equal((await startJob(w)).existing,false,'칸이 빈 옛 보고는 [회의]');
});

test('보안 3-7: 다른 작업공간·남이 만든 재료는 not_found, 이미 다른 보고에 들어간 녹음은 already_joined, 끝나지 않은 결과는 not_done',async()=>{
  // 다른 작업공간의 서버 정리 작업.
  let w=seed();w.db.serverJobs[0].workspace_id=WS2;w.db.serverJobs[0].created_by=OTHER;
  assert.equal(await code(startJob(w)),'not_found');
  // 내 작업공간이지만 내가 만들지 않은 작업.
  w=seed();w.db.serverJobs[0].created_by=OTHER;assert.equal(await code(startJob(w)),'not_found');
  // 없는 작업.
  w=seed();assert.equal(await code(jj.startJoin(w.io(ME),ME,{targetId:w.T.id,mode:'job',sourceJobId:id(998)})),'not_found');
  // 두 작업공간의 owner라도 고른 보고와 다른 작업공간의 결과·녹음 구간은 이을 수 없다(작업공간 사이로 글이 넘어가지 않는다).
  w=seed();w.db.members.push({workspace_id:WS2,user_id:ME,role:'owner'});w.db.serverJobs[0].workspace_id=WS2;
  assert.equal(await code(startJob(w)),'not_found');assert.equal(w.db.inserted.length,0);
  w=seed();w.db.members.push({workspace_id:WS2,user_id:ME,role:'owner'});w.db.recordJobs[0].workspace_id=WS2;
  await startJob(w);assert.deepEqual(w.db.inserted[0].source_record_jobs,[],'다른 작업공간의 녹음 구간은 붙이지 않는다');
  // 진행 중·실패한 결과.
  for(const status of ['running','failed']){w=seed();w.db.serverJobs[0].status=status;assert.equal(await code(startJob(w)),'not_done',status)}
  // 이미 다른 보고에 쓰인 결과 / 그 녹음 구간이 이미 다른 보고에 붙음.
  w=seed();w.db.serverJobs[0].meeting_id=id(77);assert.equal(await code(startJob(w)),'already_joined');
  w=seed();w.db.recordJobs[0].meeting_id=id(77);assert.equal(await code(startJob(w)),'already_joined');
  // 글이 없는 결과.
  w=seed();w.db.serverJobs[0].transcript_text='― 10분부터 ―';assert.equal(await code(startJob(w)),'empty_transcript');
  // 어느 경우에도 작업 행은 생기지 않는다.
  assert.equal(w.db.inserted.length,0);
  // 서버 정리 작업에서 꺼낸 녹음 구간이 휴지통·없음이면 그 구간만 빼고 잇는다(글은 잇는다).
  w=seed();w.db.recordJobs[0].trashed_at=iso(NOW);
  await startJob(w);assert.deepEqual(w.db.inserted[0].source_record_jobs,[]);
  // 이미 그 보고에 붙어 있는 구간은 그대로 넣는다(DB 함수가 건너뛴다).
  w=seed();w.db.recordJobs[0].meeting_id=w.T.id;
  await startJob(w);assert.deepEqual(w.db.inserted[0].source_record_jobs,[w.R.id]);
});

test('그 자리 전사(회의자료 소리 파일): 그 회의에만 잇고, 붙일 녹음 구간은 없다',async()=>{
  const w=seed();
  Object.assign(w.db.serverJobs[0],{kind:'attached',meeting_id:w.T.id,parts:[{no:1,seconds:0,file:{id:'file'},text:'화자1: 뒤 녹음의 글'}]});
  await startJob(w);
  assert.deepEqual(w.db.inserted[0].source_record_jobs,[]);
  assert.equal(w.db.inserted[0].transcript_text,'화자1: 앞 녹음의 글\n\n― 이어서 ―\n화자1: 뒤 녹음의 글','시작 시각을 모르는 재료는 뒤');
  // 다른 회의의 자료를 이 보고에 이을 수 없다.
  const other=seed();
  Object.assign(other.db.serverJobs[0],{kind:'attached',meeting_id:id(77)});
  assert.equal(await code(startJob(other)),'already_joined');
  const lost=seed();
  Object.assign(lost.db.serverJobs[0],{kind:'attached',meeting_id:null});
  assert.equal(await code(startJob(lost)),'not_found');
});

test('앞 글: 회의록 전문이 비면 그 보고에 연결된 서버 정리 작업의 전문, 둘 다 없으면 시작하지 않는다(보고는 그대로)',async()=>{
  let w=seed();w.db.meetings[0].notes='';
  assert.equal(await code(startJob(w)),'no_first_transcript');assert.equal(w.db.inserted.length,0);
  w=seed();w.db.meetings[0].notes=null;
  w.db.serverJobs.push({id:id(41),workspace_id:WS,created_by:ME,kind:'recording',status:'done',meeting_id:w.T.id,transcript_text:'화자1: 연결된 앞 녹음',parts:[],created_at:'2026-11-11T01:30:00.000Z'});
  // 다른 작업공간의 같은 보고 id 연결은 쓰지 않는다.
  w.db.serverJobs.push({id:id(42),workspace_id:WS2,created_by:OTHER,kind:'recording',status:'done',meeting_id:w.T.id,transcript_text:'남의 글',parts:[],created_at:'2026-11-11T01:00:00.000Z'});
  await startJob(w);
  const row=w.db.inserted[0];
  assert.equal(row.transcript_text,'화자1: 연결된 앞 녹음\n\n― 이어서 · 13:20 녹음 ―\n화자1: 뒤 녹음의 글');
  assert.equal(row.before_notes,null,'합치기 전 글은 보고에서 읽은 그대로(빈 칸)');
  assert.doesNotMatch(row.transcript_text,/남의 글/);
  // 그 자리 전사: 연결된 작업이 잇는 재료 자신뿐이면 앞 글이 없는 것이다(같은 글을 두 번 넣지 않는다).
  w=seed();w.db.meetings[0].notes='';
  Object.assign(w.db.serverJobs[0],{kind:'attached',meeting_id:w.T.id});
  assert.equal(await code(startJob(w)),'no_first_transcript');
});

test('동시에 두 번·겹침(3-5절): 같은 재료면 그 작업을 돌려주고, 어떤 역할로든 걸려 있으면 busy, 이미 이어 붙인 녹음은 already_joined',async()=>{
  let w=seed();
  const first=await startJob(w);
  // 더블클릭·두 기기: 같은 보고에 같은 녹음 결과 → 같은 작업, 새 행 없음.
  const again=await startJob(w);
  assert.equal(again.existing,true);assert.equal(again.job.id,first.job.id);assert.equal(w.db.joins.length,1);
  // 같은 보고에 다른 재료.
  const J2={...w.J,id:id(43),parts:[]};w.db.serverJobs.push(J2);
  assert.equal(await code(jj.startJoin(w.io(ME),ME,{targetId:w.T.id,mode:'job',sourceJobId:J2.id})),'busy');
  // 잇는 중인 보고를 다른 보고에 합치기(없어질 보고 역할) / 다른 보고를 잇는 중인 보고에 합치기.
  const B={...w.T,id:id(32),notes:'화자1: 다른 보고의 전문'};w.db.meetings.push(B);
  assert.equal(await code(jj.startJoin(w.io(ME),ME,{targetId:B.id,mode:'report',sourceMeetingId:w.T.id})),'busy');
  assert.equal(await code(jj.startJoin(w.io(ME),ME,{targetId:w.T.id,mode:'report',sourceMeetingId:B.id})),'busy');
  // 같은 녹음 결과를 다른 보고에 잇기.
  assert.equal(await code(jj.startJoin(w.io(ME),ME,{targetId:B.id,mode:'job',sourceJobId:w.J.id})),'busy');
  assert.equal(w.db.joins.length,1);
  // 유일 색인에 걸림(확인과 넣기 사이에 다른 요청이 먼저 넣음): 같은 재료면 그 작업, 아니면 busy.
  w=seed();
  const racing=w.io(ME);let calls=0;const active=racing.activeJoins;
  racing.activeJoins=async ws=>(++calls===1?[]:active(ws));
  w.db.joins.push({id:id(60),workspace_id:WS,created_by:ME,mode:'job',target_meeting_id:w.T.id,source_job_id:w.J.id,source_meeting_id:null,status:'running',created_at:iso(NOW),updated_at:iso(NOW),lease_until:iso(NOW+60000)});
  const raced=await jj.startJoin(racing,ME,{targetId:w.T.id,mode:'job',sourceJobId:w.J.id});
  assert.equal(raced.existing,true);assert.equal(raced.job.id,id(60));
  // 이미 이어 붙인(끝난) 녹음 결과를 또 잇기.
  w=seed();w.db.serverJobs[0].meeting_id=w.T.id;
  w.db.joins.push({id:id(61),workspace_id:WS,created_by:ME,mode:'job',target_meeting_id:w.T.id,source_job_id:w.J.id,status:'done',applied_at:iso(NOW),created_at:iso(NOW),updated_at:iso(NOW)});
  assert.equal(await code(startJob(w)),'already_joined');
  // 통째로 되돌린 뒤에는 다시 이을 수 있다.
  w.db.joins[0].status='undone';w.db.serverJobs[0].meeting_id=null;
  assert.equal((await startJob(w)).existing,false);
});

test('보고 합치기: 합칠 보고도 로그인으로 읽고, 없어질 보고의 두 글 지문을 넣는다. 다른 작업공간·휴지통·[회의] 아님·전문 없음은 거절',async()=>{
  const mk=()=>{const w=seed();const S={id:id(31),workspace_id:WS,activity_kind:'meeting',meeting_at:'2026-11-11T03:00:00+00:00',transcript_text:'결정\n- 뒤 보고에서 정한 것',notes:'화자2: 뒤 보고의 전문',deleted_at:null};w.db.meetings.push(S);return {...w,S}};
  const go=w=>jj.startJoin(w.io(ME),ME,jj.parseJoinStart({target_meeting_id:w.T.id,source:{meeting_id:w.S.id}}));
  let w=mk();
  const out=await go(w);
  const row=w.db.inserted[0];
  assert.deepEqual([row.mode,row.source_meeting_id,row.source_job_id,row.source_text],['report',w.S.id,null,null]);
  assert.equal(row.source_result_sha,sha('결정\n- 뒤 보고에서 정한 것'));assert.equal(row.source_notes_sha,sha('화자2: 뒤 보고의 전문'));
  assert.equal(row.transcript_text,'화자1: 앞 녹음의 글\n\n― 이어서 · 12:00 녹음 ―\n화자2: 뒤 보고의 전문');
  assert.deepEqual(row.source_record_jobs,[]);
  assert.deepEqual(w.log,['user:meeting','owner','user:meeting','service:active','service:insert',`kick:${out.job.id}`]);
  for(const k of Object.keys(row))assert.ok(jj.JOIN_INSERT_COLUMNS.includes(k),k);
  // 회의 결과 칸이 빈 보고의 지문 = 빈 글의 지문.
  w=mk();w.db.meetings[1].transcript_text=null;await go(w);assert.equal(w.db.inserted[0].source_result_sha,sha(''));
  // 다른 작업공간의 보고(로그인 읽기에서 안 보임) · 휴지통 · 다른 칸 · 전문 없음.
  w=mk();w.db.meetings[1].workspace_id=WS2;assert.equal(await code(go(w)),'not_found');
  w=mk();w.db.meetings[1].deleted_at=iso(NOW);assert.equal(await code(go(w)),'not_found');
  w=mk();w.db.meetings[1].activity_kind='press';assert.equal(await code(go(w)),'bad_target');
  w=mk();w.db.meetings[1].notes='';assert.equal(await code(go(w)),'no_first_transcript');
  assert.equal(w.db.inserted.length,0);
  // 다른 작업공간 보고가 로그인 읽기로 보이더라도(두 작업공간의 owner) 고른 보고와 같은 작업공간이 아니면 거절.
  w=mk();w.db.members.push({workspace_id:WS2,user_id:ME,role:'owner'});w.db.meetings[1].workspace_id=WS2;
  assert.equal(await code(go(w)),'not_found');assert.equal(w.db.inserted.length,0);
});

test('입력 창의 글 잇기(join_text): 글을 정리해 넣고, 붙일 녹음 작업은 하나라도 어긋나면 거절(남의 것·끝나지 않음·휴지통·다른 회의)',async()=>{
  const go=(w,text,ids=[w.R.id])=>jj.startJoin(w.io(ME),ME,{...jj.parseJoinText({target:w.T.id,records:ids.join(','),length:'10'}),text});
  let w=seed();
  await go(w,'화자1: 입력 창의 글  \r\n\r\n\r\n\r\n화자2: 답\u0000');
  const row=w.db.inserted[0];
  assert.deepEqual([row.mode,row.source_text,row.source_job_id,row.source_meeting_id],['text','화자1: 입력 창의 글\n\n화자2: 답',null,null]);
  assert.deepEqual(row.source_record_jobs,[w.R.id]);
  assert.equal(row.transcript_text,'화자1: 앞 녹음의 글\n\n― 이어서 ―\n화자1: 입력 창의 글\n\n화자2: 답');
  // 같은 글을 두 번 보내면 같은 작업, 다른 글이면 busy.
  assert.equal((await go(w,'화자1: 입력 창의 글\n\n화자2: 답')).existing,true);
  assert.equal(await code(go(w,'화자1: 다른 글')),'busy');assert.equal(w.db.joins.length,1);
  // 붙일 녹음 작업 확인.
  w=seed();w.db.recordJobs[0].workspace_id=WS2;assert.equal(await code(go(w,'화자1: 글')),'not_found');
  w=seed();w.db.recordJobs[0].created_by=OTHER;assert.equal(await code(go(w,'화자1: 글')),'not_found');
  w=seed();assert.equal(await code(go(w,'화자1: 글',[id(997)])),'not_found');
  w=seed();w.db.recordJobs[0].status='running';assert.equal(await code(go(w,'화자1: 글')),'not_done');
  w=seed();w.db.recordJobs[0].trashed_at=iso(NOW);assert.equal(await code(go(w,'화자1: 글')),'not_done');
  w=seed();w.db.recordJobs[0].meeting_id=id(77);assert.equal(await code(go(w,'화자1: 글')),'already_joined');
  // 글이 없거나 너무 길면 시작하지 않는다.
  w=seed();assert.equal(await code(go(w,' \n― 이어서 ―\n')),'empty_transcript');
  w=seed();assert.equal(await code(go(w,'가'.repeat(jj.JOIN_TEXT_MAX_CHARS+1))),'text_too_long');
  w=seed();w.db.meetings[0].notes='나'.repeat(jj.JOIN_TEXT_MAX_CHARS-10);assert.equal(await code(go(w,'화자1: 합치면 한도를 넘는 글 스무 자쯤')),'text_too_long');
  assert.equal(w.db.inserted.length,0);
});

test('표가 아직 없으면(적용 전) 모름(jobs_unavailable): 시작·목록·보기·물음 후보 모두',async()=>{
  const w=seed();w.db.noJoinTable=true;
  assert.equal(await code(startJob(w)),'jobs_unavailable');
  assert.equal(await code(jj.listJoins(w.io(ME),ME)),'jobs_unavailable');
  assert.equal(await code(jj.readJoin(w.io(ME),ME,{job_id:id(60)})),'jobs_unavailable');
  assert.equal(await code(jj.joinCandidates(w.io(ME),ME,{job_id:w.J.id})),'jobs_unavailable');
  assert.equal(await code(jj.joinCandidates(w.io(ME),ME,{meeting_id:w.T.id})),'jobs_unavailable');
  assert.equal(new Fail('jobs_unavailable').code,'jobs_unavailable');assert.equal(STATUS.jobs_unavailable,503);
  // 화면은 이 코드를 '서버가 아직 모름'으로 본다(app/meeting-server-job.mjs unavailable).
  const {unavailable}=await import('../app/meeting-server-job.mjs');
  assert.equal(unavailable({status:503,code:'jobs_unavailable'}),true);assert.equal(unavailable({status:400,code:'bad_request'}),true);
});

const joinRow=(w,over={})=>{const j={id:id(60),workspace_id:WS,created_by:ME,mode:'job',target_meeting_id:w.T.id,source_job_id:w.J.id,source_meeting_id:null,source_text:null,source_record_jobs:[w.R.id],
  status:'done',stage:'done',step_no:1,step_total:1,summary_parts:[],transcript_text:'합친 전문',error_code:null,lease_until:null,attempts:2,applied_at:iso(NOW-60000),undone_at:null,seen_at:null,candidates_closed_at:null,
  created_at:iso(NOW-120000),updated_at:iso(NOW-60000),finished_at:iso(NOW-60000),...over};w.db.joins.push(j);return j};

test('보기·목록·닫음: 내 작업공간의 내가 만든 작업만, 남의 것은 not_found, 목록은 작업공간을 몸통으로 받지 않는다',async()=>{
  const w=seed();
  const mine=joinRow(w);
  const theirs=joinRow(w,{id:id(61),workspace_id:WS2,created_by:OTHER});
  const coworker=joinRow(w,{id:id(62),created_by:OTHER});
  joinRow(w,{id:id(63),created_at:iso(NOW-49*3600000)});     // 48시간 지남
  joinRow(w,{id:id(64),seen_at:iso(NOW)});                   // 이미 닫음
  joinRow(w,{id:id(65),status:'undone',undone_at:iso(NOW)}); // 통째로 되돌림
  const stuck=joinRow(w,{id:id(66),status:'queued',stage:'summary',applied_at:null,updated_at:iso(NOW-5*60000)});
  const failed=joinRow(w,{id:id(67),status:'failed',stage:'apply',applied_at:null,error_code:'report_changed'});
  assert.equal((await jj.readJoin(w.io(ME),ME,{job_id:mine.id})).job.id,mine.id);
  assert.equal(await code(jj.readJoin(w.io(ME),ME,{job_id:theirs.id})),'not_found');
  assert.equal(await code(jj.readJoin(w.io(ME),ME,{job_id:coworker.id})),'not_found');
  assert.equal(await code(jj.readJoin(w.io(ME),ME,{job_id:id(996)})),'not_found');
  assert.equal(await code(jj.readJoin(w.io(ME),ME,{job_id:'x'})),'bad_request');
  assert.equal(await code(jj.readJoin(w.io(OTHER),OTHER,{job_id:mine.id})),'not_found');
  // 목록: 지난 48시간의 진행 중·실패·끝났는데 아직 닫지 않은 것. 멈춘 것처럼 보이는 진행 중 작업은 다시 깨운다.
  w.log.length=0;
  const list=await jj.listJoins(w.io(ME),ME);
  assert.deepEqual(list.jobs.map(j=>j.id).sort(),[mine.id,stuck.id,failed.id].sort());
  assert.deepEqual(w.log,['owner-list','user:joins',`kick:${stuck.id}`]);
  // owner인 작업공간이 없는 사람은 다른 action처럼 403.
  assert.equal(await code(jj.listJoins(w.io(id(3)),id(3))),403);
  // 닫음: 끝 알림 / 새 할 일 후보. 진행 중인 작업의 알림은 닫지 않는다.
  await jj.seenJoin(w.io(ME),ME,{job_id:mine.id});
  assert.equal(w.db.joins[0].seen_at,iso(NOW));assert.equal(w.db.joins[0].candidates_closed_at,null);
  await jj.seenJoin(w.io(ME),ME,{job_id:failed.id,candidates:true});
  assert.equal(w.db.joins.find(j=>j.id===failed.id).candidates_closed_at,iso(NOW));assert.equal(w.db.joins.find(j=>j.id===failed.id).seen_at,null);
  await jj.seenJoin(w.io(ME),ME,{job_id:stuck.id});assert.equal(w.db.joins.find(j=>j.id===stuck.id).seen_at,null);
  assert.equal(await code(jj.seenJoin(w.io(ME),ME,{job_id:theirs.id})),'not_found');
  assert.equal(await code(jj.seenJoin(w.io(ME),ME,{job_id:mine.id,candidates:'yes'})),'bad_request');
  for(const p of w.db.patches)for(const k of Object.keys(p))assert.ok(jj.JOIN_UPDATE_COLUMNS.includes(k),k);
});

test('되돌리기(join_undo): 세 범위만, 내 작업만, DB 함수에는 id·범위만 넘기고 고정 예외는 실패 코드로',async()=>{
  const w=seed();const mine=joinRow(w);const theirs=joinRow(w,{id:id(61),workspace_id:WS2,created_by:OTHER});
  for(const scope of ['before','joined','all']){
    w.log.length=0;
    const out=await jj.undoJoin(w.io(ME),ME,{job_id:mine.id,scope});
    assert.deepEqual(out,{scope,undone:scope==='all',kept:scope==='before'});
    assert.deepEqual(w.log,['user:join','owner',`service:undo:${scope}`],'로그인 읽기 → owner → 함수');
  }
  w.log.length=0;
  for(const scope of [undefined,'','ALL','everything',null,1])assert.equal(await code(jj.undoJoin(w.io(ME),ME,{job_id:mine.id,scope})),'bad_request',String(scope));
  assert.deepEqual(w.log,[],'범위가 틀리면 아무것도 읽지 않는다');
  assert.equal(await code(jj.undoJoin(w.io(ME),ME,{job_id:theirs.id,scope:'all'})),'not_found');
  assert.equal(await code(jj.undoJoin(w.io(OTHER),OTHER,{job_id:mine.id,scope:'all'})),'not_found');
  assert.equal(w.log.some(l=>l.startsWith('service:undo')),false);
  for(const [message,want] of [['JOIN_NOT_APPLIED','not_applied'],['JOIN_REPORT_CHANGED','report_changed'],['JOIN_SOURCE_GONE','source_gone'],['JOIN_REPORT_GONE','report_gone']]){
    w.db.undoError={code:'P0001',message};
    assert.equal(await code(jj.undoJoin(w.io(ME),ME,{job_id:mine.id,scope:'all'})),want);
  }
  w.db.undoError={code:'PGRST202',message:'function not found'};
  assert.equal(await code(jj.undoJoin(w.io(ME),ME,{job_id:mine.id,scope:'before'})),'jobs_unavailable','함수가 없으면 모름');
});

test('[다시]: 그 사이 보고가 바뀌어 멈춘 작업은 처음부터(새 행, 수정한 글로), 그 밖은 멈춘 단계부터(요약 시간 초과는 반으로 나눠)',async()=>{
  // 처음부터: report_changed.
  let w=seed();
  const failed=joinRow(w,{status:'failed',stage:'apply',applied_at:null,error_code:'report_changed',transcript_text:'옛 합친 전문'});
  w.db.meetings[0].notes='화자1: 그 사이 수정한 앞 글';
  const out=await jj.retryJoin(w.io(ME),ME,{job_id:failed.id});
  assert.equal(out.restarted,true);assert.notEqual(out.job.id,failed.id);
  assert.equal(w.db.joins.length,2);
  const fresh=w.db.joins[1];
  assert.equal(fresh.before_notes,'화자1: 그 사이 수정한 앞 글');assert.match(fresh.transcript_text,/^화자1: 그 사이 수정한 앞 글\n\n― 이어서/);
  assert.deepEqual([w.db.joins[0].status,w.db.joins[0].error_code,w.db.joins[0].seen_at],['failed','report_changed',iso(NOW)],'앞 행은 실패로 남기고 알림만 닫는다');
  assert.deepEqual(w.db.patches,[{seen_at:iso(NOW)}],'앞 행에는 알림 닫음만 쓴다(합치기 전 글·재료는 고쳐 쓰지 않는다)');
  // 이미 [다시]로 새 작업을 만든 실패 행을 갱신 안 된 다른 기기가 또 누르면: 새 작업을 또 만들지 않는다(같은 글이 두 번 붙지 않게).
  w.db.joins[1].status='done';w.db.joins[1].applied_at=iso(NOW);
  assert.equal(await code(jj.retryJoin(w.io(ME),ME,{job_id:failed.id})),'not_found');
  assert.equal(w.db.joins.length,2);
  // 처음부터: 입력 창의 글(행에 남아 있는 재료 글로).
  w=seed();
  const text=joinRow(w,{mode:'text',source_job_id:null,source_text:'화자1: 입력 창의 글',status:'failed',stage:'apply',applied_at:null,error_code:'report_changed'});
  await jj.retryJoin(w.io(ME),ME,{job_id:text.id});
  assert.deepEqual([w.db.joins[1].mode,w.db.joins[1].source_text],['text','화자1: 입력 창의 글']);
  w.db.joins[1].status='done';w.db.joins[1].applied_at=iso(NOW);
  assert.equal(await code(jj.retryJoin(w.io(ME),ME,{job_id:text.id})),'not_found','글 잇기도 두 번 다시 하지 않는다');
  assert.equal(w.db.joins.length,2);
  // 처음부터: 합칠 보고가 영구 삭제돼 재료가 비었으면 source_gone.
  w=seed();
  const merge=joinRow(w,{mode:'report',source_job_id:null,source_meeting_id:null,status:'failed',stage:'apply',applied_at:null,error_code:'source_changed'});
  assert.equal(await code(jj.retryJoin(w.io(ME),ME,{job_id:merge.id})),'source_gone');
  // 멈춘 단계부터: 요약 시간 초과 → 반 나눔 표시.
  w=seed();
  const long=Array.from({length:600},(_,i)=>`화자${i%2+1}: ${'나'.repeat(20)} ${i}`).join('\n');
  const timeout=joinRow(w,{status:'failed',stage:'summary',applied_at:null,error_code:'draft_timeout',transcript_text:long,summary_parts:[],attempts:7,finished_at:iso(NOW)});
  w.log.length=0;
  const resumed=await jj.retryJoin(w.io(ME),ME,{job_id:timeout.id});
  assert.equal(resumed.restarted,false);assert.equal(resumed.job.id,timeout.id);
  assert.deepEqual(w.db.patches.at(-1),{status:'queued',error_code:null,finished_at:null,lease_until:null,attempts:0,summary_parts:[{halves:[]}]});
  assert.deepEqual(w.log,['user:join','owner','service:active','service:patch',`kick:${timeout.id}`]);
  assert.equal(w.db.joins.length,1,'새 행을 만들지 않는다');
  // 멈춘 단계부터: apply에서 그 밖의 이유(서버 오류).
  w=seed();
  const apply=joinRow(w,{status:'failed',stage:'apply',applied_at:null,error_code:'failed'});
  await jj.retryJoin(w.io(ME),ME,{job_id:apply.id});
  assert.deepEqual([w.db.joins[0].status,w.db.joins[0].stage,w.db.joins[0].error_code],['queued','apply',null]);
  // 멈춘 단계부터: 그 사이 그 보고가 다른 진행 중 잇기·합치기에 걸렸으면(어떤 역할로든) 다시 돌리지 않는다.
  w=seed();
  const waiting=joinRow(w,{status:'failed',stage:'summary',applied_at:null,error_code:'draft_failed'});
  w.db.joins.push({id:id(68),workspace_id:WS,created_by:ME,mode:'report',target_meeting_id:id(39),source_meeting_id:w.T.id,source_job_id:null,status:'running',created_at:iso(NOW),updated_at:iso(NOW)});
  assert.equal(await code(jj.retryJoin(w.io(ME),ME,{job_id:waiting.id})),'busy');
  assert.equal(w.db.joins[0].status,'failed');assert.equal(w.db.patches.length,0);
  // 실패가 아닌 작업은 그대로 돌려준다. 남의 작업은 not_found.
  w=seed();
  const done=joinRow(w);const theirs=joinRow(w,{id:id(61),workspace_id:WS2,created_by:OTHER,status:'failed',error_code:'failed'});
  assert.equal((await jj.retryJoin(w.io(ME),ME,{job_id:done.id})).job.status,'done');assert.equal(w.db.patches.length,0);
  assert.equal(await code(jj.retryJoin(w.io(ME),ME,{job_id:theirs.id})),'not_found');
});

test('물음 후보(join_candidates): 같은 날(서울) 녹음으로 쓴 [회의] 보고의 id·녹음 길이만, 보고 목록·자료 행은 로그인으로 읽는다',async()=>{
  const w=seed();
  const M=(n,at,over={})=>{const m={id:id(n),workspace_id:WS,activity_kind:'meeting',meeting_at:at,deleted_at:null,transcript_text:'비밀 결과',notes:'비밀 전문',...over};w.db.meetings.push(m);return m};
  w.db.meetings.length=0;
  const tagged=M(30,'2026-11-11T01:02:00.000Z');            // 10:02, 녹음 자료 행이 붙음
  const linked=M(31,'2026-11-10T15:30:00.000Z');            // 00:30(같은 서울 날), 서버 정리 작업이 연결됨
  const plain=M(32,'2026-11-11T02:00:00.000Z');             // 녹음 없이 쓴 보고
  const yesterday=M(33,'2026-11-10T14:30:00.000Z');         // 전날 23:30
  const policy=M(34,'2026-11-11T03:00:00.000Z',{activity_kind:'policy'});
  const trashed=M(35,'2026-11-11T03:30:00.000Z',{deleted_at:iso(NOW)});
  const foreign=M(36,'2026-11-11T03:40:00.000Z',{workspace_id:WS2});
  w.db.docs.push({workspace_id:WS,meeting_id:tagged.id,tags:['회의자료','회의녹음']},{workspace_id:WS,meeting_id:plain.id,tags:['회의자료']},
    {workspace_id:WS,meeting_id:yesterday.id,tags:['회의녹음']},{workspace_id:WS,meeting_id:policy.id,tags:['회의녹음']},{workspace_id:WS,meeting_id:trashed.id,tags:['회의녹음']},{workspace_id:WS2,meeting_id:foreign.id,tags:['회의녹음']});
  w.db.recordJobs.push({id:id(51),workspace_id:WS,created_by:ME,status:'done',meeting_id:tagged.id,trashed_at:null,duration_sec:1500},{id:id(52),workspace_id:WS,created_by:ME,status:'done',meeting_id:tagged.id,trashed_at:null,duration_sec:780});
  w.db.serverJobs.push({id:id(44),workspace_id:WS,created_by:ME,kind:'recording',status:'done',meeting_id:linked.id,parts:[{seconds:900},{seconds:300}],transcript_text:'x',created_at:'2026-11-10T16:00:00.000Z'});
  const out=await jj.joinCandidates(w.io(ME),ME,{job_id:w.J.id});
  assert.deepEqual(out,{candidates:[{meeting_id:linked.id,seconds:1200},{meeting_id:tagged.id,seconds:2280}]});
  assert.doesNotMatch(JSON.stringify(out),/비밀|meeting_at|title/);
  assert.deepEqual(w.log,['service:server-job','service:ready','user:meetings','user:docs','service:linked-jobs','service:linked-records']);
  // 보고 ⋯ [다른 보고에 합치기]: 그 보고의 날, 자기 자신은 뺀다. 로그인 읽기 → owner 확인 뒤에만 서비스.
  w.log.length=0;
  const forMeeting=await jj.joinCandidates(w.io(ME),ME,{meeting_id:tagged.id});
  assert.deepEqual(forMeeting.candidates.map(c=>c.meeting_id),[linked.id]);
  assert.deepEqual(w.log.slice(0,3),['user:meeting','owner','service:ready']);assert.equal(serviceBeforeOwner(w.log),false);
  // 남의 보고·남의 작업·휴지통은 not_found, 둘 다 주거나 아무것도 안 주면 bad_request.
  assert.equal(await code(jj.joinCandidates(w.io(OTHER),OTHER,{meeting_id:tagged.id})),'not_found');
  assert.equal(await code(jj.joinCandidates(w.io(OTHER),OTHER,{job_id:w.J.id})),'not_found');
  assert.equal(await code(jj.joinCandidates(w.io(ME),ME,{meeting_id:trashed.id})),'not_found');
  assert.equal(await code(jj.joinCandidates(w.io(ME),ME,{meeting_id:tagged.id,job_id:w.J.id})),'bad_request');
  assert.equal(await code(jj.joinCandidates(w.io(ME),ME,{})),'bad_request');
  // 이미 그 보고에 연결된 녹음 결과 자신은 후보의 근거로 세지 않는다.
  w.db.serverJobs[0].meeting_id=plain.id;
  assert.equal((await jj.joinCandidates(w.io(ME),ME,{job_id:w.J.id})).candidates.some(c=>c.meeting_id===plain.id),false);
});

test('가짜 io의 유일 색인 흉내 = migration의 부분 유일 색인 3개',()=>{
  const sql=read('supabase/migrations/20261111142100_meeting_join_jobs.sql');
  assert.match(sql,/create unique index app_meeting_join_jobs_one_target_idx on public\.app_meeting_join_jobs\(target_meeting_id\)\n\s*where status in \('queued', 'running'\);/);
  assert.match(sql,/create unique index app_meeting_join_jobs_one_source_job_idx on public\.app_meeting_join_jobs\(source_job_id\)\n\s*where status in \('queued', 'running', 'done'\);/);
  assert.match(sql,/create unique index app_meeting_join_jobs_one_source_meeting_idx on public\.app_meeting_join_jobs\(source_meeting_id\)\n\s*where status in \('queued', 'running'\);/);
  assert.equal((sql.match(/create unique index /g)||[]).length,3);
  // 값 제약: Edge가 넣는 mode·status·stage가 표 제약 안이다.
  assert.match(sql,/check \(mode in \('job', 'report', 'text'\)\)/);
  assert.match(sql,/check \(status in \('queued', 'running', 'done', 'failed', 'undone'\)\)/);
  assert.match(sql,/check \(stage in \('summary', 'apply', 'done'\)\)/);
  assert.match(sql,/cardinality\(source_record_jobs\) <= 20/);assert.equal(jj.JOIN_RECORD_MAX,20);
  assert.match(sql,/char_length\(transcript_text\) <= 1000000/);assert.equal(jj.JOIN_TEXT_MAX_CHARS,1000000);
});

test('job_list에서 빼기: 지금 잇는 중인 녹음 결과만(실패하면 다시 보인다)',()=>{
  const A=id(40),B=id(41),C=id(42);
  const set=jj.joiningSources([{source_job_id:A,status:'queued'},{source_job_id:B,status:'running'},{source_job_id:C,status:'failed'},{source_job_id:null,status:'running'},{source_job_id:'x',status:'running'},null]);
  assert.deepEqual([...set].sort(),[A,B]);
  assert.equal(jj.joiningSources(null).size,0);
  const src=read('supabase/functions/meeting-transcribe/index.ts');
  const list=src.slice(src.indexOf('async function jobList('),src.indexOf('async function jobOpened('));
  assert.match(list,/jobs: \(data \|\| \[\]\)\.filter\(\(j\) => !joining\.has\(j\.id\)\)\.map\(\(j\) => jobView\(j\)\)/);
  // 잇기 작업 표가 없거나 읽지 못하면 빈 목록(지금 동작 그대로) — job_list가 실패하지 않는다.
  assert.match(list,/\.in\('status', \[\.\.\.ACTIVE\]\)\.in\('source_job_id', ids\);\n\s*if \(error\) return new Set\(\);/);
});

test('join_tick 서명은 job_tick 서명과 서로 통하지 않는다',async()=>{
  const ID='3f0c8a52-6a1e-4d6b-9b8e-2a6f1c0d9e11',now=1_800_000_000_000,exp=now+60000,body={job_id:ID,exp};
  const job=await sj.tickSign('server-key',ID,exp),join=await sj.tickSign('server-key',ID,exp,'join');
  assert.notEqual(job,join);assert.equal(job,await sj.tickSign('server-key',ID,exp,'job'));
  assert.equal(await sj.tickCheck('server-key',body,join,now,'join'),true);
  assert.equal(await sj.tickCheck('server-key',body,job,now,'join'),false,'job_tick 서명으로 join_tick을 열 수 없다');
  assert.equal(await sj.tickCheck('server-key',body,join,now),false,'join_tick 서명으로 job_tick을 열 수 없다');
  assert.equal(await sj.tickCheck('server-key',body,job,now),true,'job_tick은 지금 그대로');
  assert.equal(await sj.tickCheck('other-key',body,join,now,'join'),false);
  assert.equal(await sj.tickCheck('server-key',{...body,exp:exp+1},join,now,'join'),false);
  assert.equal(await sj.tickCheck('server-key',body,join,exp+1,'join'),false);
  for(const scope of ['','other','constructor','toString','__proto__'])assert.equal(await sj.tickCheck('server-key',body,join,now,scope),false,scope);
  assert.throws(()=>sj.tickSign('server-key',ID,exp,'constructor'),/tick_sign/);
  const src=read('supabase/functions/meeting-transcribe/index.ts');
  assert.match(src,/tickCheck\(SERVICE, body, req\.headers\.get\(TICK_HEADER\), Date\.now\(\), 'join'\)\)\) return json\(\{ ok: false \}, 401\)/);
  assert.match(src,/const sig = await tickSign\(SERVICE, id, exp, kind\);/);
  assert.equal(jj.JOIN_TICK_ACTION,'join_tick');
});

test('Edge 단계: 요약 코드는 한 벌(서버 정리 작업과 같이 씀), apply는 DB 함수 한 번·id만, 적용된 작업은 실패로 덮지 않는다',()=>{
  const src=read('supabase/functions/meeting-transcribe/index.ts');
  // 요약 단계 코드를 한 벌 더 만들지 않았다.
  assert.equal((src.match(/async function stepOnce\(/g)||[]).length,1);
  assert.equal((src.match(/async function serverDraft\(/g)||[]).length,1);
  assert.match(src,/async function stepOnce\(job: Job, cutBefore = false\): Promise<Record<string, unknown>> \{/);
  const run=src.slice(src.indexOf('async function runStep('),src.indexOf('async function stepOnce('));
  assert.match(run,/if \(kind === 'join' && job\.stage === 'apply'\) next = await applyJoin\(job\);\n\s*else \{\n\s*next = await stepOnce\(job, take\.cut === 1\);\n\s*if \(kind === 'join'\) next = joinAfterSummary\(next, /);
  // apply가 끝난 작업 행은 DB 함수가 쓴 그대로 둔다(바로 뒤의 되돌리기를 done으로 덮지 않게). 그 밖의 단계는 지금처럼 결과를 저장한다.
  assert.match(run,/if \(!\(kind === 'join' && job\.stage === 'apply'\)\) await patchStepJob\(id, \{ \.\.\.next, error_code: null, lease_until: null, attempts: job\.attempts \+ 1 \}, kind\);/);
  assert.match(run,/admin\.rpc\('app_meeting_join_apply', \{ p_job: job\.id \}\)/);
  assert.match(run,/throw new Fail\(joinRpcCode\(error\)\)/);
  // 잇기 작업 표를 고치는 곳은 모두 joinPatch(고치기 권한이 있는 칸만)를 지난다. 잡기(lease)는 두 표가 같은 코드.
  const updates=[...src.matchAll(/from\(JOIN_JOB_TABLE\)\.update\((.*?)\)\.eq\('id', id\)/g)].map(m=>m[1]);
  assert.equal(updates.length,2);for(const u of updates)assert.equal(u,'joinPatch(patch, new Date().toISOString())');
  assert.equal((src.match(/from\(JOIN_JOB_TABLE\)\.update\(/g)||[]).length,2);
  assert.match(run,/const lease: Record<string, unknown> = \{ status: 'running', lease_until: [^}]*updated_at: now\.toISOString\(\) \};\n\s*if \(take\.cut === 1\) lease\.error_code = 'step_cut';/);
  for(const k of ['status','lease_until','updated_at','error_code'])assert.ok(jj.JOIN_UPDATE_COLUMNS.includes(k),k);
  assert.match(src,/if \(patch\.status === 'failed'\) q = q\.is\('applied_at', null\);/);
  assert.doesNotMatch(src,/from\(JOIN_JOB_TABLE\)\.(delete|upsert)/);
  // 끝 알림: 지금 있는 종류(meeting_done) 그대로, 여는 주소만 join_job. 제목·글은 싣지 않는다.
  assert.match(src,/\$\{kind === 'join' \? 'join_job' : 'rec_job'\}=\$\{job\.id\}&notice=meeting_done\.\$\{ref\}/);
  assert.match(src,/title: kind === 'join' \? '보고에 이어 붙였어요' : '회의 요약이 준비됐어요'/);
  assert.doesNotMatch(src,/kind: '(?!meeting_done')[a-z_]+', title:/);
  // 요약 뒤 서버가 저절로 하는 바깥 행동이 없다(3-4·3-6절): 잇기 쪽 코드는 할 일·일정·Drive·메일을 부르지 않는다.
  const join=src.slice(src.indexOf('// ---- REC-한회의로잇기 PR-2: 잇기 작업 입구'),src.indexOf('Deno.serve('));
  assert.doesNotMatch(join,/fetch\(|google|tasks|calendar|gmail|drive|sender\.|moveDriveFileToTrash|driveToken/i);
  assert.doesNotMatch(src.slice(src.indexOf('async function applyJoin('),src.indexOf('async function stepOnce(')),/fetch\(|drive|sender\./i);
});
