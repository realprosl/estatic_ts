// Compilacion segura de `std::regex`.
//
// El runtime de los programas generados se compila con `-fno-exceptions`, y
// libstdc++ implementa `_GLIBCXX_THROW_OR_ABORT` como `__builtin_abort()` en
// ese modo: un patron invalido de `std::regex` termina el proceso con
// SIGABRT sin possibility de diagnostico.
//
// Este TU se compila aparte con `-fexceptions` (ver `compiler/driver/main.ets`
// y `install.sh`, que ya hacen lo mismo para el backend Drogon). Aqui si hay
// propagation de excepciones, asi que el `regex_error` se captura y se
// devuelve como error de texto.
#include <new>
#include <optional>
#include <regex>
#include <string>

namespace ets {

// Devuelve `std::nullopt` si el patron no es valido. `error` recibe el
// diagnostico de `std::regex` cuando no es nullopt el resultado.
std::optional<std::regex> compile_regex(const std::string& pattern, std::regex::flag_type flags, std::string* error) {
    try {
        return std::regex(pattern, flags);
    } catch (const std::regex_error& failure) {
        if (error) *error = failure.what();
        return std::nullopt;
    } catch (const std::bad_alloc&) {
        if (error) *error = "out of memory";
        return std::nullopt;
    }
}

}  // namespace ets
