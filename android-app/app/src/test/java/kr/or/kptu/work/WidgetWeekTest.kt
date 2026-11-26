package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZonedDateTime

/** APP-위젯다시 ③: 이번 주 위젯(요일 칸·하루 목록, S69-07 시안 B 일정/할 일 구분·D-n 줄 없음), 허용 주소. */
class WidgetWeekTest {
    private fun at(y: Int, m: Int, d: Int, h: Int = 10, min: Int = 0) =
        ZonedDateTime.of(y, m, d, h, min, 0, 0, WidgetNow.ZONE).toInstant().toEpochMilli()

    // 2026-10-30(금) 10:00 서울
    private val now = at(2026, 10, 30)

    private fun body(vararg events: String) = MiniJson.parse("""{"events":[${events.joinToString(",")}]}""")
    private fun timed(title: String, start: String, end: String) = """{"title":"$title","start":"$start","end":"$end","allDay":false}"""
    private fun allDay(title: String, start: String, end: String) = """{"title":"$title","start":"$start","end":"$end","allDay":true}"""

    @Test
    fun weekRangeIsSundayToNextSundayLikeAppCalendar() {
        // S69-위젯일요일(11/24 사용자 "위젯이 일월화수목금토여야 돼"): 앱 달력 월 보기처럼 일요일 시작, 칸 순서 일 월 … 토.
        assertEquals("2026-10-24T15:00:00Z" to "2026-10-31T15:00:00Z", WidgetWeek.range(now))
        assertEquals("이번 주 10/25–10/31", WidgetWeek.header(now))
        assertEquals(LocalDate.of(2026, 10, 25), WidgetWeek.start(now))
        // 사용자 요청 그날: 2026-11-24(화) → 이번 주 11/22–11/28.
        val tue1124 = at(2026, 11, 24, 18, 54)
        assertEquals("이번 주 11/22–11/28", WidgetWeek.header(tue1124))
        assertEquals("2026-11-21T15:00:00Z" to "2026-11-28T15:00:00Z", WidgetWeek.range(tue1124))
        val days = WidgetWeek.content(200, body(), tue1124).days
        assertEquals(listOf("일", "월", "화", "수", "목", "금", "토"), days.map { it.week })
        assertEquals(listOf(22, 23, 24, 25, 26, 27, 28), days.map { it.date })
        assertEquals(WidgetWeek.Cell.TODAY, WidgetWeek.cell(days[2], LocalDate.of(2026, 11, 24), null))
        // 경계: 일요일 당일(0시·밤)은 그 주 첫 칸, 토요일 당일(밤 23:59)은 그 주 마지막 칸.
        val sun0 = at(2026, 11, 22, 0, 0)
        val sat = at(2026, 11, 28, 23, 59)
        assertEquals(WidgetWeek.range(tue1124), WidgetWeek.range(sun0))
        assertEquals(WidgetWeek.range(tue1124), WidgetWeek.range(sat))
        assertEquals(LocalDate.of(2026, 11, 22), WidgetWeek.start(sun0))
        assertEquals(LocalDate.of(2026, 11, 22), WidgetWeek.start(sat))
        assertEquals(LocalDate.of(2026, 11, 22), WidgetWeek.content(200, body(), sun0).days.first().day)
        assertEquals(LocalDate.of(2026, 11, 28), WidgetWeek.content(200, body(), sat).days.last().day)
        assertEquals(WidgetWeek.Cell.TODAY, WidgetWeek.cell(WidgetWeek.content(200, body(), sat).days.last(), LocalDate.of(2026, 11, 28), null))
        // 토요일 밤이 지나 일요일 0시가 되면 다음 주로.
        assertEquals("이번 주 11/29–12/5", WidgetWeek.header(at(2026, 11, 29, 0, 0)))
        assertEquals(LocalDate.of(2026, 11, 29), WidgetWeek.start(at(2026, 11, 29, 0, 0)))
        // 일요일만 일요일 색(앱 달력 .cal-head.sunday와 같은 규칙).
        assertEquals(listOf(true, false, false, false, false, false, false), days.map { WidgetWeek.isSunday(it.day) })
        // 같은 허용 주소 모양(google-calendar action=events)이다.
        val (a, b) = WidgetWeek.range(now)
        assertTrue(WidgetRules.allowed("GET", WidgetRules.calendarUrl(a, b)))
    }

    @Test
    fun sundayCellUsesAppCalendarSundayColor() {
        val src = java.io.File("src/main/java/kr/or/kptu/work/WeekWidget.kt").readText()
        assertTrue(src.contains("R.color.widget_sun_ink"))
        // 웹 앱 달력 일요일 색(kptu-danger)과 같은 값, 밝은·어두운 모드 모두.
        val want = mapOf("values" to "#B42318", "values-night" to "#F0918A")
        for ((dir, hex) in want) {
            val colors = java.io.File("src/main/res/$dir/colors.xml").readText()
            assertEquals(dir, hex, Regex("<color name=\"widget_sun_ink\">(#[0-9A-Fa-f]+)</color>").find(colors)!!.groupValues[1].uppercase())
        }
        val tokens = java.io.File("../../app/theme-tokens.css").readText()
        assertTrue(tokens.contains("--kptu-danger:#b42318") && tokens.contains("--kptu-danger:#f0918a"))
        val css = java.io.File("../../app/calendar-ui.css").readText()
        assertTrue(css.contains(".cal-head.sunday{color:var(--kptu-danger)}"))
        // 앱 달력 월 보기 머리도 일요일 시작.
        assertTrue(java.io.File("../../app/calendar-month-view.js").readText().contains("['일','월','화','수','목','금','토']"))
    }

