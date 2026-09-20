export class MeetingAuthError extends Error {
  constructor(status, code) {
    if (![401, 403].includes(status)) throw new TypeError('Invalid meeting authorization status');
    super(status === 401 ? '로그인이 필요합니다.' : '접근 권한이 없습니다.');
    this.status = status;
    this.code = code;
  }
}

export function meetingAuthResponse(error, cors) {
  if (!(error instanceof MeetingAuthError)) return null;
  return new Response(JSON.stringify({error: error.message, code: error.code}), {
    status: error.status,
    headers: {...cors, 'Content-Type': 'application/json; charset=utf-8'},
  });
}
