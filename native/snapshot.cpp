#include "kernel.hpp"
#include <cstdio>
#include <future>
#include <iostream>
#include <memory>
#include <vector>
#include <zlib.h>

namespace {
using Id = std::uint64_t;
struct Profile { unsigned sector, balance, mask; };
struct Run { Id last; unsigned profile; bool founder; };
struct Stats {
    std::array<Id, 10> total{}, found{}, passed{};
    Id balance = 0;
};
struct Block { std::vector<unsigned char> rows; Stats stats; };
constexpr unsigned cases = 4096;
using Answers = std::array<std::array<int, cases>, 7>;

// The common school has two chained rules and explicit negative evidence.
// The independent JS oracle generates all expected answers from the actual casebook.
int exercise(unsigned specialty, unsigned index) {
    if (specialty == 6) {
        const bool traceable = (index & 1) != 0;
        const bool ready = traceable && (index & 2);
        return (ready ? 1 : 0) | ((index & 4) ? 2 : 0);
    }
    const int a = static_cast<int>(index % 23) - 11;
    const int b = static_cast<int>((index >> 3) % 29) - 14;
    const int c = static_cast<int>((index >> 6) % 31) - 15;
    const int data[]{a,b,c,-b,a+c,1-c};
    return semar::twice(static_cast<semar::Op>(specialty + 2), data, 6);
}
Block process(Id first, Id end, const std::vector<Run>& runs, const std::vector<Profile>& profiles, const Answers& expected) {
    Block block;
    block.rows.resize((end - first) * 8);
    auto run = std::lower_bound(runs.begin(), runs.end(), first,
        [](const Run& r, Id id){ return r.last < id; });
    for (Id id = first; id < end; ++id) {
        if (id > run->last) ++run;
        const auto p = run->profile;
        const auto& agent = profiles[p];
        auto* row = block.rows.data() + (id-first)*8;
        row[0] = agent.sector; row[1] = agent.balance;
        row[2] = agent.mask & 255; row[3] = agent.mask >> 8;
        for (unsigned i=0; i<4; ++i) row[4+i] = static_cast<unsigned char>(p >> (i*8));
        const unsigned sector = agent.sector-1, specialty = sector%7;
        ++block.stats.total[sector];
        block.stats.found[sector] += run->founder;
        block.stats.balance += agent.balance;
        if (!agent.balance) continue;
        const unsigned index = (id * 2654435761ULL) & (cases-1);
        if (!(agent.mask & (1U << (specialty+2))) || exercise(specialty,index) != expected[specialty][index])
            throw std::runtime_error("Examen fallido para el ID " + std::to_string(id));
        ++block.stats.passed[sector];
    }
    return block;
}
}
int snapshot(const char* path, unsigned threads) {
    std::string header;
    if (!std::getline(std::cin,header) || header.empty() || header.size()>32*1024*1024) throw std::runtime_error("Cabecera de archivo inválida");
    header.push_back('\n');
    Id pop; unsigned profileCount, runCount;
    if (threads < 1 || threads > 64 || !(std::cin >> pop >> profileCount >> runCount) ||
        !pop || pop > 1000000000000ULL || !profileCount || !runCount ||
        profileCount > pop || runCount > pop) throw std::runtime_error("Cabecera del padrón inválida");
    std::vector<Profile> profiles(profileCount);
    for (auto& p : profiles)
        if (!(std::cin >> p.sector >> p.balance >> p.mask) || p.sector<1 || p.sector>10 || p.balance>255 || !p.mask || p.mask>=512)
            throw std::runtime_error("Perfil inválido");
    std::vector<Run> runs;
    Id last=0;
    for (unsigned i=0; i<runCount; ++i) {
        Id end; unsigned p, founder;
        if (!(std::cin >> end >> p >> founder) || end<=last || end>pop || p>=profiles.size() || founder>1) throw std::runtime_error("Rango inválido");
        runs.push_back({end,p,founder!=0}); last=end;
    }
    if (last!=pop) throw std::runtime_error("Padrón incompleto");
    Answers expected{};
    for (auto& method : expected) for (auto& answer : method)
        if (!(std::cin >> answer)) throw std::runtime_error("Oráculo incompleto");
    std::string extra;
    if (std::cin >> extra) throw std::runtime_error("Datos sobrantes");
    gzFile file=gzopen(path,"wb6");
    if (!file) throw std::runtime_error("No se pudo crear el padrón");
    Stats stats;
    try {
        if(gzwrite(file,header.data(),static_cast<unsigned>(header.size()))!=static_cast<int>(header.size())) throw std::runtime_error("Cabecera incompleta");
        constexpr Id blockSize = 262144;
        for (Id first=1; first<=pop;) {
            std::vector<std::future<Block>> jobs;
            for (unsigned i=0; i<threads && first<=pop; ++i) {
                const Id start=first, end=std::min(pop+1,start+blockSize);
                jobs.push_back(std::async(std::launch::async,[&,start,end] { return process(start,end,runs,profiles,expected); }));
                first=end;
            }
            for (auto& job : jobs) {
                auto b=job.get();
                if (gzwrite(file,b.rows.data(),static_cast<unsigned>(b.rows.size()))!=static_cast<int>(b.rows.size())) throw std::runtime_error("Escritura incompleta");
                stats.balance+=b.stats.balance;
                for (unsigned i=0;i<10;++i) {
                    stats.total[i]+=b.stats.total[i]; stats.found[i]+=b.stats.found[i]; stats.passed[i]+=b.stats.passed[i];
                }
            }
        }
    } catch (...) { gzclose(file); throw; }
    if (gzclose(file)!=Z_OK) throw std::runtime_error("No se pudo cerrar el padrón");
    std::cout << stats.balance << '\n';
    for (unsigned i=0;i<10;++i) std::cout<<stats.total[i]<<' '<<stats.found[i]<<' '<<stats.passed[i]<<'\n';
    return 0;
}
