package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZonedDateTime

/** APP-위젯다시 ③: 이번 주 위젯(요일 칸·가장 큰 일·상집 보고일·몰린 날), 허용 주소. */
class WidgetWeekTest {
    private fun at(y: Int, m: Int, d: Int, h: Int = 10, min: Int = 0) =
        ZonedDateTime.of(y, m, d, h, min, 0, 0, WidgetNow.ZONE).toInstant().toEpochMilli()

    // 2026-10-30(금) 10:00 서울
    private val now = at(2026, 10, 30)

    private fun body(vararg events: String) = MiniJson.parse("""{"events":[${events.joinToString(",")}]}""")
    private fun timed(title: String, start: String, end: String) = """{"title":"$title","start":"$start","end":"$end","allDay":false}"""
    private fun allDay(title: String, start: String, end: String) = """{"title":"$title","start":"$start","end":"$end","allDay":true}"""

    @Test
    fun weekRangeIsMondayToNextMondayAndWeekendStaysThisWeek() {
        assertEquals("2026-10-25T15:00:00Z" to "2026-11-01T15:00:00Z", WidgetWeek.range(now))
        assertEquals("이번 주 10/26–11/1", WidgetWeek.header(now))
        // APP-이번주위젯 S68-12: 토·일에도 오늘이 든 이번 주(10/26–11/1). 다음 주로 넘기지 않는다.
        val saturday = at(2026, 10, 31)
        val sunday = at(2026, 11, 1, 23, 59)
        assertEquals("2026-10-25T15:00:00Z" to "2026-11-01T15:00:00Z", WidgetWeek.range(saturday))
        assertEquals(WidgetWeek.range(saturday), WidgetWeek.range(sunday))
        assertEquals("이번 주 10/26–11/1", WidgetWeek.header(sunday))
        assertEquals(LocalDate.of(2026, 10, 26), WidgetWeek.start(sunday))
        // 명진 11/22(일) 캡처 그날: 이번 주 11/16–11/22, 오늘(22일)이 칸 안에 있고 오늘 칸이다.
        val s1122 = at(2026, 11, 22, 14, 15)
        assertEquals("이번 주 11/16–11/22", WidgetWeek.header(s1122))
        val days = WidgetWeek.content(200, body(), s1122).days
        assertEquals(LocalDate.of(2026, 11, 22), days.last().day)
        assertEquals(WidgetWeek.Cell.TODAY, WidgetWeek.cell(days.last(), LocalDate.of(2026, 11, 22), null))
        // 월요일 0시는 그 주.
        assertEquals("이번 주 11/2–11/8", WidgetWeek.header(at(2026, 11, 2, 0)))
        assertEquals(LocalDate.of(2026, 11, 2), WidgetWeek.start(at(2026, 11, 2, 0)))
        // 같은 허용 주소 모양(google-calendar action=events)이다.
        val (a, b) = WidgetWeek.range(now)
        assertTrue(WidgetRules.allowed("GET", WidgetRules.calendarUrl(a, b)))
    }

