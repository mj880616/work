package kr.or.kptu.work

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.MimeTypeMap
import android.webkit.WebResourceResponse
import androidx.core.content.IntentCompat
import java.io.ByteArrayInputStream
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/**
 * 단계 ② 공유로 바구니 넣기(설계 docs/design/phone-app-v2.md 4절).
 * 다른 앱의 [공유]로 받은 것을 이 프로세스 메모리에만 든다(폰 저장소에 복사하지 않음, D6).
 * - 웹은 바 색 다리(KPTUAppShell)로 목록만 묻는다(이름·종류·크기·글). URI는 웹에 넘기지 않는다.
 * - 파일 내용은 웹이 https://<허용 호스트>/work/app/__share/<번호>/<순번>을 fetch하면 여기서 가로채 흘려준다.
 *   항목마다 한 번만 열리고, 다 열리거나 웹이 done을 보내거나 앱이 끝나면 번호를 버린다.
 * 앱은 토큰을 보지 않는다. 저장 권한 판정은 서버(basket-files, app_notes RLS)가 그대로 한다.
 */
object ShareIntake {
    class Item(val uri: Uri, val meta: ShellRules.ShareMeta)

    class Pending(val id: String, val subject: String?, val text: String?, val items: List<Item>) {
        val opened: MutableSet<Int> = ConcurrentHashMap.newKeySet()
        val json: String = ShellRules.shareListJson(id, subject, text, items.map { it.meta })
    }

    @Volatile private var pending: Pending? = null
    private val random = SecureRandom()

    fun isShare(intent: Intent?): Boolean =
        intent?.action == Intent.ACTION_SEND || intent?.action == Intent.ACTION_SEND_MULTIPLE

    /** 공유 intent를 읽어 새 일회용 번호로 든다(앞의 공유는 버린다). 넣을 것이 없으면 null. */
    fun receive(intent: Intent, resolver: ContentResolver, ownPackage: String): Pending? {
        val uris = streams(intent)
            // content:// 만 받는다. file:// 등은 앱 자신의 파일을 가리킬 수 있어 버린다. 이 앱의 제공자(없음)도 버린다.
            .filter { "content".equals(it.scheme, ignoreCase = true) && it.authority?.startsWith(ownPackage) != true }
            .distinct()
            .take(ShellRules.SHARE_MAX_ITEMS)
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.take(ShellRules.SHARE_MAX_TEXT)
        val subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString()?.take(1000)
        val items = uris.mapIndexed { i, uri -> Item(uri, meta(resolver, uri, intent.type, i)) }
        if (items.isEmpty() && text.isNullOrBlank() && subject.isNullOrBlank()) return null
        val next = Pending(newId(), subject, text, items)
        pending = next
        return next
    }

    /** 번호가 없으면(로그인 복귀 뒤 등) 지금 든 공유를, 있으면 그 번호일 때만 준다. */
    fun get(id: String?): Pending? {
        val p = pending ?: return null
        return if (id == null || id == p.id) p else null
    }

    fun done(id: String) {
        if (pending?.id == id) pending = null
    }

    fun clear() {
        pending = null
    }

    /**
     * WebView 요청 가로채기. __share 주소가 아니면 null(평소대로 진행).
     * __share 주소면 서버로 보내지 않고 여기서 답한다: 맞는 번호·처음 여는 순번이면 내용, 아니면 404.
     */
    fun serve(url: String?, method: String?, resolver: ContentResolver): WebResourceResponse? {
        val (id, index) = ShellRules.shareRequest(url) ?: return null
        val p = pending
        if (!"GET".equals(method, ignoreCase = true) || p == null || p.id != id || index >= p.items.size || !p.opened.add(index)) {
            return notFound()
        }
        val item = p.items[index]
        if (p.opened.size >= p.items.size) done(p.id)
        val stream = try {
            resolver.openInputStream(item.uri)
        } catch (_: Exception) {
            null
        } ?: return notFound()
        val headers = mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")
        return WebResourceResponse(item.meta.type, null, 200, "OK", headers, stream)
    }

    private fun notFound(): WebResourceResponse =
        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))

    private fun streams(intent: Intent): List<Uri> {
        val out = mutableListOf<Uri>()
        when (intent.action) {
            Intent.ACTION_SEND -> IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let(out::add)
            Intent.ACTION_SEND_MULTIPLE -> IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { out.addAll(it.filterNotNull()) }
        }
        if (out.isEmpty()) {
            val clip = intent.clipData
            if (clip != null) for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let(out::add)
        }
        return out
    }

    fun meta(resolver: ContentResolver, uri: Uri, intentType: String?, index: Int): ShellRules.ShareMeta {
        var name: String? = null
        var size = -1L
        try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val s = c.getColumnIndex(OpenableColumns.SIZE)
                    if (n >= 0 && !c.isNull(n)) name = c.getString(n)
                    if (s >= 0 && !c.isNull(s)) size = c.getLong(s)
                }
            }
        } catch (_: Exception) {
        }
        val type = ShellRules.shareMime(
            try {
                resolver.getType(uri)
            } catch (_: Exception) {
                null
            } ?: intentType,
        )
        var safe = ShellRules.shareName(name, index)
        if (!safe.contains('.')) MimeTypeMap.getSingleton().getExtensionFromMimeType(type)?.let { safe = "$safe.$it" }
        return ShellRules.ShareMeta(safe, type, size)
    }

    private fun newId(): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }
}
