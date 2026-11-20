// S67-51: 이미 단계를 만들어 쓰고 있는 작업공간의 단계 목록(시험용 합성 값). 예전 기본 11개와 같은 모양이다.
// 새로 넣는 기본값(app/org-dispute-stage-model.mjs DEFAULT_STAGES)은 업종 없는 5개로 바뀌었고, 이미 있는 단계는 그대로 남으므로
// 화면·주간 보고 판정 시험은 이 목록으로 '지금 쓰는 사람'의 동작이 그대로인지 본다.
export const EXISTING_STAGES = Object.freeze([
  {name: '교섭 시작 전', is_struggle: false, is_ending: false, is_default: true},
  {name: '교섭 중', is_struggle: false, is_ending: false, is_default: false},
  {name: '쟁의발생 결의', is_struggle: true, is_ending: false, is_default: false},
  {name: '조정 신청', is_struggle: true, is_ending: false, is_default: false},
  {name: '조정 종료', is_struggle: true, is_ending: false, is_default: false},
  {name: '파업 찬반투표', is_struggle: true, is_ending: false, is_default: false},
  {name: '쟁의중', is_struggle: true, is_ending: false, is_default: false},
  {name: '잠정합의', is_struggle: true, is_ending: false, is_default: false},
  {name: '임단협 찬반투표', is_struggle: true, is_ending: false, is_default: false},
  {name: '협약체결', is_struggle: false, is_ending: true, is_default: false},
  {name: '종료', is_struggle: false, is_ending: true, is_default: false},
].map(row => Object.freeze(row)));
export const existingStageRows = workspaceId => EXISTING_STAGES.map((row, index) => ({workspace_id: workspaceId, ...row, sort_order: index + 1}));
