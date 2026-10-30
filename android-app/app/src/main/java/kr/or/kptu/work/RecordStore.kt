package kr.or.kptu.work

import java.io.File

/**
 * 폰 녹음의 앱 전용 임시 보관(noBackupFilesDir/rec). 갤러리·공용 폴더에는 아무것도 남기지 않는다.
 * - seg-<번호>-<구간>.ogg: 녹음기가 쓰는 구간 파일. 조각을 모두 올리면(또는 녹음을 정리·버리면) 지운다.
 * - state.json: 녹음 번호·구간·자른 조각 범위만(소리·토큰 없음). 앱이 죽어도 다시 열면 '이어서 정리'에 쓴다.
 * 안드로이드 API를 쓰지 않아 JVM 단위 시험으로 확인한다.
 */
class RecordStore(val dir: File) {
    private val stateFile get() = File(dir, STATE)

    fun file(name: String): File = File(dir, name)

    fun save(s: RecordRules.Session?) {
        dir.mkdirs()
        if (s == null) {
            stateFile.delete()
            return
        }
        // 반쯤 쓴 상태 파일이 남지 않게 옆 파일에 쓰고 바꿔 넣는다.
        val tmp = File(dir, "$STATE.tmp")
        tmp.writeText(encode(s))
        if (!tmp.renameTo(stateFile)) {
            stateFile.delete()
            tmp.renameTo(stateFile)
        }
    }

    fun load(): RecordRules.Session? = if (stateFile.isFile) decode(stateFile.readText()) else null

    fun length(seg: RecordRules.Segment): Long = file(seg.file).let { if (it.isFile) it.length() else 0L }

    /** 조각 바이트를 읽는다(웹이 __rec로 받을 때). 범위가 파일 밖이면 null. */
    fun read(seg: RecordRules.Segment, piece: RecordRules.Piece): ByteArray? {
        val f = file(seg.file)
        if (!f.isFile || piece.to > f.length() || piece.from < 0 || piece.size <= 0 || piece.size > MAX_PIECE_BYTES) return null
        val out = ByteArray(piece.size.toInt())
        java.io.RandomAccessFile(f, "r").use { r ->
            r.seek(piece.from)
            r.readFully(out)
        }
        return out
    }

    /** 다 올린 구간 파일과 상태에 없는 녹음 파일을 지운다. 지운 이름 목록. */
    fun sweep(s: RecordRules.Session?): List<String> {
        val names = dir.list()?.toList() ?: return emptyList()
        val gone = RecordRules.filesToDelete(s, names)
        gone.forEach { file(it).delete() }
        return gone
    }

    /** 녹음을 정리·버렸다: 상태와 구간 파일을 모두 지운다. */
    fun clear() {
        stateFile.delete()
        dir.list()?.filter { RecordRules.isSegmentFile(it) || it.endsWith(".tmp") }?.forEach { file(it).delete() }
    }

    companion object {
        const val STATE = "state.json"
        /** 1분 조각 32kbps ≈ 240KB. 넉넉히 잡되 메모리에 한 번에 올리는 크기를 막는다. */
        const val MAX_PIECE_BYTES = 20L * 1024 * 1024

        fun encode(s: RecordRules.Session): String {
            val j = ShellRules::jsonString
            val sb = StringBuilder()
            sb.append("{\"v\":1,\"session_id\":").append(j(s.sessionId))
                .append(",\"workspace_id\":").append(j(s.workspaceId))
                .append(",\"started_at\":").append(j(s.startedAt))
                .append(",\"state\":").append(j(s.state.wire))
                .append(",\"limit\":").append(s.segmentLimit)
                .append(",\"base_ms\":").append(s.baseMs)
                .append(",\"auto\":").append(s.autoFinish)
                .append(",\"discard\":").append(s.discard)
                .append(",\"segments\":[")
            s.segments.forEachIndexed { i, g ->
                if (i > 0) sb.append(',')
                sb.append("{\"no\":").append(g.no)
                    .append(",\"id\":").append(if (g.id == null) "null" else j(g.id))
                    .append(",\"file\":").append(j(g.file))
                    .append(",\"ended\":").append(g.ended)
                    .append(",\"stopped\":").append(g.stopped)
                    .append(",\"cut_at\":").append(g.cutAt)
                    .append(",\"cut_seq\":").append(g.cutSeq)
                    .append(",\"cut_ms\":").append(g.cutMs)
                    .append(",\"ms\":").append(g.recordedMs)
                    .append(",\"pieces\":[")
                g.pieces.forEachIndexed { k, p ->
                    if (k > 0) sb.append(',')
                    sb.append('[').append(p.seq).append(',').append(p.from).append(',').append(p.to).append(',').append(p.seconds).append(']')
                }
                sb.append("]}")
            }
            sb.append("]}")
            return sb.toString()
        }

        fun decode(text: String): RecordRules.Session? {
            val o = MiniJson.obj(MiniJson.parse(text)) ?: return null
            fun long(m: Map<String, Any?>, k: String) = MiniJson.num(m[k])?.toLong() ?: 0L
            val sid = MiniJson.str(o["session_id"])?.takeIf(RecordRules::isUuid) ?: return null
            val ws = MiniJson.str(o["workspace_id"])?.takeIf(RecordRules::isUuid) ?: return null
            val state = RecordRules.State.of(MiniJson.str(o["state"])) ?: return null
            val segs = (MiniJson.list(o["segments"]) ?: return null).map { raw ->
                val g = MiniJson.obj(raw) ?: return null
                val file = MiniJson.str(g["file"])?.takeIf(RecordRules::isSegmentFile) ?: return null
                val pieces = (MiniJson.list(g["pieces"]) ?: emptyList()).map { p ->
                    val a = MiniJson.list(p)?.map { MiniJson.num(it)?.toLong() } ?: return null
                    if (a.size != 4 || a.any { it == null }) return null
                    RecordRules.Piece(a[0]!!.toInt(), a[1]!!, a[2]!!, a[3]!!.toInt())
                }
                RecordRules.Segment(
                    no = MiniJson.num(g["no"])?.toInt() ?: return null,
                    id = MiniJson.str(g["id"])?.takeIf(RecordRules::isUuid),
                    file = file,
                    ended = g["ended"] == true,
                    stopped = g["stopped"] == true,
                    cutAt = long(g, "cut_at"),
                    cutSeq = MiniJson.num(g["cut_seq"])?.toInt() ?: 0,
                    cutMs = long(g, "cut_ms"),
                    recordedMs = long(g, "ms"),
                    pieces = pieces,
                )
            }
            return RecordRules.Session(
                sessionId = sid, workspaceId = ws, startedAt = MiniJson.str(o["started_at"]) ?: "",
                state = state, segmentLimit = MiniJson.num(o["limit"])?.toInt() ?: RecordRules.SEGMENT_SECONDS,
                segments = segs, baseMs = long(o, "base_ms"), autoFinish = o["auto"] == true, discard = o["discard"] == true,
            )
        }
    }
}

