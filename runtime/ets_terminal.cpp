// Implementación de runtime/ets_terminal.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se compila
// aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/ets_terminal.hpp"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <mutex>
#include <string>
#include "runtime/ets_io.hpp"
#ifdef _WIN32
#ifndef NOMINMAX
#endif
#include <windows.h>
#include <io.h>
#else
#include <unistd.h>
#include <sys/ioctl.h>
#endif
namespace ets::terminal_detail {

ETS_API int colorCode(const std::string& name) {
    const char* colors[]={"black","red","green","yellow","blue","magenta","cyan","white"};
    if(name=="default") return 9;
    for(int i=0;i<8;i++) if(name==colors[i]) return i;
    return -1;
}
} // namespace ets::terminal_detail
