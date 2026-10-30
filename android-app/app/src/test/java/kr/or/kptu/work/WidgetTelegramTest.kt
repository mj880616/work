package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.time.LocalDate

/** WIDGET-여러개 ③: 텔레그램(운영자 전용)·아스날 위젯 규칙과 허용 주소. */
class WidgetTelegramTest {
    private val base = "https://xmlkxfjeagycwttklxjw.supabase.co"
    private fun reply(status: Int, json: String?) = WidgetSession.Reply(status, MiniJson.parse(json))

    @Test
    fun telegramAddressesAreFixedReadOnly() {
        assertEquals("$base/rest/v1/rpc/app_my_features", WidgetRules.FEATURES)
        assertEquals("$base/rest/v1/app_feed_days?source=eq.telegram&day=eq.2026-10-30&select=day,kept_count,room_count", WidgetRules.feedDaysUrl("2026-10-30"))
        assertEquals(
            "$base/rest/v1/app_feed_items?source=eq.telegram&hidden_at=is.null&day=gte.2026-10-29&select=room_key,room_label,title,summary,day,occurred_at&order=occurred_at.desc&limit=40",
            WidgetRules.feedItemsUrl("2026-10-29"),
        )
        for (u in listOf(WidgetRules.FEATURES, WidgetRules.feedDaysUrl("2026-10-30"), WidgetRules.feedItemsUrl("2026-10-29"), WidgetRules.ARSENAL)) {
            assertTrue(u, WidgetRules.allowed("GET", u))
            assertFalse(u, WidgetRules.allowed("POST", u))
        }
        assertFalse(WidgetRules.allowed("GET", WidgetRules.feedDaysUrl("2026-10-30").replace("source=eq.telegram", "source=eq.call")))
        assertFalse(WidgetRules.allowed("GET", WidgetRules.feedItemsUrl("2026-10-29").replace("select=room_key", "select=raw_text,room_key")))
        assertFalse(WidgetRules.allowed("GET", WidgetRules.feedDaysUrl("2026-10-30").replace("2026-10-30", "2026-10-30&x=1")))
        assertFalse(WidgetRules.allowed("GET", "$base/rest/v1/app_feed_items?source=eq.telegram"))
        assertFalse(WidgetRules.allowed("POST", "$base/rest/v1/rpc/app_feed_room_day_lines"))
        try {
            WidgetRules.feedDaysUrl("2026-10-30&select=*")
            throw AssertionError("bad day")
        } catch (_: IllegalArgumentException) {
        }
        assertEquals("https://bokdoong.com/work/app/arsenal/matches.js", WidgetRules.ARSENAL)
    }

    @Test
    fun noFeatureShowsOnlyNotice() {
        val none = WidgetTelegram.content(reply(200, "[\"calls\"]"), reply(200, "[]"), reply(200, "[]"), 0)
        assertEquals(WidgetTelegram.NO_FEATURE, none)
        assertFalse(none!!.enabled)
        assertEquals("이 기능 없음", none.note)
        assertEquals(WidgetTelegram.NO_FEATURE, WidgetTelegram.content(reply(200, "[]"), null, null, null))
        // 기능 목록을 못 읽으면 실패(위젯은 '불러오지 못했어요').
        assertNull(WidgetTelegram.content(reply(404, "{}"), null, null, null))
        assertNull(WidgetTelegram.content(reply(200, "{}"), null, null, null))
    }

    @Test
    fun headAndRecentRooms() {
        val items = """[
          {"room_key":"-100a","room_label":"본부","summary":"집회 장소 바뀜","title":"t1","day":"2026-10-30","occurred_at":"2026-10-30T03:00:00Z"},
          {"room_key":"-100a","room_label":"본부","summary":"옛 소식","day":"2026-10-30","occurred_at":"2026-10-30T02:00:00Z"},
          {"room_key":"-100b","room_label":"지부장","summary":"","title":"회의 일정","day":"2026-10-29","occurred_at":"2026-10-29T09:00:00Z"},
          {"room_key":"bad key","room_label":"x","summary":"y","day":"2026-10-29"},
          {"room_key":"-100c","room_label":"","summary":"자료 요청","day":"2026-10-29"},
          {"room_key":"-100d","room_label":"넷째","summary":"z","day":"2026-10-29"}
        ]"""
        val c = WidgetTelegram.content(reply(200, "[\"calls\",\"telegram\"]"), reply(200, "[{\"day\":\"2026-10-30\",\"kept_count\":7,\"room_count\":3}]"), reply(200, items), 2)!!
        assertTrue(c.enabled)
        assertEquals("새 소식 7 · 요청 2", c.head)
        assertEquals(listOf("본부 · 집회 장소 바뀜", "지부장 · 회의 일정", "이름 없는 방 · 자료 요청"), c.rooms.map { it.text })
        assertEquals(LocalDate.of(2026, 10, 29), c.rooms[1].day)
        assertNull(c.note)
        val empty = WidgetTelegram.content(reply(200, "[\"telegram\"]"), reply(200, "[]"), reply(200, "[]"), null)!!
        assertEquals("새 소식 0 · 요청 -", empty.head)
        assertEquals("어제·오늘 소식이 없어요", empty.note)
        assertEquals("소식을 읽지 못했어요", WidgetTelegram.content(reply(200, "[\"telegram\"]"), reply(500, null), reply(500, null), 1)!!.note)
    }

