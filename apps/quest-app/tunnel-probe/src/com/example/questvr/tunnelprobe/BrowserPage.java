package com.example.questvr.tunnelprobe;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

/** Browser-owned page: the browser keeps its cookies, permissions and web audio. */
final class BrowserPage {
    private static final String SERVICE = "android.support.customtabs.action.CustomTabsService";

    static void open(Activity activity) {
        PackageManager packages = activity.getPackageManager();
        // Resolve a generic HTTPS page so an installed site's deep-link handler is not selected.
        Intent generic = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.example.com/"))
            .addCategory(Intent.CATEGORY_BROWSABLE);
        ResolveInfo browser = packages.resolveActivity(generic, PackageManager.MATCH_DEFAULT_ONLY);
        String provider = browser == null || browser.activityInfo == null ? null : browser.activityInfo.packageName;
        ResolveInfo service = provider == null ? null : packages.resolveService(new Intent(SERVICE).setPackage(provider), 0);
        if (service == null || service.serviceInfo == null || !service.serviceInfo.exported) {
            Toast.makeText(activity, "默认浏览器不支持共享登录页面，可选择下方内嵌网页并登录。", Toast.LENGTH_LONG).show();
            return;
        }
        Intent page = new Intent(Intent.ACTION_VIEW, Uri.parse(WebBuildConfig.START_URL))
            .addCategory(Intent.CATEGORY_BROWSABLE).setPackage(provider);
        // Public Custom Tabs wire protocol. A present null SESSION binder requests a Custom Tab
        // without a warm-up service session. No NEW_TASK flag: closing returns to this Activity.
        Bundle options = new Bundle();
        options.putBinder("android.support.customtabs.extra.SESSION", null);
        options.putInt("android.support.customtabs.extra.TITLE_VISIBILITY", 1);
        page.putExtras(options);
        try { activity.startActivity(page); }
        catch (ActivityNotFoundException | SecurityException error) {
            Toast.makeText(activity, "浏览器页面未能打开，可使用下方内嵌网页。", Toast.LENGTH_LONG).show();
        }
    }
}
