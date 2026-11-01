package com.example.questvr.tunnelprobe;

public final class WebPolicyTest {
    private static int checks;
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError("check " + checks); }
    public static void main(String[] args) {
        String home = "https://app.example.com/?product=bot";
        check(WebPolicy.microphoneAllowed("https://app.example.com", home, home));
        check(WebPolicy.microphoneAllowed("https://APP.example.com:443", home, home));
        for (String origin : new String[]{"http://app.example.com", "https://app.example.com.attacker.example.com",
            "https://attacker.example.com", "https://app.example.com:444", "https://user@app.example.com",
            "https://app.example.com.", "file:///private/file", "data:text/html,hi", "about:blank", null})
            check(!WebPolicy.microphoneAllowed(origin, home, home));
        check(!WebPolicy.microphoneAllowed("https://app.example.com", "https://login.example.com", home));
        check(WebPolicy.microphoneAllowed(WebPolicy.VOICE_CHECK, WebPolicy.VOICE_CHECK, home));
        check(!WebPolicy.microphoneAllowed(WebPolicy.VOICE_CHECK, home, home));
        check(WebPolicy.rememberedPage("https://app.example.com/bot/abc-123?token=secret#fragment", home)
            .equals("https://app.example.com/bot/abc-123"));
        check(WebPolicy.rememberedPage("https://app.example.com/auth/callback?code=secret", home).equals(home));
        check(WebPolicy.rememberedPage("https://login.example.com/?code=secret", home).equals(home));
        System.out.println("Web policy checks passed: " + checks);
    }
}
