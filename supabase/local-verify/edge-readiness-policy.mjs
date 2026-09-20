const bootCodes = new Set(['BOOT_ERROR', 'LOAD_FUNCTION_ERROR', 'LOAD_FUNCTION_METADATA_ERROR']);

export function classifyEdgeResponse(status, code) {
  if (bootCodes.has(code)) return 'FUNCTION_BOOT_FAILURE';
  if (code === 'AUTH_REQUIRED' && status === 401) return 'FUNCTION_AUTHORIZATION_RETURNED';
  if (status === 404) return 'FUNCTION_ROUTING_FAILURE';
  if ([502, 503, 504].includes(status)) return 'GATEWAY_OR_RUNTIME_UNAVAILABLE';
  if (status >= 500) return 'REQUEST_EXCEPTION_OR_RUNTIME';
  if (status >= 200 && status < 500) return 'FUNCTION_ENDPOINT_RESPONDED';
  return 'UNCLASSIFIED';
}
