package com.example.questvr.display

import kotlin.test.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*

class DisplayEngineTest {
    private val pose = """"anchor":"front","pose":{"position":{"x":0,"y":0,"z":0},"rotation":{"x":0,"y":0,"z":0},"scale":1}"""
    private fun panel(seq: Long, id: String = "first", text: String = "text") = envelope(seq, "render_panel",
        """{"panel_id":"$id","title":"Title","text":"$text",$pose}""")
    private fun envelope(seq: Long, type: String, body: String, server: String = "server_a") =
        DisplayProtocol.decode("""{"v":1,"session_id":"$server","request_id":"request_$seq","seq":$seq,"type":"$type","body":$body}""")
    private fun engine() = DisplayEngine().apply { authenticate("server_a") }

    @Test fun cursorAndAckWaitForPresentation() = runTest {
        val engine = engine()
        val rendered = CompletableDeferred<Unit>()
        val result = async { engine.apply(panel(1)) { rendered.await() } }
        yield()
        assertEquals(0, engine.lastSeq)
        assertTrue(engine.state.panels.isEmpty())
        assertFalse(result.isCompleted)
        rendered.complete(Unit)
        assertEquals(1, result.await())
        assertEquals("text", engine.state.panels["first"]?.text)
    }

    @Test fun failedRenderCannotBeCoveredByLaterCumulativeAck() = runTest {
        val engine = engine()
        assertFailsWith<IllegalStateException> { engine.apply(panel(1)) { error("asset_failed") } }
        assertEquals(0, engine.lastSeq)
        assertFailsWith<IllegalArgumentException> { engine.apply(panel(2)) { fail("must not render a gap") } }
        assertTrue(engine.state.panels.isEmpty())
    }

    @Test fun cancellationDoesNotCommitPendingFrame() = runTest {
        val engine = engine()
        val processing = launch { engine.apply(panel(1)) { awaitCancellation() } }
        yield(); processing.cancelAndJoin()
        assertEquals(0, engine.lastSeq)
        assertTrue(engine.state.panels.isEmpty())
    }

    @Test fun panelReplacementClearAndDuplicateReplayPreserveIdentity() = runTest {
        val engine = engine()
        engine.apply(panel(1)) {}
        engine.apply(panel(2, "second")) {}
        engine.apply(panel(3, text = "updated")) {}
        assertEquals(2, engine.state.panels.size)
        assertEquals("updated", engine.state.panels["first"]?.text)
        assertEquals(3, engine.apply(panel(3)) { fail("duplicate must not be drawn twice") })
        engine.apply(envelope(4, "clear", """{"scope":"panel","panel_id":"first"}""")) {}
        assertEquals(setOf("second"), engine.state.panels.keys)
        engine.apply(envelope(5, "clear", """{"scope":"all"}""")) {}
        assertEquals(WorkspaceState(), engine.state)
    }

    @Test fun snapshotResetsCursorWithoutAcknowledgingExpiredCommands() = runTest {
        val engine = engine()
        engine.apply(panel(1)) {}
        val snapshot = envelope(0, "snapshot", """{"scene":null,"panels":[],"reason":"gap"}""")
        assertNull(engine.apply(snapshot) {})
        assertEquals(0, engine.lastSeq)
        assertEquals(1, engine.apply(panel(1)) {})
        engine.authenticate("server_b")
        assertEquals(0, engine.lastSeq)
        assertFailsWith<IllegalArgumentException> { engine.apply(panel(2)) {} }
    }

    @Test fun configurationAndMessagesFailClosed() {
        assertEquals("http://localhost:8787", DisplayProtocol.endpoint("http://localhost:8787/", true))
        for (url in listOf("http://display.example.com/", "https://user@display.example.com/",
            "https://display.example.com/mcp", "https://display.example.com/?token=sample")) {
            assertFails { DisplayProtocol.endpoint(url, true) }
        }
        assertFails { DisplayProtocol.endpoint("http://localhost:8787", false) }
        assertFails { DisplayProtocol.decode("{}") }
        assertFails { DisplayProtocol.reduce(WorkspaceState(), panel(1, text = "<script>")) }
        assertFails { DisplayProtocol.reduce(WorkspaceState(), panel(1, id = "bad id")) }
    }
}