    @Test
    fun shiftWeeksBackAndForthWithinLimit() {
        // ‹ ›: 지난주·다음 주, 그 밖은 날짜만. 범위는 ±MAX_SHIFT(8)주.
        assertEquals("지난주 10/18–10/24", WidgetWeek.header(now, shift = -1))
        assertEquals("다음 주 11/1–11/7", WidgetWeek.header(now, shift = 1))
        assertEquals("11/8–11/14", WidgetWeek.header(now, shift = 2))
        assertEquals("10/11–10/17", WidgetWeek.header(now, shift = -2))
        assertEquals("2026-10-31T15:00:00Z" to "2026-11-07T15:00:00Z", WidgetWeek.range(now, shift = 1))
        assertEquals("2026-10-17T15:00:00Z" to "2026-10-24T15:00:00Z", WidgetWeek.range(now, shift = -1))
        // 토요일에서 다음 주로 옮기면 다음 일요일부터.
        assertEquals(LocalDate.of(2026, 11, 1), WidgetWeek.start(at(2026, 10, 31, 23, 59), shift = 1))
        assertEquals(1, WidgetWeek.move(0, 1))
        assertEquals(-1, WidgetWeek.move(0, -1))
        assertEquals(0, WidgetWeek.move(1, -1))
        assertEquals(WidgetWeek.MAX_SHIFT, WidgetWeek.move(WidgetWeek.MAX_SHIFT, 1))
        assertEquals(-WidgetWeek.MAX_SHIFT, WidgetWeek.move(-WidgetWeek.MAX_SHIFT, -1))
        assertEquals(WidgetWeek.MAX_SHIFT, WidgetWeek.move(99, 0))
        assertFalse(WidgetWeek.canMove(WidgetWeek.MAX_SHIFT, 1))
        assertTrue(WidgetWeek.canMove(WidgetWeek.MAX_SHIFT, -1))
        assertFalse(WidgetWeek.canMove(-WidgetWeek.MAX_SHIFT, -1))
        assertTrue(WidgetWeek.canMove(0, 1) && WidgetWeek.canMove(0, -1))
        // 범위 밖 값은 끝으로(주소 범위도 끝 주).
        assertEquals(WidgetWeek.range(now, shift = WidgetWeek.MAX_SHIFT), WidgetWeek.range(now, shift = 50))
        // 옮긴 주는 그날에만. 자정을 지나 다시 그리면 이번 주(0)로 돌아온다(고른 날과 같은 방식).
        val fri = LocalDate.of(2026, 10, 30)
        assertEquals(2, WidgetWeek.shiftNow(2, fri, now))
        assertEquals(2, WidgetWeek.shiftNow(2, fri, at(2026, 10, 30, 23, 59)))
        assertEquals(0, WidgetWeek.shiftNow(2, fri, at(2026, 10, 31, 0, 0)))
        assertEquals(0, WidgetWeek.shiftNow(2, null, now))
        assertEquals(WidgetWeek.MAX_SHIFT, WidgetWeek.shiftNow(20, fri, now))
    }

    @Test
    fun shiftedWeekContentHasNoTodayAndKeepsPicked() {
        val next = WidgetWeek.content(
            200,
            body(
                timed("이번 주 회의", "2026-10-29T09:00:00+09:00", "2026-10-29T10:00:00+09:00"),
                timed("다음 주 교섭", "2026-11-03T14:00:00+09:00", "2026-11-03T16:00:00+09:00"),
            ),
            now,
            shift = 1,
        )
        assertEquals("다음 주 11/1–11/7", next.title)
        assertEquals(LocalDate.of(2026, 11, 1), next.sunday)
        assertEquals(listOf(0, 0, 1, 0, 0, 0, 0), next.days.map { it.count })
        assertEquals(1, next.total)
        val today = LocalDate.of(2026, 10, 30)
        // 다른 주로 옮기면 오늘 칸은 없다. 고른 날 음영은 옮긴 주에서도.
        assertTrue(next.days.none { WidgetWeek.cell(it, today, null) == WidgetWeek.Cell.TODAY })
        val tue = next.days[2]
        assertEquals(WidgetWeek.Cell.PICKED, WidgetWeek.cell(tue, today, tue.day))
        assertEquals(tue.day, WidgetWeek.active(tue.day, today, now, next.days))
        assertNull(WidgetWeek.active(tue.day, today, now, WidgetWeek.content(200, body(), now).days))
        // 지난주.
        val last = WidgetWeek.content(200, body(timed("교섭", "2026-10-20T14:00:00+09:00", "2026-10-20T17:00:00+09:00")), now, shift = -1)
        assertEquals("지난주 10/18–10/24", last.title)
        assertEquals(listOf(0, 0, 1, 0, 0, 0, 0), last.days.map { it.count })
        // 서버 할 일 요약 범위(오늘~6일 뒤) 밖 날은 0개로 보이지 않게 '할 일은 앱에서'. 범위 안 날은 그대로.
        val tasks = MiniJson.parse("""{"connected":true,"tasks":[{"title":"보고","due":"2026-11-05T00:00:00.000Z","status":"needsAction"}]}""")
        val withTasks = WidgetWeek.content(200, body(), now, tasksStatus = 200, tasks = tasks, shift = 1)
        val thu = withTasks.details.getValue(LocalDate.of(2026, 11, 5))
        assertEquals(1, thu.tasks)
        assertEquals("11/5(목)", WidgetWeek.detailHead(thu))
        // 일정이 없으면 일정 묶음 없이 할 일만(머리 위 가는 줄 없음).
        assertEquals(listOf(WidgetWeek.Row(WidgetWeek.Kind.TASK_HEAD, "할 일 1", false), WidgetWeek.Row(WidgetWeek.Kind.TASK, "보고")), WidgetWeek.dayRows(thu))
        val fri2 = withTasks.details.getValue(LocalDate.of(2026, 11, 6))
        assertTrue(fri2.beyond)
        assertEquals("11/6(금)", WidgetWeek.detailHead(fri2))
        assertEquals(listOf(WidgetWeek.Row(WidgetWeek.Kind.TASK_HEAD, "할 일은 앱에서", false)), WidgetWeek.dayRows(fri2))
        // 이번 주는 모두 범위 안.
        assertTrue(WidgetWeek.content(200, body(), now, tasksStatus = 200, tasks = tasks).details.values.none { it.beyond })
        // 실패해도 옮긴 주의 빈 칸·머리 줄.
        val down = WidgetWeek.content(0, null, now, shift = 2)
        assertEquals("11/8–11/14", down.title)
        assertEquals(LocalDate.of(2026, 11, 8), down.sunday)
    }

