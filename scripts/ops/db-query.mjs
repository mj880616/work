// Management API transport shared by approved DB workflows. No packages, retries,
// response files, or logging. The caller must approve SQL and constrain its output.
const MAX_RESPONSE_BYTES = 65_536;

export class DbQueryError extends Error {
  constructor(kind, { status, divisionByZero = false, sqlState } = {}) {
    super(`DB query failed (${kind}${status ? `, HTTP ${status}` : ''})`);
    this.name = 'DbQueryError';
    this.divisionByZero = divisionByZero;
    this.sqlState = typeof sqlState === 'string' && /^[0-9A-Z]{5}$/.test(sqlState) ? sqlState : undefined;
  }
}

export function createQueryClient({ token, projectRef, endpoint, timeoutMs = 30_000 }) {
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)
      || typeof projectRef !== 'string' || !/^[a-z]{20}$/.test(projectRef)) {
    throw new DbQueryError('configuration');
  }
  // Endpoint injection is for local fake-server tests; the workflow has no URL input.
  const url = endpoint ?? `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  return async function query(sql, { readOnly = false } = {}) {
    let response;
    let payload;
    try {
      response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql, read_only: readOnly }),
      });
      const reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new DbQueryError('response limit');
        }
        chunks.push(value);
      }
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof DbQueryError) throw error;
      // Never retain a native error/cause: it can contain URLs, headers or data.
      throw new DbQueryError('transport or invalid JSON');
    }
    const errorObjects = Array.isArray(payload)
      ? payload.filter(row => row && typeof row === 'object' && ('error' in row
        || (typeof row.code === 'string' && /^[0-9A-Z]{5}$/.test(row.code) && typeof row.message === 'string')))
      : [payload];
    if (![200, 201].includes(response.status) || errorObjects.length) {
      const sqlErrorStatus = [200, 201, 400, 422, 500].includes(response.status);
      const divisionByZero = sqlErrorStatus && errorObjects.some(error =>
        error && typeof error === 'object' && (error.code === '22012'
          || [error.error, error.message].some(value => typeof value === 'string' && /\bdivision by zero\b/i.test(value))));
      const sqlState = sqlErrorStatus ? errorObjects.find(error => error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code))?.code : undefined;
      throw new DbQueryError('API', { status: response.status, divisionByZero, sqlState });
    }
    if (!Array.isArray(payload)) throw new DbQueryError('response shape');
    return payload;
  };
}
