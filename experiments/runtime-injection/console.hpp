#pragma once
#include <string>
namespace ets_poc {
inline std::string decorate(const std::string& value) { return "runtime:" + value; }
inline std::string decorate_twice(const std::string& value) { return decorate(value) + "!"; }
}
