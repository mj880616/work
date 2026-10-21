// Management API transport shared by approved DB workflows. No packages, retries,
// response files, or logging. The caller must approve SQL and constrain its output.
const MAX_RESPONSE_BYTES = 65_536;
const KINDS = new Set(['configuration', 'API', 'transport', 'invalid JSON', 'response limit', 'response shape', 'unknown']);
const validStatus = status => Number.isInteger(status) && status >= 100 && status <= 599;
const validSqlState = sqlState => typeof sqlState === 'string' && /^[0-9A-Z]{5}$/.test(sqlState);

export class DbQueryError extends Error {
  constructor(kind, { status, divisionByZero = false, sqlState } = {}) {
    const safeKind = KINDS.has(kind) ? kind : 'unknown';
    super(`DB query failed (${safeKind}${validStatus(status) ? `, HTTP ${status}` : ''})`);
    this.name = 'DbQueryError';
    this.kind = safeKind;
    this.status = validStatus(status) ? status : undefined;
    this.divisionByZero = divisionByZero === true;
    this.sqlState = validSqlState(sqlState) ? sqlState : undefined;
  }
}

// Check SQL whose item names or column shape the runner cannot accept. Fixed text only.
export class CheckFormatError extends Error {
  constructor() { super('Invalid check SQL format'); this.name = 'CheckFormatError'; }
}

// Render only bounded internal metadata, never message/cause or response data.
export function queryErrorSummary(error) {
  if (error instanceof CheckFormatError) {
    return '확인 SQL 형식 오류(항목 이름·열 모양): 확인 SQL의 항목 이름 또는 결과 열 모양이 규칙에 맞지 않습니다. DB 연결 문제가 아닙니다. 원문 오류·SQL·데이터는 출력하지 않습니다.';
  }
  const known = error instanceof DbQueryError;
  const status = known && validStatus(error.status) ? `HTTP ${error.status}` : 'HTTP 상태 미확인';
  const kind = known && KINDS.has(error.kind) ? error.kind : '응답 검증';
  const sqlState = known && validSqlState(error.sqlState) ? ` · SQLSTATE ${error.sqlState}` : '';
  return `${status} · ${kind}${sqlState}: DB 요청·응답 확인 실패. 원문 오류·SQL·데이터는 출력하지 않습니다.`;
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
          throw new DbQueryError('response limit', { status: response.status });
        }
        chunks.push(value);
      }
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new DbQueryError('invalid JSON', { status: response.status }); }
    } catch (error) {
      if (error instanceof DbQueryError) throw error;
      // Never retain a native error/cause: it can contain URLs, headers or data.
      throw new DbQueryError('transport', { status: response?.status });
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
    if (!Array.isArray(payload)) throw new DbQueryError('response shape', { status: response.status });
    return payload;
  };
}
