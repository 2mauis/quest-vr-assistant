package com.example.questvr.tunnelprobe;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.system.Os;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ProbeService extends Service {
    static volatile boolean active;
    private Session session;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (session != null) return START_NOT_STICKY;
        // A destroyed service may still be waiting for its owned child to exit.
        if (active) { stopSelf(); return START_NOT_STICKY; }
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("probe", "Tunnel probe", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, ProbeActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1,
            new Intent(this, ProbeService.class).setAction("stop"), PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, "probe")
            .setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Quest Tunnel Probe")
            .setContentText("Temporary health check · maximum 10 minutes")
            .setContentIntent(open).addAction(new Notification.Action.Builder(null, "Stop", stop).build())
            .setOngoing(true).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, notification);
        int seconds = intent == null ? 600 : Math.max(15, Math.min(600, intent.getIntExtra("seconds", 600)));
        active = true;
        session = new Session(seconds);
        new Thread(session, "probe-session").start();
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        if (session != null) session.cancel();
        super.onDestroy();
    }

    private synchronized void save(String name, String content) throws IOException {
        AtomicFile file = new AtomicFile(getFileStreamPath(name));
        FileOutputStream output = file.startWrite();
        try {
            output.write(content.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (IOException error) { file.failWrite(output); throw error; }
    }

    private final class Session implements Runnable {
        private final int seconds;
        private final ArrayDeque<String> receipts = new ArrayDeque<>();
        private volatile boolean cancelled;
        private java.lang.Process child;
        private HealthServer health;
        private int childPid;
        private int nativeUid = -1;
        private String stage = "starting";

        Session(int seconds) { this.seconds = seconds; }

        synchronized void cancel() {
            cancelled = true;
            if (child != null) child.destroy();
            if (health != null) try { health.close(); } catch (IOException ignored) { }
        }

        private void status(String phase, String error) throws Exception {
            JSONObject state = new JSONObject().put("phase", phase).put("stage", stage)
                .put("app_uid", android.os.Process.myUid()).put("app_pid", android.os.Process.myPid())
                .put("child_pid", childPid).put("native_uid", nativeUid).put("seconds", seconds);
            if (health != null) state.put("port", health.port()).put("host", health.host()).put("run_nonce", health.runNonce());
            if (error != null) state.put("error_type", error);
            save("status.json", state.toString());
        }

        private String dnsEndpoint() throws IOException {
            ConnectivityManager manager = getSystemService(ConnectivityManager.class);
            LinkProperties properties = manager.getLinkProperties(manager.getActiveNetwork());
            if (properties != null) for (InetAddress address : properties.getDnsServers()) {
                if (!address.isAnyLocalAddress() && !address.isLoopbackAddress() && !address.isMulticastAddress()) {
                    String host = address.getHostAddress();
                    return (host.contains(":") ? "[" + host + "]" : host) + ":53";
                }
            }
            throw new IOException("active network has no usable DNS");
        }

        private String systemCertificates() throws IOException {
            for (String name : new String[]{"/apex/com.android.conscrypt/cacerts", "/system/etc/security/cacerts"}) {
                File folder = new File(name);
                File[] files = folder.listFiles();
                if (files != null) for (File file : files) if (file.isFile() && file.canRead()) return name;
            }
            throw new IOException("system certificates unavailable to app");
        }

        private void receipt(String nonce) throws IOException {
            receipts.addLast(nonce);
            while (receipts.size() > 64) receipts.removeFirst();
            save("receipts.json", new JSONArray(receipts).toString());
        }

        private Thread copyLog(InputStream input) {
            Thread thread = new Thread(() -> {
                byte[] bytes = new byte[4096];
                StringBuilder tail = new StringBuilder();
                try (InputStream stream = input) {
                    int count;
                    while ((count = stream.read(bytes)) != -1) {
                        tail.append(new String(bytes, 0, count, StandardCharsets.UTF_8));
                        if (tail.length() > 65536) tail.delete(0, tail.length() - 65536);
                        save("tunnel.log", tail.toString());
                    }
                } catch (IOException ignored) { }
            }, "probe-log");
            thread.setDaemon(true); thread.start(); return thread;
        }

        @Override public void run() {
            String failure = null;
            Thread log = null;
            File token = getFileStreamPath("tunnel.token");
            try {
                status("starting", null);
                stage = "credentials";
                if (!token.isFile() || token.length() < 16 || token.length() > 8192) throw new IOException("private tunnel token required");
                Os.chmod(token.getPath(), 0600);
                save("receipts.json", "[]"); save("tunnel.log", "");
                getFileStreamPath("native-status.json").delete();
                save("empty-config.yml", "{}\n");
                stage = "network";
                String dns = dnsEndpoint();
                String certificates = systemCertificates();
                File executable = new File(getApplicationInfo().nativeLibraryDir, "libcloudflared_probe.so");
                if (!executable.canExecute()) throw new IOException("installed native executable missing");
                synchronized (this) {
                    if (cancelled) return;
                    health = new HealthServer(this::receipt);
                    health.start();
                    stage = "native_start";
                    ProcessBuilder builder = new ProcessBuilder(executable.getPath(), "tunnel", "--config",
                        getFileStreamPath("empty-config.yml").getPath(), "--no-autoupdate", "--metrics", "localhost:0",
                        "--loglevel", "info", "--output", "json", "--edge-ip-version", "4", "--grace-period", "2s",
                        "run", "--token-file", token.getPath());
                    builder.directory(getFilesDir()); builder.redirectErrorStream(true);
                    builder.environment().put("HOME", getFilesDir().getPath());
                    builder.environment().put("QUEST_PROBE_DNS", dns);
                    builder.environment().put("TUNNEL_DNS_RESOLVER_ADDRS", dns);
                    builder.environment().put("SSL_CERT_DIR", certificates);
                    builder.environment().put("QUEST_PROBE_PARENT_PID", Integer.toString(android.os.Process.myPid()));
                    builder.environment().put("QUEST_PROBE_LIFETIME_SECONDS", Integer.toString(seconds));
                    builder.environment().put("QUEST_PROBE_STATUS_FILE", getFileStreamPath("native-status.json").getPath());
                    child = builder.start();
                }
                log = copyLog(child.getInputStream());
                long deadline = SystemClock.elapsedRealtime() + seconds * 1000L;
                while (!cancelled && SystemClock.elapsedRealtime() < deadline) {
                    if (child.waitFor(200, TimeUnit.MILLISECONDS)) {
                        if (SystemClock.elapsedRealtime() + 1000 < deadline) throw new IOException("native process exited early");
                        break;
                    }
                    if (childPid == 0 && getFileStreamPath("native-status.json").isFile()) {
                        JSONObject info = new JSONObject(new String(Files.readAllBytes(getFileStreamPath("native-status.json").toPath()), StandardCharsets.UTF_8));
                        childPid = info.getInt("pid"); nativeUid = info.getInt("uid");
                        if (info.getInt("parent_pid") != android.os.Process.myPid() || nativeUid != android.os.Process.myUid())
                            throw new IOException("unexpected native execution identity");
                        stage = "running"; status("running", null);
                    }
                }
            } catch (Exception error) { if (!cancelled) failure = error.getClass().getSimpleName(); }
            finally {
                cancel();
                try {
                    if (child != null && !child.waitFor(3, TimeUnit.SECONDS)) {
                        child.destroyForcibly();
                        if (!child.waitFor(2, TimeUnit.SECONDS)) failure = "NativeCleanupFailed";
                    }
                    if (log != null) log.join(1500);
                    if (token.exists() && !token.delete()) failure = "TokenCleanupFailed";
                    status(failure == null ? "stopped" : "failed", failure);
                } catch (Exception ignored) { }
                stopForeground(STOP_FOREGROUND_REMOVE);
                active = false;
                stopSelf();
            }
        }
    }
}
