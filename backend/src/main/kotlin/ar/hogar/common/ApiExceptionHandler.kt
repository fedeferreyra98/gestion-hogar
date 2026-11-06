package ar.hogar.common

import jakarta.validation.ConstraintViolationException
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.orm.ObjectOptimisticLockingFailureException
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException

/** Traduce excepciones a `application/problem+json` con `code` (docs/04). */
@RestControllerAdvice
class ApiExceptionHandler {
    @ExceptionHandler(DomainException::class)
    fun handleDomain(ex: DomainException): ResponseEntity<ProblemDetailBody> =
        when (ex) {
            is ValidationException ->
                problem(
                    HttpStatus.BAD_REQUEST,
                    ex.code,
                    "Validation failed",
                    ex.message,
                    ex.errors,
                )
            is UnauthorizedException -> problem(HttpStatus.UNAUTHORIZED, ex.code, "Unauthorized", ex.message)
            is NotFoundException -> problem(HttpStatus.NOT_FOUND, ex.code, "Not found", ex.message)
            is ConflictException -> problem(HttpStatus.CONFLICT, ex.code, "Conflict", ex.message)
            is BusinessRuleException ->
                problem(HttpStatus.UNPROCESSABLE_ENTITY, ex.code, "Business rule violated", ex.message)
        }

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleBeanValidation(ex: MethodArgumentNotValidException): ResponseEntity<ProblemDetailBody> =
        validation(
            ex.bindingResult.fieldErrors.map { FieldError(it.field, it.defaultMessage ?: "invalid") },
        )

    @ExceptionHandler(ConstraintViolationException::class)
    fun handleConstraint(ex: ConstraintViolationException): ResponseEntity<ProblemDetailBody> =
        validation(
            ex.constraintViolations.map {
                FieldError(it.propertyPath.toString().substringAfterLast('.'), it.message)
            },
        )

    @ExceptionHandler(MissingServletRequestParameterException::class)
    fun handleMissingParam(ex: MissingServletRequestParameterException): ResponseEntity<ProblemDetailBody> =
        validation(listOf(FieldError(ex.parameterName, "is required")))

    @ExceptionHandler(MethodArgumentTypeMismatchException::class)
    fun handleTypeMismatch(ex: MethodArgumentTypeMismatchException): ResponseEntity<ProblemDetailBody> =
        validation(listOf(FieldError(ex.name, "has an invalid value")))

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun handleUnreadable(ex: HttpMessageNotReadableException): ResponseEntity<ProblemDetailBody> =
        problem(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Validation failed", "Malformed request body")

    @ExceptionHandler(ObjectOptimisticLockingFailureException::class)
    fun handleOptimisticLock(ex: ObjectOptimisticLockingFailureException): ResponseEntity<ProblemDetailBody> =
        problem(HttpStatus.CONFLICT, "CONFLICT", "Conflict", "Resource was modified concurrently; retry")

    @ExceptionHandler(DataIntegrityViolationException::class)
    fun handleIntegrity(ex: DataIntegrityViolationException): ResponseEntity<ProblemDetailBody> =
        problem(HttpStatus.CONFLICT, "CONFLICT", "Conflict", "Data integrity violation")

    private fun validation(errors: List<FieldError>) =
        problem(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Validation failed", "Request validation failed", errors)

    private fun problem(
        status: HttpStatus,
        code: String,
        title: String,
        detail: String?,
        errors: List<FieldError> = emptyList(),
    ): ResponseEntity<ProblemDetailBody> =
        ResponseEntity
            .status(status)
            .contentType(PROBLEM_JSON)
            .body(
                ProblemDetailBody(
                    title = title,
                    status = status.value(),
                    code = code,
                    detail = detail,
                    errors = errors.ifEmpty { null },
                ),
            )

    companion object {
        val PROBLEM_JSON = org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON
    }
}

/** Cuerpo RFC 7807 + extensiones `code` y `errors` (docs/04). */
data class ProblemDetailBody(
    val type: String = "about:blank",
    val title: String,
    val status: Int,
    val code: String,
    val detail: String?,
    @get:com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
    val errors: List<FieldError>? = null,
)
