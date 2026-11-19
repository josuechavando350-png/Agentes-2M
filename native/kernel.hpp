#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>
#include <numeric>
#include <stdexcept>

namespace semar {
// Opcodes follow the public OPS list. Double the result to represent half-unit
// medians exactly on the integer wire and in the population-wide examination.
enum class Op { count, sum, minimum, maximum, range, median, best_run, non_adjacent, inference };
inline int twice(Op op, const int* data, int size) {
    switch (op) {
    case Op::count: return 2 * size;
    case Op::sum: return 2 * std::accumulate(data, data + size, 0);
    case Op::minimum: return 2 * *std::min_element(data, data + size);
    case Op::maximum: return 2 * *std::max_element(data, data + size);
    case Op::range: {
        const auto ends = std::minmax_element(data, data + size);
        return 2 * (*ends.second - *ends.first);
    }
    case Op::median: {
        std::array<int, 16> sorted{};
        std::copy_n(data, size, sorted.begin());
        std::sort(sorted.begin(), sorted.begin() + size);
        return sorted[(size - 1) / 2] + sorted[size / 2];
    }
    case Op::best_run: {
        int best = 0, ending = 0;
        for (int i = 0; i < size; ++i) {
            ending = std::max(0, ending + data[i]);
            best = std::max(best, ending);
        }
        return 2 * best;
    }
    case Op::non_adjacent: {
        int best = 0, previous = 0;
        for (int i = 0; i < size; ++i) {
            const int next = std::max(best, previous + data[i]);
            previous = best;
            best = next;
        }
        return 2 * best;
    }
    default: throw std::runtime_error("Operación numérica inválida");
    }
}
}
