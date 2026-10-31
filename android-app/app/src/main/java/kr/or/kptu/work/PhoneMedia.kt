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
import android.util.Log
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
 * - 사진 이름·내용은 로그에 쓰지 않는다(실패는 종류·단계·예외 클래스 이름만).
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

    /** 목록 읽기 실패(종류·예외 클래스 이름만). */
    private class ListFailed(val fail: PhoneMediaRules.Fail, val detail: String) : Exception()

    /**
     * WebView 요청 가로채기. __phone 주소가 아니면 null.
     * PHOTO-폰사진못읽음: 실패를 빈 404 하나로 뭉개지 않고 종류(PhoneMediaRules.Fail)와 예외 클래스 이름을 JSON으로 돌려준다.
     */
    fun serve(url: String?, method: String?, context: Context): WebResourceResponse? {
        val req = PhoneMediaRules.request(url, method, key) ?: return null
        if (req is PhoneMediaRules.Request.Bad) return fail(PhoneMediaRules.Fail.BAD_REQUEST, "", "request")
        if (req is PhoneMediaRules.Request.WrongKey) return fail(PhoneMediaRules.Fail.KEY, "", "request")
        if (access(context) == PhoneMediaRules.Access.NONE) return fail(PhoneMediaRules.Fail.PERMISSION, "none", "access")
        val stage = PhoneMediaRules.stageOf(req)
        return try {
            when (req) {
                is PhoneMediaRules.Request.Page -> json(PhoneMediaRules.pageJson(PhoneMediaRules.page(all(context), req)))
                is PhoneMediaRules.Request.Ids -> json(PhoneMediaRules.idsJson(all(context), req.ids))
                PhoneMediaRules.Request.Folders -> json(PhoneMediaRules.foldersJson(all(context)))
                is PhoneMediaRules.Request.Months -> json(PhoneMediaRules.monthsJson(PhoneMediaRules.filter(all(context), req.filter)))
                is PhoneMediaRules.Request.Days -> json(PhoneMediaRules.daysJson(PhoneMediaRules.filter(all(context), req.filter), req.month, req.prefer))
                is PhoneMediaRules.Request.Thumb -> thumb(context, req)
                is PhoneMediaRules.Request.Original -> original(context, req.id)
                PhoneMediaRules.Request.Bad, PhoneMediaRules.Request.WrongKey -> fail(PhoneMediaRules.Fail.BAD_REQUEST, "", "request")
            }
        } catch (e: ListFailed) {
            fail(e.fail, e.detail, "list")
        } catch (e: Exception) {
            fail(PhoneMediaRules.classify(e, stage), PhoneMediaRules.detailOf(e), stage.name.lowercase())
        }
    }

    fun uriOf(m: PhoneMediaRules.Media): Uri = ContentUris.withAppendedId(
        if (m.video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI, m.id,
    )

    /**
     * 사진·동영상 목록(허락된 것만). 30초 안이면 메모리의 것을 다시 쓴다.
     * PHOTO-폰사진못읽음: 예전에는 MediaStore.Files(모든 파일 모음)를 MEDIA_TYPE으로 걸렀다. 안드로이드 13+ 사진·동영상 권한은
     * 모음별(Images·Video)이라, 문서가 권하는 대로 두 모음을 따로 읽어 합친다. 한쪽만 실패하면 다른 쪽은 보이고, 둘 다 실패하면 첫 실패를 돌려준다.
     */
    @Synchronized
    fun all(context: Context, fresh: Boolean = false): List<PhoneMediaRules.Media> {
        val now = SystemClock.elapsedRealtime()
        cache?.let { if (!fresh && now - cacheAt < CACHE_MS) return it }
        var first: ListFailed? = null
        fun read(video: Boolean): List<PhoneMediaRules.Media>? = try {
            query(context, video)
        } catch (e: Exception) {
            val f = ListFailed(PhoneMediaRules.classify(e, PhoneMediaRules.Stage.LIST), PhoneMediaRules.detailOf(e))
            log(f.fail, f.detail, if (video) "list-video" else "list-image")
            if (first == null) first = f
            null
        }
        val out = PhoneMediaRules.combine(read(false), read(true)) ?: throw (first ?: ListFailed(PhoneMediaRules.Fail.QUERY, ""))
        cache = out
        cacheAt = now
        return out
    }

    /** 한 모음(사진 또는 동영상) 읽기. 열 이름은 그 모음의 MediaStore 상수만 쓴다. */
    private fun query(context: Context, video: Boolean): List<PhoneMediaRules.Media> {
        val uri = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val base = arrayOf(
            MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_TAKEN,
            MediaStore.MediaColumns.DATE_MODIFIED, MediaStore.MediaColumns.DATE_ADDED, MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.WIDTH, MediaStore.MediaColumns.HEIGHT, MediaStore.MediaColumns.RELATIVE_PATH,
        )
        val cols = if (video) base + MediaStore.Video.VideoColumns.DURATION else base
        val out = ArrayList<PhoneMediaRules.Media>()
        val cursor = context.contentResolver.query(uri, cols, null, null, null) ?: throw IllegalStateException("cursor")
        cursor.use { c ->
            val iId = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
            val iName = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
            val iSize = c.getColumnIndex(MediaStore.MediaColumns.SIZE)
            val iTaken = c.getColumnIndex(MediaStore.MediaColumns.DATE_TAKEN)
            val iMod = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED)
            val iAdd = c.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED)
            val iMime = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
            val iW = c.getColumnIndex(MediaStore.MediaColumns.WIDTH)
            val iH = c.getColumnIndex(MediaStore.MediaColumns.HEIGHT)
            val iDur = if (video) c.getColumnIndex(MediaStore.Video.VideoColumns.DURATION) else -1
            val iPath = c.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
            fun long(i: Int): Long? = if (i >= 0 && !c.isNull(i)) c.getLong(i) else null
            fun str(i: Int): String? = if (i >= 0 && !c.isNull(i)) c.getString(i) else null
            while (c.moveToNext()) {
                val name = str(iName) ?: ""
                val (takenMs, approx) = PhoneMediaRules.taken(long(iTaken), long(iMod), long(iAdd))
                out.add(
                    PhoneMediaRules.Media(
                        id = c.getLong(iId), name = name, size = long(iSize) ?: -1L, takenMs = takenMs, approx = approx,
                        addedMs = (long(iAdd) ?: 0L) * 1000, mime = str(iMime) ?: if (video) "video/mp4" else "image/jpeg",
                        width = (long(iW) ?: 0L).toInt(), height = (long(iH) ?: 0L).toInt(), durationMs = long(iDur) ?: 0L,
                        video = video, screenshot = PhoneMediaRules.isScreenshot(str(iPath), name), folder = str(iPath) ?: "",
                    ),
                )
            }
        }
        return out
    }

    private fun find(context: Context, id: Long): PhoneMediaRules.Media? =
        all(context).firstOrNull { it.id == id } ?: all(context, fresh = true).firstOrNull { it.id == id }

    private fun thumb(context: Context, req: PhoneMediaRules.Request.Thumb): WebResourceResponse {
        val m = find(context, req.id) ?: return fail(PhoneMediaRules.Fail.NOT_FOUND, "", "thumb")
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
        val m = find(context, id) ?: return fail(PhoneMediaRules.Fail.NOT_FOUND, "", "original")
        val stream = context.contentResolver.openInputStream(uriOf(m)) ?: return fail(PhoneMediaRules.Fail.NOT_FOUND, "", "original")
        return WebResourceResponse(m.mime, null, 200, "OK", headers(), stream)
    }

    private fun headers() = mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")

    private fun json(text: String): WebResourceResponse =
        WebResourceResponse("application/json", "utf-8", 200, "OK", headers(), ByteArrayInputStream(text.toByteArray(Charsets.UTF_8)))

    /** 실패 답: 상태 코드 + {"error":종류,"detail":예외 클래스 이름}. 로그에도 종류·단계·클래스 이름만(사진 이름·경로·예외 글 없음). */
    private fun fail(f: PhoneMediaRules.Fail, detail: String, stage: String): WebResourceResponse {
        log(f, detail, stage)
        val body = PhoneMediaRules.failJson(f, detail).toByteArray(Charsets.UTF_8)
        return WebResourceResponse("application/json", "utf-8", f.status, PhoneMediaRules.reasonPhrase(f.status), headers(), ByteArrayInputStream(body))
    }

    private fun log(f: PhoneMediaRules.Fail, detail: String, stage: String) {
        try {
            Log.w(TAG, "fail stage=$stage kind=${f.code} cls=${PhoneMediaRules.safeDetail(detail)}")
        } catch (_: Exception) {
        }
    }

    private const val TAG = "KPTUPhoneMedia"

    /** 폰 휴지통으로 보내기 요청(안드로이드 11+, 시스템이 확인 창을 띄움). 지금 목록에 있는 것만. */
    fun trashUris(context: Context, ids: List<Long>): List<Uri> {
        val byId = all(context, fresh = true).associateBy { it.id }
        return ids.mapNotNull { byId[it] }.map(::uriOf)
    }
}
