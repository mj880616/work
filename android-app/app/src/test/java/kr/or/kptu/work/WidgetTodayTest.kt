package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.ZonedDateTime

class WidgetTodayTest {
    // 2026-10-29 08:30 서울(목)
    private val now = ZonedDateTime.parse("2026-10-29T08:30:00+09:00[Asia/Seoul]").toInstant().toEpochMilli()

    @Test
    fun rangeIsSeoulDay() {
        assertEquals("2026-10-28T15:00:00Z" to "2026-10-29T15:00:00Z", WidgetToday.range(now))
        assertEquals("오늘 10.29 목", WidgetToday.header(now))
    }

    @Test
    fun eventsAllDayFirstThenTime() {
        val body = MiniJson.parse(
            """{"events":[
              {"title":"오후 회의","start":"2026-10-29T14:00:00+09:00","allDay":false},
              {"title":"연차","start":"2026-10-29","allDay":true},
              {"title":"어제부터","start":"2026-10-28T22:00:00+09:00","allDay":false},
              {"title":"아침","start":"2026-10-28T23:30:00Z","allDay":false},
              {"title":"","start":"bad"}
            ]}""",
        )
        val rows = WidgetToday.events(body, now)
        assertEquals(listOf("종일 연차", "계속 어제부터", "08:30 아침", "14:00 오후 회의"), rows.map { it.time + " " + it.title })
    }

    @Test
    fun tasksDueTodayOrOverdueOnly() {
        val body = MiniJson.parse(
            """{"tasks":[
              {"title":"오늘 할 일","due":"2026-10-29T00:00:00.000Z","status":"needsAction"},
              {"title":"내일","due":"2026-10-30T00:00:00.000Z","status":"needsAction"},
              {"title":"지난 것","due":"2026-10-27T00:00:00.000Z","status":"needsAction"},
              {"title":"끝냄","due":"2026-10-27T00:00:00.000Z","status":"completed"},
              {"title":"기한 없음","status":"needsAction"}
            ]}""",
        )
        val rows = WidgetToday.tasks(body, now)
        assertEquals(listOf("지남 지난 것", "오늘 오늘 할 일"), rows.map { it.time + " " + it.title })
    }

    @Test
    fun contentLimitsRowsAndNotes() {
        val events = (1..6).joinToString(",") { """{"title":"일정$it","start":"2026-10-29T1$it:00:00+09:00"}""" }
        val raw = WidgetSession.Raw(200, MiniJson.parse("""{"events":[$events]}"""), 200, MiniJson.parse("""{"connected":true,"tasks":[]}"""))
        val c = WidgetToday.content(raw, now)
        assertEquals(4, c.rows.size)
        assertEquals("일정 3개 더", c.rows[3].title)
        assertNull(c.note)

        val empty = WidgetToday.content(WidgetSession.Raw(200, MiniJson.parse("{\"events\":[]}"), 200, MiniJson.parse("{\"tasks\":[]}")), now)
        assertEquals("오늘 일정·할 일이 없어요", empty.note)

        val broken = WidgetToday.content(WidgetSession.Raw(500, null, 200, MiniJson.parse("{\"connected\":false,\"tasks\":[]}")), now)
        assertEquals("일정 연결을 확인해 주세요 · 할 일 연결이 필요해요", broken.note)

        val reconnect = WidgetToday.content(WidgetSession.Raw(200, MiniJson.parse("{\"events\":[],\"warning\":\"x\"}"), 200, MiniJson.parse("{\"needs_reconnect\":true}")), now)
        assertEquals("일정을 읽지 못했어요 · 할 일을 다시 연결해 주세요", reconnect.note)
    }

    @Test
    fun titlesAreCleaned() {
        assertEquals("(제목 없음)", WidgetToday.cleanTitle(null))
        assertEquals("a b", WidgetToday.cleanTitle(" a\nb "))
        assertEquals(80, WidgetToday.cleanTitle("가".repeat(200)).length)
    }
}
