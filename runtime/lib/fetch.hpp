// Soporte en C++ de estatic:fetch (#292): una petición HTTP con cualquier
// método, cabeceras y cuerpo, con libcurl en el pool de bloqueo del bucle de
// eventos (como http.get/post del runtime, runtime/ets_http_curl_*.hpp).
#pragma once
#include <string>
#include <vector>
#include "runtime/ets_http_curl_async.hpp"

namespace ets_fetch_lib {

inline ets::Result<ets::HttpClientResponse> requestSync(const std::string& method, const std::string& url,
        const std::vector<std::string>& names, const std::vector<std::string>& values, const std::string& body) {
    ets::detail::ensureCurlGlobalInit();
    CURL* h = ets::detail::makeEasyHandle(url, 30);
    if (!h) return ets::Result<ets::HttpClientResponse>::failure("curl_easy_init failed");
    ets::detail::WriteBuf buffer; ets::HttpClientResponse response;
    if (method == "GET") curl_easy_setopt(h, CURLOPT_HTTPGET, 1L);
    else if (method == "HEAD") curl_easy_setopt(h, CURLOPT_NOBODY, 1L);
    else curl_easy_setopt(h, CURLOPT_CUSTOMREQUEST, method.c_str());
    if (!body.empty() || (method != "GET" && method != "HEAD")) {
        curl_easy_setopt(h, CURLOPT_POSTFIELDS, body.c_str());
        curl_easy_setopt(h, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
    }
    struct curl_slist* headers = nullptr;
    for (std::size_t at = 0; at < names.size() && at < values.size(); ++at) headers = curl_slist_append(headers, (names[at] + ": " + values[at]).c_str());
    if (headers) curl_easy_setopt(h, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(h, CURLOPT_WRITEFUNCTION, ets::detail::curlWriteCb);
    curl_easy_setopt(h, CURLOPT_WRITEDATA, &buffer);
    curl_easy_setopt(h, CURLOPT_HEADERFUNCTION, ets::detail::curlHeaderCb);
    curl_easy_setopt(h, CURLOPT_HEADERDATA, &response);
    const CURLcode code = curl_easy_perform(h);
    if (headers) curl_slist_free_all(headers);
    if (code != CURLE_OK) {
        std::string error = "fetch " + method + " " + url + " failed: " + curl_easy_strerror(code);
        curl_easy_cleanup(h);
        return ets::Result<ets::HttpClientResponse>::failure(std::move(error));
    }
    long status = 0; curl_easy_getinfo(h, CURLINFO_RESPONSE_CODE, &status);
    response.status_ = static_cast<int>(status); response.body_ = std::move(buffer.data);
    curl_easy_cleanup(h);
    return ets::Result<ets::HttpClientResponse>::success(std::move(response));
}

inline ets::Task<ets::Result<ets::HttpClientResponse>> request(std::string method, std::string url,
        std::vector<std::string> names, std::vector<std::string> values, std::string body) {
    co_return co_await ets::runBlocking([method = std::move(method), url = std::move(url), names = std::move(names), values = std::move(values), body = std::move(body)]() {
        return requestSync(method, url, names, values, body);
    });
}

inline double status(ets::HttpClientResponse response) { return response.status_code(); }
inline std::string body(ets::HttpClientResponse response) { return response.body_str(); }
inline std::vector<std::string> headerNames(ets::HttpClientResponse response) {
    std::vector<std::string> out; for (const auto& item : response.headers_) out.push_back(item.first); return out;
}
inline std::vector<std::string> headerValues(ets::HttpClientResponse response) {
    std::vector<std::string> out; for (const auto& item : response.headers_) out.push_back(item.second); return out;
}

}  // namespace ets_fetch_lib
