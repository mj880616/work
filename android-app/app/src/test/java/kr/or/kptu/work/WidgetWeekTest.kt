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
    fun weekRangeIsMondayToNextMondayAndWeekendShowsNextWeek() {
        assertEquals("2026-10-25T15:00:00Z" to "2026-11-01T15:00:00Z", WidgetWeek.range(now))
        assertEquals("이번 주 10/26–11/1", WidgetWeek.header(now))
        // 토·일에는 다음 주(11/2–11/8).
        val saturday = at(2026, 10, 31)
        val sunday = at(2026, 11, 1, 23, 59)
        assertEquals("2026-11-01T15:00:00Z" to "2026-11-08T15:00:00Z", WidgetWeek.range(saturday))
        assertEquals(WidgetWeek.range(saturday), WidgetWeek.range(sunday))
        assertEquals("다음 주 11/2–11/8", WidgetWeek.header(sunday))
        // 월요일 0시는 그 주.
        assertEquals("이번 주 11/2–11/8", WidgetWeek.header(at(2026, 11, 2, 0)))
        // 같은 허용 주소 모양(google-calendar action=events)이다.
        val (a, b) = WidgetWeek.range(now)
        assertTrue(WidgetRules.allowed("GET", WidgetRules.calendarUrl(a, b)))
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
        assertTrue(words.days.last().hot)
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
        assertTrue(c.days[5].busy && c.days[5].hot)
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
    fun dayAddressAndMessage() {
        val d = LocalDate.of(2026, 11, 1)
        assertEquals("https://bokdoong.com/work/app/?view=calendar&day=2026-11-01", WidgetWeek.dayUrl(d))
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
        // 텔레그램 읽기는 위젯과 함께 지웠다.
        assertFalse(WidgetRules.allowed("POST", "https://xmlkxfjeagycwttklxjw.supabase.co/rest/v1/rpc/app_my_features"))
        assertFalse(WidgetRules.allowed("GET", "https://xmlkxfjeagycwttklxjw.supabase.co/rest/v1/rpc/app_my_features"))
    }
}