    @Test
    fun dayCellsCountEventsAndCarryOverFromLastWeek() {
        val c = WidgetWeek.content(
            200,
            body(
                timed("지난주 밤샘", "2026-10-24T22:00:00+09:00", "2026-10-25T02:00:00+09:00"),
                timed("아주 지난 회의", "2026-10-20T10:00:00+09:00", "2026-10-20T11:00:00+09:00"),
                allDay("출장", "2026-10-29", "2026-10-31"),
                timed("회의 1", "2026-10-29T09:00:00+09:00", "2026-10-29T10:00:00+09:00"),
                timed("회의 2", "2026-10-29T13:00:00+09:00", "2026-10-29T14:00:00+09:00"),
                timed("다음 주 일", "2026-11-01T09:00:00+09:00", "2026-11-01T10:00:00+09:00"),
            ),
            now,
        )
        assertEquals(listOf("일", "월", "화", "수", "목", "금", "토"), c.days.map { it.week })
        assertEquals(listOf(25, 26, 27, 28, 29, 30, 31), c.days.map { it.date })
        assertEquals(listOf(1, 0, 0, 0, 3, 0, 0), c.days.map { it.count })
        assertEquals(4, c.total)
        // APP-위젯먹색 S68-06: 그날 첫 일정 제목(종일 먼저·시각 순 = 고른 날 아래 칸 첫 일정). 지난주(토)에서 이어진 일정은 일요일 첫 일정.
        assertEquals(listOf("지난주 밤샘", null, null, null, "출장", null, null), c.days.map { it.first })
        assertEquals("출장", WidgetWeek.firstLine(c.days[4], small = false))
        assertNull(WidgetWeek.firstLine(c.days[4], small = true)) // 4×1은 지금처럼 수만
        assertNull(WidgetWeek.firstLine(c.days[1], small = false)) // 일정 없는 날은 줄을 숨김
        assertNull(c.note)
    }

    @Test
    fun noUpcomingOrReportLinesAndNoBusySummary() {
        // S69-07(11/24 사용자 "디마이너스 1 디마이너스 2 뭐 이런 건 안 해도 돼"): 목록 끝 'D-n'·'월 보고일' 줄은 없다.
        val c = WidgetWeek.content(
            200,
            body(
                allDay("당직", "2026-10-31", "2026-11-01"),
                timed("궤도 대표자회의", "2026-10-31T10:00:00+09:00", "2026-10-31T12:00:00+09:00"),
                timed("저녁 모임", "2026-10-31T18:00:00+09:00", "2026-10-31T20:00:00+09:00"),
                timed("파업선포 기자회견", "2026-11-01T10:30:00+09:00", "2026-11-01T11:30:00+09:00"),
            ),
            now,
        )
        val sat = c.details.getValue(LocalDate.of(2026, 10, 31))
        val rows = WidgetWeek.dayRows(sat)
        // S68-51: 일정이 몰려도 요약 줄 없이 전부 시간순(종일 먼저). 할 일을 못 읽었으면 머리 자리에 '할 일 읽지 못함'.
        assertEquals(listOf("종일  당직", "10:00  궤도 대표자회의", "18:00  저녁 모임", "할 일 읽지 못함"), rows.map { it.text })
        for (d in c.details.values) {
            for (r in WidgetWeek.dayRows(d)) {
                assertFalse(r.text, Regex("^(D-\\d+|오늘|월)  ").containsMatchIn(r.text) || r.text.contains("보고일") || r.text.contains("몰림"))
            }
        }
        val src = java.io.File("src/main/java/kr/or/kptu/work/WidgetWeek.kt").readText() + java.io.File("src/main/java/kr/or/kptu/work/WeekWidget.kt").readText()
        assertFalse(src.contains("\"외 \$") || src.contains("const val BUSY") || src.contains("busyPick"))
        for (gone in listOf("BIG_WORDS", "fun big(", "fun dTag(", "fun reportLabel(", "class Pick(", "c.big", "c.report", "보고일\"")) {
            assertFalse(gone, src.contains(gone))
        }
        assertFalse(java.io.File("src/main/res/layout/week_widget.xml").readText().contains("week_busy"))
    }

    @Test
    fun failuresKeepEmptyCells() {
        val bad = WidgetWeek.content(500, null, now)
        assertEquals("일정 연결을 확인해 주세요", bad.note)
        assertEquals(7, bad.days.size)
        assertEquals(0, bad.total)
        assertEquals("일정을 읽지 못했어요", WidgetWeek.content(200, MiniJson.parse("""{"events":[],"warning":"x"}"""), now).note)
        assertNull(WidgetWeek.content(200, MiniJson.parse("""{"events":[]}"""), now).note)
    }

