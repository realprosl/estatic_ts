#pragma once

// Detalles de libcurl del cliente HTTP (#377). Solo lo incluyen los .cpp
// (ets_http_curl_client.cpp, lib/fetch.cpp): así <curl/curl.h> no entra en
// las cabeceras del programa.
#include "runtime/ets_http_curl_client.hpp"
#include <curl/curl.h>
#include <mutex>
#include <string>

namespace ets {
// ----------------------------------------------------------------------------
// libcurl global init/cleanup. Una vez por proceso. RAII via CurLGlobal_.
// ----------------------------------------------------------------------------
namespace detail {
inline void ensureCurlGlobalInit() {
    static std::once_flag once;
    std::call_once(once, []() { curl_global_init(CURL_GLOBAL_DEFAULT); });
}
}  // namespace detail

// ----------------------------------------------------------------------------
// httpClientGet / httpClientPost — envuelven curl_easy. Bloqueantes
// (mismo modelo que el V28). Para async real usar curl_multi, que
// sera un PR siguiente si hace falta.
// ----------------------------------------------------------------------------
namespace detail {

// Buffer de escritura que crece con cada llamada al callback.
struct WriteBuf {
    std::string data;
};
inline size_t curlWriteCb(char* p, size_t s, size_t n, void* ud) {
    auto* b = static_cast<WriteBuf*>(ud);
    b->data.append(p, s * n);
    return s * n;
}

// Header callback: cada header llega como una linea "Name: Value\r\n".
// Guardamos todos en el response para que header(name) funcione.
ETS_API size_t curlHeaderCb(char* p, size_t s, size_t n, void* ud);

ETS_API CURL* makeEasyHandle(const std::string& url, long timeoutSec = 10);

}  // namespace detail
}  // namespace ets
