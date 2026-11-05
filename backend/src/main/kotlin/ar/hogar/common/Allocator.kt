package ar.hogar.common

import java.math.BigDecimal
import java.math.BigInteger

/**
 * Proportional allocation using the largest remainder method (ADR-005, docs/03-domain-model.md §Split).
 * Pure function: no Spring, no Money dependency. Amounts are minor units (Long), never floats (ADR-004).
 */
object Allocator {
    /**
     * Splits [total] (minor units, >= 0) across [weights] proportionally.
     *
     * - The sum of the result is exactly [total] and each part differs from its exact share by less than 1.
     * - Ties on the fractional part are broken by input order (stable), so the result is deterministic.
     * - A weight of zero always yields a part of zero.
     * - The returned map preserves the order of [weights].
     *
     * @throws IllegalArgumentException if [weights] is empty, has duplicate ids or negative weights,
     *   the weights sum to zero, or [total] is negative.
     */
    fun <Id> allocate(
        total: Long,
        weights: List<Pair<Id, BigDecimal>>,
    ): Map<Id, Long> {
        require(total >= 0) { "total must be >= 0 but was $total" }
        require(weights.isNotEmpty()) { "weights must not be empty" }
        require(weights.map { it.first }.toSet().size == weights.size) { "weight ids must be unique" }
        require(weights.none { it.second.signum() < 0 }) { "weights must be >= 0" }
        val sumW = weights.fold(BigDecimal.ZERO) { acc, (_, w) -> acc + w }
        require(sumW.signum() > 0) { "sum of weights must be > 0" }

        // exact_i = total * w_i / sumW, as a rational numerator/denominator to avoid any rounding:
        // numerator_i = total * w_i, denominator = sumW. Scale both to integers.
        val scale = maxOf(sumW.scale(), weights.maxOf { it.second.scale() }, 0)
        val denominator = sumW.setScale(scale).unscaledValue()
        val totalBig = BigInteger.valueOf(total)

        val parts =
            weights.mapIndexed { index, (_, w) ->
                val qr = (totalBig * w.setScale(scale).unscaledValue()).divideAndRemainder(denominator)
                Triple(index, qr[0].longValueExact(), qr[1]) // index, floor, fractional numerator
            }

        val remainder = total - parts.sumOf { it.second }
        val bumped =
            parts
                .sortedWith(compareByDescending<Triple<Int, Long, BigInteger>> { it.third }.thenBy { it.first })
                .take(remainder.toInt())
                .map { it.first }
                .toSet()

        val result = LinkedHashMap<Id, Long>(weights.size)
        parts.forEach { (index, base, _) ->
            result[weights[index].first] = base + if (index in bumped) 1 else 0
        }
        return result
    }
}