    @Test
    fun pickedDayShowsAndResetsOnNewDay() {
        val c = WidgetWeek.content(200, body(), now)
        val fri = LocalDate.of(2026, 10, 30)
        val tue = LocalDate.of(2026, 10, 27)
        val today = LocalDate.of(2026, 10, 30)
        assertEquals(fri, WidgetWeek.active(fri, today, now, c.days))
        // S68-51: 아래 목록은 늘 하루. 고른 날 → 오늘 → (다른 주) 일요일. 같은 날을 다시 눌러도 그대로(풀리지 않음).
        assertEquals(tue, WidgetWeek.shownDay(WidgetWeek.active(tue, today, now, c.days), today, c.days))
        assertEquals(today, WidgetWeek.shownDay(null, today, c.days))
        val next = WidgetWeek.content(200, body(), now, shift = 1)
        assertEquals(LocalDate.of(2026, 11, 1), WidgetWeek.shownDay(null, today, next.days))
        assertEquals(WidgetWeek.Cell.PICKED, WidgetWeek.cell(c.days[2], today, tue))
        assertEquals(WidgetWeek.Cell.TODAY, WidgetWeek.cell(c.days[5], today, tue)) // 오늘 표시는 그대로
        // 날이 바뀌면(고른 날짜가 오늘이 아님) 기본 날(오늘)로.
        assertNull(WidgetWeek.active(fri, today, at(2026, 10, 31, 0, 1), c.days))
        // 보이는 주 밖의 날은 무시.
        assertNull(WidgetWeek.active(LocalDate.of(2026, 11, 3), today, now, c.days))
        assertNull(WidgetWeek.active(null, today, now, c.days))
    }

    @Test
    fun tapCarriesItsWeekSoPickWorksAfterMemoryLoss() {
        // S68-51 원인: 받은 내용(메모리)이 없으면 누름을 버렸다. 이제 누름에 실린 일요일로 주를 되찾고 그 날을 고른다.
        assertEquals(0, WidgetWeek.shiftOf(LocalDate.of(2026, 10, 25), now))
        assertEquals(1, WidgetWeek.shiftOf(LocalDate.of(2026, 11, 1), now))
        assertEquals(-2, WidgetWeek.shiftOf(LocalDate.of(2026, 10, 11), now))
        assertEquals(WidgetWeek.MAX_SHIFT, WidgetWeek.shiftOf(LocalDate.of(2026, 10, 25).plusWeeks(8), now))
        assertNull(WidgetWeek.shiftOf(LocalDate.of(2026, 10, 25).plusWeeks(9), now)) // 범위 밖
        assertNull(WidgetWeek.shiftOf(LocalDate.of(2026, 10, 26), now)) // 일요일 아님(옛 판이 실은 월요일도 버리고 메모리의 주로)
        assertNull(WidgetWeek.shiftOf(null, now))
        // 어제 그려진 칸을 오늘 눌러도(주가 바뀜) 그 주 안의 날이면 그대로 고른다.
        assertEquals(-1, WidgetWeek.shiftOf(LocalDate.of(2026, 10, 25), at(2026, 11, 1, 0, 5)))
        assertTrue(WidgetWeek.dayInWeek(LocalDate.of(2026, 11, 7), LocalDate.of(2026, 11, 1)))
        assertFalse(WidgetWeek.dayInWeek(LocalDate.of(2026, 11, 8), LocalDate.of(2026, 11, 1)))
        assertFalse(WidgetWeek.dayInWeek(null, LocalDate.of(2026, 11, 1)))
        // ‹ ›로 옮긴 주의 날 누름: 그 주 내용에서 고른 날이 살아 있고 목록이 그 날이다.
        val next = WidgetWeek.content(200, body(timed("다음 주 일", "2026-11-04T09:00:00+09:00", "2026-11-04T10:00:00+09:00")), now, shift = 1)
        val wed = LocalDate.of(2026, 11, 4)
        val active = WidgetWeek.active(wed, LocalDate.of(2026, 10, 30), now, next.days)
        assertEquals(wed, WidgetWeek.shownDay(active, LocalDate.of(2026, 10, 30), next.days))
        // 다음 주(서버 할 일 범위 안 수요일)에 할 일 0개면 할 일 머리·줄 모두 없음.
        assertEquals(listOf(WidgetWeek.Row(WidgetWeek.Kind.EVENT, "09:00  다음 주 일")), WidgetWeek.dayRows(next.details.getValue(wed).copy(tasks = 0)))

        val src = java.io.File("src/main/java/kr/or/kptu/work/WeekWidget.kt").readText()
        val pick = src.substringAfter("private fun pick(").substringBefore("\n        }\n")
        // 누름은 메모리 내용 유무와 상관없이 고른 날을 적고, 그린 상태가 없으면 '불러오는 중' + 다시 읽기(redraw).
        assertFalse(pick, pick.contains("last["))
        assertTrue(pick, pick.contains("picked = day") && pick.contains("redraw(context)"))
        val redraw = src.substringAfter("private fun redraw(").substringBefore("\n        }\n")
        assertTrue(redraw, redraw.contains("State.Loading") && redraw.contains("WidgetJobs.refreshNow(context)"))
        // 요일 칸·화살표 누름에 그 주 일요일을 싣는다.
        assertTrue(src.contains(".putExtra(EXTRA_DAY, day.toString()).putExtra(EXTRA_SUNDAY, sunday.toString())"))
        assertTrue(src.contains(".putExtra(EXTRA_DELTA, delta).putExtra(EXTRA_SUNDAY, sunday.toString())"))
        // 불러오는 중(받은 내용 없음)에는 고른 날을 풀지 않는다.
        assertTrue(src.contains("if (!small && shown != null && active == null && v.picked != null)"))
    }

