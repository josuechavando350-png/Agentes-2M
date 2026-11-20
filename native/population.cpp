// One sector owns 100 distance rules. An ordinal identifies exactly one
// (query, historical reference, rule) comparison within that sector.
#include <openssl/evp.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {
using Row = std::array<int, 10>;
struct Range { std::uint64_t first, last; };
struct Cell { std::string hash; int initial, ten, votes; };
long long number(long long min, long long max) {
    long long v;
    if (!(std::cin >> v) || v < min || v > max) throw std::runtime_error("Entrada de evaluación inválida");
    return v;
}
void word(std::vector<unsigned char>& out, unsigned v) {
    for (int i = 0; i < 4; ++i) { out.push_back(static_cast<unsigned char>(v)); v >>= 8; }
}
std::string sha256(const std::vector<unsigned char>& bytes) {
    unsigned char result[EVP_MAX_MD_SIZE]; unsigned size = 0;
    if (!EVP_Digest(bytes.data(), bytes.size(), result, &size, EVP_sha256(), nullptr) || size != 32)
        throw std::runtime_error("No se pudo sellar el lote");
    std::ostringstream hex;
    for (unsigned i = 0; i < size; ++i)
        hex << std::hex << std::setw(2) << std::setfill('0') << static_cast<unsigned>(result[i]);
    return hex.str();
}
std::vector<Cell> sectorRun(int sector, const std::vector<Range>& runs, const std::vector<Row>& history,
                            const std::vector<int>& outcomes, const std::vector<Row>& queries, int rules) {
    std::size_t ri = 0;
    std::uint64_t id = runs[0].first;
    std::vector<Cell> cells;
    std::vector<unsigned char> bytes;
    bytes.reserve(history.size() * rules * 12);
    for (const Row& query : queries) {
        std::array<int,100> best, winners{};
        best.fill(std::numeric_limits<int>::max());
        bytes.clear();
        for (std::size_t h = 0; h < history.size(); ++h) {
            Row delta; int total = 0;
            for (int f = 0; f < 10; ++f) {
                delta[f] = std::abs(query[f] - history[h][f]);
                total += delta[f];
            }
            const int base = total + 16 * delta[sector];
            for (int j = 0; j < rules; ++j) {
                const int rule = rules == 10 ? j * 11 : j;
                const int distance = base + (rule / 10) * delta[(sector + 1) % 10] + (rule % 10) * delta[(sector + 3) % 10];
                word(bytes,static_cast<unsigned>(id));
                word(bytes,static_cast<unsigned>(id >> 32));
                word(bytes,static_cast<unsigned>(distance));
                if (distance < best[rule]) { best[rule] = distance; winners[rule] = outcomes[h]; }
                if (id == runs[ri].last) { ++ri; if (ri < runs.size()) id = runs[ri].first; }
                else ++id;
            }
        }
        int votes = 0, ten = 0;
        for (int i = 0; i < 100; ++i) { votes += winners[i]; if (i % 11 == 0) ten += winners[i]; }
        cells.push_back({sha256(bytes),winners[0],ten,votes});
    }
    if (ri != runs.size()) throw std::runtime_error("Participación incompleta");
    return cells;
}
}
int population(int rules) {
    const int workers = number(1,10), n = number(1,4096), q = number(1,4096);
    const auto count = static_cast<long long>(n) * q * rules;
    if (count > 10000000) throw std::runtime_error("Cupo sectorial excedido");
    std::array<std::vector<Range>,10> ranges;
    for (auto& list : ranges) {
        const int k = number(1,100000);
        long long total = 0, previous = 0;
        for (int i = 0; i < k; ++i) {
            const auto first = number(previous+1,1000000000000LL), last = number(first,1000000000000LL);
            total += last-first+1; previous=last;
            list.push_back({static_cast<std::uint64_t>(first),static_cast<std::uint64_t>(last)});
        }
        if (total != count) throw std::runtime_error("Rango sectorial incompleto");
    }
    std::vector<Row> history(n),queries(q);
    std::vector<int> labels(n);
    for (int i=0; i<n; ++i) { labels[i] = number(0,1); for (int& v : history[i]) v=number(0,10000); }
    for (auto& row : queries) for (int& v : row) v=number(0,10000);
    std::string extra;
    if (std::cin >> extra) throw std::runtime_error("Datos sobrantes");
    std::atomic<int> next{0};
    std::array<std::vector<Cell>,10> output;
    std::array<std::exception_ptr,10> failures{};
    std::vector<std::thread> threads;
    for (int t=0;t<workers;++t) threads.emplace_back([&]{
        for(int s=next++; s<10; s=next++) {
            try { output[s] = sectorRun(s,ranges[s],history,labels,queries,rules); }
            catch (...) { failures[s]=std::current_exception(); }
        }
    });
    for(auto& thread:threads) thread.join();
    for(int s=0;s<10;++s){
        if(failures[s]) std::rethrow_exception(failures[s]);
        for(const auto& c:output[s]) std::cout << c.hash << ' ' << c.initial << ' ' << c.ten << ' ' << c.votes << '\n';
    }
    return 0;
}
