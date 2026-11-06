#pragma once
// Platform services only. No ETS syntax, import rules, graph or cache policy.
#include <array>
#include <atomic>
#include <chrono>
#include <bit>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>
#include <cstring>
#include <cerrno>
#include <sys/stat.h>
#include <unistd.h>
namespace ets_bootstrap {
inline std::string sha256(const std::string& text) {
    constexpr std::array<uint32_t,64> k = {
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
    std::array<uint32_t,8> h = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    std::string data=text; const uint64_t bits=uint64_t(text.size())*8;
    data.push_back(char(0x80)); while(data.size()%64!=56) data.push_back(0);
    for(int i=7;i>=0;--i) data.push_back(char(bits>>(i*8)));
    for(size_t off=0;off<data.size();off+=64) {
        std::array<uint32_t,64> w{};
        for(int i=0;i<16;++i) for(int j=0;j<4;++j) w[i]=(w[i]<<8)|uint8_t(data[off+i*4+j]);
        for(int i=16;i<64;++i) {
            const auto x=w[i-15],y=w[i-2];
            w[i]=w[i-16]+(std::rotr(x,7)^std::rotr(x,18)^(x>>3))+w[i-7]+(std::rotr(y,17)^std::rotr(y,19)^(y>>10));
        }
        auto a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],v=h[7];
        for(int i=0;i<64;++i) {
            auto t=v+(std::rotr(e,6)^std::rotr(e,11)^std::rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i];
            auto u=(std::rotr(a,2)^std::rotr(a,13)^std::rotr(a,22))+((a&b)^(a&c)^(b&c));
            v=g;g=f;f=e;e=d+t;d=c;c=b;b=a;a=t+u;
        }
        h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=v;
    }
    std::string out; constexpr char hex[]="0123456789abcdef";
    for(auto v:h) for(int shift=28;shift>=0;shift-=4) out+=hex[(v>>shift)&15];
    return out;
}
inline std::string canonical(const std::string& file) {
    std::error_code ec;
    if(!std::filesystem::is_regular_file(file,ec)||ec) return "";
    const auto result=std::filesystem::canonical(file,ec);return ec?"":result.string();
}
inline std::string metadata(const std::string& file) {
    struct stat s{}; if(::stat(file.c_str(),&s)!=0||!S_ISREG(s.st_mode)) return "";
    // Integers remain strings: nanosecond epochs and inode numbers exceed 2^53.
    return std::to_string(s.st_size)+"|"+std::to_string(s.st_mtim.tv_sec)+":"+std::to_string(s.st_mtim.tv_nsec)
        +"|"+std::to_string(s.st_ctim.tv_sec)+":"+std::to_string(s.st_ctim.tv_nsec)
        +"|"+std::to_string(s.st_dev)+"|"+std::to_string(s.st_ino);
}
inline std::vector<std::string> readSnapshot(const std::string& file) {
    const auto before=metadata(file); std::string contents,error;
    std::ifstream input(file,std::ios::binary);
    if(!input) error="No se puede leer '"+file+"': "+std::strerror(errno);
    else {
        std::array<char,65536> buffer{};
        while(input.read(buffer.data(),buffer.size()) || input.gcount()>0) contents.append(buffer.data(),input.gcount());
        if(!input.eof()) {error="Error durante la lectura de '"+file+"'";contents.clear();}
    }
    return {contents,error,before,metadata(file)};
}
inline bool atomicWrite(const std::string& file,const std::string& contents) {
    std::error_code ec; std::filesystem::create_directories(std::filesystem::path(file).parent_path(),ec);
    if(ec) return false;
    static std::atomic<uint64_t> sequence{0};
    const auto temp=file+"."+std::to_string(::getpid())+"."+std::to_string(sequence++)+".tmp";
    std::ofstream stream(temp,std::ios::binary|std::ios::trunc);
    if(!stream) return false;
    stream.write(contents.data(),contents.size());stream.close();
    if(stream.fail()) {std::filesystem::remove(temp,ec);return false;}
    std::filesystem::rename(temp,file,ec);
    if(ec) {std::filesystem::remove(temp,ec);return false;}return true;
}
inline std::string syntaxIdentity() {
#ifdef ESTATIC_FRONTEND_ID
    return ESTATIC_FRONTEND_ID;
#else
    // Unfingerprinted ad-hoc builds must not reuse entries across processes.
    static const auto nonce = std::chrono::high_resolution_clock::now().time_since_epoch().count();
    return std::string("unfingerprinted:")+std::to_string(::getpid())+":"+std::to_string(nonce);
#endif
}
}
