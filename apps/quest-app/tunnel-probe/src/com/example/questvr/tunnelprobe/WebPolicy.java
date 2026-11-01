package com.example.questvr.tunnelprobe;

import java.net.URI;
import java.util.Locale;

/** Pure URL policy: web content never receives a native JS bridge or tunnel secrets. */
final class WebPolicy {
    static final String VOICE_CHECK = "https://voice-check.example.com/";

    static String origin(String value) {
        if (value == null) return null;
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getRawUserInfo() != null)
                return null;
            int port = uri.getPort();
            if (port != -1 && port != 443) return null;
            if (host.endsWith(".")) return null;
            return "https://" + host.toLowerCase(Locale.ROOT);
        } catch (Exception ignored) { return null; }
    }

    static boolean microphoneAllowed(String requestOrigin, String visibleUrl, String home) {
        String requested = origin(requestOrigin);
        return requested != null && requested.equals(origin(visibleUrl)) &&
            (requested.equals(origin(home)) || requested.equals(origin(VOICE_CHECK)));
    }

    static String rememberedPage(String value, String home) {
        String host = origin(value);
        if (host == null || !host.equals(origin(home))) return home;
        try {
            URI uri = new URI(value);
            // Never persist OAuth query parameters, fragments or an authentication callback.
            String path = uri.getRawPath();
            if ("/".equals(path) || "".equals(path)) return home;
            if (path != null && path.matches("/bot/[A-Za-z0-9_-]+"))
                return host + path;
        } catch (Exception ignored) { }
        return home;
    }
}
