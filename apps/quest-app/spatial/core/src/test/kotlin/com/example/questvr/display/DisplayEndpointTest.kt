package com.example.questvr.display

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DisplayEndpointTest {
    @Test fun normalizesBareOrigins() {
        assertEquals("http://localhost:8787", DisplayEndpoint.parse(" http://localhost:8787/ ", allowLocal = true).origin)
        assertEquals("https://display.example.com", DisplayEndpoint.parse("https://Display.example.com:443", false).origin)
        assertEquals("https://display.example.com/", DisplayEndpoint.parse("https://display.example.com", false).pageUrl)
    }

    @Test fun rejectsAnythingButAnOrigin() {
        val rejected =
            listOf(
                "http://display.example.com/",
                "https://user@display.example.com/",
                "https://display.example.com/mcp",
                "https://display.example.com/?token=sample",
                "https://display.example.com/#x",
                "file:///data/display",
                "javascript:alert(1)",
                "not a url",
                "",
            )
        for (url in rejected) assertFailsWith<IllegalArgumentException>(url) { DisplayEndpoint.parse(url, true) }
        assertFailsWith<IllegalArgumentException> { DisplayEndpoint.parse("http://localhost:8787", allowLocal = false) }
    }

    @Test fun ownsOnlyTheSameOrigin() {
        val endpoint = DisplayEndpoint.parse("https://display.example.com", false)
        assertTrue(endpoint.owns("https://display.example.com/"))
        assertTrue(endpoint.owns("https://DISPLAY.example.com:443/assets/app.js"))
        assertFalse(endpoint.owns("https://display.example.com:8443/"))
        assertFalse(endpoint.owns("http://display.example.com/"))
        assertFalse(endpoint.owns("https://display.example.com.example.net/"))
        assertFalse(endpoint.owns("https://user@display.example.com/"))
        assertFalse(endpoint.owns("about:blank"))
        assertFalse(endpoint.owns(null))
    }

    @Test fun apiUrlsStayUnderApi() {
        val endpoint = DisplayEndpoint.parse("https://display.example.com", false)
        assertEquals("https://display.example.com/api/device/pair", endpoint.apiUrl("/api/device/pair"))
        assertFailsWith<IllegalArgumentException> { endpoint.apiUrl("/ws") }
    }

    @Test fun injectionScriptAcceptsOnlySessionTokens() {
        val token = "a".repeat(64)
        assertTrue(SessionInjection.script(token).contains("'$token'"))
        for (bad in listOf("A".repeat(64), "a".repeat(63), "a".repeat(63) + "'", "<PLACEHOLDER>")) {
            assertFailsWith<IllegalArgumentException> { SessionInjection.script(bad) }
        }
    }
}
