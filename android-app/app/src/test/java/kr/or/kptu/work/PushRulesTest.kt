package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// APP-폰알림 N4: 폰 알림 판단 규칙(PushRules).
class PushRulesTest {
    private val token = "fcm_token-abcdefghijklmnop:1234567890"

    @Test
    fun knownKindsMatchTheServerList() {
        // app_push_log.kind 검사 제약과 같은 열 가지(2절 일곱 종류 + 조용한 시간 묶음 + 시험 + 잊지 말기, migration 20261105120000).
        assertEquals(
            listOf("task_due", "commitment", "meeting_done", "collect_stall", "morning", "evening", "next_week", "quiet_digest", "test", "family"),
            PushRules.KINDS.keys.toList(),
        )
        assertTrue(PushRules.urgent("task_due"))
        assertTrue(PushRules.urgent("collect_stall"))
        assertFalse(PushRules.urgent("morning"))
        assertFalse(PushRules.urgent("evening"))
        assertFalse(PushRules.urgent("family"))
        assertEquals("push_task_due", PushRules.channelId("task_due"))
    }

    @Test
    fun messageKeepsOnlyKnownKindAndTitle() {
        val m = PushRules.message(mapOf("kind" to "task_due", "title" to "기한 오늘 · 자료 보내기", "open" to "/work/app/?view=tasks"))!!
        assertEquals("task_due", m.kind)
        assertEquals("기한 오늘 · 자료 보내기", m.title)
        assertEquals("/work/app/?view=tasks", m.open)
        assertTrue(m.urgent)
        assertNull(PushRules.message(mapOf("kind" to "unknown", "title" to "x")))
        assertNull(PushRules.message(mapOf("kind" to "test", "title" to "  ")))
        assertNull(PushRules.message(mapOf("title" to "x")))
        assertNull(PushRules.message(null))
    }

    @Test
    fun messageTitleIsOneLineAndCut() {
        val m = PushRules.message(mapOf("kind" to "test", "title" to "첫 줄\n둘째\t줄"))!!
        assertEquals("첫 줄 둘째 줄", m.title)
        val long = PushRules.message(mapOf("kind" to "test", "title" to "가".repeat(200)))!!
        assertEquals(PushRules.MAX_TITLE, long.title.codePointCount(0, long.title.length))
        assertTrue(long.title.endsWith("…"))
    }

    @Test
    fun strangeOpenFallsBackToHome() {
        for (bad in listOf("https://evil.example/work/app/", "/work/app/?a=<x>", "/p/x/", "javascript:alert(1)", "//evil.example/work/app/", "/work/app/../p/")) {
            assertEquals(bad, "/work/app/", PushRules.message(mapOf("kind" to "test", "title" to "t", "open" to bad))!!.open)
        }
    }

    @Test
    fun openUrlStaysInsideWeb2() {
        assertEquals("https://bokdoong.com/work/app/?view=basket&pane=todo", PushRules.openUrl("/work/app/?view=basket&pane=todo"))
        assertEquals(ShellRules.HOME, PushRules.openUrl("/work/app/"))
        assertEquals(ShellRules.HOME, PushRules.openUrl(null))
        assertEquals(ShellRules.HOME, PushRules.openUrl("https://evil.example/"))
        assertEquals(ShellRules.HOME, PushRules.openUrl("/work/app/?x=" + "a".repeat(300)))
        assertTrue(ShellRules.isInternalApp(PushRules.openUrl("/work/app/?view=home&day=2026-11-01")))
    }

    @Test
    fun notifyIdIsStablePerKindAndPlace() {
        val a = PushRules.message(mapOf("kind" to "task_due", "title" to "a", "open" to "/work/app/?view=tasks"))!!
        val b = PushRules.message(mapOf("kind" to "task_due", "title" to "b", "open" to "/work/app/?view=tasks"))!!
        val c = PushRules.message(mapOf("kind" to "commitment", "title" to "a", "open" to "/work/app/?view=tasks"))!!
        assertEquals(PushRules.notifyId(a), PushRules.notifyId(b))
        assertNotEquals(PushRules.notifyId(a), PushRules.notifyId(c))
        assertTrue(PushRules.notifyId(a) > 0)
    }

