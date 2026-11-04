package kr.or.kptu.work

import android.content.Context
import android.graphics.Bitmap
import android.media.ThumbnailUtils
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.util.Size
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.security.SecureRandom

/**
 * FILES-통합 3단계(S49-51, 명진 결정 H-1): [파일] '이 폰' 저장 공간 읽기 다리(규칙은 PhoneFilesRules).
 * - 웹이 __phone/<열쇠>/files/… 를 fetch하면 여기서 내부 저장소(뿌리 = 외부 저장소 기본 칸)를 읽어 답한다. 서버로 나가지 않는다.
 * - '모든 파일 접근'(안드로이드 11+, 설정에서 명진이 켬)이 켜져 있을 때만 답한다. 꺼져 있으면 403 permission.
 * - 목록·파일을 저장하지 않는다(요청마다 읽는다). 로그에는 실패 종류·단계·예외 클래스 이름만(파일 이름·경로 없음).
 * - 이 판은 읽기만(목록·최근·원본·작은 그림). 쓰기(받기·이름·새 폴더·지우기)는 다음 PR에서 사람이 누른 것만.
 */
object PhoneFiles {
    private val random = SecureRandom()

    /** 이번 앱 프로세스의 열쇠(사진 다리와 다른 값). 허용 Origin 최상위 화면 다리(pfiles:hello)에만, 권한이 켜져 있을 때만 준다. */
    val key: String by lazy {
        val bytes = ByteArray(24)
        random.nextBytes(bytes)
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    /** 이 폰에서 '모든 파일 접근'을 켤 수 있나(안드로이드 11+). */
    fun can(): Boolean = Build.VERSION.SDK_INT >= 30

    /** 지금 켜져 있나. */
    fun granted(): Boolean = try {
        can() && Environment.isExternalStorageManager()
    } catch (_: Exception) {
        false
    }

    fun stateMessage(): String = PhoneFilesRules.stateMessage(granted(), can(), key)

    @Suppress("DEPRECATION")
    private fun root(): File = Environment.getExternalStorageDirectory()

    /** WebView 요청 가로채기. __phone/…/files/ 주소가 아니면 null(다음 다리로). */
    fun serve(url: String?, method: String?, context: Context): WebResourceResponse? {
        val req = PhoneFilesRules.request(url, method, key) ?: return null
        if (req is PhoneFilesRules.Request.Bad) return fail(PhoneFilesRules.Fail.BAD_REQUEST, "request", "")
        if (req is PhoneFilesRules.Request.WrongKey) return fail(PhoneFilesRules.Fail.KEY, "request", "")
        if (!granted()) return fail(PhoneFilesRules.Fail.PERMISSION, "access", "")
        val stage = when (req) {
            is PhoneFilesRules.Request.List -> "list"
            is PhoneFilesRules.Request.Recent -> "recent"
            is PhoneFilesRules.Request.Raw -> "raw"
            is PhoneFilesRules.Request.Thumb -> "thumb"
            else -> "request"
        }
        return try {
            when (req) {
                is PhoneFilesRules.Request.List -> list(req.dir)
                is PhoneFilesRules.Request.Recent -> json(PhoneFilesRules.recentJson(recent(context, req.limit), req.limit))
                is PhoneFilesRules.Request.Raw -> raw(req.path)
                is PhoneFilesRules.Request.Thumb -> thumb(req.path, req.large)
                else -> fail(PhoneFilesRules.Fail.BAD_REQUEST, "request", "")
            }
        } catch (e: SecurityException) {
            fail(PhoneFilesRules.Fail.PERMISSION, stage, PhoneMediaRules.detailOf(e))
        } catch (e: java.io.FileNotFoundException) {
            fail(PhoneFilesRules.Fail.NOT_FOUND, stage, PhoneMediaRules.detailOf(e))
        } catch (e: Exception) {
            fail(PhoneFilesRules.Fail.READ, stage, PhoneMediaRules.detailOf(e))
        }
    }

    private fun list(dir: String): WebResourceResponse {
        val base = root()
        val folder = PhoneFilesRules.resolve(base, dir, dir = true) ?: return fail(PhoneFilesRules.Fail.BLOCKED, "list", "")
        if (!folder.isDirectory) return fail(PhoneFilesRules.Fail.NOT_FOUND, "list", "")
        val parent = if (dir.isEmpty()) emptyList() else dir.split('/')
        val children = folder.listFiles() ?: return fail(PhoneFilesRules.Fail.READ, "list", "listFiles")
        val out = ArrayList<PhoneFilesRules.Entry>(children.size)
        for (c in children) {
            val name = c.name
            if (!PhoneFilesRules.visibleChild(parent, name)) continue
            val rel = if (dir.isEmpty()) name else "$dir/$name"
            val isDir = c.isDirectory
            out.add(PhoneFilesRules.Entry(rel, name, isDir, if (isDir) 0L else c.length(), c.lastModified(), if (isDir) "" else PhoneFilesRules.mimeOf(name)))
        }
        return json(PhoneFilesRules.listJson(dir, out))
    }

    /**
     * [최근]: 사진첩 색인(MediaStore.Files)을 바뀐 시각 새것부터 읽는다('모든 파일 접근'이면 문서·한글·PDF도 색인에 있다).
     * 폴더 줄(MIME 없음)은 빼고, 숨김·막힌 곳은 규칙이 다시 거른다. 파일이 지금 없으면 뺀다.
     */
    private fun recent(context: Context, limit: Int): List<PhoneFilesRules.Entry> {
        val uri = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val cols = arrayOf(
            MediaStore.MediaColumns.RELATIVE_PATH, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_MODIFIED, MediaStore.MediaColumns.MIME_TYPE,
        )
        val args = Bundle().apply {
            putString(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION, MediaStore.MediaColumns.MIME_TYPE + " IS NOT NULL")
            putString(android.content.ContentResolver.QUERY_ARG_SQL_SORT_ORDER, MediaStore.MediaColumns.DATE_MODIFIED + " DESC")
            // 숨김·막힌 곳을 거르고 나면 모자랄 수 있어 넉넉히 읽는다.
            putInt(android.content.ContentResolver.QUERY_ARG_LIMIT, limit * 3)
        }
        val base = root()
        val out = ArrayList<PhoneFilesRules.Entry>()
        val cursor = context.contentResolver.query(uri, cols, args, null) ?: throw IllegalStateException("cursor")
        cursor.use { c ->
            val iPath = c.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
            val iName = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
            val iSize = c.getColumnIndex(MediaStore.MediaColumns.SIZE)
            val iMod = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED)
            val iMime = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
            fun str(i: Int): String? = if (i >= 0 && !c.isNull(i)) c.getString(i) else null
            fun long(i: Int): Long? = if (i >= 0 && !c.isNull(i)) c.getLong(i) else null
            while (c.moveToNext() && out.size < limit) {
                val name = str(iName) ?: continue
                val rel = PhoneFilesRules.joinRel(str(iPath), name) ?: continue
                val f = PhoneFilesRules.resolve(base, rel) ?: continue
                if (!f.isFile) continue
                val mime = str(iMime)?.takeIf { it.length in 3..120 } ?: PhoneFilesRules.mimeOf(name)
                out.add(PhoneFilesRules.Entry(rel, name, false, long(iSize) ?: f.length(), (long(iMod) ?: 0L) * 1000, mime))
            }
        }
        return out
    }

