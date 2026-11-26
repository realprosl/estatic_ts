// Implementación de runtime/ets_http_curl_client.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se compila
// aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/ets_http_curl_client.hpp"
#include "runtime/ets_http_curl_detail.hpp"
#include <curl/curl.h>
#include <cstring>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
namespace ets::detail {

ETS_API size_t curlHeaderCb(char* p, size_t s, size_t n, void* ud) {
    auto* out = static_cast<HttpClientResponse*>(ud);
    const std::size_t total = s * n;
    std::string line(p, total);
    // Quita \r\n al final si los tiene.
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) {
        line.pop_back();
    }
    // Ignora lineas de status (HTTP/1.1 200 OK) y lineas vacias.
    if (line.empty()) return total;
    if (line.compare(0, 5, "HTTP/") == 0) return total;
    const auto colon = line.find(':');
    if (colon == std::string::npos) return total;
    std::string name = line.substr(0, colon);
    std::string value = line.substr(colon + 1);
    // Trim leading whitespace del value.
    std::size_t vs = 0;
    while (vs < value.size() && (value[vs] == ' ' || value[vs] == '\t')) ++vs;
    value = value.substr(vs);
    out->headers_.emplace_back(std::move(name), std::move(value));
    return total;
}

ETS_API CURL* makeEasyHandle(const std::string& url, long timeoutSec) {
    CURL* h = curl_easy_init();
    if (!h) return nullptr;
    curl_easy_setopt(h, CURLOPT_URL, url.c_str());
    curl_easy_setopt(h, CURLOPT_TIMEOUT, timeoutSec);
    curl_easy_setopt(h, CURLOPT_CONNECTTIMEOUT, timeoutSec);
    curl_easy_setopt(h, CURLOPT_NOSIGNAL, 1L);  // thread-safe
    curl_easy_setopt(h, CURLOPT_FOLLOWLOCATION, 1L);  // redirects
    curl_easy_setopt(h, CURLOPT_MAXREDIRS, 5L);
    curl_easy_setopt(h, CURLOPT_ACCEPT_ENCODING, "");  // gzip/deflate
    return h;
}
} // namespace ets::detail
namespace ets {

ETS_API ets::Result<ets::HttpClientResponse> httpClientGet(const std::string& url) {
    detail::ensureCurlGlobalInit();
    CURL* h = detail::makeEasyHandle(url);
    if (!h) return ets::Result<ets::HttpClientResponse>::failure("curl_easy_init failed");
    detail::WriteBuf wb;
    HttpClientResponse resp;
    curl_easy_setopt(h, CURLOPT_HTTPGET, 1L);
    curl_easy_setopt(h, CURLOPT_WRITEFUNCTION, detail::curlWriteCb);
    curl_easy_setopt(h, CURLOPT_WRITEDATA, &wb);
    curl_easy_setopt(h, CURLOPT_HEADERFUNCTION, detail::curlHeaderCb);
    curl_easy_setopt(h, CURLOPT_HEADERDATA, &resp);
    CURLcode rc = curl_easy_perform(h);
    if (rc != CURLE_OK) {
        std::string err = "GET " + url + " failed: ";
        err += curl_easy_strerror(rc);
        curl_easy_cleanup(h);
        return ets::Result<ets::HttpClientResponse>::failure(std::move(err));
    }
    long status = 0;
    curl_easy_getinfo(h, CURLINFO_RESPONSE_CODE, &status);
    resp.status_ = static_cast<int>(status);
    resp.body_ = std::move(wb.data);
    curl_easy_cleanup(h);
    return ets::Result<ets::HttpClientResponse>::success(std::move(resp));
}

ETS_API ets::Result<ets::HttpClientResponse> httpClientPost(const std::string& url,
                                                const std::string& body,
                                                const std::string& contentType) {
    detail::ensureCurlGlobalInit();
    CURL* h = detail::makeEasyHandle(url);
    if (!h) return ets::Result<ets::HttpClientResponse>::failure("curl_easy_init failed");
    detail::WriteBuf wb;
    HttpClientResponse resp;
    curl_easy_setopt(h, CURLOPT_POST, 1L);
    curl_easy_setopt(h, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(h, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
    struct curl_slist* headers = nullptr;
    if (!contentType.empty()) {
        const std::string h = "Content-Type: " + contentType;
        headers = curl_slist_append(headers, h.c_str());
    }
    if (headers) curl_easy_setopt(h, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(h, CURLOPT_WRITEFUNCTION, detail::curlWriteCb);
    curl_easy_setopt(h, CURLOPT_WRITEDATA, &wb);
    curl_easy_setopt(h, CURLOPT_HEADERFUNCTION, detail::curlHeaderCb);
    curl_easy_setopt(h, CURLOPT_HEADERDATA, &resp);
    CURLcode rc = curl_easy_perform(h);
    if (headers) curl_slist_free_all(headers);
    if (rc != CURLE_OK) {
        std::string err = "POST " + url + " failed: ";
        err += curl_easy_strerror(rc);
        curl_easy_cleanup(h);
        return ets::Result<ets::HttpClientResponse>::failure(std::move(err));
    }
    long status = 0;
    curl_easy_getinfo(h, CURLINFO_RESPONSE_CODE, &status);
    resp.status_ = static_cast<int>(status);
    resp.body_ = std::move(wb.data);
    curl_easy_cleanup(h);
    return ets::Result<ets::HttpClientResponse>::success(std::move(resp));
}
} // namespace ets
