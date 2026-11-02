package com.example.questvr.display

/** The only script the shell runs in the display page: hand over a session token. */
object SessionInjection {
    /** Result string `evaluateJavascript` reports when the page accepted the token. */
    const val ACCEPTED = "true"

    fun script(token: String): String {
        require(DisplaySession.isSessionToken(token)) { "session_token" }
        // The token is hex only, so embedding it in a string literal cannot break out of it.
        return "(function(){var d=window.__display;" +
            "return !!(d&&typeof d.adoptSession==='function'&&d.adoptSession('$token'));})()"
    }
}