    @Test
    fun roomAddressAndMessage() {
        val d = LocalDate.of(2026, 10, 30)
        assertEquals("https://bokdoong.com/work/app/?view=telegram&tg_room=-100a%3Ab&tg_day=2026-10-30", WidgetTelegram.roomUrl("-100a:b", d))
        assertTrue(ShellRules.isInternalApp(WidgetTelegram.roomUrl("-100a:b", d)))
        assertEquals("tg:open:2026-10-30:-100a:b", WidgetTelegram.roomMessage("-100a:b", d))
        assertFalse(WidgetTelegram.isRoomKey("a&b"))
        assertFalse(WidgetTelegram.isRoomKey(null))
    }

    @Test
    fun arsenalFromRepoFileShowsLastResult() {
        val text = File("../../app/arsenal/matches.js").readText()
        val list = WidgetArsenal.parse(text)
        assertTrue(list != null && list.isNotEmpty())
        // 지금 파일에는 끝난 경기만 있다(다음 경기 자료는 아직 없음). 자료가 늘어도 깨지지 않게 마지막 결과 모양만 본다.
        val c = WidgetArsenal.content(list, LocalDate.of(2026, 10, 30))
        assertTrue(c.bottom, c.bottom.startsWith("지난 "))
    }

    @Test
    fun arsenalNextMatchWhenScoreless() {
        val text = """window.ARSENAL_MATCHES = [
          {"date":"2026-11-01","home":"아스날","away":"리버풀","competition":"Premier League","kickoff":"01:30"},
          {"date":"2026-11-08","home":"첼시","away":"아스날","competition":"Premier League"},
          {"date":"2026-10-27","home":"플리트우드 타운","away":"아스날","homeScore":1,"awayScore":2,"result":"승"},
          {"date":"2026-10-24","home":"아스날","away":"에버턴","homeScore":3,"awayScore":0,"result":"승"}
        ];"""
        val c = WidgetArsenal.content(WidgetArsenal.parse(text), LocalDate.of(2026, 10, 30))
        assertEquals("다음 11.1(일) 01:30 홈 리버풀", c.top)
        assertEquals("지난 10.27(화) 원정 플리트우드 타운 2-1 승", c.bottom)
        assertNull(WidgetArsenal.parse("var x = [1]"))
        assertEquals("불러오지 못했어요", WidgetArsenal.content(null, LocalDate.of(2026, 10, 30)).bottom)
    }

    @Test
    fun publicReadSendsNoTokenAndOnlyArsenal() {
        val sent = ArrayList<WidgetRequest>()
        val vault = object : WidgetVault {
            override fun exists() = false
            override fun read(): String? = null
            override fun write(value: String) {}
            override fun clear() {}
        }
        val session = WidgetSession(WidgetHttp { r -> sent.add(r); WidgetResponse(200, "window.ARSENAL_MATCHES = [];") }, vault)
        val r = session.readPublic(WidgetRules.ARSENAL)
        assertTrue(r is WidgetSession.Outcome.Ok)
        assertEquals(1, sent.size)
        assertTrue(sent[0].headers.isEmpty())
        assertTrue(session.readPublic(WidgetRules.TASKS) is WidgetSession.Outcome.Failed)
        assertEquals(1, sent.size)
        val down = WidgetSession(WidgetHttp { throw IOException("down") }, vault)
        assertTrue(down.readPublic(WidgetRules.ARSENAL) is WidgetSession.Outcome.Failed)
    }
}
