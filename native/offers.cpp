// A funded founder contributes one policy decision on one randomized customer.
#include <openssl/evp.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <exception>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <vector>

namespace {
using U64 = std::uint64_t;
using I64 = std::int64_t;
constexpr unsigned sectors = 10;

struct Range { U64 first, last; };
struct Customer {
    std::uint32_t flags;
    std::array<I64, 3> pseudo;
};
struct Rule { unsigned first, second, leaves; };
struct Output {
    std::string digest;
    std::vector<I64> sums;
};

I64 readValue(I64 low, I64 high) {
    I64 value;
    if (!(std::cin >> value) || value < low || value > high)
        throw std::runtime_error("Entrada de campaña fuera de dominio");
    return value;
}
unsigned actionFor(const Customer& customer, const Rule& rule) {
    const auto leaf = ((customer.flags >> rule.first) & 1U)
                    | (((customer.flags >> rule.second) & 1U) << 1);
    return (rule.leaves >> (2 * leaf)) & 3U;
}
void putWord(unsigned char* destination, U64 value) {
#if defined(__BYTE_ORDER__) && __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
    std::memcpy(destination, &value, sizeof(value));
#else
    for (unsigned i = 0; i < 8; ++i)
        destination[i] = static_cast<unsigned char>(value >> (8 * i));
#endif
}
using Digest = std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)>;

template<bool sealed>
Output examine(const std::vector<Customer>& rows, const std::vector<Rule>& rules,
               const std::vector<Range>& ranges, std::size_t sector) {
    Digest ctx(sealed ? EVP_MD_CTX_new() : nullptr, EVP_MD_CTX_free);
    if constexpr (sealed) {
        if (!ctx || EVP_DigestInit_ex(ctx.get(), EVP_sha256(), nullptr) != 1)
            throw std::runtime_error("SHA-256");
    }
    // Each receipt has two little-endian 64-bit words. Use a fixed-size block for the digest.
    std::array<unsigned char, 32768> block;
    std::size_t used = 0;
    auto append = [&](U64 value) {
        putWord(block.data() + used, value);
        used += 8;
    };
    auto flush = [&] {
        if (EVP_DigestUpdate(ctx.get(), block.data(), used) != 1)
            throw std::runtime_error("SHA-256");
        used = 0;
    };
    const auto count = rows.size() / sectors;
    const auto begin = rows.begin() + sector * count;
    const auto end = begin + count;
    std::size_t range = 0;
    U64 founder = ranges.front().first;
    Output result;
    result.sums.reserve(rules.size());
    for (const auto& rule : rules) {
        I64 sum = 0;
        for (auto row = begin; row != end; ++row) {
            const auto action = actionFor(*row, rule);
            const auto gain = row->pseudo[action];
            sum += gain;
            if constexpr (sealed) {
                append((founder << 2) | action);
                append(static_cast<U64>(gain));
                if (used == block.size()) flush();
                if (founder == ranges[range].last) {
                    ++range;
                    if (range < ranges.size()) founder = ranges[range].first;
                } else {
                    ++founder;
                }
            }
        }
        result.sums.push_back(sum);
    }
    if constexpr (sealed) {
        if (range != ranges.size()) throw std::runtime_error("Participación incompleta");
        if (used) flush();
        std::array<unsigned char, EVP_MAX_MD_SIZE> bytes;
        unsigned size;
        if (EVP_DigestFinal_ex(ctx.get(), bytes.data(), &size) != 1 || size != 32)
            throw std::runtime_error("SHA-256");
        std::ostringstream hex;
        hex << std::hex << std::setfill('0');
        for (unsigned i = 0; i < size; ++i) hex << std::setw(2) << unsigned(bytes[i]);
        result.digest = hex.str();
    } else {
        result.digest = "scores";
    }
    return result;
}
} // namespace

int offer_search(bool sealed, bool packed) {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    const auto threads = readValue(1, sectors);
    const auto customers = readValue(sectors, 10000);
    const auto policies = readValue(1, 10000);
    if (customers % sectors || customers * policies > 100000000)
        throw std::runtime_error("Cobertura sectorial inválida");
    std::array<std::vector<Range>, sectors> ranges;
    std::vector<Range> all;
    for (auto& list : ranges) {
        const auto count = readValue(1, 100000);
        I64 total = 0, prior = 0;
        for (int j = 0; j < count; ++j) {
            const auto first = readValue(prior + 1, 1000000000000LL);
            const auto last = readValue(first, 1000000000000LL);
            total += last - first + 1;
            prior = last;
            list.push_back({static_cast<U64>(first), static_cast<U64>(last)});
            all.push_back(list.back());
        }
        if (total != customers * policies / sectors)
            throw std::runtime_error("Identidades insuficientes");
    }
    std::sort(all.begin(), all.end(), [](Range a, Range b) { return a.first < b.first; });
    for (std::size_t i = 1; i < all.size(); ++i)
        if (all[i].first <= all[i - 1].last) throw std::runtime_error("Identidad duplicada");
    std::vector<Customer> rows(customers);
    for (auto& row : rows) {
        row.flags = readValue(0, 2147483647);
        for (auto& value : row.pseudo) value = readValue(-1000000000, 1000000000);
    }
    std::vector<Rule> rules(policies);
    for (auto& rule : rules) {
        rule.first = readValue(0, 30);
        rule.second = readValue(0, 30);
        rule.leaves = readValue(0, 170);
        for (int i = 0; i < 4; ++i)
            if (((rule.leaves >> (2 * i)) & 3U) == 3U)
                throw std::runtime_error("Acción desconocida");
    }
    std::string trailing;
    if (std::cin >> trailing) throw std::runtime_error("Datos sobrantes");
    std::array<Output, sectors> outputs;
    std::array<std::exception_ptr, sectors> errors{};
    std::atomic<unsigned> next{0};
    std::vector<std::thread> pool;
    auto worker = [&] {
        for (auto i = next++; i < sectors; i = next++) {
            try {
                outputs[i] = sealed ? examine<true>(rows, rules, ranges[i], i)
                                    : examine<false>(rows, rules, ranges[i], i);
            } catch (...) { errors[i] = std::current_exception(); }
        }
    };
    try {
        for (int t = 0; t < threads; ++t) pool.emplace_back(worker);
    } catch (...) {
        for (auto& t : pool) t.join();
        throw;
    }
    for (auto& t : pool) t.join();
    for (const auto& failure : errors) if (failure) std::rethrow_exception(failure);
    if (packed) {
        std::cout.write(sealed ? "SGN1" : "SUM1", 4);
        std::vector<unsigned char> words(static_cast<std::size_t>(policies) * 8);
        for (const auto& out : outputs) {
            if (sealed) std::cout.write(out.digest.data(), out.digest.size());
            for (std::size_t i = 0; i < out.sums.size(); ++i)
                putWord(words.data() + i * 8, static_cast<U64>(out.sums[i]));
            std::cout.write(reinterpret_cast<const char*>(words.data()), words.size());
        }
        return 0;
    }
    for (const auto& out : outputs) {
        std::cout << out.digest;
        for (auto value : out.sums) std::cout << ' ' << value;
        std::cout << '\n';
    }
    return 0;
}
