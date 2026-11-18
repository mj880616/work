// S61-36 REC-상세녹음: 회의 상세 [녹음]으로 시작한 녹음이 어느 회의 것인지 서버(Edge meeting-transcribe)가 남기고 다시 쓴다.
// - rec_start: 새 녹음에 meeting_id가 오면 부른 사람 로그인(owner RLS)으로 읽은 같은 작업공간 회의일 때만 연결 행을 넣는다.
// - rec_save: 화면이 회의를 보내지 않아도(새로고침 뒤 [이어서 저장]) 남긴 회의에 붙인다. 남긴 회의가 없거나 읽지 못하면 자료실에만.
// - rec_pending: 목록마다 meeting_id(없으면 null).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withMeetings} from '../supabase/functions/meeting-transcribe/recording.mjs';

const src=readFileSync(new URL('../supabase/functions/meeting-transcribe/index.ts',import.meta.url),'utf8');
const fn=name=>{const i=src.indexOf(`async function ${name}(`);assert.ok(i>=0,name);const j=src.indexOf('\nasync function ',i+10);return src.slice(i,j<0?undefined:j)};

test('withMeetings: 녹음마다 회의 id(없으면 null), 다른 칸은 그대로',()=>{
  const list=[{session_id:'s1',duration_sec:60},{session_id:'s2',duration_sec:30}];
  assert.deepEqual(withMeetings(list,[{session_id:'s1',meeting_id:'m1'},{session_id:'sX',meeting_id:'mX'},{session_id:'s2',meeting_id:null}]),
    [{session_id:'s1',duration_sec:60,meeting_id:'m1'},{session_id:'s2',duration_sec:30,meeting_id:null}]);
  assert.deepEqual(withMeetings(list,null).map(s=>s.meeting_id),[null,null]);
  assert.deepEqual(withMeetings(null,[]),[]);
});

test('rec_start: 새 녹음만, 회의는 로그인으로 읽은 같은 작업공간 회의일 때만 남긴다(작업공간·만든 사람은 서버가 정함)',()=>{
  const body=fn('recStart');
  assert.match(body,/await requireOwner\(user\.id, workspaceId\)/);
  assert.match(body,/const meeting = fresh \? await ownMeeting\(userDb, body\.meeting_id, workspaceId\) : null;/);
  assert.match(body,/from\(REC_MEETING_TABLE\)\.insert\(\{ session_id: sessionId, workspace_id: workspaceId, created_by: user\.id, meeting_id: meeting\.id \}\)/);
  assert.ok(body.indexOf('REC_MEETING_TABLE')<body.indexOf('from(REC_TABLE).insert'),'link before the segment row');
  assert.match(src,/if \(action === 'rec_start'\) return await recStart\(user, userDb, body\);/);
  const own=fn('ownMeeting');
  assert.match(own,/userDb\.from\('app_meetings'\)/,'meeting read with the caller login (owner RLS)');
  assert.match(own,/data\.workspace_id !== workspaceId\) throw new Fail\('not_found'\)/);
  assert.match(own,/!isUuid\(id\)\) throw new Fail\('bad_request'\)/);
});

test('rec_save: 보낸 회의 우선, 없으면 그 녹음에 남긴 회의(같은 작업공간 행만), 지금 없는 회의면 자료실에만',()=>{
  const body=fn('recSave');
  assert.match(body,/let meeting = await ownMeeting\(userDb, body\.meeting_id, ws\);/);
  assert.match(body,/const linked = await sessionMeeting\(ws, body\.session_id as string\);/);
  assert.match(body,/e\.code === 'not_found'\) return null/);
  assert.ok(body.indexOf('ownSession(user.id, body.session_id)')<body.indexOf('sessionMeeting'),'session ownership first');
  const read=fn('sessionMeeting');
  assert.match(read,/\.eq\('session_id', sessionId\)\.eq\('workspace_id', workspaceId\)/);
});

test('rec_pending: 같은 작업공간 연결만 읽어 목록마다 meeting_id',()=>{
  const body=fn('recPending');
  assert.match(body,/from\(REC_MEETING_TABLE\)\.select\('session_id,meeting_id'\)\.eq\('workspace_id', workspaceId\)\.in\('session_id', sessionIds\)/);
  assert.match(body,/sessions: withMeetings\(pendingSessions\(/);
  assert.match(body,/live: withMeetings\(liveSessions\(/);
});