    @Test
    fun listShowsEverythingScrollable() {
        val src = java.io.File("src/main/java/kr/or/kptu/work/WeekWidget.kt").readText()
        // 12+는 줄을 그림에 싣고(RemoteCollectionItems), 11 이하는 메모리만 읽는 서비스. 줄 수 제한 없음.
        assertTrue(src.contains("RemoteViews.RemoteCollectionItems.Builder()"))
        assertTrue(src.contains("val rows = WidgetWeek.dayRows(d)"))
        assertTrue(src.contains("setViewTypeCount(ROW_TYPES)"))
        val svc = java.io.File("src/main/java/kr/or/kptu/work/WeekListService.kt").readText()
        assertFalse(svc.contains("SharedPreferences") || svc.contains("openFileOutput"))
        val manifest = java.io.File("src/main/AndroidManifest.xml").readText()
        val entry = manifest.substringAfter("android:name=\".WeekListService\"").substringBefore("/>")
        assertTrue(entry, entry.contains("android:exported=\"false\"") && entry.contains("android.permission.BIND_REMOTEVIEWS"))
        val row = java.io.File("src/main/res/layout/week_widget_row.xml").readText()
        assertTrue(row.contains("@+id/week_row"))
        // 11 이하 길도 같은 줄 그리기(종류마다 레이아웃)와 같은 종류 수.
        assertTrue(svc.contains("WeekWidget.rowView(context,") && svc.contains("WeekWidget.ROW_TYPES"))
        // S69-07 시안 B: 할 일 머리(가는 줄 + 작은 회색 글), 할 일 줄(앞에 빈 네모).
        val head = java.io.File("src/main/res/layout/week_widget_task_head.xml").readText()
        assertTrue(head.contains("@+id/week_row_line") && head.contains("@color/widget_line") && head.contains("@color/widget_muted") && head.contains("11sp"))
        val task = java.io.File("src/main/res/layout/week_widget_task_row.xml").readText()
        assertTrue(task.contains("@+id/week_row") && task.contains("@drawable/widget_task_box"))
        val box = java.io.File("src/main/res/drawable/widget_task_box.xml").readText()
        assertTrue(box.contains("<stroke") && box.contains("transparent"))
    }

    @Test
    fun dayDetailListsEventsThenDueTasks() {
        val tasks = MiniJson.parse(
            """{"connected":true,"needs_reconnect":false,"tasks":[
            {"title":"보고서","due":"2026-10-29T00:00:00.000Z","status":"needsAction"},
            {"title":"끝낸 일","due":"2026-10-29T00:00:00.000Z","status":"completed"},
            {"title":"기한 없음","status":"needsAction"},
            {"title":"이상한 기한","due":"x","status":"needsAction"}]}""",
        )
        val c = WidgetWeek.content(
            200,
            body(
                allDay("출장", "2026-10-29", "2026-10-31"),
                timed("회의 2", "2026-10-29T13:00:00+09:00", "2026-10-29T14:00:00+09:00"),
                timed("회의 1", "2026-10-29T09:00:00+09:00", "2026-10-29T10:00:00+09:00"),
            ),
            now,
            tasksStatus = 200,
            tasks = tasks,
        )
        val thu = c.details.getValue(LocalDate.of(2026, 10, 29))
        assertEquals(listOf(WidgetWeek.Item("종일", "출장"), WidgetWeek.Item("09:00", "회의 1"), WidgetWeek.Item("13:00", "회의 2")), thu.items)
        assertEquals(listOf("보고서"), thu.todos)
        assertEquals("10/29(목)", WidgetWeek.detailHead(thu))
        // 칸 숫자(일정 수)와 머리 줄 일정 수가 같다.
        assertEquals(c.days.first { it.day == thu.day }.count, thu.events)
        // S69-07 시안 B: 일정(시각 + 제목) → 가는 줄 + '할 일 1' 머리 → 빈 네모 + 제목(줄마다 '할 일' 글자 없음).
        assertEquals(
            listOf(
                WidgetWeek.Row(WidgetWeek.Kind.EVENT, "종일  출장"),
                WidgetWeek.Row(WidgetWeek.Kind.EVENT, "09:00  회의 1"),
                WidgetWeek.Row(WidgetWeek.Kind.EVENT, "13:00  회의 2"),
                WidgetWeek.Row(WidgetWeek.Kind.TASK_HEAD, "할 일 1", true),
                WidgetWeek.Row(WidgetWeek.Kind.TASK, "보고서"),
            ),
            WidgetWeek.dayRows(thu),
        )
        // 할 일 0개면 머리·줄 모두 없음, 둘 다 0개면 '일정·할 일 없음' 한 줄.
        val wed = c.details.getValue(LocalDate.of(2026, 10, 28))
        assertEquals(listOf(WidgetWeek.Row(WidgetWeek.Kind.EMPTY, "일정·할 일 없음")), WidgetWeek.dayRows(wed))
        // 일정만 있고 할 일 0개면 일정 줄만(머리·가는 줄 없음).
        assertEquals(thu.items.size, WidgetWeek.dayRows(thu.copy(tasks = 0, todos = emptyList())).size)
        assertTrue(WidgetWeek.dayRows(thu.copy(tasks = 0, todos = emptyList())).all { it.kind == WidgetWeek.Kind.EVENT })
        assertTrue(WidgetWeek.dayRows(thu).none { it.text.startsWith("할 일  ") })
        assertEquals(7, c.details.size)
        // 할 일 연결이 없거나 다시 연결이 필요하면 할 일 수는 '읽지 못함'(null), 일정은 그대로.
        val off = WidgetWeek.content(200, body(), now, tasksStatus = 200, tasks = MiniJson.parse("""{"connected":false,"tasks":[]}"""))
        assertNull(off.details.getValue(LocalDate.of(2026, 10, 29)).tasks)
        val again = WidgetWeek.content(200, body(), now, tasksStatus = 200, tasks = MiniJson.parse("""{"connected":true,"needs_reconnect":true,"tasks":[]}"""))
        assertNull(again.details.getValue(LocalDate.of(2026, 10, 29)).tasks)
        assertNull(WidgetWeek.content(200, body(), now).details.getValue(LocalDate.of(2026, 10, 29)).tasks)
    }

