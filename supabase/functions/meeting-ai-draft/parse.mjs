export function parseMeetingDraft(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error('AI 응답이 비어 있습니다. 입력한 회의록은 유지됩니다.');

  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));

  let parsed;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch { /* Try the next representation. */ }
  }
  const warnings = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { draft: { decisions: '', actions: [], information: raw }, warnings: ['AI 응답 형식이 달라 원문을 검수용 초안에 보존했습니다.'] };
  }
  const input = parsed;
  const decisions = typeof input.decisions === 'string' ? input.decisions : '';
  let information = typeof input.information === 'string' ? input.information : '';
  const actions = [];
  const invalid = [];
  if (Array.isArray(input.actions)) {
    for (const action of input.actions) {
      if (action && typeof action === 'object' && typeof action.task === 'string' && typeof action.assignee === 'string' && typeof action.due === 'string' && action.task.trim()) {
        actions.push({ task: action.task, assignee: action.assignee, due: action.due });
      } else {
        invalid.push(JSON.stringify(action));
      }
    }
  } else if (input.actions !== undefined) {
    invalid.push(JSON.stringify(input.actions));
  }
  if (invalid.length) {
    information = [information, '확인할 후속 과제 원문:', ...invalid].filter(Boolean).join('\n');
    warnings.push('일부 후속 과제의 형식이 맞지 않아 원문을 정보공유에 보존했습니다.');
  }
  if (typeof input.decisions !== 'string' || typeof input.information !== 'string' || !Array.isArray(input.actions)) {
    warnings.push('일부 필드가 없어 초안을 검수해 주세요.');
  }
  if (!decisions && !information && !actions.length) {
    return { draft: { decisions: '', actions: [], information: raw }, warnings: ['AI 응답에서 유효한 내용을 찾지 못해 원문을 보존했습니다.'] };
  }
  return { draft: { decisions, actions, information }, warnings };
}