    private fun raw(path: String): WebResourceResponse {
        val f = PhoneFilesRules.resolve(root(), path) ?: return fail(PhoneFilesRules.Fail.BLOCKED, "raw", "")
        if (!f.isFile) return fail(PhoneFilesRules.Fail.NOT_FOUND, "raw", "")
        val h = headers() + ("Content-Length" to f.length().toString())
        return WebResourceResponse(PhoneFilesRules.mimeOf(f.name), null, 200, "OK", h, FileInputStream(f))
    }

    private fun thumb(path: String, large: Boolean): WebResourceResponse {
        val f = PhoneFilesRules.resolve(root(), path) ?: return fail(PhoneFilesRules.Fail.BLOCKED, "thumb", "")
        if (!f.isFile) return fail(PhoneFilesRules.Fail.NOT_FOUND, "thumb", "")
        val mime = PhoneFilesRules.mimeOf(f.name)
        val side = if (large) PhoneFilesRules.THUMB_LARGE else PhoneFilesRules.THUMB_SMALL
        val bitmap = when {
            PhoneFilesRules.isImage(mime) -> ThumbnailUtils.createImageThumbnail(f, Size(side, side), null)
            PhoneFilesRules.isVideo(mime) -> ThumbnailUtils.createVideoThumbnail(f, Size(side, side), null)
            else -> return fail(PhoneFilesRules.Fail.NOT_FOUND, "thumb", "kind")
        }
        val bytes = ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, if (large) 88 else 78, out)
            bitmap.recycle()
            out.toByteArray()
        }
        return WebResourceResponse("image/jpeg", null, 200, "OK", headers(), ByteArrayInputStream(bytes))
    }

    private fun headers() = mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")

    private fun json(text: String): WebResourceResponse =
        WebResourceResponse("application/json", "utf-8", 200, "OK", headers(), ByteArrayInputStream(text.toByteArray(Charsets.UTF_8)))

    private fun fail(f: PhoneFilesRules.Fail, stage: String, detail: String): WebResourceResponse {
        try {
            Log.w(TAG, "fail stage=$stage kind=${f.code} cls=${PhoneMediaRules.safeDetail(detail)}")
        } catch (_: Exception) {
        }
        val body = PhoneFilesRules.failJson(f).toByteArray(Charsets.UTF_8)
        return WebResourceResponse("application/json", "utf-8", f.status, PhoneFilesRules.reasonPhrase(f.status), headers(), ByteArrayInputStream(body))
    }

    private const val TAG = "KPTUPhoneFiles"
}
