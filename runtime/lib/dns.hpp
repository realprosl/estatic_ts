// Soporte en C++ de estatic:dns (#292): resolveDns del runtime (libuv).
#pragma once
#include <string>
#include "runtime/ets_dns.hpp"

namespace ets_dns_lib {
inline ets::Task<std::string> lookup(std::string host) { return ets::resolveDns(std::move(host)); }
}  // namespace ets_dns_lib
