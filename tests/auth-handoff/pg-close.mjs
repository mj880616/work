// pg-pool의 end()는 소켓이 실제로 닫히기 전에 끝난다(유휴 연결을 목록에서 빼고 바로 resolve).
// 그 상태에서 cluster.stop()(SIGINT)이 오면 PostgreSQL이 아직 열린 연결에
// 57P01 "terminating connection due to administrator command"를 보내고,
// 그 오류가 리스너 없는 pool 'error'로 올라와 모든 하위 시험이 통과한 시험도 실패로 만든다.
// trackPool로 만든 pool은 closePool이 모든 연결의 'end'까지 기다린 뒤 돌아온다.
const ends = new WeakMap();

export function trackPool(pool) {
  const list = [];
  ends.set(pool, list);
  pool.on('connect', client => list.push(new Promise(resolve => client.once('end', resolve))));
  return pool;
}

export async function closePool(pool) {
  if (!pool) return;
  const list = ends.get(pool);
  if (!list) throw new Error('closePool: trackPool로 만든 pool이 아님');
  await pool.end();
  await Promise.all(list);
}
