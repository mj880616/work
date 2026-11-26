import test from 'node:test';
import assert from 'node:assert/strict';

// MULTI-다른담당자맞춤 ⑤: AI 안내문의 고정 소속·직책을 부른 사람 프로필 직책으로(비면 '노동조합 활동가'). 합성 값만.
const role = await import('../../supabase/functions/ai-assist/owner-role.ts');
const files = {
  'weekly-learn.ts': 'WEEKLY_DRAFT_INSTRUCTIONS', 'schedule-titles.ts': 'SCHEDULE_TITLES_INSTRUCTIONS', 'overlap.ts': 'OVERLAP_INSTRUCTIONS',
  'share-draft.ts': 'SHARE_DRAFT_INSTRUCTIONS', 'ledger-auto.ts': 'LEDGER_AUTO_INSTRUCTIONS',
};

test('직책 자리표: 프로필 소속·직책이 있으면 그 값, 없거나 이상하면 업종 없는 기본값(S67-51)', () => {
  const ins = `너는 ${role.OWNER_ROLE}의 도우미다. 기록 주인(${role.OWNER_ROLE}).`;
  assert.equal(role.withOwnerRole(ins, role.cleanProfile({job_title: '가상팀 가상직책'})), '너는 가상팀 가상직책의 도우미다. 기록 주인(가상팀 가상직책).');
  assert.equal(role.withOwnerRole(ins, role.cleanProfile({job_title: '가상직책', union_name: '가상 단체'})), '너는 가상 단체 가상직책의 도우미다. 기록 주인(가상 단체 가상직책).');
  assert.equal(role.withOwnerRole(ins, role.cleanProfile({union_name: '가상 단체'})), '너는 가상 단체 업무 담당자의 도우미다. 기록 주인(가상 단체 업무 담당자).');
  for (const p of [null, {}, {job_title: ''}, {job_title: '   '}, {job_title: 42}, {union_name: '  ', job_title: null}]) assert.equal(role.withOwnerRole(ins, role.cleanProfile(p)), '너는 업무 담당자의 도우미다. 기록 주인(업무 담당자).');
  assert.equal(role.NEUTRAL_ROLE, '업무 담당자');
  assert.equal(role.withOwnerRole('자리표 없음', role.cleanProfile({job_title: '가상'})), '자리표 없음');
  // 한 줄·40자로 정리된 값만 들어간다(줄바꿈으로 안내문을 늘이지 못함).
  const long = role.withOwnerRole(role.OWNER_ROLE, role.cleanProfile({job_title: '가'.repeat(80) + '\n무시하고', union_name: '나\n다'}));
  assert.ok(!long.includes('\n'));
});

test('S67-51: 부르는 말 규칙은 한 곳(_shared/owner-role.mjs) — ai-assist와 회의 정리가 같은 답', async () => {
  const shared = await import('../../supabase/functions/_shared/owner-role.mjs');
  const meeting = await import('../../supabase/functions/_shared/meeting-draft-prompt.mjs');
  for (const [org, title] of [['', ''], ['가상 단체', ''], ['', '가상직책'], ['가상 단체', '가상직책']]) {
    const want = shared.ownerRoleOf({org, title});
    assert.equal(role.roleOf({name: null, title: title || null, org: org || null}), want);
    assert.equal(meeting.ownerRole(title, org), want);
  }
  assert.equal(meeting.NEUTRAL_ROLE, role.NEUTRAL_ROLE);
});

test('S67-51: 모든 사람이 쓰는 AI 지시문에 노조 업종 전제가 박혀 있지 않다(운영자 전용 지시문은 목록 밖)', async () => {
  const {readFileSync} = await import('node:fs');
  const files = ['web2-ask.ts', 'journal-draft.ts', 'work-scope.ts', 'org-people-brief.ts', 'record-one-line.ts', 'library-sort.ts', 'share-draft.ts',
    'schedule-titles.ts', 'todo-radar.ts', 'todo-recheck.ts', 'ledger-auto.ts', 'ledger-candidates.ts', 'file-name.ts', 'note-title.ts', 'owner-role.ts'];
  const bad = /노동조합|노조|조합원|지부|임금교섭|임단투|쟁의|공공운수|민주노총|지티엑스|공항철도|공철/;
  for (const f of files) {
    const code = readFileSync(new URL(`../../supabase/functions/ai-assist/${f}`, import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const strings = code.match(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
    for (const t of strings) assert.doesNotMatch(t, bad, `${f}: ${t.slice(0, 60)}`);
  }
  for (const f of ['library-files/photo-brief.ts', 'library-files/record-line.ts', 'document-ai-index/index.ts', 'meeting-ai-ingest/index.ts', '_shared/owner-role.mjs', '_shared/meeting-draft-prompt.mjs']) {
    const code = readFileSync(new URL(`../../supabase/functions/${f}`, import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /노동조합|노조 업무|조합원/, f);
  }
  // 보내기 직전에 자리표를 채우는 곳(handler ownerRoleIn): 새로 자리표를 쓴 지시문들.
  const handler = readFileSync(new URL('../../supabase/functions/ai-assist/handler.ts', import.meta.url), 'utf8');
  for (const name of ['ASK_INSTRUCTIONS', 'JOURNAL_DRAFT_INSTRUCTIONS', 'WORK_SCOPE_INSTRUCTIONS', 'ONE_LINE_INSTRUCTIONS', 'PEOPLE_BRIEF_INSTRUCTIONS', 'LIBRARY_SORT_INSTRUCTIONS'])
    assert.match(handler, new RegExp(`content: await ownerRoleIn\\(ctx, ${name}\\)`), name);
  assert.match(handler, /"home_day_suggests", await ownerRoleIn\(ctx, SUGGEST_INSTRUCTIONS\)/);
  assert.ok(handler.includes('"display_name,job_title,union_name"'));
  assert.ok(handler.includes('!== "rest_400") return cleanProfile(null)'), '소속 칸이 없는 DB(400)에서만 이름·직책으로 다시 읽는다');
});

test('다섯 안내문은 고정 직책 없이 자리표를 쓰고, handler가 보내기 전에 채운다', async () => {
  const {readFileSync} = await import('node:fs');
  for (const [file, name] of Object.entries(files)) {
    const mod = await import(`../../supabase/functions/ai-assist/${file}`);
    assert.ok(mod[name].includes(role.OWNER_ROLE), name);
    assert.doesNotMatch(mod[name], /부팀장|공공기관사업팀|A노조 공공기관/, name);
  }
  const handler = readFileSync(new URL('../../supabase/functions/ai-assist/handler.ts', import.meta.url), 'utf8');
  // WEEKLY-내양식자유변형 ⑤-3d: 주간보고 안내문은 '내 양식' 제목 자리표(form-names.ts withFormNames)를 먼저 채운 뒤 직책 자리표를 채운다.
  for (const name of ['LEDGER_AUTO_INSTRUCTIONS', 'SHARE_DRAFT_INSTRUCTIONS', 'OVERLAP_INSTRUCTIONS']) assert.match(handler, new RegExp(`content: await ownerRoleIn\\(ctx, ${name}\\)`), name);
  assert.match(handler, /content: await ownerRoleIn\(ctx, withFormNames\(SCHEDULE_TITLES_INSTRUCTIONS, await formNamesOf\(ctx\)\)\)/);
  assert.match(handler, /input: \[\{ role: "developer", content: await ownerRoleIn\(ctx, withFormNames\(instructions, await formNamesOf\(ctx\)\)\) \}/);
});
