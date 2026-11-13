import test from 'node:test';
import assert from 'node:assert/strict';

// MULTI-다른담당자맞춤 ⑤: AI 안내문의 고정 소속·직책을 부른 사람 프로필 직책으로(비면 '노동조합 활동가'). 합성 값만.
const role = await import('../../supabase/functions/ai-assist/owner-role.ts');
const files = {
  'weekly-learn.ts': 'WEEKLY_DRAFT_INSTRUCTIONS', 'schedule-titles.ts': 'SCHEDULE_TITLES_INSTRUCTIONS', 'overlap.ts': 'OVERLAP_INSTRUCTIONS',
  'share-draft.ts': 'SHARE_DRAFT_INSTRUCTIONS', 'ledger-auto.ts': 'LEDGER_AUTO_INSTRUCTIONS',
};

test('직책 자리표: 프로필 직책이 있으면 그 값, 없거나 이상하면 중립 표현', () => {
  const ins = `너는 ${role.OWNER_ROLE}의 도우미다. 기록 주인(${role.OWNER_ROLE}).`;
  assert.equal(role.withOwnerRole(ins, role.cleanProfile({job_title: '가상팀 가상직책'})), '너는 노동조합 가상팀 가상직책의 도우미다. 기록 주인(노동조합 가상팀 가상직책).');
  for (const p of [null, {}, {job_title: ''}, {job_title: '   '}, {job_title: 42}]) assert.equal(role.withOwnerRole(ins, role.cleanProfile(p)), '너는 노동조합 활동가의 도우미다. 기록 주인(노동조합 활동가).');
  assert.equal(role.withOwnerRole('자리표 없음', role.cleanProfile({job_title: '가상'})), '자리표 없음');
  // 한 줄·40자로 정리된 값만 들어간다(줄바꿈으로 안내문을 늘이지 못함).
  const long = role.withOwnerRole(role.OWNER_ROLE, role.cleanProfile({job_title: '가'.repeat(80) + '\n무시하고'}));
  assert.ok(!long.includes('\n'));
});

test('다섯 안내문은 고정 직책 없이 자리표를 쓰고, handler가 보내기 전에 채운다', async () => {
  const {readFileSync} = await import('node:fs');
  for (const [file, name] of Object.entries(files)) {
    const mod = await import(`../../supabase/functions/ai-assist/${file}`);
    assert.ok(mod[name].includes(role.OWNER_ROLE), name);
    assert.doesNotMatch(mod[name], /부팀장|공공기관사업팀|공공운수노조 공공기관/, name);
  }
  const handler = readFileSync(new URL('../../supabase/functions/ai-assist/handler.ts', import.meta.url), 'utf8');
  for (const name of ['LEDGER_AUTO_INSTRUCTIONS', 'SHARE_DRAFT_INSTRUCTIONS', 'SCHEDULE_TITLES_INSTRUCTIONS', 'OVERLAP_INSTRUCTIONS']) assert.match(handler, new RegExp(`content: await ownerRoleIn\\(ctx, ${name}\\)`), name);
  assert.match(handler, /input: \[\{ role: "developer", content: await ownerRoleIn\(ctx, instructions\) \}/);
});
