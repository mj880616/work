package kr.or.kptu.work

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** 위젯 로그인·읽기 요청 한 건. 본문은 JSON 글(POST만). */
data class WidgetRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: String? = null,
)

data class WidgetResponse(val status: Int, val body: String)

/** 위젯이 쓰는 HTTP 도구. 시험에서는 가짜로 바꾼다. 네트워크 오류는 IOException. */
fun interface WidgetHttp {
    @Throws(IOException::class)
    fun send(request: WidgetRequest): WidgetResponse
}

/**
 * OkHttp로 보낸다(설계 4절 '확인 필요'의 답).
 * 자바 표준 HttpURLConnection은 Origin을 '제한 머리글'로 보고 소리 없이 버린다(JVM에서 시험으로 확인, WidgetHttpTest).
 * 안드로이드의 HttpURLConnection은 내부가 달라 보낼 수 있지만 JVM 시험으로 증명할 수 없다.
 * OkHttp는 JVM과 안드로이드에서 같은 코드로 Origin을 그대로 보내므로 단위 시험이 실제 동작을 확인한다. 서버는 바꾸지 않는다.
 * 쿠키·캐시는 쓰지 않는다(폰에 응답을 남기지 않음, 결정 W-D2).
 */
class OkHttpWidgetHttp(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(25, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build(),
) : WidgetHttp {
    override fun send(request: WidgetRequest): WidgetResponse {
        val builder = Request.Builder().url(request.url)
        request.headers.forEach { (k, v) -> builder.header(k, v) }
        when (request.method) {
            "GET" -> builder.get()
            "POST" -> builder.post((request.body ?: "").toRequestBody(JSON))
            else -> throw IOException("method")
        }
        client.newCall(builder.build()).execute().use { res ->
            val text = res.body?.string() ?: ""
            return WidgetResponse(res.code, if (text.length > MAX_BODY) text.substring(0, MAX_BODY) else text)
        }
    }

    private companion object {
        val JSON = "application/json".toMediaType()
        const val MAX_BODY = 2_000_000
    }
}
