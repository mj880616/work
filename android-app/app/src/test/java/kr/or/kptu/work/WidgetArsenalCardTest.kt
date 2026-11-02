package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate
import java.time.ZonedDateTime

/** APP-위젯아스날맞춤 C·D·E(S48-2b): 크기 고르기·카드 글(D-n·잠 n시간·결과 가림)·[달력에 넣기] 내용. */
class WidgetArsenalCardTest {
    private val zone = WidgetNow.ZONE
    private fun d(m: Int, day: Int) = LocalDate.of(2026, m, day)

    private fun upcoming(date: LocalDate, kickoff: String?, competition: String = "Premier League", round: String = "10R", home: Boolean = false, broadcast: String? = null) =
        WidgetArsenal.Match(date, home, "리버풀", competition, kickoff, null, null, round, broadcast)

    private fun finished(date: LocalDate, score: String, result: String? = null) =
        WidgetArsenal.Match(date, false, "노팅엄 포리스트", "Premier League", null, score, result, "7R")

    private fun ev(y: Int, m: Int, day: Int, h: Int, min: Int, title: String, allDay: Boolean = false): WidgetNow.Ev {
        val start = ZonedDateTime.of(y, m, day, h, min, 0, 0, zone).toInstant().toEpochMilli()
        return WidgetNow.Ev(allDay, start, start + 3_600_000, LocalDate.of(y, m, day), title)
    }

    private val past = listOf(
        finished(d(10, 1), "2-0"), finished(d(10, 5), "1-1"), finished(d(10, 10), "0-1"),
        finished(d(10, 14), "3-1"), finished(d(10, 18), "1-0"), finished(d(10, 25), "2-2"),
    )

    @Test
    fun sizePicksThreeShapesOnly() {
        // 결정 ①: 4×2·4×1·2×1. 2×2 같은 좁은 칸은 2×1 모양.
        assertEquals(WidgetArsenal.Size.BIG, WidgetArsenal.size(250, 110))
        assertEquals(WidgetArsenal.Size.BIG, WidgetArsenal.size(200, 100))
        assertEquals(WidgetArsenal.Size.WIDE, WidgetArsenal.size(250, 40))
        assertEquals(WidgetArsenal.Size.WIDE, WidgetArsenal.size(230, 99))
        assertEquals(WidgetArsenal.Size.SMALL, WidgetArsenal.size(110, 40))
        assertEquals(WidgetArsenal.Size.SMALL, WidgetArsenal.size(110, 110))
        assertEquals(WidgetArsenal.Size.SMALL, WidgetArsenal.size(199, 200))
    }

    @Test
    fun bigCardShowsDdayKickoffBroadcastAndSleep() {
        // 11.8(일) 00:00 킥오프 → 02:00 끝(정오 전) → 그날 아침 첫 일정 09:30 → 잠 7시간.
        val list = past + upcoming(d(11, 8), "00:00", broadcast = "쿠팡플레이")
        val mine = WidgetArsenal.Mine.Read(listOf(ev(2026, 11, 8, 0, 0, "종일", allDay = true), ev(2026, 11, 8, 9, 30, "회의")))
        val c = WidgetArsenal.card(list, d(11, 5), mine, hide = false)
        assertEquals("원정 리버풀", c.title)
        assertEquals("리", c.initial)
        assertEquals("D-3", c.dDay)
        assertEquals("프리미어리그 10R · 11.8(일) 00:00", c.sub)
        assertEquals("중계 쿠팡플레이", c.broadcast)
        assertEquals("끝 02:00 → 아침 첫 일정 09:30 회의", c.after)
        assertEquals("생중계 보면 잠 7시간", c.sleep)
        assertEquals("D-3 원정 리버풀", c.wideTop)
        assertEquals("11.8(일) 00:00 · 프리미어리그 10R · 쿠팡플레이", c.wideBottom)
    }

