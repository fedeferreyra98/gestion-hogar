package ar.hogar.stock

import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.test.assertEquals

class ExpiryPolicyUnitTest {
    private val today = LocalDate.parse("2026-06-15")

    private fun status(
        expiry: String?,
        warning: Int = 3,
    ) = ExpiryPolicy.statusOf(expiry?.let(LocalDate::parse), today, warning)

    @Test
    fun `status boundaries`() {
        assertEquals(ExpiryStatus.NO_EXPIRY, status(null))
        assertEquals(ExpiryStatus.EXPIRED, status("2026-06-14"))
        assertEquals(ExpiryStatus.EXPIRING_SOON, status("2026-06-15")) // vence hoy: todavía no vencido
        assertEquals(ExpiryStatus.EXPIRING_SOON, status("2026-06-18")) // hoy + N
        assertEquals(ExpiryStatus.OK, status("2026-06-19")) // hoy + N + 1
    }

    @Test
    fun `warning window is configurable`() {
        assertEquals(ExpiryStatus.OK, status("2026-06-16", warning = 0))
        assertEquals(ExpiryStatus.EXPIRING_SOON, status("2026-06-15", warning = 0))
        assertEquals(ExpiryStatus.EXPIRING_SOON, status("2026-06-22", warning = 7))
        assertEquals(ExpiryStatus.OK, status("2026-06-23", warning = 7))
    }

    @Test
    fun `today is derived from the injected clock in the household zone`() {
        // 02:30 UTC del 16/06 sigue siendo 15/06 (23:30) en Buenos Aires (UTC-3)
        val clock = Clock.fixed(Instant.parse("2026-06-16T02:30:00Z"), ZoneOffset.UTC)
        val baires = LocalDate.now(clock.withZone(ZoneId.of("America/Argentina/Buenos_Aires")))
        val utc = LocalDate.now(clock.withZone(ZoneOffset.UTC))
        assertEquals(LocalDate.parse("2026-06-15"), baires)
        assertEquals(LocalDate.parse("2026-06-16"), utc)

        val expiry = LocalDate.parse("2026-06-15")
        assertEquals(ExpiryStatus.EXPIRING_SOON, ExpiryPolicy.statusOf(expiry, baires, 3))
        assertEquals(ExpiryStatus.EXPIRED, ExpiryPolicy.statusOf(expiry, utc, 3))
    }
}
