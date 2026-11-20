#include "kernel.hpp"
#include <iostream>
#include <sstream>
#include <string>
#include <unordered_set>
#include <vector>

std::string team_scan(std::istream& input);
int population(int rules);
int snapshot(const char* path, unsigned threads);

namespace {
int bounded(std::istream& in, int lo, int hi) {
    int value;
    if (!(in >> value) || value < lo || value > hi) throw std::runtime_error("Argumento inválido");
    return value;
}
std::string literal(std::istream& in) {
    std::string word;
    if (!(in >> word) || word.size() > 64) throw std::runtime_error("Literal inválido");
    return word;
}
std::string decide(std::istream& in) {
    const auto query = literal(in);
    std::unordered_set<std::string> known;
    const auto facts = bounded(in, 0, 64);
    for (int i = 0; i < facts; ++i) known.insert(literal(in));
    struct Rule { std::string head; std::vector<std::string> conditions; };
    std::vector<Rule> rules(bounded(in, 0, 48));
    for (auto& rule : rules) {
        rule.head = literal(in);
        const int n = bounded(in, 1, 8);
        for (int i = 0; i < n; ++i) rule.conditions.push_back(literal(in));
    }
    bool progress;
    do {
        progress = false;
        for (const auto& rule : rules) {
            if (!known.count(rule.head) && std::all_of(rule.conditions.begin(), rule.conditions.end(),
                    [&](const auto& c) { return known.count(c); })) {
                known.insert(rule.head);
                progress = true;
            }
        }
    } while (progress);
    const bool yes = known.count(query), no = known.count("!" + query);
    return yes ? (no ? "CONFLICTED" : "SUPPORTED") : (no ? "REFUTED" : "UNKNOWN");
}
void serve() {
    std::string line;
    while (std::getline(std::cin, line)) {
        try {
            if (line.rfind("TEAM ", 0) == 0) {
                if (line.size() > 2 * 1024 * 1024) throw std::runtime_error("Expediente demasiado grande");
                std::istringstream packet(line.substr(5));
                std::cout << team_scan(packet) << std::endl;
                continue;
            }
            if (line.size() > 65536) throw std::runtime_error("Tarea demasiado larga");
            std::istringstream in(line);
            const auto op = static_cast<semar::Op>(bounded(in, 0, 8));
            std::string answer;
            if (op == semar::Op::inference) answer = decide(in);
            else {
                std::array<int, 16> data{};
                const int n = bounded(in, 1, 16);
                for (int i = 0; i < n; ++i) data[i] = bounded(in, -1000000, 1000000);
                answer = std::to_string(semar::twice(op, data.data(), n));
            }
            std::string trailing;
            if (in >> trailing) throw std::runtime_error("Datos sobrantes");
            std::cout << answer << std::endl;
        } catch (const std::exception& e) { std::cout << "ERR " << e.what() << std::endl; }
    }
}
}
int main(int argc, char** argv) {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    try {
        if (argc == 2 && std::string(argv[1]) == "population") return population(100);
        if (argc == 3 && std::string(argv[1]) == "population-scale") {
            const std::string k = argv[2];
            if (k == "1") return population(1);
            if (k == "10") return population(10);
            throw std::runtime_error("Escala desconocida");
        }
        if (argc == 2 && std::string(argv[1]) == "serve") { serve(); return 0; }
        if (argc == 4 && std::string(argv[1]) == "snapshot")
            return snapshot(argv[2], static_cast<unsigned>(std::stoul(argv[3])));
        throw std::runtime_error("Use serve, population o snapshot ARCHIVO HILOS");
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