    @Test
    fun eveningMatchLooksAtNextDayAndCupAddsHalfHour() {
        // 컵 21:00 킥오프 → 23:30 끝 → 다음 날 첫 일정 08:00 → 잠 8시간.
        val list = listOf(upcoming(d(11, 10), "21:00", competition = "Carabao Cup", round = "16강"))
        val mine = WidgetArsenal.Mine.Read(listOf(ev(2026, 11, 11, 8, 0, "출근")))
        val c = WidgetArsenal.card(list, d(11, 10), mine, hide = false)
        assertEquals("D-day", c.dDay)
        assertEquals("끝 23:30 → 다음 날 첫 일정 08:00 출근", c.after)
        assertEquals("생중계 보면 잠 8시간", c.sleep)
        assertNull(c.broadcast)
        assertEquals("카라바오컵 16강 · 11.10(화) 21:00", c.sub)
    }

    @Test
    fun mineStatesNeverLeaveBlankLines() {
        val list = listOf(upcoming(d(11, 8), "00:00"))
        val out = WidgetArsenal.card(list, d(11, 5), WidgetArsenal.Mine.SignedOut, false)
        assertEquals("끝 02:00 · " + WidgetArsenal.SIGNED_OUT_MINE, out.after)
        assertNull(out.sleep)
        val failed = WidgetArsenal.card(list, d(11, 5), WidgetArsenal.Mine.Failed, false)
        assertEquals("끝 02:00 · 내 일정 불러오지 못했어요", failed.after)
        val none = WidgetArsenal.card(list, d(11, 5), WidgetArsenal.Mine.Read(emptyList()), false)
        assertEquals("끝 02:00 → 아침 첫 일정 없음", none.after)
        assertNull(none.sleep)
        val noKick = WidgetArsenal.card(listOf(upcoming(d(11, 8), null)), d(11, 5), WidgetArsenal.Mine.Read(emptyList()), false)
        assertEquals("킥오프 시각 준비 중", noKick.after)
        assertNull(noKick.draft)
        // 다음 경기 자료가 없어도 빈칸 없이.
        val empty = WidgetArsenal.card(past, d(11, 5), WidgetArsenal.Mine.SignedOut, false)
        assertEquals("다음 경기 자료 준비 중", empty.title)
        for (s in listOf(empty.sub, empty.after, empty.wideTop, empty.wideBottom, empty.lastTop, empty.lastBottom)) assertTrue(s.isNotBlank())
        val ph = WidgetArsenal.placeholder("불러오는 중")
        assertEquals("불러오는 중", ph.after)
        assertEquals("불러오는 중", ph.lastBottom)
    }

    @Test
    fun hideResultsCoversScoreAndForm() {
        val list = past + upcoming(d(11, 8), "00:00")
        val shown = WidgetArsenal.card(list, d(11, 5), WidgetArsenal.Mine.SignedOut, hide = false)
        assertEquals(listOf("무", "패", "승", "승", "무"), shown.form)
        assertNull(shown.formNote)
        assertEquals("지난 10.25(일) 원정 노팅엄 포리스트", shown.lastTop)
        assertEquals("2-2 무 · 프리미어리그 7R", shown.lastBottom)
        val hidden = WidgetArsenal.card(list, d(11, 5), WidgetArsenal.Mine.SignedOut, hide = true)
        assertEquals(emptyList<String>(), hidden.form)
        assertEquals(WidgetArsenal.HIDDEN_FORM, hidden.formNote)
        assertEquals("결과 가림 · 누르면 보기", hidden.lastBottom)
        assertEquals(shown.lastTop, hidden.lastTop)
        for (s in listOf(hidden.title, hidden.sub, hidden.after, hidden.wideTop, hidden.wideBottom, hidden.lastTop)) {
            assertFalse(s, s.contains("2-2"))
        }
        // 다음 경기 자료가 없을 때도 점수가 새지 않는다.
        val emptyHidden = WidgetArsenal.card(past, d(11, 5), WidgetArsenal.Mine.SignedOut, hide = true)
        for (s in listOf(emptyHidden.sub, emptyHidden.after, emptyHidden.wideBottom, emptyHidden.lastBottom)) assertFalse(s, s.contains("2-2"))
    }

