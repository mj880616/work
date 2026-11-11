package kr.or.kptu.work

import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * APP-뒤에서올리기(설계 16.5절): 올리기 본문을 다 보낸 뒤 답을 못 받으면 '결과 모름'(WidgetSentException)으로 갈라
 * 같은 파일을 저절로 다시 보내지 않는다. once면 HTTP 도구도 스스로 다시 보내지 않는다. 시험 서버는 이 컴퓨터 안의 지어낸 것이다.
 */
class BackUploadHttpTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var server: ServerSocket
    private val requests = AtomicInteger()
    private val bodies = CopyOnWriteArrayList<Int>()
    /** true면 요청을 다 읽은 뒤 답 없이 끊는다. */
    @Volatile
    private var cut = false

    @Before
    fun start() {
        server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = try {
                    server.accept()
                } catch (_: IOException) {
                    break
                }
                thread(isDaemon = true) { serve(socket) }
            }
        }
    }

    @After
    fun stop() = server.close()

    private fun serve(socket: Socket) {
        socket.use { s ->
            try {
                val input = s.getInputStream()
                while (true) {
                    val head = readHead(input) ?: return
                    requests.incrementAndGet()
                    val length = Regex("(?im)^content-length:\\s*(\\d+)\\s*$").find(head)?.groupValues?.get(1)?.toInt() ?: 0
                    var got = 0
                    val buf = ByteArray(8192)
                    while (got < length) {
                        val n = input.read(buf, 0, minOf(buf.size, length - got))
                        if (n < 0) return
                        got += n
                    }
                    bodies.add(got)
                    if (cut) return
                    val out = "{\"ok\":true,\"document\":{\"id\":\"cccccccc-0000-4ccc-8ddd-000000000001\"}}".toByteArray()
                    s.getOutputStream().apply {
                        write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${out.size}\r\n\r\n").toByteArray())
                        write(out)
                        flush()
                    }
                }
            } catch (_: IOException) {
            }
        }
    }

    /** 머리글 끝(빈 줄)까지 읽는다. 연결이 끝났으면 null. */
    private fun readHead(input: InputStream): String? {
        val out = ByteArrayOutputStream()
        var tail = 0
        while (true) {
            val b = input.read()
            if (b < 0) return null
            out.write(b)
            tail = (tail shl 8) or b
            if (tail == 0x0d0a0d0a) return out.toString("ISO-8859-1")
        }
    }

    private fun request(once: Boolean): WidgetRequest {
        val file = tmp.newFile().apply { writeBytes(ByteArray(300_000) { 7 }) }
        val parts = listOf(
            WidgetPart("file", file = file, fileName = "a.jpg", type = "image/jpeg"),
            WidgetPart("meeting_id", value = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
        )
        return WidgetRequest("POST", "http://127.0.0.1:${server.localPort}/functions/v1/library-files", mapOf("Authorization" to "Bearer t"), null, parts, once)
    }

    private fun http() = OkHttpWidgetHttp(OkHttpClient.Builder().proxy(Proxy.NO_PROXY).build())

    @Test
    fun multipartUploadReachesTheServerOnce() {
        val res = http().send(request(once = true))
        assertEquals(200, res.status)
        assertTrue(res.body.contains("\"ok\":true"))
        assertEquals(1, requests.get())
        assertTrue(bodies.single() > 300_000)
    }

    @Test
    fun cutAfterTheBodyWasSentIsReportedAsSentAndNotResent() {
        cut = true
        try {
            http().send(request(once = true))
            fail("expected WidgetSentException")
        } catch (_: WidgetSentException) {
        }
        // 서버는 본문을 다 받았다(이미 저장했을 수 있음). HTTP 도구가 같은 본문을 스스로 한 번 더 보내지 않는다.
        assertEquals(1, requests.get())
        assertTrue(bodies.single() > 300_000)
    }

    @Test
    fun jsonRequestsKeepPlainNetworkErrors() {
        cut = true
        try {
            http().send(WidgetRequest("POST", "http://127.0.0.1:${server.localPort}/auth/v1/token", mapOf("Content-Type" to "application/json"), "{}"))
            fail("expected IOException")
        } catch (e: IOException) {
            // 올리기(multipart)가 아닌 요청은 지금처럼 보통 네트워크 오류다.
            assertTrue(e !is WidgetSentException)
        }
    }
}