    @Test
    fun bigWidgetPicksInsideWidgetSmallOpensApp() {
        val src = java.io.File("src/main/java/kr/or/kptu/work/WeekWidget.kt").readText()
        // 4×2 요일 칸은 이 위젯에만 가는 방송(앱을 열지 않음), 4×1은 지금처럼 앱 그 날. [열기]만 앱 그 날.
        assertTrue(src.contains("if (small) day(context, d.day, i + 1) else pickIntent(context, id, d.day, sunday, i)"))
        assertTrue(src.contains("Intent(context, WeekWidget::class.java).setAction(ACTION_PICK)"))
        assertTrue(src.contains("views.setOnClickPendingIntent(R.id.week_sel_open, day(context, d.day, 11))"))
        // 고른 날짜는 메모리에만(폰 저장 없음, W-D2).
        assertFalse(src.contains("SharedPreferences") || src.contains("getSharedPreferences") || src.contains("openFileOutput"))
        // 요일 칸 바탕은 보통·고른 날 둘뿐, 모두 누를 때 물결, 고른 날 칸은 옅은 테마색. 몰린 날·가장 큰 일 날 색칠은 없다(APP-주간위젯평등).
        assertFalse(src.contains("widget_day_hot") || src.contains("widget_day_busy"))
        assertFalse(java.io.File("src/main/res/drawable/widget_day_hot.xml").exists() || java.io.File("src/main/res/drawable/widget_day_busy.xml").exists())
        for (n in listOf("plain", "pick")) {
            val xml = java.io.File("src/main/res/drawable/widget_day_$n.xml").readText()
            assertTrue(n, xml.contains("<ripple") && xml.contains("@color/widget_press"))
        }
        // S68-12: 고른 날 음영은 바탕과 또렷이 다른 먹색 톤(widget_pick_bg) + 얇은 테두리.
        val pickXml = java.io.File("src/main/res/drawable/widget_day_pick.xml").readText()
        assertTrue(pickXml.contains("@color/widget_pick_bg") && pickXml.contains("@color/widget_pick_line"))
        val big = java.io.File("src/main/res/layout/week_widget.xml").readText()
        for (id in listOf("week_sel", "week_sel_title", "week_sel_open", "week_sel_list")) assertTrue(id, big.contains("@+id/$id\""))
        // S68-51: 줄 셋 고정 칸·주간 요약 줄을 없애고 스크롤 목록(ListView) 하나.
        for (id in listOf("week_sel_i0", "week_big", "week_rep", "week_busy")) assertFalse(id, big.contains("@+id/$id\""))
        assertTrue(big.contains("<ListView"))
    }

    @Test
    fun dayAddressAndMessage() {
        val d = LocalDate.of(2026, 11, 1)
        assertEquals("https://workonplus.com/work/app/?view=calendar&day=2026-11-01", WidgetWeek.dayUrl(d))
        assertTrue(ShellRules.isInternalApp(WidgetWeek.dayUrl(d)))
        assertEquals("day:open:2026-11-01", WidgetWeek.dayMessage(d))
        assertEquals(d, WidgetWeek.parseDay("2026-11-01"))
        assertNull(WidgetWeek.parseDay("2026-02-30"))
        assertNull(WidgetWeek.parseDay("2026-11-01&view=x"))
        assertNull(WidgetWeek.parseDay(null))
    }

    @Test
    fun candidatesAddressIsNoLongerRead() {
        // S68-13(11/22 사용자): 처리 전 후보는 '지금' 위젯만 읽었다. 위젯과 함께 허용 목록에서 뺐다(어떤 방식도 안 됨).
        val url = "https://xmlkxfjeagycwttklxjw.supabase.co/rest/v1/app_todo_candidates?status=eq.open&select=source_kind,summary&order=created_at.desc&limit=100"
        assertFalse(WidgetRules.allowed("GET", url))
        assertFalse(WidgetRules.allowed("POST", url))
        assertFalse(WidgetRules.allowed("PATCH", url))
        assertFalse(WidgetRules.allowed("GET", "https://xmlkxfjeagycwttklxjw.supabase.co/rest/v1/app_todo_candidates"))
        // 텔레그램 읽기는 위젯과 함께 지웠다. S68-02: 기능 목록은 보고일 이름·앱 폴더 이름(nojo_words)에만 GET 하나(POST 없음).
        assertFalse(WidgetRules.allowed("POST", "https://xmlkxfjeagycwttklxjw.supabase.co/rest/v1/rpc/app_my_features"))
        assertTrue(WidgetRules.allowed("GET", "https://xmlkxfjeagycwttklxjw.supabase.co/rest/v1/rpc/app_my_features"))
        assertFalse(WidgetRules.allowed("GET", "https://xmlkxfjeagycwttklxjw.supabase.co/rest/v1/rpc/app_my_features?select=*"))
    }