    @Test
    fun calendarDraftIsKickoffToEnd() {
        val m = upcoming(d(11, 8), "00:00", broadcast = "쿠팡플레이")
        val dr = WidgetArsenal.draft(m)!!
        assertEquals("아스날 경기 · 원정 리버풀", dr.title)
        assertEquals(ZonedDateTime.of(2026, 11, 8, 0, 0, 0, 0, zone).toInstant().toEpochMilli(), dr.beginMs)
        assertEquals(dr.beginMs + 120 * 60_000L, dr.endMs)
        assertEquals("프리미어리그 10R · 중계 쿠팡플레이", dr.description)
        val cup = WidgetArsenal.draft(upcoming(d(11, 10), "21:00", competition = "FA Cup", round = ""))!!
        assertEquals(cup.beginMs + 150 * 60_000L, cup.endMs)
        assertEquals("FA컵", cup.description)
        // 폰 달력 '일정 추가' 화면이 읽는 이름(CalendarContract.EXTRA_EVENT_BEGIN_TIME = "beginTime" 등).
        val x = WidgetArsenal.calendarExtras(dr)
        assertEquals(listOf("title", "beginTime", "endTime", "description"), x.keys.toList())
        assertEquals(dr.beginMs, x["beginTime"])
        assertEquals("content://com.android.calendar/events", WidgetArsenal.CALENDAR_INSERT_URI)
    }

    @Test
    fun wakeRangeStaysInsideAllowedCalendarReads() {
        val m = upcoming(d(11, 8), "00:00")
        val (from, to) = WidgetArsenal.wakeRange(m)!!
        assertEquals("2026-11-07T15:00:00Z", from)
        assertEquals("2026-11-08T15:00:00Z", to)
        // 위젯 로그인 허용 목록(WidgetRules.allowed)을 넓히지 않는다: 이미 허용된 calendarUrl 모양.
        assertTrue(WidgetRules.allowed("GET", WidgetRules.calendarUrl(from, to)))
        assertNull(WidgetArsenal.wakeRange(upcoming(d(11, 8), null)))
        assertNull(WidgetArsenal.wakeRange(null))
    }

    @Test
    fun widgetDrawsWithoutServerWriteOrStorage() {
        val src = File("src/main/java/kr/or/kptu/work/ArsenalWidget.kt").readText()
        // [달력에 넣기]는 폰 달력 앱 '일정 추가' 화면(서버 쓰기 없음), 내 일정은 위젯 세션 읽기만.
        assertTrue(src.contains("Intent.ACTION_INSERT"))
        assertTrue(src.contains("CalendarContract.Events.CONTENT_URI"))
        assertTrue(src.contains("session.readList(listOf(WidgetRules.calendarUrl("))
        for (bad in listOf("session.write(", "session.photo(", "readPublic(url", "Log.", "println(")) assertFalse(bad, src.contains(bad))
        // 경기·일정 자료는 메모리에만. 설정 파일에는 '결과 가림' 켬/끔 하나(위젯 번호별)만.
        assertEquals(1, Regex("putBoolean\\(").findAll(src).count())
        assertFalse(src.contains("putString("))
        // 크기별 모양 셋, 놓을 때 고르는 설정 창.
        for (layout in listOf("R.layout.arsenal_widget_small", "R.layout.arsenal_widget_wide", "R.layout.arsenal_widget")) assertTrue(layout, src.contains(layout))
        val info = File("src/main/res/xml/arsenal_widget_info.xml").readText()
        assertTrue(info.contains("android:configure=\"kr.or.kptu.work.ArsenalWidgetConfigActivity\""))
        assertTrue(info.contains("android:resizeMode=\"horizontal|vertical\""))
        assertTrue(info.contains("android:targetCellWidth=\"4\""))
        assertTrue(info.contains("android:targetCellHeight=\"2\""))
    }
}