    @Test
    fun shiftWeeksBackAndForthWithinLimit() {
        // ‹ ›: 지난주·다음 주, 그 밖은 날짜만. 범위는 ±MAX_SHIFT(8)주.
        assertEquals("지난주 10/19–10/25", WidgetWeek.header(now, shift = -1))
        assertEquals("다음 주 11/2–11/8", WidgetWeek.header(now, shift = 1))
        assertEquals("11/9–11/15", WidgetWeek.header(now, shift = 2))
        assertEquals("10/12–10/18", WidgetWeek.header(now, shift = -2))
        assertEquals("2026-11-01T15:00:00Z" to "2026-11-08T15:00:00Z", WidgetWeek.range(now, shift = 1))
        assertEquals("2026-10-18T15:00:00Z" to "2026-10-25T15:00:00Z", WidgetWeek.range(now, shift = -1))
        // 일요일에서 다음 주로 옮기면 다음 월요일부터.
        assertEquals(LocalDate.of(2026, 11, 2), WidgetWeek.start(at(2026, 11, 1, 23, 59), shift = 1))
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
        assertEquals("다음 주 11/2–11/8", next.title)
        assertEquals(LocalDate.of(2026, 11, 2), next.monday)
        assertEquals(listOf(0, 1, 0, 0, 0, 0, 0), next.days.map { it.count })
        assertEquals(1, next.total)
        // 옮긴 주의 보고일은 그 주 월요일.
        assertEquals(LocalDate.of(2026, 11, 2), next.report!!.day)
        val today = LocalDate.of(2026, 10, 30)
        // 다른 주로 옮기면 오늘 칸은 없다. 고른 날 음영은 옮긴 주에서도.
        assertTrue(next.days.none { WidgetWeek.cell(it, today, null) == WidgetWeek.Cell.TODAY })
        val tue = next.days[1]
        assertEquals(WidgetWeek.Cell.PICKED, WidgetWeek.cell(tue, today, tue.day))
        assertEquals(tue.day, WidgetWeek.active(tue.day, today, now, next.days))
        assertNull(WidgetWeek.active(tue.day, today, now, WidgetWeek.content(200, body(), now).days))
        // 지난주: 오늘 이후가 아니므로 가장 큰 일·몰린 날은 없고 보고일은 그 주 월요일.
        val last = WidgetWeek.content(200, body(timed("교섭", "2026-10-20T14:00:00+09:00", "2026-10-20T17:00:00+09:00")), now, shift = -1)
        assertEquals("지난주 10/19–10/25", last.title)
        assertEquals(listOf(0, 1, 0, 0, 0, 0, 0), last.days.map { it.count })
        assertNull(last.big)
        assertEquals(LocalDate.of(2026, 10, 19), last.report!!.day)
        // 서버 할 일 요약 범위(오늘~6일 뒤) 밖 날은 0개로 보이지 않게 '할 일은 앱에서'. 범위 안 날은 그대로.
        val tasks = MiniJson.parse("""{"connected":true,"tasks":[{"title":"보고","due":"2026-11-05T00:00:00.000Z","status":"needsAction"}]}""")
        val withTasks = WidgetWeek.content(200, body(), now, tasksStatus = 200, tasks = tasks, shift = 1)
        val thu = withTasks.details.getValue(LocalDate.of(2026, 11, 5))
        assertEquals(1, thu.tasks)
        assertEquals("11/5(목) 일정 0 · 할 일 1", WidgetWeek.detailHead(thu))
        val fri2 = withTasks.details.getValue(LocalDate.of(2026, 11, 6))
        assertTrue(fri2.beyond)
        assertEquals("11/6(금) 일정 0 · 할 일은 앱에서", WidgetWeek.detailHead(fri2))
        // 이번 주는 모두 범위 안.
        assertTrue(WidgetWeek.content(200, body(), now, tasksStatus = 200, tasks = tasks).details.values.none { it.beyond })
        // 실패해도 옮긴 주의 빈 칸·머리 줄.
        val down = WidgetWeek.content(0, null, now, shift = 2)
        assertEquals("11/9–11/15", down.title)
        assertEquals(LocalDate.of(2026, 11, 9), down.monday)
    }

    @Test
    fun dayCellsCountEventsAndCarryOverFromLastWeek() {
        val c = WidgetWeek.content(
            200,
            body(
                timed("지난주 밤샘", "2026-10-25T22:00:00+09:00", "2026-10-26T02:00:00+09:00"),
                timed("아주 지난 회의", "2026-10-20T10:00:00+09:00", "2026-10-20T11:00:00+09:00"),
                allDay("출장", "2026-10-29", "2026-10-31"),
                timed("회의 1", "2026-10-29T09:00:00+09:00", "2026-10-29T10:00:00+09:00"),
                timed("회의 2", "2026-10-29T13:00:00+09:00", "2026-10-29T14:00:00+09:00"),
                timed("다음 주 일", "2026-11-02T09:00:00+09:00", "2026-11-02T10:00:00+09:00"),
            ),
            now,
        )
        assertEquals(listOf("월", "화", "수", "목", "금", "토", "일"), c.days.map { it.week })
        assertEquals(listOf(26, 27, 28, 29, 30, 31, 1), c.days.map { it.date })
        assertEquals(listOf(1, 0, 0, 3, 0, 0, 0), c.days.map { it.count })
        assertEquals(4, c.total)
        assertEquals(listOf(false, false, false, true, false, false, false), c.days.map { it.busy })
        // APP-위젯먹색 S68-06: 그날 첫 일정 제목(종일 먼저·시각 순 = 고른 날 아래 칸 첫 일정). 지난주에서 이어진 일정은 월요일 첫 일정.
        assertEquals(listOf("지난주 밤샘", null, null, "출장", null, null, null), c.days.map { it.first })
        assertEquals("출장", WidgetWeek.firstLine(c.days[3], small = false))
        assertNull(WidgetWeek.firstLine(c.days[3], small = true)) // 4×1은 지금처럼 수만
        assertNull(WidgetWeek.firstLine(c.days[1], small = false)) // 일정 없는 날은 줄을 숨김
        // 몰린 날(목)이 이미 지났으면 '몰린 날' 줄은 없다.
        assertNull(c.busy)
        assertNull(c.note)
    }

