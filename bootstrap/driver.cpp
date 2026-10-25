// Installed entry point. The frontend is native; the current TypeScript
// driver/emitter run with Node, from the installed distribution, not the clone.
#include "install_config.hpp"
#include <filesystem>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>
#include <unistd.h>

namespace fs = std::filesystem;
static fs::path executablePath(const char* argument) {
    fs::path path(argument);
    if (path.has_parent_path()) return fs::canonical(fs::absolute(path));
    const char* raw = std::getenv("PATH");
    const std::string search = raw ? raw : "";
    std::size_t begin = 0;
    while (begin <= search.size()) {
        const auto end = search.find(':', begin);
        auto candidate = fs::path(search.substr(begin, end - begin)) / path;
        if (::access(candidate.c_str(), X_OK) == 0) return fs::canonical(fs::absolute(candidate));
        if (end == std::string::npos) break;
        begin = end + 1;
    }
    throw std::runtime_error("No se encuentra nativo en PATH");
}
int main(int argc, char** argv) {
    try {
        const auto home = executablePath(argv[0]).parent_path() / "../lib/nativo/current";
        const auto script = fs::weakly_canonical(home / "bootstrap/cli.ts");
        if (!fs::exists(script)) throw std::runtime_error("Instalación incompleta: falta bootstrap/cli.ts");
        const char* node = std::getenv("NATIVO_NODE");
        if (!node || !*node) node = ESTATIC_NODE;
        std::vector<std::string> arguments{node, "--experimental-strip-types", "--no-warnings", script.string()};
        for (int at = 1; at < argc; ++at) arguments.emplace_back(argv[at]);
        std::vector<char*> pointers;
        for (auto& value : arguments) pointers.push_back(value.data());
        pointers.push_back(nullptr);
        ::execvp(node, pointers.data());
        std::cerr << "No se puede ejecutar Node: " << node << '\n';
        return 1;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
