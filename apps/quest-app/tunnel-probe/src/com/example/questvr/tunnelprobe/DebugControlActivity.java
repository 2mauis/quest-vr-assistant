package com.example.questvr.tunnelprobe;

import android.app.Activity;
import android.content.Intent;

/** Debug APK only. DUMP permission restricts this entry to shell/system callers. */
public final class DebugControlActivity extends Activity {
    @Override public void onResume() {
        super.onResume();
        if ("start".equals(getIntent().getStringExtra("command"))) {
            startForegroundService(new Intent(this, ProbeService.class)
                .putExtra("seconds", Math.max(15, Math.min(600, getIntent().getIntExtra("seconds", 600)))));
        } else if ("stop".equals(getIntent().getStringExtra("command"))) {
            stopService(new Intent(this, ProbeService.class));
            getFileStreamPath("tunnel.token").delete();
        }
        finish();
    }
}