    @Test
    fun biggestUsesWordsThenLengthThenEarliest() {
        // 낱말이 있으면 길이보다 먼저.
        val words = WidgetWeek.content(
            200,
            body(
                timed("긴 워크숍", "2026-10-30T13:00:00+09:00", "2026-10-30T18:00:00+09:00"),
                timed("파업선포 기자회견", "2026-11-01T10:30:00+09:00", "2026-11-01T11:30:00+09:00"),
            ),
            now,
        )
        assertEquals(WidgetWeek.Pick(LocalDate.of(2026, 11, 1), "D-2", "일 10:30 파업선포 기자회견"), words.big)
        // 낱말이 없으면 2시간 이상 가장 긴 시간 일정(종일 제외), 같으면 이른 것. 지난 일정은 보지 않는다.
        val length = WidgetWeek.content(
            200,
            body(
                timed("지난 긴 일", "2026-10-30T06:00:00+09:00", "2026-10-30T09:30:00+09:00"),
                allDay("휴가", "2026-10-31", "2026-11-01"),
                timed("짧은 일", "2026-10-30T11:00:00+09:00", "2026-10-30T12:00:00+09:00"),
                timed("워크숍 B", "2026-10-31T13:00:00+09:00", "2026-10-31T16:00:00+09:00"),
                timed("워크숍 A", "2026-10-30T13:00:00+09:00", "2026-10-30T16:00:00+09:00"),
            ),
            now,
        )
        assertEquals(WidgetWeek.Pick(LocalDate.of(2026, 10, 30), "오늘", "금 13:00 워크숍 A"), length.big)
        // 2시간이 안 되면 없음.
        val none = WidgetWeek.content(200, body(timed("짧은 일", "2026-10-30T11:00:00+09:00", "2026-10-30T12:00:00+09:00")), now)
        assertNull(none.big)
        assertTrue(WidgetWeek.BIG_WORDS.containsAll(listOf("파업", "집회", "기자회견", "총회", "대표자회의", "교섭")))
    }

