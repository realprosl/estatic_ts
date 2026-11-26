// Corrutinas de runtime/ets_http_curl_async.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se compila
// aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/ets_http_curl_async.hpp"
#include "ets_http_curl_client.hpp"  // HttpClientResponse, Result, httpClientGet, httpClientPost
#include "ets_async.hpp"               // Task, runBlocking, defaultEventLoop
#include <string>
#include <utility>
namespace ets {

ETS_API Task<Result<HttpClientResponse>> httpClientPostAsync(
    std::string url, std::string body, std::string contentType) {
    co_return co_await runBlocking(
        [url = std::move(url), body = std::move(body), contentType = std::move(contentType)]() -> Result<HttpClientResponse> {
            return httpClientPost(url, body, contentType);
        });
}
} // namespace ets
