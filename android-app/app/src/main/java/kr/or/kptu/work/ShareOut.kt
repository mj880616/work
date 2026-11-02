package kr.or.kptu.work

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

/**
 * PHOTO-폰앱공유(0.4.7): 웹2 [공유] → 안드로이드 공유 창. 규칙은 ShareOutRules(JVM 시험).
 * - 폰 사진: 그 사진의 MediaStore content URI 그대로(복사하지 않음). 지금 허락된 목록에 있는 번호만.
 * - 원드라이브·구글 드라이브: 웹이 이미 받은 그림 바이트를 앱 캐시 share-out/에 한 장씩 쓰고 FileProvider content URI로 넘긴다.
 *   새 묶음을 시작하면 앞 묶음 파일을 지운다(캐시라 백업·옮기기에 들어가지 않고, 저장 공간이 모자라면 시스템이 지운다).
 * 쓰기는 MainActivity의 saveWorker(한 줄)에서만 한다.
 */
object ShareOut {
    const val AUTHORITY = "kr.or.kptu.work.shareout"
    private const val DIR = "share-out"

    class Item(val uri: Uri, val mime: String)

    class Batch(val rules: ShareOutRules.Batch, val dir: File) {
        val items = ArrayList<Item>()
        var file: File? = null
        var out: FileOutputStream? = null
        var mime: String = ""
    }

    private fun dir(context: Context): File = File(context.cacheDir, DIR)

    /** 앞 묶음 파일을 지우고 새 묶음을 연다. */
    fun start(context: Context, count: Int): Batch {
        val d = dir(context)
        clear(d)
        d.mkdirs()
        return Batch(ShareOutRules.Batch(count), d)
    }

    private fun clear(d: File) {
        try { d.listFiles()?.forEach { it.delete() } } catch (_: Exception) {}
    }

    fun addPhone(context: Context, batch: Batch, id: Long): Boolean {
        if (!batch.rules.canAdd()) return false
        val m = PhoneMedia.shareMedia(context, id) ?: return false
        if (!batch.rules.addPhone()) return false
        batch.items.add(Item(PhoneMedia.uriOf(m), m.mime.ifBlank { if (m.video) "video/*" else "image/*" }))
        return true
    }

    fun begin(batch: Batch, m: ShareOutRules.Message.Begin): Boolean {
        if (!batch.rules.begin(m.size)) return false
        // 같은 이름이 묶음 안에 또 있으면 앞에 순번을 붙인다(받는 앱이 이름으로 겹쳐 쓰지 않게).
        val name = if (File(batch.dir, m.name).exists()) "${batch.items.size + 1}-${m.name}" else m.name
        val f = File(batch.dir, name)
        return try {
            batch.out = FileOutputStream(f)
            batch.file = f
            batch.mime = m.mime
            true
        } catch (_: Exception) {
            drop(batch)
            false
        }
    }

    fun part(batch: Batch, bytes: ByteArray): Boolean {
        val out = batch.out ?: return false
        if (!batch.rules.part(bytes.size)) return false
        out.write(bytes)
        return true
    }

    fun end(context: Context, batch: Batch): Boolean {
        try { batch.out?.close() } catch (_: Exception) {}
        batch.out = null
        val f = batch.file ?: return false
        batch.file = null
        if (!batch.rules.end()) {
            f.delete()
            return false
        }
        batch.items.add(Item(FileProvider.getUriForFile(context, AUTHORITY, f), batch.mime))
        return true
    }

    fun drop(batch: Batch) {
        try { batch.out?.close() } catch (_: Exception) {}
        batch.out = null
        batch.file?.delete()
        batch.file = null
    }

    /** 공유 창 의도(고르기 창으로 감쌈). 묶음이 다 차지 않았으면 null. */
    fun chooser(batch: Batch): Intent? {
        if (!batch.rules.ready || batch.items.isEmpty()) return null
        val plan = ShareOutRules.plan(batch.items.map { it.mime }) ?: return null
        val send = Intent(plan.action).setType(plan.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (plan.action == ShareOutRules.SEND) send.putExtra(Intent.EXTRA_STREAM, batch.items[0].uri)
        else send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(batch.items.map { it.uri }))
        val clip = ClipData.newRawUri("", batch.items[0].uri)
        batch.items.drop(1).forEach { clip.addItem(ClipData.Item(it.uri)) }
        send.clipData = clip
        return Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}
