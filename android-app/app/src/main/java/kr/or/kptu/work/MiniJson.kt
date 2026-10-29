package kr.or.kptu.work

/**
 * 위젯이 받는 서버 응답(JSON)을 읽는 작은 해석기.
 * android의 org.json은 JVM 단위 시험에서 빈 껍데기라 쓰지 않는다(ShellRules와 같은 이유).
 * 결과: Map<String, Any?> / List<Any?> / String / Double / Boolean / null. 잘못된 글이면 null.
 */
object MiniJson {
    private const val MAX_DEPTH = 64

    fun parse(text: String?): Any? {
        if (text == null) return null
        return try {
            val p = Parser(text)
            p.space()
            val v = p.value(0)
            p.space()
            if (p.i != text.length) null else v
        } catch (_: Exception) {
            null
        }
    }

    @Suppress("UNCHECKED_CAST")
    fun obj(value: Any?): Map<String, Any?>? = value as? Map<String, Any?>

    @Suppress("UNCHECKED_CAST")
    fun list(value: Any?): List<Any?>? = value as? List<Any?>

    fun str(value: Any?): String? = value as? String

    fun num(value: Any?): Double? = value as? Double

    private class Parser(val s: String) {
        var i = 0

        fun space() {
            while (i < s.length && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++
        }

        fun value(depth: Int): Any? {
            if (depth > MAX_DEPTH) throw IllegalStateException("depth")
            space()
            if (i >= s.length) throw IllegalStateException("end")
            return when (val c = s[i]) {
                '{' -> objectValue(depth)
                '[' -> arrayValue(depth)
                '"' -> stringValue()
                't' -> word("true", true)
                'f' -> word("false", false)
                'n' -> word("null", null)
                else -> if (c == '-' || c in '0'..'9') numberValue() else throw IllegalStateException("char")
            }
        }

        private fun word(w: String, v: Any?): Any? {
            if (!s.startsWith(w, i)) throw IllegalStateException("word")
            i += w.length
            return v
        }

        private fun objectValue(depth: Int): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            i++
            space()
            if (i < s.length && s[i] == '}') { i++; return out }
            while (true) {
                space()
                if (i >= s.length || s[i] != '"') throw IllegalStateException("key")
                val k = stringValue()
                space()
                if (i >= s.length || s[i] != ':') throw IllegalStateException("colon")
                i++
                out[k] = value(depth + 1)
                space()
                if (i >= s.length) throw IllegalStateException("end")
                if (s[i] == ',') { i++; continue }
                if (s[i] == '}') { i++; return out }
                throw IllegalStateException("obj")
            }
        }

        private fun arrayValue(depth: Int): List<Any?> {
            val out = ArrayList<Any?>()
            i++
            space()
            if (i < s.length && s[i] == ']') { i++; return out }
            while (true) {
                out.add(value(depth + 1))
                space()
                if (i >= s.length) throw IllegalStateException("end")
                if (s[i] == ',') { i++; continue }
                if (s[i] == ']') { i++; return out }
                throw IllegalStateException("arr")
            }
        }

        private fun stringValue(): String {
            val sb = StringBuilder()
            i++
            while (true) {
                if (i >= s.length) throw IllegalStateException("str")
                val c = s[i++]
                when {
                    c == '"' -> return sb.toString()
                    c == '\\' -> {
                        if (i >= s.length) throw IllegalStateException("esc")
                        when (val e = s[i++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000c')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                if (i + 4 > s.length) throw IllegalStateException("u")
                                sb.append(s.substring(i, i + 4).toInt(16).toChar())
                                i += 4
                            }
                            else -> throw IllegalStateException("esc $e")
                        }
                    }
                    c < ' ' -> throw IllegalStateException("ctrl")
                    else -> sb.append(c)
                }
            }
        }

        private fun numberValue(): Double {
            val start = i
            if (s[i] == '-') i++
            while (i < s.length && (s[i] in '0'..'9' || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || s[i] == '+' || s[i] == '-')) i++
            return s.substring(start, i).toDouble()
        }
    }
}
