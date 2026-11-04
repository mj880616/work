package kr.or.kptu.work

import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * FILES-통합 3-③(S49-51, 명진 결정 H-1·H-3): [파일] '이 폰' 쓰기(규칙은 PhoneFilesRules 쓰기 절). 화면이 사람이 누른 것만 confirm:true로 보낸다.
 * - 새 폴더·이름 바꾸기: 뿌리 안·막힌 곳 밖만. 같은 이름이 있으면 하지 않는다(exists).
 * - 휴지통: 파일만, 안드로이드 휴지통(MediaStore.createTrashRequest — 시스템이 확인 창을 띄우거나 '미디어 관리 허용'이면 바로). 영구 삭제는 없다.
 * - 클라우드 → 폰 받기: 받을 폴더의 숨긴 임시 파일에 쓰고, 크기가 맞으면 번호 붙인 이름(덮어쓰기 없음)으로 바꾼다. 실패·그만두기 = 임시 파일 지움.
 * - 로그에는 단계·예외 클래스 이름만(파일 이름·경로 없음). 서버로 보내지 않는다.
 */
object PhoneFilesWrite {
    private val random = SecureRandom()
    /** 쓰기는 한 줄로 차례대로(화면 실행 흐름을 막지 않게). */
    val worker = Executors.newSingleThreadExecutor()

    class Failed(val code: String) : Exception()

    @Suppress("DEPRECATION")
    private fun root(): File = Environment.getExternalStorageDirectory()

    private fun need() {
        if (!PhoneFiles.granted()) throw Failed("permission")
    }

    private fun folder(dir: String): File {
        val f = PhoneFilesRules.resolve(root(), dir, dir = true) ?: throw Failed("blocked")
        if (!f.isDirectory) throw Failed("not_found")
        return f
    }

    private fun names(dir: File): List<String> = dir.list()?.toList() ?: emptyList()

    private fun rel(f: File): String = PhoneFilesRules.relOf(root().canonicalFile, f.canonicalFile) ?: throw Failed("blocked")

    private fun scan(context: Context, vararg files: File) {
        try {
            MediaScannerConnection.scanFile(context.applicationContext, files.map { it.path }.toTypedArray(), null, null)
        } catch (_: Exception) {
        }
    }

    fun mkdir(context: Context, op: PhoneFilesRules.Write.Mkdir): String {
        need()
        val parent = folder(op.dir)
        if (names(parent).any { it.equals(op.name, ignoreCase = true) }) throw Failed("exists")
        val f = File(parent, op.name)
        if (!f.mkdir()) throw Failed("write")
        return rel(f)
    }

    fun rename(context: Context, op: PhoneFilesRules.Write.Rename): String {
        need()
        val f = PhoneFilesRules.resolve(root(), op.path) ?: throw Failed("blocked")
        if (!f.exists()) throw Failed("not_found")
        val parent = f.parentFile ?: throw Failed("blocked")
        if (op.name == f.name) return rel(f)
        // 대소문자만 바꾸는 것은 받는다(같은 파일). 다른 파일이 그 이름이면 하지 않는다.
        if (names(parent).any { it.equals(op.name, ignoreCase = true) && !it.equals(f.name, ignoreCase = true) }) throw Failed("exists")
        val to = File(parent, op.name)
        if (!f.renameTo(to)) throw Failed("write")
        scan(context, f, to)
        return rel(to)
    }

    /** 휴지통에 보낼 사진첩 색인 주소(파일만, 색인에 있는 것만). 못 찾은 개수와 함께. */
    fun trashUris(context: Context, op: PhoneFilesRules.Write.Trash): Pair<List<Uri>, Int> {
        need()
        val uris = ArrayList<Uri>()
        var missing = 0
        val base = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        for (p in op.paths) {
            val f = PhoneFilesRules.resolve(root(), p)
            if (f == null || !f.isFile) { missing++; continue }
            val r = rel(f)
            val dir = r.substringBeforeLast('/', "")
            val id = try {
                context.contentResolver.query(
                    base, arrayOf(MediaStore.MediaColumns._ID),
                    MediaStore.MediaColumns.RELATIVE_PATH + "=? AND " + MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                    arrayOf(if (dir.isEmpty()) "" else "$dir/", f.name), null,
                )?.use { c -> if (c.moveToFirst()) c.getLong(0) else null }
            } catch (e: Exception) {
                log("trash-find", e)
                null
            }
            if (id == null) missing++ else uris.add(android.content.ContentUris.withAppendedId(base, id))
        }
        return uris to missing
    }

    // ── 받기 ──

    class Save(val dir: File, val name: String, val temp: File, val out: FileOutputStream, val rules: PhoneFilesRules.Saving)

    @Volatile var current: Save? = null
        private set

    fun begin(op: PhoneFilesRules.Write.Begin) {
        need()
        drop()
        val dir = folder(op.dir)
        // 남은 공간을 모르면(0) 막지 않고, 알면 받을 크기 + 16MB가 있어야 시작한다.
        val free = dir.usableSpace
        if (free > 0 && free < op.size + 16L * 1024 * 1024) throw Failed("space")
        val bytes = ByteArray(9).also(random::nextBytes)
        val tag = bytes.joinToString("") { "%02x".format(it) }
        val temp = File(dir, PhoneFilesRules.TEMP_PREFIX + tag)
        val out = FileOutputStream(temp)
        current = Save(dir, op.name, temp, out, PhoneFilesRules.Saving(op.size))
    }

    fun part(bytes: ByteArray): Long {
        val s = current ?: throw Failed("state")
        if (!s.rules.add(bytes.size)) { drop(); throw Failed("size") }
        try {
            s.out.write(bytes)
        } catch (e: Exception) {
            drop()
            throw Failed(if (s.dir.usableSpace < bytes.size) "space" else "write")
        }
        return s.rules.got
    }

    /** 다 받았으면 번호 붙인 이름으로 바꾸고 상대 경로를 돌려준다. */
    fun end(context: Context): String {
        val s = current ?: throw Failed("state")
        current = null
        try { s.out.close() } catch (_: Exception) {}
        if (!s.rules.complete) { s.temp.delete(); throw Failed("size") }
        val name = PhoneFilesRules.numbered(s.name, names(s.dir))
        val to = File(s.dir, name)
        if (!s.temp.renameTo(to)) { s.temp.delete(); throw Failed("write") }
        scan(context, to)
        return rel(to)
    }

    fun drop() {
        val s = current ?: return
        current = null
        try { s.out.close() } catch (_: Exception) {}
        try { s.temp.delete() } catch (_: Exception) {}
    }

    fun log(stage: String, e: Exception) {
        try {
            Log.w(TAG, "fail stage=$stage cls=${PhoneMediaRules.detailOf(e)}")
        } catch (_: Exception) {
        }
    }

    private const val TAG = "KPTUPhoneFilesWrite"
}