    @Test
    fun configNeedsAllFourValues() {
        assertFalse(PushRules.configOk("", "", "", ""))
        assertFalse(PushRules.configOk("web2-phone", "1:2:android:3", "123", ""))
        assertFalse(PushRules.configOk("web2 phone", "1:2:android:3", "123", "AIzaKey"))
        assertTrue(PushRules.configOk("web2-phone", "1:123:android:abc", "123", "AIzaSyKey_-x"))
    }

    @Test
    fun bridgeWordsAndStates() {
        assertEquals(PushRules.Ask.HELLO, PushRules.ask("push:hello"))
        assertEquals(PushRules.Ask.ENABLE, PushRules.ask("push:enable"))
        assertEquals(PushRules.Ask.FORGET, PushRules.ask("push:forget"))
        assertNull(PushRules.ask("push:on:x"))
        assertNull(PushRules.ask(null))
        assertEquals("push:on:$token", PushRules.onMessage(token))
        assertEquals(PushRules.STATE_FAIL, PushRules.onMessage("short"))
        assertEquals(PushRules.STATE_FAIL, PushRules.onMessage(null))
        assertEquals(PushRules.STATE_NONE, PushRules.state(configured = false, enabled = true, canPost = true))
        assertEquals(PushRules.STATE_OFF, PushRules.state(configured = true, enabled = false, canPost = true))
        assertEquals(PushRules.STATE_DENIED, PushRules.state(configured = true, enabled = true, canPost = false))
        assertNull(PushRules.state(configured = true, enabled = true, canPost = true))
    }

    // APP-알림숫자지우기: 남은 폰 알림 지우기 규칙.
    @Test
    fun clearOnlyTouchesPushChannels() {
        assertTrue(PushRules.clearable("push_task_due"))
        assertTrue(PushRules.clearable(PushRules.channelId("family")))
        assertFalse(PushRules.clearable("recording"))
        assertFalse(PushRules.clearable("app_update"))
        assertFalse(PushRules.clearable(null))
        assertFalse(PushRules.clearable(""))
    }

    @Test
    fun noticeTagComesFromOpenAsIs() {
        assertEquals("next_week.2026-11-16", PushRules.noticeTag("/work/app/?view=calendar&notice=next_week.2026-11-16"))
        assertEquals("meeting_done.m%3Aabc-1", PushRules.noticeTag("/work/app/?notice=meeting_done.m%3Aabc-1&view=meetings"))
        assertNull(PushRules.noticeTag("/work/app/"))
        assertNull(PushRules.noticeTag("/work/app/?view=home"))
        assertNull(PushRules.noticeTag("/work/app/?notice=Bad.kind"))
        assertNull(PushRules.noticeTag("/work/app/?notice=next_week"))
        assertNull(PushRules.noticeTag(null))
    }

    @Test
    fun clearKeyAcceptsOnlyItsShape() {
        assertEquals("next_week.2026-11-16", PushRules.clearKey("push:clear:next_week.2026-11-16"))
        assertEquals("meeting_done.m%3Aabc-1", PushRules.clearKey("push:clear:meeting_done.m%3Aabc-1"))
        assertNull(PushRules.clearKey("push:clear:"))
        assertNull(PushRules.clearKey("push:clear:next_week"))
        assertNull(PushRules.clearKey("push:clear:next_week.a b"))
        assertNull(PushRules.clearKey("push:hello"))
        assertNull(PushRules.clearKey(null))
        // 다른 다리 글(push:hello 등)의 해석은 그대로다.
        assertNull(PushRules.ask("push:clear:next_week.2026-11-16"))
        assertEquals(PushRules.Ask.HELLO, PushRules.ask("push:hello"))
    }

    @Test
    fun noticeTagAndClearKeyMeet() {
        val open = "/work/app/?view=calendar&notice=next_week.2026-11-16"
        assertEquals(PushRules.noticeTag(open), PushRules.clearKey("push:clear:next_week.2026-11-16"))
    }
}
