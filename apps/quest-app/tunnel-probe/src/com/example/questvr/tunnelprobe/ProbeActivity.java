package com.example.questvr.tunnelprobe;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import java.nio.file.Files;

public final class ProbeActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView status;
    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            String phase = "stopped";
            try { phase = new JSONObject(new String(Files.readAllBytes(
                getFileStreamPath("status.json").toPath()), java.nio.charset.StandardCharsets.UTF_8)).optString("phase", phase); }
            catch (Exception ignored) { }
            if (!ProbeService.active && (phase.equals("running") || phase.equals("starting"))) phase = "stopped";
            status.setText("State: " + phase + "\nHealth probe only · stops within 10 minutes");
            handler.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(40, 40, 40, 40);
        TextView title = new TextView(this);
        title.setText("Quest Tunnel Probe"); title.setTextSize(26); layout.addView(title);
        status = new TextView(this); status.setTextSize(19); layout.addView(status);
        Button start = new Button(this); start.setText("Start 10-minute probe");
        start.setOnClickListener(v -> startForegroundService(new Intent(this, ProbeService.class)));
        layout.addView(start);
        Button stop = new Button(this); stop.setText("Stop and remove probe token");
        stop.setOnClickListener(v -> {
            stopService(new Intent(this, ProbeService.class));
            getFileStreamPath("tunnel.token").delete();
        });
        layout.addView(stop);
        setContentView(layout);
    }
    @Override public void onResume() { super.onResume(); handler.post(refresh); }
    @Override public void onPause() { handler.removeCallbacks(refresh); super.onPause(); }
}
