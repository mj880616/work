package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShellRulesTest {
    @Test
    fun internalAppAddresses() {
        assertTrue(ShellRules.isInternalApp("https://desk.bokdoong.com/work/app/"))
        assertTrue(ShellRules.isInternalApp("https://desk.bokdoong.com/work/app/?view=basket"))
        assertTrue(ShellRules.isInternalApp("https://desk.bokdoong.com/work/app/native-callback.html?native=android"))
        assertTrue(ShellRules.isInternalApp("https://desk.bokdoong.com/"))
        assertTrue(ShellRules.isInternalApp("https://work.bokdoong.com/work/app/"))
        assertTrue(ShellRules.isInternalApp("https://mj880616.github.io/work/app/"))
        assertTrue(ShellRules.isInternalApp("https://DESK.bokdoong.com/work/app"))
    }

    @Test
    fun outsideAddresses() {
        assertFalse(ShellRules.isInternalApp("http://desk.bokdoong.com/work/app/"))
        assertFalse(ShellRules.isInternalApp("https://desk.bokdoong.com/work/apps/"))
        assertFalse(ShellRules.isInternalApp("https://desk.bokdoong.com/p/"))
        assertFalse(ShellRules.isInternalApp("https://work.bokdoong.com/"))
        assertFalse(ShellRules.isInternalApp("https://mj880616.github.io/"))
        assertFalse(ShellRules.isInternalApp("https://desk.bokdoong.com.evil.example/work/app/"))
        assertFalse(ShellRules.isInternalApp("https://desk.bokdoong.com@evil.example/work/app/"))
        assertFalse(ShellRules.isInternalApp("https://desk.bokdoong.com:8443/work/app/"))
        assertFalse(ShellRules.isInternalApp("https://xmlkxfjeagycwttklxjw.supabase.co/auth/v1/authorize?provider=google"))
        assertFalse(ShellRules.isInternalApp("javascript:alert(1)"))
        assertFalse(ShellRules.isInternalApp(null))
        assertFalse(ShellRules.isInternalApp("not a url"))
        assertTrue(ShellRules.opensOutside("https://accounts.google.com/"))
        assertTrue(ShellRules.opensOutside("https://desk.bokdoong.com/work/app/file?external=1"))
        assertFalse(ShellRules.opensOutside("https://desk.bokdoong.com/work/app/?external=0"))
    }

    @Test
    fun loginReturnPassesOnlyKnownValues() {
        assertEquals(
            "https://desk.bokdoong.com/work/app/?handoff=abc.DEF_12-3",
            ShellRules.homeForReturn("kptuwork://auth?handoff=abc.DEF_12-3"),
        )
        assertEquals(
            "https://desk.bokdoong.com/work/app/?google=connected",
            ShellRules.homeForReturn("kptuwork://auth?google=connected&access_token=x&refresh_token=y"),
        )
        assertEquals(
            "https://desk.bokdoong.com/work/app/?google=error&reason=a+b",
            ShellRules.homeForReturn("kptuwork://auth?google=error&reason=a%20b"),
        )
        assertEquals(ShellRules.HOME, ShellRules.homeForReturn("kptuwork://auth?payload=secret"))
        assertEquals(ShellRules.HOME, ShellRules.homeForReturn("kptuwork://other?handoff=abc"))
        assertEquals(ShellRules.HOME, ShellRules.homeForReturn("https://evil.example/?handoff=abc"))
        assertEquals(ShellRules.HOME, ShellRules.homeForReturn("kptuwork://auth?handoff=" + "a".repeat(5000)))
        assertTrue(ShellRules.isAppReturn("kptuwork://auth?handoff=1"))
        assertFalse(ShellRules.isAppReturn("kptuwork://evil?handoff=1"))
    }

    @Test
    fun barColors() {
        assertEquals(0xFFF3F1EA.toInt(), ShellRules.parseColor("#f3f1ea"))
        assertEquals(0xFF161613.toInt(), ShellRules.parseColor(" #161613 "))
        assertEquals(0xFFFFFFFF.toInt(), ShellRules.parseColor("#fff"))
        assertNull(ShellRules.parseColor("red"))
        assertNull(ShellRules.parseColor("#12345"))
        assertNull(ShellRules.parseColor("url(x)"))
        assertNull(ShellRules.parseColor(null))
        assertTrue(ShellRules.isLight(ShellRules.parseColor("#f3f1ea")!!))
        assertTrue(ShellRules.isLight(ShellRules.parseColor("#eef6fd")!!))
        assertFalse(ShellRules.isLight(ShellRules.parseColor("#161613")!!))
    }

    @Test
    fun versions() {
        assertTrue(ShellRules.isNewer("0.2.1", "0.2.0"))
        assertTrue(ShellRules.isNewer("0.10.0", "0.9.9"))
        assertTrue(ShellRules.isNewer("1.0.0", "0.99.99"))
        assertFalse(ShellRules.isNewer("0.2.0", "0.2.0"))
        assertFalse(ShellRules.isNewer("0.1.13", "0.2.0"))
        assertFalse(ShellRules.isNewer("0.2", "0.1.0"))
        assertFalse(ShellRules.isNewer("0.3.0-beta", "0.2.0"))
        assertEquals("0.3.0", ShellRules.versionFromTag("phone-app-v0.3.0"))
        assertNull(ShellRules.versionFromTag("basket-pc-v0.3.0"))
        assertNull(ShellRules.versionFromTag("phone-app-vlatest"))
    }

    @Test
    fun onlyThisRepositoryApk() {
        val base = "https://github.com/mj880616/work/releases/download/phone-app-v0.3.0/"
        assertTrue(ShellRules.isTrustedApk(base + "web2-phone-0.3.0.apk", "0.3.0"))
        assertFalse(ShellRules.isTrustedApk(base + "web2-phone-0.3.0.zip", "0.3.0"))
        assertFalse(ShellRules.isTrustedApk(base + "../x.apk", "0.3.0"))
        assertFalse(ShellRules.isTrustedApk(base + "a/b.apk", "0.3.0"))
        assertFalse(ShellRules.isTrustedApk(base + "web2-phone-0.3.0.apk", "0.3.1"))
        assertFalse(ShellRules.isTrustedApk("https://github.com/other/work/releases/download/phone-app-v0.3.0/a.apk", "0.3.0"))
        assertFalse(ShellRules.isTrustedApk(null, "0.3.0"))
    }
}
