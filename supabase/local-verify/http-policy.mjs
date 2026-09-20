export const hidden = result => [401, 403].includes(result.status) ||
  (result.status === 200 &&
    (result.data == null || (Array.isArray(result.data) && result.data.length === 0)));

export function assertMeetingDenied(assert, result, status, code, label) {
  assert.equal(result.status, status, label);
  assert.equal(result.data?.code, code, label);
  assert.ok(!JSON.stringify(result.data).includes('Synthetic private'), label);
  assert.ok(!JSON.stringify(result.data).includes('Synthetic foreign'), label);
}
