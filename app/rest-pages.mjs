// LIB-끌어옮기기저장실패(S69, 명진 11/24 16:09): 서버(PostgREST)는 한 번에 돌려주는 줄 수를 정해 둔 만큼(기본 1000줄)에서 자른다.
// 원인(사실, 코드): 자료실은 자료(app_documents)와 폴더 연결(app_library_folder_items)을 한 번에 읽었다 — 자료가 1000개를 넘으면
//   목록·연결이 일부만 와서, 이미 잡동사니에 든 자료가 '폴더 밖'으로 보이고(②·④), 그것을 폴더로 끌면 '새 연결 넣기'가 이미 있는 줄과 겹쳐
//   거절되어 '저장하지 못했어요'가 떴다(①).
// 여기는 같은 읽기를 쪽(limit·offset)으로 끝까지 읽는 한 가지 길이다. path에는 순서(order=…, 끝에 겹치지 않는 열)를 꼭 넣는다.
// 쪽 크기(1000) = 서버가 자르는 줄 수(Supabase 기본 1000)와 같다: 쪽이 덜 차면 끝. 1000개 안쪽이면 지금처럼 한 번만 읽는다.
// maxPages를 넘으면 잘린 목록을 쓰지 않고 실패한다.
export const REST_PAGE = 1000;
export const REST_MAX_PAGES = 200;

export async function readAllPages(api, path, {page = REST_PAGE, maxPages = REST_MAX_PAGES} = {}) {
  if (typeof api !== 'function' || typeof path !== 'string' || !/[?&]order=/.test(path)) throw new Error('readAllPages: order가 있는 경로가 필요해요.');
  const join = path.includes('?') ? '&' : '?';
  const rows = [];
  for (let n = 0, offset = 0; ; n++) {
    if (n >= maxPages) throw new Error('목록이 너무 길어 다 읽지 못했어요.');
    const got = await api(`${path}${join}limit=${page}&offset=${offset}`);
    if (!Array.isArray(got)) throw new Error('목록을 읽지 못했어요.');
    rows.push(...got);
    if (got.length < page) return rows;
    offset += got.length;
  }
}