    @Test
    fun firstLineAndTodayCell() {
        // APP-위젯먹색 S68-06: 첫 일정 줄은 공백만인 제목이면 숨기고, 오늘 칸은 고른 날보다 먼저(먹색 바탕).
        val today = LocalDate.of(2026, 10, 30)
        val d = WidgetWeek.Day(today, "금", 30, 2, "  운영위 회의  ")
        assertEquals("운영위 회의", WidgetWeek.firstLine(d, small = false))
        assertNull(WidgetWeek.firstLine(d.copy(first = "   "), small = false))
        assertNull(WidgetWeek.firstLine(d.copy(count = 0), small = false))
        assertEquals(WidgetWeek.Cell.TODAY, WidgetWeek.cell(d, today, null))
        // S68-12: 오늘을 고르면 오늘 표시가 앞서고 음영이 겹친다(따로 구분되는 칸).
        assertEquals(WidgetWeek.Cell.TODAY_PICKED, WidgetWeek.cell(d, today, today))
        val tue = d.copy(day = LocalDate.of(2026, 10, 27))
        assertEquals(WidgetWeek.Cell.PICKED, WidgetWeek.cell(tue, today, tue.day))
        assertEquals(WidgetWeek.Cell.PLAIN, WidgetWeek.cell(tue, today, null))
        // 실패·로그인 전 빈 칸(fallback)에는 첫 일정이 없다.
        assertTrue(WidgetWeek.content(0, null, now).days.all { it.first == null })
        // 화면: 4×2 틀에만 첫 일정 줄 7개, 4×1 틀에는 없다(새 서버 주소 없음 — 같은 일정 답에서 만든다).
        val big = java.io.File("src/main/res/layout/week_widget.xml").readText()
        val small = java.io.File("src/main/res/layout/week_widget_small.xml").readText()
        for (i in 0..6) {
            assertTrue(big.contains("@+id/week_f$i\""))
            assertFalse(small.contains("@+id/week_f$i\""))
        }
        val src = java.io.File("src/main/java/kr/or/kptu/work/WeekWidget.kt").readText()
        assertTrue(src.contains("WidgetWeek.Cell.TODAY -> R.drawable.widget_day_today"))
        assertTrue(src.contains("R.color.widget_today_ink"))
        val todayXml = java.io.File("src/main/res/drawable/widget_day_today.xml").readText()
        assertTrue(todayXml.contains("<ripple") && todayXml.contains("@color/widget_today_bg"))
        assertTrue(src.contains("WidgetWeek.Cell.TODAY_PICKED -> R.drawable.widget_day_today_pick"))
        val bothXml = java.io.File("src/main/res/drawable/widget_day_today_pick.xml").readText()
        assertTrue(bothXml.contains("@color/widget_today_bg") && bothXml.contains("@color/widget_pick_bg"))
        // 고른 날 음영 색은 밝은·어두운 모드 모두 있고, 바탕색과 다르다.
        for (dir in listOf("values", "values-night")) {
            val colors = java.io.File("src/main/res/$dir/colors.xml").readText()
            fun color(name: String) = Regex("<color name=\"$name\">(#[0-9A-Fa-f]+)</color>").find(colors)!!.groupValues[1]
            assertFalse(dir, color("widget_pick_bg").equals(color("widget_bg"), ignoreCase = true))
            assertFalse(dir, color("widget_pick_bg").equals(color("widget_todo_bg"), ignoreCase = true))
        }
    }

