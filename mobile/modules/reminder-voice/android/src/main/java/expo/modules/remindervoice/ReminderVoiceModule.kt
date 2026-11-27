package expo.modules.remindervoice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Spoken to-do titles on Android.
 *
 * Since Android 8 a notification's sound belongs to its channel, and expo-notifications can only point a channel at
 * sounds built into the app. This makes one channel per spoken clip whose sound is the WAV the app already saved, so
 * Android itself plays the title when the reminder rings — app closed, phone locked — without loading anything then.
 *
 * Android 10+: the clip is copied into the phone's Notifications sounds (MediaStore, Notifications/BusinessMessaging),
 * the same kind of sound a user picks as a custom tone, so the system (and Xiaomi/Samsung sound players) can always
 * read it. Android 8–9: the app's own file through expo-file-system's FileProvider, granted to the system.
 */
class ReminderVoiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReminderVoice")

    /**
     * Make (or keep) a channel that rings with `fileUri` (a file:// in the app's files folder).
     * Returns "ok:<channel id actually used>" or a short reason why it couldn't.
     */
    AsyncFunction("createVoiceChannel") { id: String, name: String, description: String, fileUri: String ->
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      try {
        createChannel(ctx, id, name, description, fileUri)
      } catch (e: Exception) {
        "error: ${e.javaClass.simpleName}: ${e.message}"
      }
    }

    /** Remove this app's copied clips from the phone's Notifications sounds, except the files named in `keep`. */
    AsyncFunction("removeVoiceSounds") { keep: List<String> ->
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      try {
        removeSounds(ctx, keep.toSet())
      } catch (e: Exception) {
        0
      }
    }

    /** What decides whether a spoken reminder can be heard on this phone (for the in-app check). */
    AsyncFunction("diagnose") { channelId: String? ->
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      diagnose(ctx, channelId)
    }

    /** Open the phone's settings for one channel (or the app's notification settings). */
    Function("openChannelSettings") { channelId: String? ->
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !channelId.isNullOrEmpty()) {
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
          .putExtra(Settings.EXTRA_CHANNEL_ID, channelId)
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        ctx.startActivity(intent)
        true
      } catch (e: Exception) {
        false
      }
    }
  }

  private val soundDir = "${Environment.DIRECTORY_NOTIFICATIONS}/BusinessMessaging/"

  private fun createChannel(ctx: Context, baseId: String, name: String, description: String, fileUri: String): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return "android older than 8"
    val path = Uri.parse(fileUri).path ?: return "bad file address"
    val file = File(path)
    if (!file.isFile) return "clip file missing"
    if (file.length() == 0L) return "clip file empty"

    val sound = mediaSound(ctx, file) ?: providerSound(ctx, file)
    // a deleted channel id comes back with its OLD settings (and old sound) if made again, so the id follows the sound
    val id = "$baseId-${Integer.toHexString(sound.toString().hashCode())}"

    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return "no notification service"
    val existing = nm.getNotificationChannel(id)
    if (existing != null && existing.sound == sound) return "ok:$id"
    if (existing != null) nm.deleteNotificationChannel(id)
    val channel = NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply {
      this.description = description
      setSound(
        sound,
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 250, 250, 250)
      enableLights(true)
      lightColor = Color.parseColor("#2f7fe0")
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    nm.createNotificationChannel(channel)
    return "ok:$id"
  }

  /** Android 8–9 (or if MediaStore refuses): the app's own file, readable by the system through a URI grant. */
  private fun providerSound(ctx: Context, file: File): Uri {
    val sound = FileProvider.getUriForFile(ctx, "${ctx.packageName}.FileSystemFileProvider", file)
    for (pkg in listOf("com.android.systemui", "android")) {
      try {
        ctx.grantUriPermission(pkg, sound, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      } catch (e: Exception) {
        // that package may not exist on this phone; the other grant is enough
      }
    }
    return sound
  }

  /** Android 10+: copy the clip into the phone's Notifications sounds once and return its content://media address. */
  private fun mediaSound(ctx: Context, file: File): Uri? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
    return try {
      val resolver = ctx.contentResolver
      val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      resolver.query(
        collection,
        arrayOf(MediaStore.Audio.Media._ID),
        // Android may have stored it as "name (1).wav" if an older copy (e.g. from before a reinstall) holds the name
        "${MediaStore.Audio.Media.DISPLAY_NAME} LIKE ? AND ${MediaStore.Audio.Media.RELATIVE_PATH}=?",
        arrayOf("${file.nameWithoutExtension}%", soundDir),
        null
      )?.use { c ->
        // the file name carries the clip's hash, so the same name is the same clip (copies are only kept when complete)
        if (c.moveToFirst()) return ContentUris.withAppendedId(collection, c.getLong(0))
      }
      val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension("wav") ?: "audio/x-wav"
      val values = ContentValues().apply {
        put(MediaStore.Audio.Media.DISPLAY_NAME, file.name)
        put(MediaStore.Audio.Media.MIME_TYPE, mime)
        put(MediaStore.Audio.Media.RELATIVE_PATH, soundDir)
        put(MediaStore.Audio.Media.IS_NOTIFICATION, 1)
        put(MediaStore.Audio.Media.IS_PENDING, 1)
      }
      val row = resolver.insert(collection, values) ?: return null
      try {
        val out = resolver.openOutputStream(row) ?: throw IllegalStateException("no output stream")
        out.use { o -> file.inputStream().use { it.copyTo(o) } }
        resolver.update(row, ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }, null, null)
        row
      } catch (e: Exception) {
        resolver.delete(row, null, null)
        null
      }
    } catch (e: Exception) {
      null
    }
  }

  private fun removeSounds(ctx: Context, keep: Set<String>): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
    val resolver = ctx.contentResolver
    val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    var removed = 0
    resolver.query(
      collection,
      arrayOf(MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DISPLAY_NAME),
      "${MediaStore.Audio.Media.RELATIVE_PATH}=?",
      arrayOf(soundDir),
      null
    )?.use { c ->
      while (c.moveToNext()) {
        // "todo_voice_<hash> (1).wav" is the same clip as "todo_voice_<hash>.wav"
        val fileName = (c.getString(1) ?: continue).replace(Regex(" \\(\\d+\\)(?=\\.wav$)"), "")
        if (fileName in keep) continue
        removed += resolver.delete(ContentUris.withAppendedId(collection, c.getLong(0)), null, null)
      }
    }
    return removed
  }

  private fun diagnose(ctx: Context, channelId: String?): Map<String, Any?> {
    val nm = ctx.getSystemService(NotificationManager::class.java)
    val am = ctx.getSystemService(AudioManager::class.java)
    val out = mutableMapOf<String, Any?>(
      "manufacturer" to Build.MANUFACTURER,
      "model" to Build.MODEL,
      "android" to Build.VERSION.RELEASE,
      "sdk" to Build.VERSION.SDK_INT,
      "notificationsEnabled" to (nm?.areNotificationsEnabled() ?: false),
      "volume" to (am?.getStreamVolume(AudioManager.STREAM_NOTIFICATION) ?: -1),
      "maxVolume" to (am?.getStreamMaxVolume(AudioManager.STREAM_NOTIFICATION) ?: -1),
      "ringerMode" to when (am?.ringerMode) {
        AudioManager.RINGER_MODE_SILENT -> "silent"
        AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
        AudioManager.RINGER_MODE_NORMAL -> "normal"
        else -> "unknown"
      },
      "doNotDisturb" to (nm != null && nm.currentInterruptionFilter > NotificationManager.INTERRUPTION_FILTER_ALL),
      "mediaStore" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q),
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && !channelId.isNullOrEmpty()) {
      val ch = nm.getNotificationChannel(channelId)
      out["channelExists"] = ch != null
      if (ch != null) {
        out["channelImportance"] = ch.importance
        out["channelSound"] = ch.sound?.toString()
      }
    }
    return out
  }
}