    @Test
    fun reportDayAndBusyDay() {
        // 금요일에는 다음 월요일이 상집 보고일, 월요일에는 그날.
        assertEquals(WidgetWeek.Pick(LocalDate.of(2026, 11, 2), "월", "11/2 상집 보고일"), WidgetWeek.content(200, body(), now).report)
        assertEquals(WidgetWeek.Pick(LocalDate.of(2026, 11, 2), "월", "11/2 상집 보고일"), WidgetWeek.content(200, body(), at(2026, 11, 2, 8)).report)
        // S68-02: 새 사용자(서버 기능에 nojo_words 없음)는 '주간 보고일'.
        assertEquals(WidgetWeek.Pick(LocalDate.of(2026, 11, 2), "월", "11/2 주간 보고일"), WidgetWeek.content(200, body(), now, nojoWords = false).report)
        // 오늘 이후 3개 이상인 첫 날, 첫 시간 일정부터.
        val c = WidgetWeek.content(
            200,
            body(
                allDay("당직", "2026-10-31", "2026-11-01"),
                timed("궤도 대표자회의", "2026-10-31T10:00:00+09:00", "2026-10-31T12:00:00+09:00"),
                timed("저녁 모임", "2026-10-31T18:00:00+09:00", "2026-10-31T20:00:00+09:00"),
            ),
            now,
        )
        assertEquals(WidgetWeek.Pick(LocalDate.of(2026, 10, 31), "토", "일정 3개 몰림 · 궤도 대표자회의 10:00부터"), c.busy)
        assertTrue(c.days[5].busy)
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
    fun pickedDayTogglesAndResetsOnNewDay() {
        val c = WidgetWeek.content(200, body(), now)
        val fri = LocalDate.of(2026, 10, 30)
        val today = LocalDate.of(2026, 10, 30)
        // 누르면 그 날, 같은 날을 다시 누르면 풀림, 다른 날이면 그 날로.
        assertEquals(fri, WidgetWeek.toggle(null, fri))
        assertNull(WidgetWeek.toggle(fri, fri))
        assertEquals(LocalDate.of(2026, 10, 27), WidgetWeek.toggle(fri, LocalDate.of(2026, 10, 27)))
        assertEquals(fri, WidgetWeek.active(fri, today, now, c.days))
        // 날이 바뀌면(고른 날짜가 오늘이 아님) 주간 요약으로.
        assertNull(WidgetWeek.active(fri, today, at(2026, 10, 31, 0, 1), c.days))
        // 보이는 주 밖의 날은 무시.
        assertNull(WidgetWeek.active(LocalDate.of(2026, 11, 3), today, now, c.days))
        assertNull(WidgetWeek.active(null, today, now, c.days))
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
        assertEquals(listOf(WidgetWeek.Item("종일", "출장"), WidgetWeek.Item("09:00", "회의 1"), WidgetWeek.Item("13:00", "회의 2"), WidgetWeek.Item("할 일", "보고서")), thu.items)
        assertEquals("10/29(목) 일정 3 · 할 일 1", WidgetWeek.detailHead(thu))
        // 칸 숫자(일정 수)와 머리 줄 일정 수가 같다.
        assertEquals(c.days.first { it.day == thu.day }.count, thu.events)
        assertEquals(listOf("종일  출장", "09:00  회의 1", "외 2"), WidgetWeek.detailRows(thu))
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
        assertTrue(src.contains("if (small) day(context, d.day, i + 1) else pickIntent(context, id, d.day, i)"))
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
        for (id in listOf("week_sel", "week_sel_title", "week_sel_open", "week_sel_i0", "week_sel_i1", "week_sel_i2")) assertTrue(id, big.contains("@+id/$id\""))
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
    fun candidatesAddressIsFixedAndReadOnly() {
        val url = "https://xmlkxfjeagycwttklxjw.supabase.co/rest/v1/app_todo_candidates?status=eq.open&select=source_kind,summary&order=created_at.desc&limit=100"
        assertEquals(url, WidgetRules.CANDIDATES)
        assertTrue(WidgetRules.allowed("GET", url))
        assertFalse(WidgetRules.allowed("POST", url))
        assertFalse(WidgetRules.allowed("PATCH", url))
        assertFalse(WidgetRules.allowed("GET", url.replace("status=eq.open", "status=eq.tasked")))
        assertFalse(WidgetRules.allowed("GET", url.replace("select=source_kind,summary", "select=*")))
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
        val d = WidgetWeek.Day(today, "금", 30, 2, false, "  운영위 회의  ")
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
        // 4×2 머리 줄 양끝 ‹ ›(작은 글자 단추), 4×1 틀에는 없다(이번 주 고정).
        val big = java.io.File("src/main/res/layout/week_widget.xml").readText()
        val small = java.io.File("src/main/res/layout/week_widget_small.xml").readText()
        for (id in listOf("week_prev", "week_next")) {
            assertTrue(id, big.contains("@+id/$id\""))
            assertFalse(id, small.contains("@+id/$id\""))
        }
        val src = java.io.File("src/main/java/kr/or/kptu/work/WeekWidget.kt").readText()
        assertTrue(src.contains("val shift = if (small) 0 else shiftOf(id, now)"))
        assertTrue(src.contains("arrow(context, views, R.id.week_prev, id, shift, -1)"))
        assertTrue(src.contains("arrow(context, views, R.id.week_next, id, shift, 1)"))
        // 옮긴 주에서 머리 글자를 누르면 이번 주로(앱을 열지 않음), 이번 주에서는 지금처럼 앱 달력.
        assertTrue(src.contains("if (shift == 0) day(context, null, 0) else shiftIntent(context, id, 0)"))
        // 위젯마다(번호) 따로, 메모리에만. 옮기면 같은 일정 주소를 범위만 바꿔 읽는다.
        assertTrue(src.contains("putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)"))
        assertTrue(src.contains("manager.updateAppWidget(id, rv)"))
    }
}
