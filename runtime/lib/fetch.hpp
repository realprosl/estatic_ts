// Soporte en C++ de estatic:fetch (#292): una petición HTTP con cualquier
// método, cabeceras y cuerpo, con libcurl en el pool de bloqueo del bucle de
// eventos (como http.get/post del runtime, runtime/ets_http_curl_*.hpp).
#pragma once
#include "runtime/ets_api.hpp"
#include <string>
#include <vector>
#include "runtime/ets_http_curl_async.hpp"

namespace ets_fetch_lib {

ETS_API ets::Result<ets::HttpClientResponse> requestSync(const std::string& method, const std::string& url,
        const std::vector<std::string>& names, const std::vector<std::string>& values, const std::string& body);
ETS_API ets::Task<ets::Result<ets::HttpClientResponse>> request(std::string method, std::string url,
        std::vector<std::string> names, std::vector<std::string> values, std::string body);

inline double status(ets::HttpClientResponse response) { return response.status_code(); }
inline std::string body(ets::HttpClientResponse response) { return response.body_str(); }
inline std::vector<std::string> headerNames(ets::HttpClientResponse response) {
    std::vector<std::string> out; for (const auto& item : response.headers_) out.push_back(item.first); return out;
}
inline std::vector<std::string> headerValues(ets::HttpClientResponse response) {
    std::vector<std::string> out; for (const auto& item : response.headers_) out.push_back(item.second); return out;
}

}  // namespace ets_fetch_lib

#if !defined(ETS_RUNTIME_PRECOMPILED)
#include "runtime/lib/fetch.cpp"
#endif
