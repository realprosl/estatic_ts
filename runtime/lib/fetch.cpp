// Implementación de runtime/lib/fetch.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se
// compila aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/lib/fetch.hpp"
#include "runtime/ets_http_curl_detail.hpp"
#include <string>
#include <utility>
#include <vector>

namespace ets_fetch_lib {

ETS_API ets::Result<ets::HttpClientResponse> requestSync(const std::string& method, const std::string& url,
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

ETS_API ets::Task<ets::Result<ets::HttpClientResponse>> request(std::string method, std::string url,
        std::vector<std::string> names, std::vector<std::string> values, std::string body) {
    co_return co_await ets::runBlocking([method = std::move(method), url = std::move(url), names = std::move(names), values = std::move(values), body = std::move(body)]() {
        return requestSync(method, url, names, values, body);
    });
}

}  // namespace ets_fetch_lib
