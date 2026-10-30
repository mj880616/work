package kr.or.kptu.work

import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Base64
import android.util.Size
import android.webkit.WebResourceResponse
import androidx.core.content.ContextCompat
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.SecureRandom

/**
 * PHOTO-출처 ①: 사진 메뉴 '폰 사진'(규칙은 PhoneMediaRules). 웹이 __phone/<열쇠>/… 를 fetch하면 여기서 폰 사진첩(MediaStore)을 읽어 답한다.
 * - 서버로 나가지 않는다. 사진·목록을 저장하지 않는다(목록은 메모리에 30초만, 그림은 요청마다 만든다).
 * - 접근은 사용자가 허락한 만큼만(안드로이드 14 부분 허용이면 고른 사진만 MediaStore가 돌려준다).
 * - 사진 이름·내용은 로그에 쓰지 않는다.
 */
object PhoneMedia {
    private val random = SecureRandom()

    /** 이번 앱 프로세스의 열쇠. 허용 Origin 최상위 화면 다리(photos:hello)에만 준다. */
    val key: String by lazy {
        val bytes = ByteArray(24)
        random.nextBytes(bytes)
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    private const val CACHE_MS = 30_000L
    @Volatile private var cache: List<PhoneMediaRules.Media>? = null
    @Volatile private var cacheAt = 0L

    fun forget() {
        cache = null
        cacheAt = 0L
    }

    fun access(context: Context): PhoneMediaRules.Access {
        val granted = PhoneMediaRules.permissionsToAsk(Build.VERSION.SDK_INT)
            .filter { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }.toSet()
        return PhoneMediaRules.access(Build.VERSION.SDK_INT, granted)
    }

    fun stateMessage(context: Context): String = PhoneMediaRules.stateMessage(access(context), key, Build.VERSION.SDK_INT)

    /** WebView 요청 가로채기. __phone 주소가 아니면 null. */
    fun serve(url: String?, method: String?, context: Context): WebResourceResponse? {
        val req = PhoneMediaRules.request(url, method, key) ?: return null
        if (req is PhoneMediaRules.Request.Bad || access(context) == PhoneMediaRules.Access.NONE) return notFound()
        return try {
            when (req) {
                is PhoneMediaRules.Request.Page -> json(PhoneMediaRules.pageJson(PhoneMediaRules.page(all(context), req)))
                is PhoneMediaRules.Request.Ids -> json(PhoneMediaRules.idsJson(all(context), req.ids))
                is PhoneMediaRules.Request.Months -> json(PhoneMediaRules.monthsJson(PhoneMediaRules.filter(all(context), req.filter)))
                is PhoneMediaRules.Request.Days -> json(PhoneMediaRules.daysJson(PhoneMediaRules.filter(all(context), req.filter), req.month, req.prefer))
                is PhoneMediaRules.Request.Thumb -> thumb(context, req)
                is PhoneMediaRules.Request.Original -> original(context, req.id)
                PhoneMediaRules.Request.Bad -> notFound()
            }
        } catch (_: Exception) {
            notFound()
        }
    }

    fun uriOf(m: PhoneMediaRules.Media): Uri = ContentUris.withAppendedId(
        if (m.video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI, m.id,
    )

    /** 사진·동영상 목록(허락된 것만). 30초 안이면 메모리의 것을 다시 쓴다. */
    @Synchronized
    fun all(context: Context, fresh: Boolean = false): List<PhoneMediaRules.Media> {
        val now = SystemClock.elapsedRealtime()
        cache?.let { if (!fresh && now - cacheAt < CACHE_MS) return it }
        val out = ArrayList<PhoneMediaRules.Media>()
        val cols = arrayOf(
            MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, "date_taken",
            MediaStore.MediaColumns.DATE_MODIFIED, MediaStore.MediaColumns.DATE_ADDED, MediaStore.MediaColumns.MIME_TYPE,
            "width", "height", "duration", "relative_path", MediaStore.Files.FileColumns.MEDIA_TYPE,
        )
        val sel = "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN (${MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE},${MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO})"
        context.contentResolver.query(MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL), cols, sel, null, null)?.use { c ->
            val iId = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
            val iName = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
            val iSize = c.getColumnIndex(MediaStore.MediaColumns.SIZE)
            val iTaken = c.getColumnIndex("date_taken")
            val iMod = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED)
            val iAdd = c.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED)
            val iMime = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
            val iW = c.getColumnIndex("width")
            val iH = c.getColumnIndex("height")
            val iDur = c.getColumnIndex("duration")
            val iPath = c.getColumnIndex("relative_path")
            val iType = c.getColumnIndex(MediaStore.Files.FileColumns.MEDIA_TYPE)
            fun long(i: Int): Long? = if (i >= 0 && !c.isNull(i)) c.getLong(i) else null
            fun str(i: Int): String? = if (i >= 0 && !c.isNull(i)) c.getString(i) else null
            while (c.moveToNext()) {
                val name = str(iName) ?: ""
                val (takenMs, approx) = PhoneMediaRules.taken(long(iTaken), long(iMod), long(iAdd))
                val video = long(iType) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toLong()
                out.add(
                    PhoneMediaRules.Media(
                        id = c.getLong(iId), name = name, size = long(iSize) ?: -1L, takenMs = takenMs, approx = approx,
                        addedMs = (long(iAdd) ?: 0L) * 1000, mime = str(iMime) ?: if (video) "video/mp4" else "image/jpeg",
                        width = (long(iW) ?: 0L).toInt(), height = (long(iH) ?: 0L).toInt(), durationMs = long(iDur) ?: 0L,
                        video = video, screenshot = PhoneMediaRules.isScreenshot(str(iPath), name),
                    ),
                )
            }
        }
        cache = out
        cacheAt = now
        return out
    }

    private fun find(context: Context, id: Long): PhoneMediaRules.Media? =
        all(context).firstOrNull { it.id == id } ?: all(context, fresh = true).firstOrNull { it.id == id }

    private fun thumb(context: Context, req: PhoneMediaRules.Request.Thumb): WebResourceResponse {
        val m = find(context, req.id) ?: return notFound()
        val side = PhoneMediaRules.thumbSide(req.large)
        val bitmap = context.contentResolver.loadThumbnail(uriOf(m), Size(side, side), null)
        val bytes = ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, if (req.large) 88 else 78, out)
            bitmap.recycle()
            out.toByteArray()
        }
        return WebResourceResponse("image/jpeg", null, 200, "OK", headers(), ByteArrayInputStream(bytes))
    }

    private fun original(context: Context, id: Long): WebResourceResponse {
        val m = find(context, id) ?: return notFound()
        val stream = context.contentResolver.openInputStream(uriOf(m)) ?: return notFound()
        return WebResourceResponse(m.mime, null, 200, "OK", headers(), stream)
    }

    private fun headers() = mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")

    private fun json(text: String): WebResourceResponse =
        WebResourceResponse("application/json", "utf-8", 200, "OK", headers(), ByteArrayInputStream(text.toByteArray(Charsets.UTF_8)))

    private fun notFound(): WebResourceResponse =
        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))

    /** 폰 휴지통으로 보내기 요청(안드로이드 11+, 시스템이 확인 창을 띄움). 지금 목록에 있는 것만. */
    fun trashUris(context: Context, ids: List<Long>): List<Uri> {
        val byId = all(context, fresh = true).associateBy { it.id }
        return ids.mapNotNull { byId[it] }.map(::uriOf)
    }
}
