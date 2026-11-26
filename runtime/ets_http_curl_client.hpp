// runtime/ets_http_curl_client.hpp — Cliente HTTP/1.1+ sobre libcurl.
//
// Sustituye al cliente sobre TCP plano de runtime/ets_http_client.hpp
// (V28). libcurl nos da HTTP/1.1, HTTPS, HTTP/2, redirects automaticos,
// connection pooling, timeouts, decompression, todo built-in y
// battle-tested (es lo que usan git, docker, slack, aws-cli, etc).
//
// API del dialecto: IDENTICA a la del cliente V28. El codegen del
// dialecto NO nota la diferencia:
//
//   let r = http.get("http://example.com/path")
//   match (r) {
//     Result.Ok(v) => print("status=" + numberToString(v.status()))
//     Result.Err(e) => print("error: " + e)
//   }
//
// Compilacion:
//   g++ -std=c++20 -I. programa.cpp -lcurl -o programa
//
// El link con -lcurl es automatico. Para HTTPS no hay que hacer
// nada extra: libcurl-openssl-dev ya esta linkado por defecto.

#pragma once

#include "runtime/ets_api.hpp"


#include <cstring>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace ets {

// ----------------------------------------------------------------------------
// HttpClientResponse — struct plano con el resultado de un request.
// Accesores estilo metodo (status_code(), body_str(), header(name))
// para que el codegen del dialecto pueda traducir status()/body()/header()
// sin ambiguedad con campos.
// ----------------------------------------------------------------------------
struct HttpClientResponse {
    int status_code() const { return status_; }
    const std::string& body_str() const { return body_; }
    std::string header(const std::string& name) const {
        // Headers en libcurl son case-insensitive en lookup: el user
        // puede pedir "Content-Type" o "content-type" indistintamente.
        for (const auto& kv : headers_) {
            if (strcasecmp(kv.first.c_str(), name.c_str()) == 0) {
                return kv.second;
            }
        }
        return std::string();
    }

    int status_ = 0;
    std::string body_;
    std::vector<std::pair<std::string, std::string>> headers_;
};

// Los detalles de libcurl (init global, callbacks, makeEasyHandle) están en
// runtime/ets_http_curl_detail.hpp, que solo incluyen los .cpp (#377).


}  // namespace ets  // cierre del namespace ets abierto en linea 36
    // (HttpClientResponse y detail::*). Reabrimos namespace ets para
    // Result y las funciones httpClientGet/Post a continuacion.

// Result<T> en namespace ets. Mismo nombre que el de ets_async.hpp
// para mantener compatibilidad con el codegen del dialecto. El
// `ETS_RESULT_DEFINED` evita redefinition cuando el dialecto ya
// incluye ets_async.hpp (via ets_runtime_full.hpp).
#include "runtime/ets_result.hpp"

namespace ets {

ETS_API ets::Result<ets::HttpClientResponse> httpClientGet(const std::string& url);

ETS_API ets::Result<ets::HttpClientResponse> httpClientPost(const std::string& url,
                                                const std::string& body,
                                                const std::string& contentType);

}  // namespace ets

#if !defined(ETS_RUNTIME_PRECOMPILED)
#include "runtime/ets_http_curl_client.cpp"
#endif
