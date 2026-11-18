// 시험용 한글 파일 엔진 묶음(WEEKLY-내양식자유변형 ⑤-3a): weekly-engine-core.mjs(template·report) + draft.mjs.
// 엔진은 profile 을 꼭 받는다(코드에 기본 양식 없음). 여기 함수들은 profile 을 주지 않으면 고정 양식(weekly-own-form-legacy-shape.json)을 넣는다.
import {FIXTURE_PROFILE} from './weekly-engine-core.mjs';
import * as D from '../../app/weekly-hwpx/draft.mjs';

export * from './weekly-engine-core.mjs';
export * from '../../app/weekly-hwpx/draft.mjs';

const P = o => ({profile: FIXTURE_PROFILE, ...(o ?? {})});
export const prepareConfirmed = (pkg, o) => D.prepareConfirmed(pkg, P(o));
export const buildHwpx = (template, data, zlib, o) => D.buildHwpx(template, data, zlib, P(o));
export const issuedFrom = (bytes, at, zlib, o) => D.issuedFrom(bytes, at, zlib, P(o));
