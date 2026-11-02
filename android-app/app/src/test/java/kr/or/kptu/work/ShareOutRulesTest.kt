package kr.or.kptu.work

import kr.or.kptu.work.ShareOutRules.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** PHOTO-폰앱공유(0.4.7): 웹2 [공유] → 안드로이드 공유 창 다리 규칙. */
class ShareOutRulesTest {
    @Test
    fun messages() {
        assertEquals(Message.Hello, ShareOutRules.message("out:hello"))
        assertEquals(Message.Start(3), ShareOutRules.message("out:start:{\"count\":3}"))
        assertNull(ShareOutRules.message("out:start:{\"count\":0}"))
        assertNull(ShareOutRules.message("out:start:{\"count\":21}"))
        assertNull(ShareOutRules.message("out:start:{\"count\":1.5}"))
        assertEquals(Message.Phone(123), ShareOutRules.message("out:phone:123"))
        assertNull(ShareOutRules.message("out:phone:12a"))
        assertNull(ShareOutRules.message("out:phone:"))
        assertEquals(Message.Begin("a.jpg", "image/jpeg", 10), ShareOutRules.message("out:begin:{\"name\":\"a.jpg\",\"mime\":\"image/jpeg\",\"size\":10}"))
        // 경로·이상한 글자는 이름에서 빠지고, 확장자는 종류에 맞춘다.
        assertEquals(Message.Begin("x.png", "image/png", 5), ShareOutRules.message("out:begin:{\"name\":\"../../x.jpg\",\"mime\":\"image/png\",\"size\":5}"))
        assertNull(ShareOutRules.message("out:begin:{\"name\":\"a.mp4\",\"mime\":\"video/mp4\",\"size\":10}"))
        assertNull(ShareOutRules.message("out:begin:{\"name\":\"a.jpg\",\"mime\":\"image/jpeg\",\"size\":0}"))
        assertNull(ShareOutRules.message("out:begin:{\"name\":\"a.jpg\",\"mime\":\"image/jpeg\",\"size\":${ShareOutRules.FILE_MAX + 1}}"))
        assertEquals(Message.Part("QUJD"), ShareOutRules.message("out:part:QUJD"))
        assertNull(ShareOutRules.message("out:part:QUJ"))
        assertNull(ShareOutRules.message("out:part:QU!D"))
        assertEquals(Message.End, ShareOutRules.message("out:end"))
        assertEquals(Message.Go, ShareOutRules.message("out:go"))
        assertEquals(Message.Cancel, ShareOutRules.message("out:cancel"))
        assertNull(ShareOutRules.message("out:send"))
        assertNull(ShareOutRules.message("share:get:1"))
        assertNull(ShareOutRules.message(null))
    }

    @Test
    fun plans() {
        assertEquals(ShareOutRules.Plan(ShareOutRules.SEND, "image/jpeg"), ShareOutRules.plan(listOf("image/jpeg")))
        assertEquals(ShareOutRules.Plan(ShareOutRules.SEND_MULTIPLE, "image/jpeg"), ShareOutRules.plan(listOf("image/jpeg", "image/jpeg")))
        assertEquals(ShareOutRules.Plan(ShareOutRules.SEND_MULTIPLE, "image/*"), ShareOutRules.plan(listOf("image/jpeg", "image/png")))
        assertEquals(ShareOutRules.Plan(ShareOutRules.SEND_MULTIPLE, "video/*"), ShareOutRules.plan(listOf("video/mp4", "video/3gpp")))
        assertEquals(ShareOutRules.Plan(ShareOutRules.SEND_MULTIPLE, "*/*"), ShareOutRules.plan(listOf("image/jpeg", "video/mp4")))
        assertNull(ShareOutRules.plan(emptyList()))
        assertNull(ShareOutRules.plan(List(21) { "image/jpeg" }))
    }

    @Test
    fun batch() {
        val b = ShareOutRules.Batch(2)
        assertTrue(b.addPhone())
        assertFalse(b.ready)
        assertTrue(b.begin(4))
        assertFalse(b.addPhone()) // 받는 중인 장이 있으면 다른 장을 넣지 않는다
        assertTrue(b.part(3))
        assertFalse(b.part(2)) // 선언한 크기를 넘음
        assertTrue(b.part(1))
        assertTrue(b.end())
        assertTrue(b.ready)
        assertFalse(b.addPhone()) // 선언한 장 수까지
        assertFalse(b.begin(1))

        val short = ShareOutRules.Batch(1)
        assertTrue(short.begin(4))
        assertTrue(short.part(2))
        assertFalse(short.end()) // 덜 받은 장은 세지 않는다
        assertFalse(short.ready)

        val big = ShareOutRules.Batch(5)
        repeat(3) { assertTrue(big.begin(ShareOutRules.FILE_MAX)); assertTrue(big.part(ShareOutRules.FILE_MAX.toInt())); assertTrue(big.end()) }
        assertFalse(big.begin(ShareOutRules.FILE_MAX)) // 합계 200MB를 넘음
        assertTrue(big.begin(10))
    }

    @Test
    fun answers() {
        assertEquals("out:state:{\"v\":1}", ShareOutRules.STATE)
        assertEquals("out:ack:{\"ok\":true,\"step\":\"phone\",\"error\":\"\"}", ShareOutRules.ackMessage(true, "phone"))
        assertEquals("out:ack:{\"ok\":false,\"step\":\"begin\",\"error\":\"failed\"}", ShareOutRules.ackMessage(false, "begin", "failed"))
        assertEquals("out:sent:{\"ok\":false,\"error\":\"noapp\"}", ShareOutRules.sentMessage(false, "noapp"))
        assertEquals("out:sent:{\"ok\":true,\"error\":\"\"}", ShareOutRules.sentMessage(true))
    }
}
