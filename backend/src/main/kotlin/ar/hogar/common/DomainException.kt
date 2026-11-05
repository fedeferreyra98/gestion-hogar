package ar.hogar.common

data class FieldError(
    val field: String,
    val message: String,
)

/** Raíz de los errores de dominio; el [ApiExceptionHandler] los traduce a RFC 7807. */
sealed class DomainException(
    val code: String,
    message: String,
) : RuntimeException(message)

/** 400 `VALIDATION_ERROR`. */
class ValidationException(
    message: String,
    val errors: List<FieldError> = emptyList(),
) : DomainException("VALIDATION_ERROR", message)

/** 404 `NOT_FOUND`. */
class NotFoundException(
    message: String,
) : DomainException("NOT_FOUND", message)

/** 409 `CONFLICT`. */
class ConflictException(
    message: String,
) : DomainException("CONFLICT", message)

/** 422 con `code` específico (`LIST_NOT_OPEN`, `INSUFFICIENT_STOCK`, `UNSUPPORTED_CURRENCY`, ...). */
class BusinessRuleException(
    code: String,
    message: String,
) : DomainException(code, message)
