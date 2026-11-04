#pragma once
#include <iostream>
#include <string>

namespace ets_native {
inline void print(const std::string& text) {
  std::cout << text << '\n';
}
}
