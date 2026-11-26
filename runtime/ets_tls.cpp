// Implementación de runtime/ets_tls.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se compila
// aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/ets_tls.hpp"
#include "runtime/ets_net.hpp"
#include <openssl/err.h>
#include <openssl/ssl.h>
#include <memory>
#include <string>
namespace ets {

ETS_API std::string tlsError(const std::string& operation) {
    const unsigned long code = ::ERR_get_error();
    if (code == 0) return operation;
    char buffer[256];
    ::ERR_error_string_n(code, buffer, sizeof(buffer));
    return operation + ": " + buffer;
}

ETS_API Result<TlsContext> createTlsServer(const std::string& certificatePath, const std::string& privateKeyPath) {
    ::OPENSSL_init_ssl(0, nullptr);
    SSL_CTX* context = ::SSL_CTX_new(::TLS_server_method());
    if (!context) return Result<TlsContext>::failure(tlsError("No se puede crear el contexto TLS"));
    ::SSL_CTX_set_min_proto_version(context, TLS1_2_VERSION);
    if (::SSL_CTX_use_certificate_chain_file(context, certificatePath.c_str()) != 1) {
        const auto error = tlsError("No se puede cargar el certificado TLS"); ::SSL_CTX_free(context); return Result<TlsContext>::failure(error);
    }
    if (::SSL_CTX_use_PrivateKey_file(context, privateKeyPath.c_str(), SSL_FILETYPE_PEM) != 1 || ::SSL_CTX_check_private_key(context) != 1) {
        const auto error = tlsError("No se puede cargar la clave privada TLS"); ::SSL_CTX_free(context); return Result<TlsContext>::failure(error);
    }
    return Result<TlsContext>::success(TlsContext{context});
}
} // namespace ets
