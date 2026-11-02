package com.example.questvr.display

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class SessionKeeperTest {
    private val endpoint = DisplayEndpoint.parse("https://display.example.com", false)
    private val token = "0f".repeat(32)

    private fun TestScope.session(
        expiresIn: Long,
        grantFor: Long? = 3_600_000,
    ) = DisplaySession(
        endpoint,
        token,
        testScheduler.currentTime + expiresIn,
        grantFor?.let { "g".repeat(64) },
        grantFor?.let { testScheduler.currentTime + it } ?: 0,
    )

    private fun TestScope.keeper(refresh: suspend (DisplaySession) -> DisplaySession) =
        SessionKeeper(refresh, clock = { testScheduler.currentTime }, random = Random(1))

    @Test fun renewsAMinuteBeforeExpiryAndKeepsGoing() =
        runTest {
            val renewed = mutableListOf<Long>()
            val keeper = keeper { session(expiresIn = 900_000) }
            val job = launch { keeper.keep(session(expiresIn = 900_000)) { renewed += testScheduler.currentTime } }
            advanceTimeBy(839_999)
            assertTrue(renewed.isEmpty())
            advanceTimeBy(2)
            assertEquals(listOf(840_000L), renewed)
            advanceTimeBy(840_000)
            assertEquals(listOf(840_000L, 1_680_000L), renewed)
            job.cancel()
        }

    @Test fun expiredSessionRenewsImmediately() =
        runTest {
            val renewed = mutableListOf<DisplaySession>()
            val job = launch { keeper { session(900_000) }.keep(session(expiresIn = -1)) { renewed += it } }
            runCurrent()
            assertEquals(1, renewed.size)
            job.cancel()
        }

    @Test fun shortSessionsDoNotSpin() =
        runTest {
            var calls = 0
            val keeper =
                keeper {
                    calls++
                    session(30_000)
                }
            val job = launch { keeper.keep(session(30_000)) {} }
            advanceTimeBy(60_001)
            assertEquals(4, calls)
            job.cancel()
        }

    @Test fun rejectedGrantEndsWithPairingRequired() =
        runTest {
            var finished = false
            launch {
                keeper { throw PairingRejected(401) }.keep(session(-1)) { error("not renewed") }
                finished = true
            }
            runCurrent()
            assertTrue(finished)
        }

    @Test fun transientFailuresBackOffThenRecover() =
        runTest {
            var calls = 0
            val renewed = mutableListOf<Long>()
            val keeper =
                keeper {
                    calls++
                    if (calls < 3) throw InvalidPairingResponse("response_json")
                    session(900_000)
                }
            val job = launch { keeper.keep(session(-1)) { renewed += testScheduler.currentTime } }
            advanceTimeBy(10_000)
            assertEquals(3, calls)
            assertEquals(1, renewed.size)
            job.cancel()
        }

    @Test fun rateLimitWaitsAMinute() =
        runTest {
            var calls = 0
            val keeper =
                keeper {
                    calls++
                    if (calls == 1) throw PairingRejected(429)
                    session(900_000)
                }
            val job = launch { keeper.keep(session(-1)) {} }
            advanceTimeBy(59_999)
            assertEquals(1, calls)
            advanceTimeBy(2)
            assertEquals(2, calls)
            job.cancel()
        }

    @Test fun sessionWithoutGrantEndsAtExpiry() =
        runTest {
            var finishedAt = -1L
            launch {
                keeper { error("no grant to refresh") }.keep(session(5_000, grantFor = null)) {}
                finishedAt = testScheduler.currentTime
            }
            advanceTimeBy(5_001)
            assertEquals(5_000, finishedAt)
        }

    @Test fun delaysAreBoundedAndNullWhenUnrenewable() {
        val keeper = SessionKeeper({ it }, clock = { 0 }, random = Random(1))
        for (attempt in 0..10) assertTrue(keeper.retryDelay(attempt) in 800..36_000)
        assertNull(keeper.renewalDelay(DisplaySession(endpoint, token, expiresAt = 0), now = 0))
    }
}
