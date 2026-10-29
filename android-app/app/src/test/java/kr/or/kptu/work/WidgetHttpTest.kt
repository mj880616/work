package kr.or.kptu.work

import com.sun.net.httpserver.HttpServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.URL
import java.util.concurrent.atomic.AtomicReference

/**
 * 설계 4절 '확인 필요': 앱의 직접 요청이 Origin 머리글을 보내는가.
 * 자바 표준 HttpURLConnection은 Origin을 제한 머리글로 보고 버린다 → 위젯은 OkHttp를 쓴다(서버 변경 없음).
 */
class WidgetHttpTest {
    private lateinit var server: HttpServer
    private val origin = AtomicReference<String?>()
    private val method = AtomicReference<String?>()
    private val body = AtomicReference<String?>()

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            origin.set(ex.requestHeaders.getFirst("Origin"))
            method.set(ex.requestMethod)
            body.set(ex.requestBody.bufferedReader().readText())
            val out = "{\"ok\":true}".toByteArray()
            ex.sendResponseHeaders(200, out.size.toLong())
            ex.responseBody.use { it.write(out) }
        }
        server.start()
    }

    @After
    fun stop() = server.stop(0)

    private fun url() = "http://127.0.0.1:${server.address.port}/functions/v1/auth-handoff"

    @Test
    fun okHttpSendsOriginHeader() {
        val http = OkHttpWidgetHttp(OkHttpClient.Builder().proxy(Proxy.NO_PROXY).build())
        val res = http.send(
            WidgetRequest("POST", url(), mapOf("Content-Type" to "application/json", "Origin" to WidgetRules.ORIGIN), "{\"action\":\"consume\"}"),
        )
        assertEquals(200, res.status)
        assertEquals("{\"ok\":true}", res.body)
        assertEquals("https://desk.bokdoong.com", origin.get())
        assertEquals("POST", method.get())
        assertEquals("{\"action\":\"consume\"}", body.get())
    }

    @Test
    fun jdkHttpUrlConnectionDropsOriginHeader() {
        // 이 시험이 실패하면(=JDK가 Origin을 보냄) 판단 근거가 바뀐 것이니 설계 4절을 다시 본다.
        val conn = URL(url()).openConnection(Proxy.NO_PROXY) as HttpURLConnection
        conn.requestMethod = "GET"
        conn.setRequestProperty("Origin", WidgetRules.ORIGIN)
        assertEquals(200, conn.responseCode)
        conn.inputStream.close()
        assertNull(origin.get())
    }
}
