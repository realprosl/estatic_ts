#pragma once

#include "runtime/ets_api.hpp"

#include <cerrno>
#include <cstring>
#include <iterator>
#include <string>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <vector>

ETS_API bool runNativeProcess(std::vector<std::string> arguments, const std::string& description, std::string& error) noexcept;

ETS_API bool sourceUsesTreeSitter(const std::string& source) noexcept;

ETS_API bool compileCpp(const std::string& source, const std::string& binary, const std::string& includeRoot,
                       const std::string& compiler, const std::string& profile, std::string& error) noexcept;

#if !defined(ETS_RUNTIME_PRECOMPILED)
#include "runtime/ets_process.cpp"
#endif
