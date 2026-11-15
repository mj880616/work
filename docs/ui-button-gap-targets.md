# 버튼 간격 전수 대상 표 (UI-버튼간격, S49-40)

`node scripts/ui/button-gap-scan.mjs`로 만든 표입니다. 템플릿 안에서 `</button>` 바로 뒤에 다른 버튼이 붙은 줄입니다. 그 줄의 부모가 간격 규칙(flex gap 또는 `.btn-row`)을 갖는지는 UI-버튼크기전수 작업에서 하나씩 보고 `.btn-row`(간격 `--ds-button-gap`)로 맞춥니다. 이번 PR에서 맞춘 곳은 담당조직 [전체 표]·[현황 표]입니다.

| 파일 | 줄 | 같은 줄 btn-row | 첫 클래스 |
| --- | --- | --- | --- |
| app/basket-ai-summary.js | 158 | 확인 필요 | ai-summary-proposal |
| app/basket-link-records.js | 124 | 확인 필요 | basket-link-danger |
| app/basket-link-records.js | 147 | 확인 필요 | basket-link-original |
| app/basket-manual-link.js | 228 | 확인 필요 | basket-actions |
| app/basket-manual-link.js | 233 | 확인 필요 | basket-actions save-row |
| app/basket-manual-link.js | 247 | 확인 필요 | basket-actions basket-manual-task-option |
| app/basket-manual-link.js | 249 | 확인 필요 | basket-actions save-row |
| app/basket-notes.js | 104 | 확인 필요 | home-quick-placeholder |
| app/basket-notes.js | 141 | 확인 필요 | nx-row nx-folder${isPicked(key) ? ' nx-p |
| app/basket-notes.js | 153 | 확인 필요 | basket-row-item note-row-item nx-row nx- |
| app/basket-notes.js | 501 | 확인 필요 | basket-detail-head |
| app/basket.js | 81 | 확인 필요 | basket-head |
| app/basket.js | 236 | 확인 필요 | basket-ocr-text |
| app/basket.js | 598 | 확인 필요 | basket-row-item |
| app/basket.js | 819 | 확인 필요 | basket-detail-head |
| app/calendar-interactions-v2.js | 28 | 확인 필요 | modal hidden |
| app/call-feed.js | 203 | 확인 필요 | feed-warn |
| app/call-feed.js | 231 | 확인 필요 | feed-link-actions |
| app/call-feed.js | 242 | 확인 필요 | feed-link-actions |
| app/call-feed.js | 509 | 확인 필요 | feed-faint |
| app/choice-sheet.js | 48 | 확인 필요 | anchored-drag-title |
| app/collection-status.js | 266 | 확인 필요 | collect-alert-line |
| app/diary-list.js | 51 | 확인 필요 | diary-lv-star |
| app/diary-list.js | 128 | 확인 필요 |  |
| app/diary.js | 44 | 확인 필요 | diary-head |
| app/diary.js | 267 | 확인 필요 | diary-panel-head |
| app/diary.js | 583 | 확인 필요 | diary-actions save-row save-row-sticky |
| app/document-category-editor.js | 38 | 확인 필요 | dce-row dce-row-edit dce-row-sub |
| app/document-category-editor.js | 49 | 확인 필요 | ${cls} dce-row-edit |
| app/document-category-editor.js | 51 | 확인 필요 | ${cls} |
| app/feed-link.js | 24 | 확인 필요 | feed-link-actions |
| app/file-rename.js | 84 | 확인 필요 | fr-acts |
| app/files.js | 79 | 확인 필요 | fx-top |
| app/files.js | 658 | 확인 필요 | fx-pv-acts |
| app/files.js | 661 | 확인 필요 | fx-btn |
| app/files.js | 738 | 확인 필요 | fx-btn |
| app/files.js | 751 | 확인 필요 | fx-btn fx-danger |
| app/files.js | 755 | 확인 필요 | fx-bar-t |
| app/files.js | 758 | 확인 필요 | fx-btn fx-danger |
| app/files.js | 944 | 확인 필요 | fx-btn |
| app/files.js | 981 | 확인 필요 | fx-ask-opts |
| app/files.js | 1494 | 확인 필요 | fx-btn fx-pri |
| app/global-search.js | 601 | 확인 필요 |  |
| app/google-tasks.js | 76 | 확인 필요 | modal hidden |
| app/google-tasks.js | 322 | 확인 필요 | gt-row ${t.status==='completed'?'complet |
| app/google-tasks.js | 326 | 확인 필요 | gt-due |
| app/google-tasks.js | 534 | 확인 필요 | gt-row ${isDone(t)?'completed':'pending' |
| app/home-quick.js | 62 | 확인 필요 | home-quick-modes |
| app/hwp-convert.js | 59 | 확인 필요 | hwp-convert-foot |
| app/hwp-lab.js | 143 | 확인 필요 | primary |
| app/hwp-lab.js | 147 | 확인 필요 | hwp-conv-name |
| app/inbox-todos.js | 43 | 확인 필요 |  |
| app/inbox-todos.js | 95 | 확인 필요 | inbox-todo-link |
| app/inbox-todos.js | 99 | 확인 필요 | inbox-todo-edit |
| app/inbox-todos.js | 102 | 확인 필요 | inbox-todo-actions |
| app/journal-memorable.js | 110 | 확인 필요 | journal-memorable-edit |
| app/journal.js | 83 | 확인 필요 | journal-head |
| app/journal.js | 216 | 확인 필요 | journal-edit-meta |
| app/journal.js | 233 | 확인 필요 | mini |
| app/library-folders.js | 80 | 확인 필요 | modal hidden |
| app/library-upload.js | 410 | 확인 필요 | lu-row${luPick.items?' lu-row-picking':' |
| app/library-upload.js | 610 | 확인 필요 | icon-btn lu-expand |
| app/library-upload.js | 733 | 확인 필요 | lu-menu-key |
| app/library-upload.js | 743 | 확인 필요 | lu-menu-head |
| app/meeting-from-files.js | 43 | 확인 필요 | meeting-create-modes |
| app/meeting-recorder.js | 77 | 확인 필요 | rec-btn |
| app/meeting-recorder.js | 83 | 확인 필요 | rec-btn |
| app/meeting-recorder.js | 90 | 확인 필요 | rec-btn |
| app/meeting-recorder.js | 97 | 확인 필요 | rec-btn |
| app/meeting-recorder.js | 106 | 확인 필요 | rec-btn |
| app/meeting-recorder.js | 131 | 확인 필요 | rec-pending-text |
| app/meeting-round-detail.js | 51 | 확인 필요 | modal hidden |
| app/meeting-round-detail.js | 52 | 확인 필요 | optional |
| app/meeting-round-detail.js | 71 | 확인 필요 | gt-menu-danger |
| app/meeting-round-detail.js | 90 | 확인 필요 | gt-menu-danger |
| app/meeting-transcript-draft.js | 40 | 확인 필요 | mtd-actions |
| app/news-clipping.js | 146 | 확인 필요 | nc-memo |
| app/news-clipping.js | 147 | 확인 필요 | nc-memo |
| app/news-clipping.js | 560 | 확인 필요 |  |
| app/news-clipping.js | 595 | 확인 필요 | nc-faint |
| app/note-board.js | 20 | 확인 필요 | nb-tools |
| app/note-boards.js | 170 | 확인 필요 | basket-menu-danger |
| app/notice-done.js | 29 | 확인 필요 | kptu-notice-line-action |
| app/notice-lines.js | 30 | 확인 필요 | kptu-notice-line-action |
| app/notice-outside.js | 34 | 확인 필요 | kptu-notice-line-action |
| app/now-detail.js | 74 | 확인 필요 | nd-memo |
| app/now-interests.js | 74 | 확인 필요 | ni-row |
| app/now-interests.js | 76 | 확인 필요 | ni-row |
| app/now-row-acts.js | 15 | 확인 필요 | now-hov-btn |
| app/od-settings.js | 34 | 확인 필요 | diary-od-browse |
| app/org-dispute-stage-ui.js | 61 | 확인 필요 | wd-stage-hsub |
| app/org-dispute-stage-ui.js | 65 | 확인 필요 | wd-stage-hsub wd-stage-hform |
| app/org-dispute-stage-ui.js | 67 | 확인 필요 | wd-stage-hsub stg-confirm |
| app/org-dispute-stage-ui.js | 225 | 확인 필요 | stg-sub |
| app/org-dispute-stage-ui.js | 227 | 확인 필요 | stg-sub |
| app/org-dispute-stage-ui.js | 231 | 확인 필요 | stg-sub stg-confirm |
| app/org-dispute-stage-ui.js | 244 | 확인 필요 | stg-add |
| app/org-key-people.js | 124 | 확인 필요 | okp-menu |
| app/org-key-people.js | 232 | 확인 필요 | modal-action-footer |
| app/org-overview.js | 44 | 확인 필요 | so-team-tabs |
| app/org-overview.js | 132 | 맞음 | oa-bar btn-row |
| app/org-status-table.js | 100 | 맞음 | wd-st-actions btn-row |
| app/org-status-table.js | 123 | 맞음 | wd-st-bar btn-row |
| app/outside-statements.js | 548 | 확인 필요 |  |
| app/overlap-check.js | 19 | 확인 필요 |  |
| app/phone-recorder.js | 86 | 확인 필요 | rec-btn |
| app/phone-recorder.js | 115 | 확인 필요 | rec-pending-text |
| app/photo-grid-size.js | 65 | 확인 필요 | photo-size |
| app/photos.js | 100 | 확인 필요 | photos-bar |
| app/photos.js | 2467 | 확인 필요 | photos-album |
| app/project-system-v3.js | 320 | 확인 필요 | modal hidden |
| app/project-system-v3.js | 322 | 확인 필요 | modal hidden |
| app/project-system-v3.js | 324 | 확인 필요 | modal hidden |
| app/project-system-v3.js | 432 | 확인 필요 | ps3-record-danger |
| app/project-system-v3.js | 462 | 확인 필요 | ps3-pg-editor |
| app/project-system-v3.js | 576 | 확인 필요 | ps3-section ps3-content |
| app/project-system-v3.js | 580 | 확인 필요 | ps3-content-editor |
| app/project-system-v3.js | 598 | 확인 필요 | ps3-content-editor ps3-new-form |
| app/project-system-v3.js | 603 | 확인 필요 | ps3-content-actions |
| app/project-system-v3.js | 605 | 확인 필요 | ps3-content-actions |
| app/project-system-v3.js | 683 | 확인 필요 | ps3-more |
| app/quick-links.js | 285 | 확인 필요 |  |
| app/quick-links.js | 313 | 확인 필요 | ql-btn ql-remove |
| app/quick-links.js | 337 | 확인 필요 | ql-foot |
| app/reference-bundles.js | 78 | 확인 필요 | rb-row rb-order-row |
| app/reference-bundles.js | 82 | 확인 필요 | rb-actions |
| app/reference-bundles.js | 83 | 확인 필요 | rb-inline |
| app/reference-bundles.js | 90 | 확인 필요 | rb-inline |
| app/reference-bundles.js | 93 | 확인 필요 | rb-items |
| app/reference-bundles.js | 190 | 확인 필요 |  |
| app/reference-bundles.js | 192 | 확인 필요 | rb-menu-danger |
| app/report-summary-preview.js | 113 | 확인 필요 | biz-ai-edit |
| app/report-views.js | 20 | 확인 필요 | rv-cal-head |
| app/share-pages.js | 167 | 확인 필요 | task-inline-danger |
| app/share-pages.js | 168 | 확인 필요 | task-inline-danger |
| app/share-pages.js | 169 | 확인 필요 |  |
| app/share-pages.js | 170 | 확인 필요 | task-inline-danger |
| app/task-files.js | 115 | 확인 필요 | gt-file |
| app/task-files.js | 311 | 확인 필요 | gt-att-row |
| app/task-inline.js | 64 | 확인 필요 | task-due-quick |
| app/task-workflow.js | 15 | 확인 필요 | gt-check |
| app/task-workflow.js | 19 | 확인 필요 | gt-menu-danger |
| app/team.js | 226 | 확인 필요 | report-period-panel |
| app/team.js | 320 | 확인 필요 | toggle-line |
| app/team.js | 431 | 확인 필요 |  |
| app/telegram-feed.js | 224 | 확인 필요 | feed-vsw |
| app/telegram-feed.js | 225 | 확인 필요 | feed-chiprow |
| app/telegram-feed.js | 233 | 확인 필요 | feed-link-actions |
| app/telegram-feed.js | 237 | 확인 필요 | feed-link-actions |
| app/telegram-feed.js | 270 | 확인 필요 | feed-rd feed-r${roomTone(l.room_key)}${o |
| app/telegram-feed.js | 283 | 확인 필요 | feed-rd feed-r${roomTone(l.room_key)}${o |
| app/telegram-feed.js | 346 | 확인 필요 | feed-se |
| app/telegram-feed.js | 353 | 확인 필요 | feed-di${on ? ' is-open' : ''}${ask ? '  |
| app/telegram-feed.js | 443 | 확인 필요 | feed-link-actions |
| app/telegram-feed.js | 449 | 확인 필요 | feed-link-actions |
| app/telegram-feed.js | 457 | 확인 필요 | feed-link-actions |
| app/telegram-feed.js | 847 | 확인 필요 | feed-menu-danger |
| app/telegram-feed.js | 879 | 확인 필요 |  |
| app/telegram-feed.js | 906 | 확인 필요 | feed-menu-danger |
| app/time-photos.js | 86 | 확인 필요 | tp-pick |
| app/version-notice.js | 86 | 확인 필요 | kptu-notice-line-icon |
| app/workflow-ai-v3.js | 15 | 확인 필요 | modal hidden |
| app/workplace-detail.js | 121 | 확인 필요 | modal hidden |
| app/workplace-detail.js | 129 | 확인 필요 | wd-year |
| app/workplace-detail.js | 252 | 확인 필요 | basket-link-danger |
| app/workplace-detail.js | 259 | 확인 필요 | wd-up-editor |
| app/workplace-report.js | 23 | 확인 필요 | modal hidden |

합계 167줄, 확인 필요 164줄
