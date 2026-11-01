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
        // app_push_log.kind 검사 제약과 같은 아홉 가지(2절 일곱 종류 + 조용한 시간 묶음 + 시험).
        assertEquals(
            listOf("task_due", "commitment", "meeting_done", "collect_stall", "morning", "evening", "next_week", "quiet_digest", "test"),
            PushRules.KINDS.keys.toList(),
        )
        assertTrue(PushRules.urgent("task_due"))
        assertTrue(PushRules.urgent("collect_stall"))
        assertFalse(PushRules.urgent("morning"))
        assertFalse(PushRules.urgent("evening"))
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
}
