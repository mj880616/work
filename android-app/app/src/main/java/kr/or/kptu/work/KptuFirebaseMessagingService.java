package kr.or.kptu.work;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class KptuFirebaseMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL_ID = "workspace";
    private static final String BASE = "https://mj880616.github.io";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        RemoteMessage.Notification notification = message.getNotification();
        String title = notification != null && notification.getTitle() != null
            ? notification.getTitle() : data.getOrDefault("title", "공공기관사업팀 Workspace");
        String body = notification != null && notification.getBody() != null
            ? notification.getBody() : data.getOrDefault("body", "새 알림이 있습니다.");
        String target = data.getOrDefault("url", "/work/app/");
        showNotification(title, body, target, data.getOrDefault("tag", "workspace"));
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        getSharedPreferences("kptu_push", MODE_PRIVATE).edit().putString("pending_token", token).apply();
    }

    private void showNotification(String title, String body, String target, String tag) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "업무 알림", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("할 일·메시지·가입 승인 등 Workspace 알림");
        channel.enableLights(true);
        channel.setLightColor(Color.rgb(49, 95, 135));
        manager.createNotificationChannel(channel);

        String url = target == null || target.isEmpty() ? "/work/app/" : target;
        if (url.startsWith("/")) url = BASE + url;
        Intent intent = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(url))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            this,
            Math.abs((tag + url).hashCode()),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        android.app.Notification built = new android.app.Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new android.app.Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build();
        manager.notify(tag, Math.abs((title + body + url).hashCode()), built);
    }
}
