// SEC-정리묶음: google-calendar·google-tasks는 로그인 뒤 작업공간 소유자 행(app_workspace_members role=owner)을 확인한다.
// 기존 가짜 Supabase를 그대로 두고, 이 표 읽기만 소유자 행(또는 지정한 값)으로 답하게 감싼다. 값은 모두 지어낸 것이다.
export const OWNER_MEMBER = { workspace_id: 'synthetic-workspace', role: 'owner' };
export function withOwner(createClient, { member = OWNER_MEMBER, error = null, reads = null } = {}) {
  return (...args) => {
    const client = createClient(...args);
    if (!client || typeof client.from !== 'function') return client;
    return new Proxy(client, {
      get(target, key) {
        if (key !== 'from') return target[key];
        return table => {
          if (table !== 'app_workspace_members') return target.from(table);
          // 소유자 확인(role=owner로 거른 읽기)만 답한다. 다른 읽기(할 일 첨부의 기존 확인 등)는 원래 가짜에 그대로 넘긴다.
          const filters = {}, steps = [];
          const q = {
            select: (...a) => { steps.push(['select', a]); return q; },
            eq: (k, v) => { filters[k] = v; steps.push(['eq', [k, v]]); return q; },
            maybeSingle: async () => {
              if (filters.role !== 'owner') return steps.reduce((b, [m, a]) => b[m](...a), target.from(table)).maybeSingle();
              reads?.push(filters); return { data: error ? null : member, error };
            }
          };
          return q;
        };
      }
    });
  };
}
