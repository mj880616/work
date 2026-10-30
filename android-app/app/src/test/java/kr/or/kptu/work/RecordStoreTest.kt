package kr.or.kptu.work

import kr.or.kptu.work.RecordRules.Segment
import kr.or.kptu.work.RecordRules.Session
import kr.or.kptu.work.RecordRules.State
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class RecordStoreTest {
    private val sid = "11111111-2222-4333-8444-555555555555"
    private val rid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    private val ws = "99999999-8888-4777-8666-555555555555"

    private fun dir(): File = Files.createTempDirectory("rec").toFile()

    private fun sample(): Session {
        val a = RecordRules.cut(Segment(1, rid, RecordRules.segmentFile(sid, 1)), 10, 60_000)
        val b = Segment(2, null, RecordRules.segmentFile(sid, 2))
        return Session(sid, ws, "2026-10-30T05:00:00.000Z", State.PAUSED, 900, listOf(RecordRules.end(a, 16, 70_000), b), baseMs = 5, fails = 0, autoFinish = true)
    }

    @Test fun 상태_파일은_저장했다_그대로_읽힌다() {
        val s = sample()
        val back = RecordStore.decode(RecordStore.encode(s))
        assertEquals(s, back)
        // 상태 파일에는 소리·토큰이 없다(번호·바이트 범위·초만).
        assertFalse(RecordStore.encode(s).contains("token"))
        assertNull(RecordStore.decode("{\"session_id\":\"x\"}"))
        assertNull(RecordStore.decode("not json"))
        // 파일 이름이 녹음 파일 모양이 아니면 받지 않는다(다른 파일을 가리키지 못하게).
        assertNull(RecordStore.decode(RecordStore.encode(s).replace(RecordRules.segmentFile(sid, 1), "../x.ogg")))
    }

    @Test fun 조각_바이트_읽기와_다_올린_파일_지우기() {
        val d = dir()
        val store = RecordStore(d)
        val s = sample()
        store.file(s.segments[0].file).writeBytes(ByteArray(16) { it.toByte() })
        store.file(s.segments[1].file).writeBytes(ByteArray(3))
        store.file("seg-oldoldold-1.ogg").writeBytes(ByteArray(1))
        store.save(s)
        assertEquals(s, store.load())
        val p = s.segments[0].pieces[1]
        assertArrayEquals(ByteArray(6) { (it + 10).toByte() }, store.read(s.segments[0], p))
        assertNull(store.read(s.segments[0], p.copy(to = 99)))
        // 1구간 첫 조각을 올림 → 아직 둘째 조각이 남아 파일을 둔다. 다 올리면 지운다. 앞 녹음 찌꺼기는 바로 지운다.
        var cur = RecordRules.sent(s, 1, 1)
        assertEquals(listOf("seg-oldoldold-1.ogg"), store.sweep(cur))
        assertTrue(store.file(s.segments[0].file).isFile)
        cur = RecordRules.sent(cur, 1, 2)
        assertEquals(listOf(s.segments[0].file), store.sweep(cur))
        assertFalse(store.file(s.segments[0].file).exists())
        assertTrue(store.file(s.segments[1].file).isFile)
        // 정리·버리기 끝: 상태와 녹음 파일을 모두 지운다.
        store.clear()
        assertNull(store.load())
        assertEquals(emptyList<String>(), d.list()!!.toList())
    }
}
