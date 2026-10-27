// PRJ-목록접어두기: 잘 안 여는 프로젝트를 목록 맨 아래 한 줄로 접어 둔다. 접힘은 프로젝트 행의 metadata.folded(true)에 서버 저장한다
// (기존 app_spaces.metadata, 새 칸·새 표·권한 변경 없음; metadata.color 검사와 서로 닿지 않는다). 접힌 프로젝트의 데이터는 그대로이고
// 바뀌는 것은 프로젝트 탭 목록의 자리와 연결 고르기 목록의 순서(맨 아래·흐리게)뿐이다.
// 담당조직 목록에도 쓸 수 있도록 프로젝트 모양(id, parent_id, metadata)만 안다. 담당조직에는 아직 적용하지 않는다.
export const isFoldedOwn = p => p?.metadata?.folded === true;

// 접힌 것으로 보이는 id 모음: 스스로 접었거나, 위로 올라가다 접힌 상위가 있는 것(큰 프로젝트를 접으면 하위도 같이).
export function foldedSet(projects) {
  const rows = Array.isArray(projects) ? projects : [];
  const byId = new Map(rows.map(p => [p.id, p]));
  const out = new Set();
  for (const p of rows) {
    const seen = new Set();
    for (let x = p; x && !seen.has(x.id); x = byId.get(x.parent_id)) {
      seen.add(x.id);
      if (isFoldedOwn(x)) { out.add(p.id); break; }
    }
  }
  return out;
}

// 트리 줄([{project, depth}], 위에서 아래 순서)을 펼쳐 둔 것과 접힌 것으로 나눈다. 순서는 각자 그대로, 접힌 것이 뒤로 간다.
export function partitionTree(rows, folded) {
  const list = Array.isArray(rows) ? rows : [];
  return { open: list.filter(r => !folded.has(r.project.id)), folded: list.filter(r => folded.has(r.project.id)) };
}

// 줄 묶음: 첫 줄이 머리, 그보다 깊은 뒤따르는 줄은 그 머리의 아래(depth는 머리 기준 1, 2).
// 하위 하나만 접은 경우처럼 머리의 depth가 0이 아니어도 머리부터 한 덩어리로 그린다.
export function blocks(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const last = out[out.length - 1];
    if (last && r.depth > last.depth) last.below.push({ project: r.project, depth: r.depth - last.depth });
    else out.push({ project: r.project, depth: r.depth, below: [] });
  }
  return out.map(b => ({ head: b.project, below: b.below }));
}

export function foldedMetadata(metadata, on) {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
  if (on) base.folded = true; else delete base.folded;
  return base;
}

// '▸ 접어 둔 것 n · 이름, 이름…' 한 줄의 글(머리 이름만; 길면 CSS가 말줄임으로 줄인다).
export function foldSummary(headNames) {
  const names = (Array.isArray(headNames) ? headNames : []).map(n => String(n || '').trim() || '이름 없는 프로젝트');
  return { count: names.length, names: names.join(', ') };
}

// 순서 바꾸기는 같은 칸(접힌 쪽끼리 / 펼친 쪽끼리) 형제만 대상으로 삼는다.
export const sameGroup = (folded, a, b) => folded.has(a.id) === folded.has(b.id);
