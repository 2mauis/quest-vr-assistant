package com.example.questvr.display

/**
 * A short-lived display session plus the optional device grant that renews it.
 * Times are wall-clock milliseconds, matching what the relay's `expires_in` counts from.
 */
data class DisplaySession(
    val endpoint: DisplayEndpoint,
    val token: String,
    val expiresAt: Long,
    val refreshToken: String? = null,
    val refreshExpiresAt: Long = 0,
) {
    fun canRefresh(at: Long): Boolean = refreshToken != null && refreshExpiresAt > at

    fun canRestore(at: Long): Boolean = expiresAt > at || canRefresh(at)

    override fun toString(): String = "DisplaySession(endpoint=${endpoint.origin}, expiresAt=$expiresAt)"

    companion object {
        private val sessionToken = Regex("^[0-9a-f]{64}$")

        /** The display page accepts only this shape; anything else must never be injected. */
        fun isSessionToken(value: String): Boolean = sessionToken.matches(value)
    }
}
