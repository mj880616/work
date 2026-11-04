// PHOTO-기기별출처(S49-5): 이 기기(폰 앱 / PC·브라우저)의 사진 출처 켜기·끄기 읽기. 사진·일기·사업 보고 '그 시각 사진'이 모두 이 한 곳을 읽는다.
// 기기 종류는 폰 앱 다리(phone-photos.js usable)로만 정한다. 폴드를 펼친 폰 앱도 폰이다. 저장은 서버 view_prefs뿐(기기 저장 없음).
import {viewPrefs} from './view-prefs.js';
import {phonePhotos} from './phone-photos.js';
import {parseSources, deviceSourcesKey, deviceSourcesDefault} from './photo-sources-model.mjs';

export const onPhoneApp = () => !!phonePhotos().usable;
export const deviceSourcesPref = () => deviceSourcesKey(onPhoneApp());
export const readDeviceSources = () => parseSources(viewPrefs.get(deviceSourcesPref()), deviceSourcesDefault(onPhoneApp()));
