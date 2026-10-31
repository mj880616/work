package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.ZonedDateTime

/** APP-위젯다시 ①: '지금' 위젯(다음 일정·남은 시간·그다음·처리할 것 세 줄). */
class WidgetNowTest {
    private fun at(h: Int, m: Int) = ZonedDateTime.of(2026, 10, 30, h, m, 0, 0, WidgetNow.ZONE).toInstant().toEpochMilli()
    private val day = LocalDate.of(2026, 10, 30)
    private fun cal(vararg events: String) = MiniJson.parse("""{"events":[${events.joinToString(",")}]}""")
    private fun timed(title: String, start: String, end: String) = """{"title":"$title","start":"$start","end":"$end","allDay":false}"""
    private fun allDay(title: String, start: String, end: String) = """{"title":"$title","start":"$start","end":"$end","allDay":true}"""
    private val tasks = MiniJson.parse("""{"tasks":[]}""")
    private val none = MiniJson.parse("[]")

    @Test
    fun rangeIsTodayToDayAfterTomorrow() {
        assertEquals("2026-10-29T15:00:00Z" to "2026-10-31T15:00:00Z", WidgetNow.range(at(12, 0)))
    }

    @Test
    fun leftTime() {
        val now = at(12, 24)
        assertEquals("1시간 36분 뒤", WidgetNow.left(now, at(14, 0)))
        assertEquals("25분 뒤", WidgetNow.left(now, now + 24 * 60_000 + 1))
        assertEquals("2시간 뒤", WidgetNow.left(now, at(14, 24)))
        assertEquals("진행 중", WidgetNow.left(now, at(12, 0)))
    }

    @Test
    fun nextAndAfter() {
        val body = cal(
            timed("아침 회의", "2026-10-30T09:00:00+09:00", "2026-10-30T10:00:00+09:00"),
            allDay("창립 기념일", "2026-10-30", "2026-10-31"),
            timed("연극", "2026-10-30T14:00:00+09:00", "2026-10-30T16:00:00+09:00"),
            allDay("심장사상충 약 복용", "2026-10-31", "2026-11-01"),
            timed("내일 회의", "2026-10-31T09:00:00+09:00", "2026-10-31T10:00:00+09:00"),
        )
        val c = WidgetNow.content(WidgetSession.Raw(200, body, 200, tasks, 200, none), at(12, 24))
        assertEquals(WidgetNow.Next("14:00", "연극", "1시간 36분 뒤", day), c.next)
        assertEquals("그다음 · 내일 종일 심장사상충 약 복용", c.after)
        // 진행 중인 일정이 큰 줄, 그다음은 오늘 뒤 일정.
        val running = WidgetNow.content(WidgetSession.Raw(200, body, 200, tasks, 200, none), at(14, 30))
        assertEquals(WidgetNow.Next("14:00", "연극", "진행 중", day), running.next)
        // 오늘 남은 일정이 없으면 큰 줄 없음(화면은 '오늘 남은 일정 없음'), 그다음은 내일 것.
        val late = WidgetNow.content(WidgetSession.Raw(200, body, 200, tasks, 200, none), at(17, 0))
        assertNull(late.next)
        assertEquals("그다음 · 내일 종일 심장사상충 약 복용", late.after)
        assertEquals("오늘 남은 일정 없음", WidgetNow.NO_NEXT)
    }

    @Test
    fun inboxMatchesWebRule() {
        val candidates = MiniJson.parse(
            """[{"source_kind":"telegram","summary":"새 요청"},{"source_kind":"note","summary":"회의록 정리!"},
            {"source_kind":"meeting","summary":"예산 확인"},{"source_kind":"telegram","summary":"오래된 요청"}]""",
        )
        val t = MiniJson.parse("""{"tasks":[{"title":"회의록 정리","status":"needsAction"},{"title":"예산확인","status":"completed"}]}""")
        // '회의록 정리!'는 이미 할 일(문장부호·공백 무시) → 뺌. 끝낸 할 일 제목은 비교하지 않는다.
        val (asks, todo) = WidgetNow.inbox(candidates, t)!!
        assertEquals(WidgetNow.Line(2, "오래된 요청"), asks)
        assertEquals(WidgetNow.Line(3, "예산 확인"), todo)
        assertNull(WidgetNow.inbox(MiniJson.parse("{}"), t))
        assertEquals("회의록정리", WidgetNow.normalizeTitle(" 회의록 · 정리! "))
        assertEquals("abc", WidgetNow.normalizeTitle("ＡＢＣ"))
    }

    @Test
    fun failuresShowShortReasons() {
        val ev = cal()
        assertEquals("일정 연결을 확인해 주세요", WidgetNow.content(WidgetSession.Raw(500, null, 200, tasks, 200, none), at(9, 0)).note)
        val noTasks = WidgetNow.content(WidgetSession.Raw(200, ev, 200, MiniJson.parse("""{"connected":false,"tasks":[]}"""), 404, null), at(9, 0))
        assertEquals(WidgetNow.Line(null, "할 일 연결이 필요해요"), noTasks.due)
        // 후보 표가 없으면(404) 0으로, 그 밖의 실패는 '읽지 못했어요'.
        assertEquals(WidgetNow.Line(0, "없음"), noTasks.asks)
        val broken = WidgetNow.content(WidgetSession.Raw(200, ev, 500, null, 500, null), at(9, 0))
        assertEquals(WidgetNow.Line(null, "읽지 못했어요"), broken.asks)
        assertEquals(WidgetNow.Line(null, "읽지 못했어요"), broken.due)
        assertNull(broken.note)
    }

    @Test
    fun dueTodayAndOverdue() {
        val t = MiniJson.parse(
            """{"tasks":[{"title":"오늘 보내기","due":"2026-10-30T00:00:00.000Z","status":"needsAction"},
            {"title":"내일 일","due":"2026-10-31T00:00:00.000Z","status":"needsAction"},
            {"title":"끝낸 일","due":"2026-10-29T00:00:00.000Z","status":"completed"}]}""",
        )
        assertEquals(WidgetNow.Line(1, "오늘 보내기"), WidgetNow.due(t, at(9, 0)))
        assertEquals(WidgetNow.Line(0, "없음"), WidgetNow.due(MiniJson.parse("""{"tasks":[]}"""), at(9, 0)))
    }
}
