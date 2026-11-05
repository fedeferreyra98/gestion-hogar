package ar.hogar.common

import org.springframework.data.domain.Page
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.domain.Sort

/** `Page<T>` del contrato (docs/04): page 0-based. */
data class PageResponse<T>(
    val content: List<T>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)

fun <T, R> Page<T>.toPageResponse(transform: (T) -> R): PageResponse<R> =
    PageResponse(content.map(transform), number, size, totalElements, totalPages)

fun <T> Page<T>.toPageResponse(): PageResponse<T> = toPageResponse { it }

object PageRequests {
    const val DEFAULT_SIZE = 20
    const val MAX_SIZE = 100

    /**
     * Construye un [Pageable] desde `page`, `size` y `sort` (`campo,asc|desc`).
     * Valores fuera de rango o campos de orden no permitidos → [ValidationException] (400).
     */
    fun of(
        page: Int?,
        size: Int?,
        sort: String?,
        allowedSortFields: Set<String>,
        defaultSort: Sort = Sort.unsorted(),
    ): Pageable {
        val p = page ?: 0
        val s = size ?: DEFAULT_SIZE
        if (p < 0) throw ValidationException("Invalid page", listOf(FieldError("page", "must be >= 0")))
        if (s !in 1..MAX_SIZE) {
            throw ValidationException("Invalid size", listOf(FieldError("size", "must be between 1 and $MAX_SIZE")))
        }
        return PageRequest.of(p, s, parseSort(sort, allowedSortFields) ?: defaultSort)
    }

    private fun parseSort(
        sort: String?,
        allowed: Set<String>,
    ): Sort? {
        if (sort.isNullOrBlank()) return null
        val parts = sort.split(',')
        val field = parts[0].trim()
        val direction =
            when (parts.getOrNull(1)?.trim()?.lowercase()) {
                null, "asc" -> Sort.Direction.ASC
                "desc" -> Sort.Direction.DESC
                else -> throw ValidationException(
                    "Invalid sort",
                    listOf(FieldError("sort", "direction must be asc or desc")),
                )
            }
        if (parts.size > 2 || field !in allowed) {
            throw ValidationException("Invalid sort", listOf(FieldError("sort", "must be one of $allowed")))
        }
        return Sort.by(direction, field)
    }
}
