package ar.hogar.auth

import org.junit.jupiter.api.Test
import java.time.Duration
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class AuthPropertiesUnitTest {
    @Test
    fun `rejects secrets shorter than 32 bytes`() {
        assertFailsWith<IllegalArgumentException> { AuthProperties(secret = "short") }
    }

    @Test
    fun `defaults are 1h access and 30d refresh`() {
        val p = AuthProperties(secret = "x".repeat(32))
        assertEquals(Duration.ofHours(1), p.accessTtl)
        assertEquals(Duration.ofDays(30), p.refreshTtl)
    }
}
