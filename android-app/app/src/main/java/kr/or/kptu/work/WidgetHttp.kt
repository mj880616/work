package kr.or.kptu.work

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * 위젯 로그인·읽기 요청 한 건. 본문은 JSON 글(POST만).
 * APP-위젯빠른쓰기 [사진]: parts가 있으면 multipart 본문(basket-files 올리기 하나만, WidgetRules.allowedParts가 모양을 고정).
 */
data class WidgetRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: String? = null,
    val parts: List<WidgetPart>? = null,
)

/** multipart 칸 하나: 글 칸(value) 또는 파일 칸(file·fileName·type). */
data class WidgetPart(
    val name: String,
    val value: String? = null,
    val file: File? = null,
    val fileName: String? = null,
    val type: String? = null,
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
        val parts = request.parts
        when (request.method) {
            "GET" -> builder.get()
            "POST" -> builder.post(if (parts != null) multipart(parts) else (request.body ?: "").toRequestBody(JSON))
            else -> throw IOException("method")
        }
        // 사진 올리기는 몇 MB라 시간 한도를 넉넉히(읽기·로그인 요청은 그대로 짧게).
        val c = if (parts != null) upload else client
        c.newCall(builder.build()).execute().use { res ->
            val text = res.body?.string() ?: ""
            return WidgetResponse(res.code, if (text.length > MAX_BODY) text.substring(0, MAX_BODY) else text)
        }
    }

    private val upload: OkHttpClient by lazy {
        client.newBuilder()
            .writeTimeout(60, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .callTimeout(5, TimeUnit.MINUTES)
            .build()
    }

    private fun multipart(parts: List<WidgetPart>): MultipartBody {
        val b = MultipartBody.Builder().setType(MultipartBody.FORM)
        for (p in parts) {
            val f = p.file
            if (f != null) b.addFormDataPart(p.name, p.fileName ?: f.name, f.asRequestBody((p.type ?: "application/octet-stream").toMediaType()))
            else b.addFormDataPart(p.name, p.value ?: "")
        }
        return b.build()
    }

    private companion object {
        val JSON = "application/json".toMediaType()
        const val MAX_BODY = 2_000_000
    }
}
