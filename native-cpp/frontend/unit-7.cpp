// Generated module. Do not edit.
#include "estatic_common.hpp"

std::string canonicalFile(std::string file) {
    return ets_bootstrap::canonical(file);;
    return std::string("");
}

std::string fileMetadata(std::string file) {
    return ets_bootstrap::metadata(file);;
    return std::string("");
}

std::string contentHash(std::string text) {
    return ets_bootstrap::sha256(text);;
    return std::string("");
}

bool publishRecord(std::string file, std::string text) {
    return ets_bootstrap::atomicWrite(file, text);;
    return false;
}

std::string syntaxIdentity() {
    return ets_bootstrap::syntaxIdentity();;
    return std::string("");
}

std::vector<std::string> readSnapshot(std::string file) {
    return ets_bootstrap::readSnapshot(file);;
    return std::vector<std::string>();
}

void ets_init_bootstrap_modules_platform_562cee50() {

}
