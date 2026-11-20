// Soporte en C++ de estatic:terminal (#292): las operaciones de terminal de
// runtime/ets_terminal.hpp (las mismas que console.color, console.moveTo...).
#pragma once
#include <string>
#include "runtime/ets_terminal.hpp"

namespace ets_terminal_lib {
inline ::ets::terminal_detail::Operations ops() { return ::ets::terminal_detail::Operations{}; }
inline bool write(std::string text) { return ops().write(text); }
inline bool writeLine(std::string text) { return ops().writeLine(text); }
inline bool flush() { return ops().flush(); }
inline bool isTTY() { return ops().isTTY(); }
inline bool supportsAnsi() { return ops().supportsAnsi(); }
inline double columns() { return ops().columns(); }
inline double rows() { return ops().rows(); }
inline bool color(std::string name) { return ops().color(name); }
inline bool background(std::string name) { return ops().background(name); }
inline bool style(std::string name) { return ops().style(name); }
inline bool reset() { return ops().reset(); }
inline bool clear() { return ops().clear(); }
inline bool clearLine() { return ops().clearLine(); }
inline bool moveTo(double column, double row) { return ops().moveTo(column, row); }
inline bool moveBy(double columns, double rows) { return ops().moveBy(columns, rows); }
inline bool hideCursor() { return ops().hideCursor(); }
inline bool showCursor() { return ops().showCursor(); }
}  // namespace ets_terminal_lib
