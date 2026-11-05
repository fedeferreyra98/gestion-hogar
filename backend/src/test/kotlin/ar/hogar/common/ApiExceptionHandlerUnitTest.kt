package ar.hogar.common

import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.http.MediaType
import org.springframework.web.bind.MissingServletRequestParameterException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull

class ApiExceptionHandlerUnitTest {
    private val handler = ApiExceptionHandler()

    private fun check(
        response: org.springframework.http.ResponseEntity<ProblemDetailBody>,
        status: Int,
        code: String,
    ): ProblemDetailBody {
        assertEquals(status, response.statusCode.value())
        assertEquals(MediaType.APPLICATION_PROBLEM_JSON, response.headers.contentType)
        val body = assertNotNull(response.body)
        assertEquals(status, body.status)
        assertEquals(code, body.code)
        assertEquals("about:blank", body.type)
        return body
    }

    @Test
    fun `validation maps to 400 with field errors`() {
        val body =
            check(
                handler.handleDomain(
                    ValidationException("bad", listOf(FieldError("quantity", "must be greater than 0"))),
                ),
                400,
                "VALIDATION_ERROR",
            )
        assertEquals(listOf(FieldError("quantity", "must be greater than 0")), body.errors)
    }

    @Test
    fun `missing parameter maps to 400`() {
        val body =
            check(
                handler.handleMissingParam(MissingServletRequestParameterException("from", "String")),
                400,
                "VALIDATION_ERROR",
            )
        assertEquals("from", body.errors?.single()?.field)
    }

    @Test
    fun `not found maps to 404`() {
        check(handler.handleDomain(NotFoundException("Product 1 not found")), 404, "NOT_FOUND")
    }

    @Test
    fun `conflict maps to 409`() {
        check(handler.handleDomain(ConflictException("Category has products")), 409, "CONFLICT")
    }

    @Test
    fun `business rule maps to 422 keeping its specific code`() {
        val body =
            check(
                handler.handleDomain(BusinessRuleException("LIST_NOT_OPEN", "List is not open")),
                422,
                "LIST_NOT_OPEN",
            )
        assertEquals("List is not open", body.detail)
        assertEquals(null, body.errors)
    }

    @Test
    fun `unsupported currency maps to 422 UNSUPPORTED_CURRENCY`() {
        val ex =
            assertFailsWith<BusinessRuleException> {
                CurrencyPolicy(Money.currencyOf("ARS")).requireSupported(Money.currencyOf("USD"))
            }
        check(handler.handleDomain(ex), 422, "UNSUPPORTED_CURRENCY")
    }

    @Test
    fun `page mapper follows the contract shape`() {
        val page = PageImpl(listOf(1, 2), PageRequest.of(1, 2), 5)
        assertEquals(PageResponse(listOf("1", "2"), 1, 2, 5, 3), page.toPageResponse { it.toString() })
    }

    @Test
    fun `page requests apply defaults, limits and sort whitelist`() {
        val p = PageRequests.of(null, null, null, setOf("name"))
        assertEquals(0, p.pageNumber)
        assertEquals(20, p.pageSize)
        assertEquals(Sort.by(Sort.Direction.DESC, "name"), PageRequests.of(0, 10, "name,desc", setOf("name")).sort)
        assertFailsWith<ValidationException> { PageRequests.of(0, 101, null, setOf("name")) }
        assertFailsWith<ValidationException> { PageRequests.of(-1, 10, null, setOf("name")) }
        assertFailsWith<ValidationException> { PageRequests.of(0, 10, "secret,asc", setOf("name")) }
    }
}
