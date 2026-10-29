package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MiniJsonTest {
    @Test
    fun parsesValues() {
        val v = MiniJson.obj(MiniJson.parse("""{"a":"x\"é\n","b":[1,2.5,-3e2],"c":true,"d":null,"e":{"f":false}}"""))!!
        assertEquals("x\"é\n", v["a"])
        assertEquals(listOf(1.0, 2.5, -300.0), v["b"])
        assertEquals(true, v["c"])
        assertNull(v["d"])
        assertEquals(false, MiniJson.obj(v["e"])!!["f"])
    }

    @Test
    fun rejectsBroken() {
        assertNull(MiniJson.parse("{"))
        assertNull(MiniJson.parse("{\"a\":1}x"))
        assertNull(MiniJson.parse("[1,]"))
        assertNull(MiniJson.parse(""))
        assertNull(MiniJson.parse(null))
        assertNull(MiniJson.parse("[".repeat(100) + "]".repeat(100)))
    }
}
