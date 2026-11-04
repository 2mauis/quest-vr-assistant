package com.example.questvr.display

import java.net.URI
import java.net.URISyntaxException

/**
 * The display origin the shell pairs with and loads. It is an origin, never a path:
 * the page, the device API and the socket all live at its root.
 */
@ConsistentCopyVisibility
data class DisplayEndpoint private constructor(
    val origin: String,
) {
    val pageUrl: String get() = "$origin/"

    fun apiUrl(path: String): String {
        require(path.startsWith("/api/")) { "display_api_path" }
        return origin + path
    }

    /** True only for a URL on exactly this scheme, host and port. */
    fun owns(url: String?): Boolean {
        if (url == null) return false
        val uri = parseOrNull(url) ?: return false
        return uri.userInfo == null && originOf(uri) == origin
    }

    companion object {
        /** Throws [IllegalArgumentException] with a stable reason for anything that is not a bare origin. */
        fun parse(
            value: String,
            allowLocal: Boolean,
        ): DisplayEndpoint {
            val uri = parseOrNull(value.trim()) ?: throw IllegalArgumentException("display_url")
            require(uri.host != null && uri.userInfo == null) { "display_url" }
            require(uri.rawQuery == null && uri.rawFragment == null) { "display_url" }
            require(uri.rawPath.isNullOrEmpty() || uri.rawPath == "/") { "display_base_path" }
            val local = uri.scheme == "http" && uri.host == "localhost"
            require(uri.scheme == "https" || (allowLocal && local)) { "display_requires_tls" }
            return DisplayEndpoint(requireNotNull(originOf(uri)) { "display_url" })
        }

        private fun parseOrNull(value: String): URI? =
            try {
                URI(value)
            } catch (_: URISyntaxException) {
                null
            }

        private fun originOf(uri: URI): String? {
            val scheme = uri.scheme?.lowercase() ?: return null
            val host = uri.host?.lowercase() ?: return null
            val defaultPort = if (scheme == "https") 443 else 80
            val port = if (uri.port == -1 || uri.port == defaultPort) "" else ":${uri.port}"
            return "$scheme://$host$port"
        }
    }
}
