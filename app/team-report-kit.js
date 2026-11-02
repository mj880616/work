// PERF-첫로딩 P5-b(docs/design/first-load.md 10절): 사업 보고 화면·입력 창에만 쓰는 모듈 한 묶음.
// team.js가 사업 보고 화면 자료를 읽을 때(또는 연결 다시 읽기 때) import()로 한 번 부른다. 이 파일은 다시 내보내기만 한다.
// 앱 바탕(로그인 뒤 모든 화면)에 쓰는 모듈은 여기에 넣지 않는다(team.js 맨 위 정적 import). 시간 칸(time-input.js)은 앱 전체 칸을 맞추므로 team.js에 남긴다.
export {renderFilterChips} from './filter-chips.js';
export {defaultReportAt} from './report-default-at.mjs';
export {isPhotoFile} from './activity-photo-model.mjs';
export {paintLocalPhotos} from './report-photo-row.js';
export {REPORT_VIEW_OPTIONS,reportViewOf,shiftMonth,photosByMeeting} from './report-views-model.mjs';
export {calendarHtml,photoViewHtml,mountPhotoView,mountStrips} from './report-views.js';
export {PC_QUERY,NONE_KEY,sortRecentFirst,MEETING_DOCS_LABEL,meetingColumns,columnsHtml,listHtml,pickMeeting,assignMeetingColors,meetingPaletteColor,nameHash,MEETING_HUES,roundLabel,hasRound,meetingShortName} from './meeting-columns.js';
export {formatMeetingWhen} from './meeting-when.js';
export {pickReportKind} from './report-kind-sheet.js';
export {reportWords,isMeetingKind} from './report-words.mjs';
export {createFieldRows} from './report-entry-rows.js';
export {mountSplitResize} from './split-resize.js';
export {followPane} from './follow-pane.js';
export {targetList,targetsLabel,firstProjectId} from './report-links-model.mjs';
export {saveReportTargets,readAllReportTargets,locationAvailable,noteLocationFromMeetings,noteAreaFromMeetings,noteAreaNoneFromMeetings,LEGACY_NOTE} from './report-links.js';
export {mountAreaFields} from './business-area-fields.js';
export {mountBigWrite} from './record-text-write.js';
export {untaggedInWeek,NO_AREA,AREA_NONE,areaRoots,areaChipOptions,matchesAreaChip,areaIdOf,defaultReportWeek,inReportWeek,undatedCount,reportWeekLabel,reportDay,weekOf,shiftDays} from './business-area-model.mjs';
