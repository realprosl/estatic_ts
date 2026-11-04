#pragma once
#include <string>
namespace ets_native {
inline double add(double a, double b) { return a + b; }
inline std::string greet(const std::string& name) { return "Hola, " + name; }
inline std::string checked_label(double value) {
  return value < 0 ? "ERROR" : "OK";
}
}
