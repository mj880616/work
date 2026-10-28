// ORG-담당13기준: the one rule for "내 담당 조직". The source is the owner's own assignment rows
// (app_suborganization_assignees, edited in 내 프로필 → 담당 사업장), crossed with active organizations — the same
// set home weekUpdates and the 기록할 곳 sheet already use. No assignment (or a failed read) falls back to every active
// organization and says so (fallback:true). Order and groups stay in organization-order.js.
// The Drive copy (supabase/functions/drive-summary/basket.mjs) keeps a deployment-local copy; tests compare the two.
export function selectMyOrganizations(organizations, assignees) {
  const active = organizations.filter(row => row.active !== false);
  const assigned = new Set(assignees.map(row => row.organization_id));
  const mine = active.filter(row => assigned.has(row.id));
  return { organizations: mine.length ? mine : active, fallback: mine.length === 0 };
}
// The ids of my organizations, for screens that keep the others' records under one "그 외" group.
export const myOrganizationIds = (organizations, assignees) => new Set(selectMyOrganizations(organizations, assignees).organizations.map(row => row.id));
export const OTHERS = '그 외';
// ORG-고르기통일: every place where I choose an organization (record places, task links, event checks, feed links, library
// bulk change, basket [연결하기]) offers only this set, in organization-order.js order. 내 프로필 → 담당 사업장 is the one
// exception: it is where the assignment is decided, so it lists every organization. Pickers that showed nothing when I have
// no assignment keep that (whenNone:'none'); the others keep the rule's fallback (every active organization).
// tests/org-picker-mine.test.mjs fails when a new file reads app_suborganizations without this rule or a stated reason.
export function pickMyOrganizations(organizations, assignees, {whenNone = 'all'} = {}) {
  const mine = selectMyOrganizations(organizations || [], assignees || []);
  return mine.fallback && whenNone === 'none' ? [] : mine.organizations;
}