    @Test
    fun headerArrowsMoveWeekOnlyOnBigWidget() {
        // 4×2 머리 줄 양끝 ‹ ›(S68-22: 26sp·누르는 자리 40×36dp), 4×1 틀에는 없다(이번 주 고정).
        assertTrue(Regex("""android:id="@\+id/week_prev"[^>]*android:textSize="26sp"""").containsMatchIn(java.io.File("src/main/res/layout/week_widget.xml").readText()))
        val big = java.io.File("src/main/res/layout/week_widget.xml").readText()
        val small = java.io.File("src/main/res/layout/week_widget_small.xml").readText()
        for (id in listOf("week_prev", "week_next")) {
            assertTrue(id, big.contains("@+id/$id\""))
            assertFalse(id, small.contains("@+id/$id\""))
        }
        val src = java.io.File("src/main/java/kr/or/kptu/work/WeekWidget.kt").readText()
        assertTrue(src.contains("val shift = if (small) 0 else shiftOf(id, now)"))
        assertTrue(src.contains("arrow(context, views, R.id.week_prev, id, shift, -1, sunday, now)"))
        assertTrue(src.contains("arrow(context, views, R.id.week_next, id, shift, 1, sunday, now)"))
        // 옮긴 주에서 머리 글자를 누르면 이번 주로(앱을 열지 않음), 이번 주에서는 지금처럼 앱 달력.
        assertTrue(src.contains("if (shift == 0) day(context, null, 0) else shiftIntent(context, id, 0, sunday, null)"))
        // 위젯마다(번호) 따로, 메모리에만. 옮기면 같은 일정 주소를 범위만 바꿔 읽는다.
        assertTrue(src.contains("putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)"))
        assertTrue(src.contains("manager.updateAppWidget(id, rv)"))
    }

    /**
     * S69-78(11/24 사용자 "지난주 갔다가 > 누르면 이번주를 건너뛰고 다음주로 감"): ‹ ›는 지금 보이는 주에서 한 칸.
     * 위젯 한 번 그리기 = 4×2 틀과 4×1 틀을 모두 그린다(HomeWidgets.sized). 누름 보관함은 PendingIntent처럼 data 주소가 열쇠이고
     * 같은 주소로 다시 만들면 실린 값이 덮인다(FLAG_UPDATE_CURRENT).
     */
    private class Launcher(val now: Long, val id: Int = 7) {
        var memory: Int? = null
        val store = HashMap<String, Pair<Int, LocalDate?>>() // data → (delta, to)
        val bound = HashMap<Int, String>() // 화살표(delta) → 지금 그림에 묶인 data

        fun draw() {
            val shift = memory ?: 0
            // 4×2 틀
            for (delta in listOf(-1, 1)) {
                val to = WidgetWeek.arrowTo(shift, delta, now)
                if (to == null) bound.remove(delta) else {
                    val data = WidgetWeek.shiftData(id, delta, to)
                    store[data] = delta to to
                    bound[delta] = data
                }
            }
            // 4×1 틀: 화살표 누름을 만들지 않는다(이번 주로 덮던 원인).
        }

        fun press(delta: Int) {
            val (d, to) = store.getValue(bound.getValue(delta))
            memory = WidgetWeek.shiftTarget(to, WidgetWeek.start(now, shift = memory ?: 0), d, memory, now)
            draw()
        }

        fun title() {
            memory = WidgetWeek.shiftTarget(null, WidgetWeek.start(now, shift = memory ?: 0), 0, memory, now)
            draw()
        }
    }

    @Test
    fun arrowsMoveOneWeekFromShownWeek() {
        fun run(vararg steps: Int): Int? = Launcher(now).apply { draw(); steps.forEach { press(it) } }.memory
        assertEquals(0, run(-1, 1))
        assertEquals(0, run(1, -1))
        assertEquals(-1, run(-1, -1, 1))
        assertEquals(2, run(1, 1))
        assertEquals(1, run(-1, 1, 1))
        // 머리 글자 = 이번 주
        val l = Launcher(now).apply { draw(); press(-1); press(-1) }
        l.title()
        assertEquals(0, l.memory)
        // 범위 끝에서는 화살표를 숨긴다
        val far = Launcher(now).apply { draw(); repeat(WidgetWeek.MAX_SHIFT) { press(1) } }
        assertEquals(WidgetWeek.MAX_SHIFT, far.memory)
        assertNull(far.bound[1])

        // 다시 그릴 때마다 화살표에 지금 주 ± 1이 실린다.
        val w = Launcher(now).apply { draw(); press(-1) }
        assertEquals(LocalDate.of(2026, 10, 25), w.store.getValue(w.bound.getValue(1)).second) // 지난주에서 › = 이번 주
        assertEquals(LocalDate.of(2026, 10, 11), w.store.getValue(w.bound.getValue(-1)).second)
        // 주가 다르면 누름 주소도 달라 서로 덮지 않는다.
        assertTrue(WidgetWeek.shiftData(7, 1, LocalDate.of(2026, 10, 25)) != WidgetWeek.shiftData(7, 1, LocalDate.of(2026, 11, 1)))
    }

    @Test
    fun arrowPressSurvivesMemoryLossAndOldVersions() {
        // 메모리를 잃어도(프로세스 내려감) 누름에 실린 대상 주로 옮긴다.
        val l = Launcher(now).apply { draw(); press(-1) }
        l.memory = null
        val (d, to) = l.store.getValue(l.bound.getValue(1))
        assertEquals(0, WidgetWeek.shiftTarget(to, LocalDate.of(2026, 10, 18), d, null, now))
        // 옛 판 누름(대상 주 없음): 위젯 기억에서 한 칸, 기억이 없으면 실린 일요일에서 한 칸.
        assertEquals(0, WidgetWeek.shiftTarget(null, LocalDate.of(2026, 10, 25), 1, -1, now))
        assertEquals(0, WidgetWeek.shiftTarget(null, LocalDate.of(2026, 10, 18), 1, null, now))
        assertEquals(1, WidgetWeek.shiftTarget(null, null, 1, null, now))
        // 옛 월요일 판 누름은 이번 주로.
        assertEquals(0, WidgetWeek.shiftTarget(null, LocalDate.of(2026, 10, 26), 1, null, now))
        assertEquals(0, WidgetWeek.shiftTarget(null, LocalDate.of(2026, 10, 19), -1, -1, now))
        // 범위 밖 대상 주는 버리고 기억에서.
        assertEquals(-1, WidgetWeek.shiftTarget(LocalDate.of(2026, 10, 25).plusWeeks(20), LocalDate.of(2026, 10, 25), -1, 0, now))
        // 첫 화면은 이번 주 + 오늘 칸.
        val first = Launcher(now).apply { draw() }
        assertNull(first.memory)
        val c = WidgetWeek.content(200, body(), now, shift = first.memory ?: 0)
        assertEquals(LocalDate.of(2026, 10, 25), c.sunday)
        assertEquals(LocalDate.of(2026, 10, 30), WidgetWeek.shownDay(null, WidgetWeek.today(now), c.days))
        // 소스: 4×1 틀은 화살표를 만들지 않고, 누름에 대상 주를 싣는다.
        val src = java.io.File("src/main/java/kr/or/kptu/work/WeekWidget.kt").readText()
        assertTrue(src.contains("if (!small) {\n                arrow(context, views, R.id.week_prev"))
        assertTrue(src.contains("to?.let { intent.putExtra(EXTRA_TO, it.toString()) }"))
        assertTrue(src.contains("Uri.parse(WidgetWeek.shiftData(id, delta, to))"))
        assertTrue(src.contains("WidgetWeek.shiftTarget(to, sunday, delta, memory, now)"))
    }
}
