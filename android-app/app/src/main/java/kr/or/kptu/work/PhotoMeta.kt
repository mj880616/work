package kr.or.kptu.work

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import java.util.TimeZone

/**
 * S48-60 PHOTO-정보고치기: 폰 사진의 찍은 시각·위치 읽기·쓰기(규칙은 PhotoMetaRules).
 * - 읽기: 원본(위치가 가려지지 않게 setRequireOriginal, '사진 위치 정보' 허락이 있을 때)에서 위치·카메라·렌즈, 시각은 사진첩 DATE_TAKEN.
 * - 쓰기: 허락 창(createWriteRequest)을 받은 뒤 장마다 파일을 rw로 열어 EXIF 시각·위치 칸만 다시 쓰고(그림 바이트는 그대로),
 *   닫은 뒤 사진첩 목록 DATE_TAKEN을 같은 시각으로 고친다(갤러리·웹2 순서가 바뀐다).
 * - 사진 이름·시각·위치는 로그에 쓰지 않는다(실패 단계·예외 클래스 이름만).
 */
object PhotoMeta {
    fun locationAllowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < 29 || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_MEDIA_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun original(context: Context, uri: Uri): Uri =
        if (Build.VERSION.SDK_INT >= 29 && locationAllowed(context)) MediaStore.setRequireOriginal(uri) else uri

    fun targets(context: Context, ids: List<Long>): List<PhoneMediaRules.Media> {
        val byId = PhoneMedia.all(context, fresh = true).associateBy { it.id }
        return ids.mapNotNull { byId[it] }
    }

    fun read(context: Context, ids: List<Long>): List<PhotoMetaRules.Info> {
        val out = ArrayList<PhotoMetaRules.Info>()
        for (m in targets(context, ids)) {
            var lat: Double? = null
            var lon: Double? = null
            var make = ""
            var model = ""
            var lens = ""
            if (!m.video) {
                try {
                    context.contentResolver.openInputStream(original(context, PhoneMedia.uriOf(m)))?.use { s ->
                        val exif = ExifInterface(s)
                        exif.latLong?.let { if (PhotoMetaRules.validLoc(it[0], it[1])) { lat = it[0]; lon = it[1] } }
                        make = exif.getAttribute(ExifInterface.TAG_MAKE)?.trim() ?: ""
                        model = exif.getAttribute(ExifInterface.TAG_MODEL)?.trim() ?: ""
                        lens = exif.getAttribute(ExifInterface.TAG_LENS_MODEL)?.trim() ?: ""
                    }
                } catch (e: Exception) {
                    PhoneMedia.logEdit("meta-read", e)
                }
            }
            out.add(PhotoMetaRules.Info(m.id, m.takenMs, lat, lon, make, model, lens, PhotoMetaRules.canWrite(m.mime, m.video)))
        }
        return out
    }

    /** 허락을 받은 뒤 고치기. 돌려주는 값 = (고친 번호, 못 고친 번호). 한 장이 실패해도 나머지는 계속한다. */
    fun write(context: Context, list: List<PhoneMediaRules.Media>, changes: List<PhotoMetaRules.Change>): Pair<List<Long>, List<Long>> {
        val byId = list.associateBy { it.id }
        val zone = TimeZone.getDefault()
        val done = ArrayList<Long>()
        val failed = ArrayList<Long>()
        for (c in changes) {
            val m = byId[c.id]
            if (m == null || !PhotoMetaRules.canWrite(m.mime, m.video) || (c.touchesLoc && !locationAllowed(context))) {
                failed.add(c.id)
                continue
            }
            val uri = PhoneMedia.uriOf(m)
            try {
                context.contentResolver.openFileDescriptor(original(context, uri), "rw")?.use { pfd ->
                    val exif = ExifInterface(pfd.fileDescriptor)
                    c.taken?.let { t ->
                        val date = PhotoMetaRules.exifDate(t, zone)
                        val off = PhotoMetaRules.exifOffset(t, zone)
                        exif.setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, date)
                        exif.setAttribute(ExifInterface.TAG_DATETIME_DIGITIZED, date)
                        exif.setAttribute(ExifInterface.TAG_DATETIME, date)
                        exif.setAttribute(ExifInterface.TAG_OFFSET_TIME_ORIGINAL, off)
                        exif.setAttribute(ExifInterface.TAG_OFFSET_TIME_DIGITIZED, off)
                        exif.setAttribute(ExifInterface.TAG_OFFSET_TIME, off)
                    }
                    if (c.loc != null) exif.setLatLong(c.loc.lat, c.loc.lon)
                    else if (c.clearLoc) GPS_TAGS.forEach { exif.setAttribute(it, null) }
                    exif.saveAttributes()
                } ?: throw IllegalStateException("open")
                // 파일을 닫으면 사진첩이 다시 읽는다. 시각은 한 번 더 적어 둔다(시간대 없는 옛 파일도 같은 값이 되게).
                c.taken?.let { t ->
                    try {
                        context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.DATE_TAKEN, t) }, null, null)
                    } catch (e: Exception) {
                        PhoneMedia.logEdit("meta-taken", e)
                    }
                }
                done.add(c.id)
            } catch (e: Exception) {
                PhoneMedia.logEdit("meta-write", e)
                failed.add(c.id)
            }
        }
        PhoneMedia.forget()
        return done to failed
    }

    private val GPS_TAGS = listOf(
        ExifInterface.TAG_GPS_LATITUDE, ExifInterface.TAG_GPS_LATITUDE_REF, ExifInterface.TAG_GPS_LONGITUDE, ExifInterface.TAG_GPS_LONGITUDE_REF,
        ExifInterface.TAG_GPS_ALTITUDE, ExifInterface.TAG_GPS_ALTITUDE_REF,
    )
}
