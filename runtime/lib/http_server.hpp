// Funciones del servidor HTTP comunes a estatic:http (cpp-httplib) y
// estatic:http/drogon (Drogon). Se incluye detrás de la cabecera del backend,
// que define ets::Server, ets::HttpRequest y ets::http_param/query/header.
#pragma once
#include <string>

namespace ets_http_lib {
inline ets::Server createServer() { return ets::Server{}; }
inline std::string param(const ets::HttpRequest* request, std::string name) { return ets::http_param(*request, name); }
inline std::string query(const ets::HttpRequest* request, std::string name) { return ets::http_query(*request, name); }
inline std::string header(const ets::HttpRequest* request, std::string name) { return ets::http_header(*request, name); }
}  // namespace ets_http_lib
