// One funded founder contributes one policy decision on one observed randomized customer.
#include <openssl/evp.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
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
struct Range { U64 first, last; };
struct Customer { std::uint32_t flags; std::array<I64,3> pseudo; };
struct Rule { unsigned first, second, leaves; };
struct Output { std::string digest; std::vector<I64> sums; };
I64 readValue(I64 low, I64 high) {
    I64 v;
    if (!(std::cin >> v) || v < low || v > high) throw std::runtime_error("Entrada de campaña fuera de dominio");
    return v;
}
// Each task seals founder ID, chosen action and signed contribution in a portable fixed-width record.
void appendWord(std::vector<unsigned char>& buffer, U64 word) {
    for (int b=0; b<8; ++b) { buffer.push_back(static_cast<unsigned char>(word)); word >>= 8; }
}
Output examine(const std::vector<Customer>& rows, const std::vector<Rule>& rules,
               const std::vector<Range>& ranges, std::size_t sector, bool sealed) {
    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> ctx(EVP_MD_CTX_new(),EVP_MD_CTX_free);
    if (!ctx || EVP_DigestInit_ex(ctx.get(),EVP_sha256(),nullptr)!=1) throw std::runtime_error("SHA-256");
    std::vector<unsigned char> buffer;
    buffer.reserve(32768);
    auto flush=[&] {if(EVP_DigestUpdate(ctx.get(),buffer.data(),buffer.size())!=1)throw std::runtime_error("SHA-256"); buffer.clear();};
    std::size_t range=0; U64 id=ranges[0].first; Output result;
    const auto length=rows.size()/10;
    if (!sealed) {
        for (const auto& rule : rules) {
            I64 sum = 0;
            for (std::size_t i = sector * length; i < (sector + 1) * length; ++i) {
                const auto& customer = rows[i];
                const auto leaf = ((customer.flags >> rule.first) & 1U) | (((customer.flags >> rule.second) & 1U) << 1);
                sum += customer.pseudo[(rule.leaves >> (leaf * 2)) & 3U];
            }
            result.sums.push_back(sum);
        }
        result.digest = "scores";
        return result;
    }
    for(const auto& rule:rules){
        I64 sum=0;
        for(std::size_t i=sector*length;i<(sector+1)*length;++i){
            const auto& x=rows[i];
            const unsigned leaf=((x.flags>>rule.first)&1U) + 2*((x.flags>>rule.second)&1U);
            const unsigned action=(rule.leaves>>(leaf*2))&3U;
            const auto gain=x.pseudo[action];
            sum+=gain;
            appendWord(buffer,(id<<2)|action);appendWord(buffer,static_cast<U64>(gain));
            if(buffer.size()>=32768)flush();
            if(id==ranges[range].last){++range;if(range<ranges.size())id=ranges[range].first;}else ++id;
        }
        result.sums.push_back(sum);
    }
    if(range!=ranges.size())throw std::runtime_error("Participación incompleta");
    if(!buffer.empty())flush();
    unsigned char bytes[EVP_MAX_MD_SIZE];unsigned size;
    if(EVP_DigestFinal_ex(ctx.get(),bytes,&size)!=1 || size!=32)throw std::runtime_error("SHA-256");
    std::ostringstream hex;hex<<std::hex<<std::setfill('0');
    for(unsigned i=0;i<size;++i)hex<<std::setw(2)<<static_cast<unsigned>(bytes[i]);
    result.digest=hex.str();return result;
}
}
int offer_search(bool sealed){
    const auto threads=readValue(1,10),n=readValue(10,10000),k=readValue(1,10000);
    if(n%10 || n*k>100000000)throw std::runtime_error("Cobertura sectorial inválida");
    std::array<std::vector<Range>,10> ranges;
    std::vector<Range> all;
    for(auto& list:ranges){
        const auto count=readValue(1,100000);I64 total=0,prior=0;
        for(int j=0;j<count;++j){
            const auto a=readValue(prior+1,1000000000000LL),b=readValue(a,1000000000000LL);
            total+=b-a+1;prior=b;list.push_back({static_cast<U64>(a),static_cast<U64>(b)});all.push_back(list.back());
        }
        if(total!=n*k/10)throw std::runtime_error("Identidades insuficientes");
    }
    std::sort(all.begin(),all.end(),[](Range a,Range b){return a.first<b.first;});
    for(std::size_t i=1;i<all.size();++i)if(all[i].first<=all[i-1].last)throw std::runtime_error("Identidad duplicada");
    std::vector<Customer> rows(n);for(auto& r:rows){
        r.flags=readValue(0,2147483647);for(auto& v:r.pseudo)v=readValue(-1000000000,1000000000);
    }
    std::vector<Rule> rules(k);for(auto& r:rules){
        r.first=readValue(0,30);r.second=readValue(0,30);r.leaves=readValue(0,170);
        for(int i=0;i<4;++i)if(((r.leaves>>(2*i))&3U)==3U)throw std::runtime_error("Acción desconocida");
    }
    std::string trailing;if(std::cin>>trailing)throw std::runtime_error("Datos sobrantes");
    std::array<Output,10> outputs;std::array<std::exception_ptr,10> errors{};
    std::atomic<int> next{0};std::vector<std::thread> pool;
    for(int t=0;t<threads;++t)pool.emplace_back([&]{for(int i=next++;i<10;i=next++){try{outputs[i]=examine(rows,rules,ranges[i],i,sealed);}catch(...){errors[i]=std::current_exception();}}});
    for(auto& t:pool)t.join();
    for(const auto& e:errors)if(e)std::rethrow_exception(e);
    for(const auto& o:outputs){std::cout<<o.digest;for(auto v:o.sums)std::cout<<' '<<v;std::cout<<'\n';}
    return 0;
}
