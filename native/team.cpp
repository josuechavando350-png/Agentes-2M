#include <chrono>
#include <future>
#include <istream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// Inputs contain every row's subject and field. Values and source locators
// stay in the immutable dossier and are resolved by the reducer from returned offsets.
std::string team_scan(std::istream& input) {
    int members, lanes, count, fields;
    std::string subject, first, second;
    if (!(input >> members >> lanes >> count >> fields >> subject >> first) ||
        (members != 1 && members != 10 && members != 100) ||
        lanes < 1 || lanes > 4 || lanes > members || count < members || count > 8192 ||
        (fields != 1 && fields != 2) || (fields == 2 && !(input >> second))) {
        throw std::runtime_error("Cabecera de equipo inválida");
    }
    std::vector<std::pair<std::string, std::string>> rows(count);
    for (auto& row : rows) {
        if (!(input >> row.first >> row.second)) throw std::runtime_error("Filas incompletas");
    }
    std::string trailing;
    if (input >> trailing) throw std::runtime_error("Filas sobrantes");

    std::vector<std::vector<int>> matches(members);
    auto scan = [&](int lane) {
        for (int seat = lane; seat < members; seat += lanes) {
            const int begin = count * seat / members, end = count * (seat + 1) / members;
            for (int i = begin; i < end; ++i) {
                const auto& row = rows[i];
                if (row.first == subject && (row.second == first || (fields == 2 && row.second == second)))
                    matches[seat].push_back(i);
            }
        }
    };
    const auto start = std::chrono::steady_clock::now();
    std::vector<std::future<void>> jobs;
    for (int lane = 1; lane < lanes; ++lane)
        jobs.emplace_back(std::async(std::launch::async, scan, lane));
    scan(0);
    for (auto& job : jobs) job.get();
    const auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now() - start).count();
    std::string result = "{\"lanes\":" + std::to_string(lanes) + ",\"scanNs\":" + std::to_string(ns) + ",\"hits\":[";
    for (int seat = 0; seat < members; ++seat) {
        if (seat) result += ',';
        result += '[';
        const auto& found = matches[seat];
        for (std::size_t j = 0; j < found.size(); ++j) {
            if (j) result += ',';
            result += std::to_string(found[j]);
        }
        result += ']';
    }
    return result + "]}";
}
