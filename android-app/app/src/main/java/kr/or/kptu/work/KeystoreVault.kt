package kr.or.kptu.work

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 위젯 세션의 새로고침 토큰 보관(설계 5절).
 * Android Keystore에 만든 AES-GCM 키(밖으로 꺼낼 수 없음, 이 앱만 사용)로 암호화해 앱 전용 noBackup 공간 파일 하나에 둔다.
 * 백업·기기 옮기기는 앱 저장 공간 전체가 이미 빠져 있다(allowBackup=false, data_extraction_rules.xml).
 * 위젯은 폰이 잠긴 동안에도 갱신해야 하므로 '잠금 해제 때만' 조건은 걸지 않는다.
 * EncryptedSharedPreferences(security-crypto)는 사용 중단 예고로 쓰지 않는다.
 */
class KeystoreVault(context: Context) : WidgetVault {
    private val file = File(context.applicationContext.noBackupFilesDir, FILE)
    private val lock = Any()

    override fun exists(): Boolean = file.isFile

    override fun read(): String? = synchronized(lock) {
        if (!file.isFile) return null
        try {
            val all = file.readBytes()
            val ivLen = all[0].toInt()
            if (ivLen !in 12..16 || all.size <= 1 + ivLen) throw IllegalStateException("file")
            val key = existingKey() ?: throw IllegalStateException("key")
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, all, 1, ivLen))
            String(cipher.doFinal(all, 1 + ivLen, all.size - 1 - ivLen), Charsets.UTF_8)
        } catch (_: Exception) {
            // 풀 수 없는 파일(키가 바뀜·손상): 지우고 다시 로그인 받는다.
            clearLocked()
            null
        }
    }

    override fun write(value: String) {
        synchronized(lock) { writeLocked(value) }
    }

    private fun writeLocked(value: String) {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, existingKey() ?: newKey())
        val iv = cipher.iv
        val sealed = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val out = ByteArray(1 + iv.size + sealed.size)
        out[0] = iv.size.toByte()
        System.arraycopy(iv, 0, out, 1, iv.size)
        System.arraycopy(sealed, 0, out, 1 + iv.size, sealed.size)
        val tmp = File(file.parentFile, "$FILE.tmp")
        tmp.writeBytes(out)
        if (!tmp.renameTo(file)) {
            tmp.delete()
            throw IllegalStateException("rename")
        }
    }

    override fun clear() {
        synchronized(lock) { clearLocked() }
    }

    private fun clearLocked() {
        file.delete()
        File(file.parentFile, "$FILE.tmp").delete()
        try {
            keyStore().deleteEntry(ALIAS)
        } catch (_: Exception) {
        }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(STORE).apply { load(null) }

    private fun existingKey(): SecretKey? = keyStore().getKey(ALIAS, null) as? SecretKey

    private fun newKey(): SecretKey {
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return gen.generateKey()
    }

    private companion object {
        const val STORE = "AndroidKeyStore"
        const val ALIAS = "kptu_widget_session_v1"
        const val FILE = "widget_session.bin"
        const val TRANSFORM = "AES/GCM/NoPadding"
    }
}
