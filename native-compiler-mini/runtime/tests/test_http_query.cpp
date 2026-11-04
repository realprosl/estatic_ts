// Prueba standalone: no requiere Drogon, libuv ni servicios externos.
#include "runtime/ets_http_query.hpp"

#include <cassert>
#include <cstdio>
#include <map>
#include <string>
#include <thread>
#include <vector>

namespace {

// Oraculo independiente: semantica del parser anterior basado en map.
std::map<std::string, std::string> referenceParse(const std::string& query) {
    std::map<std::string, std::string> out;
    std::string key, value;
    bool inKey = true;
    for (char c : query) {
        if (c == '&') {
            if (!key.empty()) out[key] = value;
            key.clear(); value.clear(); inKey = true;
        } else if (c == '=' && inKey) {
            inKey = false;
        } else if (inKey) {
            key.push_back(c);
        } else {
            value.push_back(c);
        }
    }
    if (!key.empty()) out[key] = value;
    return out;
}

void checkQuery(const std::string& query) {
    const auto parsed = referenceParse(query);
    for (const auto& [name, expected] : parsed) {
        assert(ets::detail::rawQueryValue(query, name) == expected);
    }
    assert(ets::detail::rawQueryValue(query, "missing") == "");
    assert(ets::detail::rawQueryValue(query, "") == "");
}

}  // namespace

int main() {
    for (const std::string query : {
             "", "a=1&b=2", "a=1&a=2", "a=1&a", "a=&a=2&a=",
             "&&a=1&&", "=ignored&a=1", "a=x=y=z", "flag", "a=%20+%2F",
             "a=uno&ab=dos", "nombre=espa\xc3\xb1ol"}) {
        checkQuery(query);
    }
    // El string devuelto no toma prestada memoria de la entrada.
    std::string query = "a=" + std::string(4096, 'x');
    auto owned = ets::detail::rawQueryValue(query, "a");
    query = "a=changed";
    assert(owned == std::string(4096, 'x'));
    assert(ets::detail::rawQueryValue(query, "a") == "changed");

    // Muchas queries distintas: no debe acumularse ningun estado entre llamadas.
    // Repetirlo en varios hilos tambien detecta un estado compartido accidental.
    std::vector<std::thread> workers;
    for (int worker = 0; worker < 4; ++worker) {
        workers.emplace_back([worker] {
            for (int i = 0; i < 25000; ++i) {
                const auto value = std::to_string(worker) + "-" + std::to_string(i);
                const auto input = "id=" + value + "&empty=&id=" + value;
                assert(ets::detail::rawQueryValue(input, "id") == value);
                if (i % 1000 == 0) checkQuery(input);
            }
        });
    }
    for (auto& worker : workers) worker.join();
    std::puts("http-query: OK (100000 queries, 4 threads)");
}
