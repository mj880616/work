package kr.or.kptu.work

import kr.or.kptu.work.PhoneFilesRules.Entry
import kr.or.kptu.work.PhoneFilesRules.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class PhoneFilesRulesTest {
    private val key = "abcdefghijklmnopqrstuvwxyzABCDEF"
    private val base = "https://bokdoong.com/work/app/__phone/$key/files/"

    @Test
    fun onlyFilesAddressesAreTaken() {
        // 사진 다리 주소·다른 주소는 넘긴다(null → 다음 다리).
        assertNull(PhoneFilesRules.request("https://bokdoong.com/work/app/__phone/$key/page", "GET", key))
        assertNull(PhoneFilesRules.request("https://bokdoong.com/work/app/index.html", "GET", key))
        assertNull(PhoneFilesRules.request("https://bokdoong.com/work/app/__phone/$key/page?folder=files/x", "GET", key))
        assertEquals(Request.List(""), PhoneFilesRules.request(base + "list", "GET", key))
        assertEquals(Request.List("Documents/회의"), PhoneFilesRules.request(base + "list?dir=Documents%2F%ED%9A%8C%EC%9D%98", "GET", key))
        assertEquals(Request.Recent(200), PhoneFilesRules.request(base + "recent", "GET", key))
        assertEquals(Request.Recent(50), PhoneFilesRules.request(base + "recent?limit=50", "GET", key))
        assertEquals(Request.Raw("Download/a b.pdf"), PhoneFilesRules.request(base + "raw?path=Download%2Fa+b.pdf", "GET", key))
        assertEquals(Request.Thumb("DCIM/x.jpg", true), PhoneFilesRules.request(base + "thumb?path=DCIM%2Fx.jpg&s=large", "GET", key))
    }

    @Test
    fun sameDoorAsPhotoBridge() {
        val other = "ZZZZefghijklmnopqrstuvwxyzABCDEF"
        assertEquals(Request.WrongKey, PhoneFilesRules.request("https://bokdoong.com/work/app/__phone/$other/files/list", "GET", key))
        assertEquals(Request.WrongKey, PhoneFilesRules.request(base + "list", "GET", ""))
        assertEquals(Request.Bad, PhoneFilesRules.request("https://evil.example/work/app/__phone/$key/files/list", "GET", key))
        assertEquals(Request.Bad, PhoneFilesRules.request("http://bokdoong.com/work/app/__phone/$key/files/list", "GET", key))
        assertEquals(Request.Bad, PhoneFilesRules.request("https://bokdoong.com:8443/work/app/__phone/$key/files/list", "GET", key))
        assertEquals(Request.Bad, PhoneFilesRules.request("https://u@bokdoong.com/work/app/__phone/$key/files/list", "GET", key))
        assertEquals(Request.Bad, PhoneFilesRules.request(base + "list", "POST", key))
        assertEquals(Request.Bad, PhoneFilesRules.request(base + "list#x", "GET", key))
        assertEquals(Request.Bad, PhoneFilesRules.request(base + "write", "GET", key))
        assertEquals(Request.Bad, PhoneFilesRules.request(base + "list?dir=a&dir=b", "GET", key))
        assertEquals(Request.Bad, PhoneFilesRules.request(base + "list?path=a", "GET", key))
        assertEquals(Request.Bad, PhoneFilesRules.request(base + "recent?limit=0", "GET", key))
        assertEquals(Request.Bad, PhoneFilesRules.request(base + "recent?limit=999", "GET", key))
        assertEquals(Request.Bad, PhoneFilesRules.request(base + "raw", "GET", key))
        assertEquals(Request.Bad, PhoneFilesRules.request(base + "thumb?path=a.jpg&s=huge", "GET", key))
    }

    @Test
    fun pathsStayInsideAndAwayFromBlockedPlaces() {
        for (bad in listOf("../x", "a/../b", "a/./b", "/a", "a/", "a//b", "a\\b", ".hidden", "a/.thumbnails/x", "a\u0000b", "a\nb",
            "Android/data", "android/DATA/com.x/f", "Android/obb/x", "x".repeat(256))) {
            assertNull(bad, PhoneFilesRules.segments(bad))
            assertEquals(bad, Request.Bad, PhoneFilesRules.request(base + "raw?path=" + java.net.URLEncoder.encode(bad, "UTF-8"), "GET", key))
        }
        assertEquals(Request.Bad, PhoneFilesRules.request(base + "list?dir=Android%2Fdata", "GET", key))
        assertNotNull(PhoneFilesRules.segments("Android/media/x"))
        assertNotNull(PhoneFilesRules.segments("Download/한글 문서 (2).hwp"))
        assertNull(PhoneFilesRules.segments(List(41) { "a" }.joinToString("/")))
        // 목록에서도 빠진다.
        assertFalse(PhoneFilesRules.visibleChild(listOf("Android"), "data"))
        assertFalse(PhoneFilesRules.visibleChild(listOf("Android"), "obb"))
        assertTrue(PhoneFilesRules.visibleChild(listOf("Android"), "media"))
        assertFalse(PhoneFilesRules.visibleChild(emptyList(), ".nomedia"))
        assertTrue(PhoneFilesRules.visibleChild(emptyList(), "Download"))
    }

    @Test
    fun resolveFollowsLinksOnlyInsideRoot() {
        val tmp = Files.createTempDirectory("pfiles").toFile()
        try {
            val root = File(tmp, "root").apply { mkdirs() }
            val outside = File(tmp, "outside").apply { mkdirs() }
            File(outside, "secret.txt").writeText("x")
            File(root, "Download").mkdirs()
            File(root, "Download/a.txt").writeText("a")
            File(root, "Android/data/app").mkdirs()
            File(root, "Android/data/app/f.txt").writeText("f")
            Files.createSymbolicLink(File(root, "Download/out").toPath(), outside.toPath())
            Files.createSymbolicLink(File(root, "Download/inner").toPath(), File(root, "Android/data").toPath())

            assertEquals(File(root, "Download/a.txt").canonicalFile, PhoneFilesRules.resolve(root, "Download/a.txt"))
            assertEquals(root.canonicalFile, PhoneFilesRules.resolve(root, "", dir = true))
            assertNull(PhoneFilesRules.resolve(root, ""))
            assertNull(PhoneFilesRules.resolve(root, "Download/out/secret.txt"))
            assertNull(PhoneFilesRules.resolve(root, "Download/out", dir = true))
            assertNull(PhoneFilesRules.resolve(root, "Download/inner/app/f.txt"))
            assertNull(PhoneFilesRules.resolve(root, "Android/data/app/f.txt"))
            assertNull(PhoneFilesRules.resolve(root, "../outside/secret.txt"))
        } finally {
            tmp.deleteRecursively()
        }
    }

    @Test
    fun relOfIsRootRelative() {
        val b = File("/storage/emulated/0")
        assertEquals("", PhoneFilesRules.relOf(b, File("/storage/emulated/0")))
        assertEquals("Download/a.pdf", PhoneFilesRules.relOf(b, File("/storage/emulated/0/Download/a.pdf")))
        assertNull(PhoneFilesRules.relOf(b, File("/storage/emulated/01/x")))
        assertNull(PhoneFilesRules.relOf(b, File("/data/data/kr.or.kptu.work/files/x")))
    }

    @Test
    fun listAndRecentJson() {
        val list = listOf(
            Entry("Download/b.pdf", "b.pdf", false, 10, 2000, "application/pdf"),
            Entry("Download/Zeta", "Zeta", true, 999, 1000, ""),
            Entry("Download/a\"q.hwp", "a\"q.hwp", false, -1, -5, "application/x-hwp"),
        )
        val json = PhoneFilesRules.listJson("Download", list)
        assertEquals(
            "{\"dir\":\"Download\",\"items\":[{\"p\":\"Download/Zeta\",\"n\":\"Zeta\",\"d\":true,\"s\":0,\"m\":1000}," +
                "{\"p\":\"Download/a\\\"q.hwp\",\"n\":\"a\\\"q.hwp\",\"d\":false,\"s\":0,\"m\":0,\"t\":\"application/x-hwp\"}," +
                "{\"p\":\"Download/b.pdf\",\"n\":\"b.pdf\",\"d\":false,\"s\":10,\"m\":2000,\"t\":\"application/pdf\"}],\"more\":false}",
            json,
        )
        val parsed = MiniJson.obj(MiniJson.parse(json))
        assertEquals(3, MiniJson.list(parsed?.get("items"))?.size)

        val recent = PhoneFilesRules.recentJson(
            list + Entry("Android/data/x/y.txt", "y.txt", false, 1, 9000, "text/plain") + Entry(".hidden/z.txt", "z.txt", false, 1, 8000, "text/plain"),
            2,
        )
        assertEquals(
            "{\"items\":[{\"p\":\"Download/b.pdf\",\"n\":\"b.pdf\",\"d\":false,\"s\":10,\"m\":2000,\"t\":\"application/pdf\"}," +
                "{\"p\":\"Download/a\\\"q.hwp\",\"n\":\"a\\\"q.hwp\",\"d\":false,\"s\":0,\"m\":0,\"t\":\"application/x-hwp\"}]}",
            recent,
        )
    }

    @Test
    fun joinRelAndMime() {
        assertEquals("Download/a.pdf", PhoneFilesRules.joinRel("Download/", "a.pdf"))
        assertEquals("a.pdf", PhoneFilesRules.joinRel("", "a.pdf"))
        assertNull(PhoneFilesRules.joinRel("Android/data/x/", "a.pdf"))
        assertNull(PhoneFilesRules.joinRel("Download/", null))
        assertEquals("application/x-hwp", PhoneFilesRules.mimeOf("문서.HWP"))
        assertEquals("application/pdf", PhoneFilesRules.mimeOf("a.pdf"))
        assertEquals("application/octet-stream", PhoneFilesRules.mimeOf("noext"))
    }

    @Test
    fun bridgeMessages() {
        assertEquals(PhoneFilesRules.Message.Hello, PhoneFilesRules.message("pfiles:hello"))
        assertEquals(PhoneFilesRules.Message.Ask, PhoneFilesRules.message("pfiles:ask"))
        assertNull(PhoneFilesRules.message("pfiles:write:x"))
        assertNull(PhoneFilesRules.message(null))
        // 열쇠는 켜져 있을 때만.
        assertEquals("pfiles:state:{\"v\":1,\"can\":true,\"all\":false}", PhoneFilesRules.stateMessage(false, true, key))
        assertEquals("pfiles:state:{\"v\":1,\"can\":false,\"all\":false}", PhoneFilesRules.stateMessage(true, false, key))
        assertEquals("pfiles:state:{\"v\":1,\"can\":true,\"all\":true,\"key\":\"$key\"}", PhoneFilesRules.stateMessage(true, true, key))
    }

    @Test
    fun bridgeCodeKeepsSecrets() {
        // 로그에 파일 이름·경로를 쓰지 않는다(실패 종류·단계·예외 클래스 이름만), 서버로 보내지 않는다(네트워크 도구 없음).
        val text = File("src/main/java/kr/or/kptu/work/PhoneFiles.kt").readText()
        for (bad in listOf("OkHttp", "HttpURLConnection", "URL(", "Log.d", "Log.i", "Log.e", "printStackTrace", "e.message")) assertFalse(bad, text.contains(bad))
        val logs = Regex("Log\\.w\\(TAG, \"([^\"]*)\"").findAll(text).map { it.groupValues[1] }.toList()
        assertEquals(listOf("fail stage=\$stage kind=\${f.code} cls=\${PhoneMediaRules.safeDetail(detail)}"), logs)
        // 쓰기 길은 이 판에 없다.
        for (bad in listOf("FileOutputStream", ".delete(", ".renameTo(", ".mkdir")) assertFalse(bad, text.contains(bad))
    }
}
