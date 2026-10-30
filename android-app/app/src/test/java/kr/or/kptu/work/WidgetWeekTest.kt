package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZonedDateTime

/** WIDGET-여러개 ②: 이번 주 위젯 줄, 오늘 위젯 '챙길 것·나한테 온 요청' 건수, 허용 주소. */
class WidgetWeekTest {
    // 2026-10-30(금) 10:00 서울
    private val now = ZonedDateTime.of(2026, 10, 30, 10, 0, 0, 0, WidgetToday.ZONE).toInstant().toEpochMilli()

    @Test
    fun weekRangeIsMondayToNextMondaySeoul() {
        assertEquals("2026-10-25T15:00:00Z" to "2026-11-01T15:00:00Z", WidgetWeek.range(now))
        assertEquals("이번 주 10.26~11.1", WidgetWeek.header(now))
        // 일요일 밤도 같은 주, 월요일 0시부터 다음 주.
        val sunday = ZonedDateTime.of(2026, 11, 1, 23, 59, 0, 0, WidgetToday.ZONE).toInstant().toEpochMilli()
        assertEquals(WidgetWeek.range(now), WidgetWeek.range(sunday))
        val monday = ZonedDateTime.of(2026, 11, 2, 0, 0, 0, 0, WidgetToday.ZONE).toInstant().toEpochMilli()
        assertEquals("2026-11-01T15:00:00Z", WidgetWeek.range(monday).first)
        // 같은 허용 주소 모양(google-calendar action=events)이다.
        val (a, b) = WidgetWeek.range(now)
        assertTrue(WidgetRules.allowed("GET", WidgetRules.calendarUrl(a, b)))
    }

    @Test
    fun rowsFromTodayToSundayInOrder() {
        val body = MiniJson.parse(
            """{"events":[
            {"title":"지난 회의","start":"2026-10-28T01:00:00Z","end":"2026-10-28T02:00:00Z","allDay":false},
            {"title":"일요일 행사","start":"2026-11-01","end":"2026-11-02","allDay":true},
            {"title":"오후 회의","start":"2026-10-30T05:00:00Z","end":"2026-10-30T06:00:00Z","allDay":false},
            {"title":"출장","start":"2026-10-29","end":"2026-10-31","allDay":true},
            {"title":"끝난 종일","start":"2026-10-28","end":"2026-10-30","allDay":true},
            {"title":"밤샘","start":"2026-10-29T14:00:00Z","end":"2026-10-30T02:00:00Z","allDay":false},
            {"title":"토요일 아침","start":"2026-10-31T00:30:00Z","allDay":false},
            {"title":"다음 주","start":"2026-11-02T01:00:00Z","allDay":false}
            ]}""",
        )
        val rows = WidgetWeek.rows(body, now)
        assertEquals(
            listOf(
                "금 30  종일  출장",
                "금 30  계속  밤샘",
                "금 30  14:00  오후 회의",
                "토 31  09:30  토요일 아침",
                "일 1  종일  일요일 행사",
            ),
            rows.map { it.text },
        )
        assertEquals(LocalDate.of(2026, 10, 31), rows[3].day)
    }

    @Test
    fun contentNotesAndMore() {
        assertEquals("일정 연결을 확인해 주세요", WidgetWeek.content(500, null, now).note)
        assertEquals("이번 주 남은 일정이 없어요", WidgetWeek.content(200, MiniJson.parse("""{"events":[]}"""), now).note)
        assertEquals("일정을 읽지 못했어요", WidgetWeek.content(200, MiniJson.parse("""{"events":[],"warning":"x"}"""), now).note)
        val many = (0 until 12).joinToString(",") { """{"title":"일$it","start":"2026-10-31T0${it % 10}:00:00Z","allDay":false}""" }
        val c = WidgetWeek.content(200, MiniJson.parse("""{"events":[$many]}"""), now)
        assertEquals(WidgetWeek.MAX_ROWS, c.rows.size)
        assertEquals("일정 5개 더", c.rows.last().text)
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
    fun countsMatchWebInboxRule() {
        val candidates = MiniJson.parse(
            """[{"source_kind":"telegram","summary":"자료 보내기"},{"source_kind":"note","summary":"회의록 정리!"},
            {"source_kind":"telegram","summary":"답장 하기"},{"source_kind":"meeting","summary":"예산 확인"}]""",
        )
        val tasks = MiniJson.parse("""{"tasks":[{"title":"회의록 정리","status":"needsAction"},{"title":"답장하기","status":"completed"}]}""")
        // '회의록 정리!'는 이미 할 일(문장부호·공백 무시) → 뺌. 끝낸 할 일 제목은 비교하지 않는다.
        assertEquals(WidgetToday.Counts(3, 2), WidgetToday.counts(candidates, tasks))
        assertEquals("챙길 것 3 · 나한테 온 요청 2", WidgetToday.Counts(3, 2).line())
        assertEquals(WidgetToday.Counts(4, 2), WidgetToday.counts(candidates, null))
        assertNull(WidgetToday.counts(MiniJson.parse("{}"), tasks))
        assertEquals("회의록정리", WidgetToday.normalizeTitle(" 회의록 · 정리! "))
        assertEquals("abc", WidgetToday.normalizeTitle("ＡＢＣ"))
    }

    @Test
    fun todayContentShowsCountsLineOnlyWhenRead() {
        val ev = MiniJson.parse("""{"events":[]}""")
        val tk = MiniJson.parse("""{"tasks":[]}""")
        val list = MiniJson.parse("""[{"source_kind":"telegram","summary":"a"}]""")
        assertEquals("챙길 것 1 · 나한테 온 요청 1", WidgetToday.content(WidgetSession.Raw(200, ev, 200, tk, 200, list), now).counts)
        assertEquals("챙길 것 0 · 나한테 온 요청 0", WidgetToday.content(WidgetSession.Raw(200, ev, 200, tk, 404, null), now).counts)
        assertNull(WidgetToday.content(WidgetSession.Raw(200, ev, 200, tk, 500, null), now).counts)
        assertNull(WidgetToday.content(WidgetSession.Raw(200, ev, 200, tk), now).counts)
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
    }
}
