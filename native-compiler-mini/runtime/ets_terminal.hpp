#pragma once
// Included only for semantic uses of the ETS `console` terminal methods.
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
#define NOMINMAX
#endif
#include <windows.h>
#include <io.h>
#else
#include <unistd.h>
#include <sys/ioctl.h>
#endif

namespace ets {
namespace terminal_detail {
inline bool tty() {
#ifdef _WIN32
    DWORD mode=0;
    return GetConsoleMode(GetStdHandle(STD_OUTPUT_HANDLE),&mode)!=0;
#else
    return ::isatty(STDOUT_FILENO)==1;
#endif
}
struct State {
    std::mutex mutex;
    bool styled=false,hidden=false;
#ifdef _WIN32
    bool modeChanged=false;
    HANDLE output=INVALID_HANDLE_VALUE;
    DWORD originalMode=0;
#endif
    bool ansi() {
        if(!tty()) return false;
        const char* type=std::getenv("TERM");
        if(type && std::strcmp(type,"dumb")==0) return false;
#ifdef _WIN32
        const auto handle=GetStdHandle(STD_OUTPUT_HANDLE);
        DWORD mode=0;
        if(!GetConsoleMode(handle,&mode)) return false;
        if((mode & ENABLE_VIRTUAL_TERMINAL_PROCESSING)==0) {
            if(!SetConsoleMode(handle,mode|ENABLE_VIRTUAL_TERMINAL_PROCESSING)) return false;
            if(!modeChanged) {output=handle;originalMode=mode;modeChanged=true;}
        }
#else
        if(!type || !*type) return false;
#endif
        return true;
    }
    bool emit(const std::string& text) {
        std::cout << text;
        std::cout.flush();
        return std::cout.good();
    }
    ~State() {
        // Best effort on normal shutdown; no guarantees after forced termination.
        if((styled || hidden) && tty()) {
            std::cout.flush();
            if(styled) std::fputs("\033[0m",stdout);
            if(hidden) std::fputs("\033[?25h",stdout);
            std::fflush(stdout);
        }
#ifdef _WIN32
        if(modeChanged) SetConsoleMode(output,originalMode);
#endif
    }
};
inline State& state() {static State value;return value;}
inline int colorCode(const std::string& name) {
    const char* colors[]={"black","red","green","yellow","blue","magenta","cyan","white"};
    if(name=="default") return 9;
    for(int i=0;i<8;i++) if(name==colors[i]) return i;
    return -1;
}
inline bool integer(double value,double minimum,double maximum) {
    return std::isfinite(value) && std::floor(value)==value && value>=minimum && value<=maximum;
}
}

// Stateless handles all refer to stdout and the same synchronized state.
namespace terminal_detail {
struct Operations {
    bool isTTY() const {return terminal_detail::tty();}
    bool supportsAnsi() const {
        auto& s=terminal_detail::state();std::lock_guard<std::mutex> lock(s.mutex);return s.ansi();
    }
    bool write(const std::string& text) const {
        auto& s=terminal_detail::state();std::lock_guard<std::mutex> lock(s.mutex);
        return writeLocked(text);
    }
    bool writeLine(const std::string& text) const {return write(text+"\n");}
    bool flush() const {
        auto& s=terminal_detail::state();std::lock_guard<std::mutex> lock(s.mutex);
        std::cout.flush();return std::cout.good();
    }
    double columns() const {return dimension(true);}
    double rows() const {return dimension(false);}
    bool color(const std::string& name) const {return setColor(name,false);}
    bool background(const std::string& name) const {return setColor(name,true);}
    bool style(const std::string& name) const {
        const char* names[]={"bold","dim","italic","underline","inverse","strikethrough"};
        const int codes[]={1,2,3,4,7,9};
        int code=-1;for(int i=0;i<6;i++) if(name==names[i]) code=codes[i];
        if(code<0) return false;
        auto& s=terminal_detail::state();std::lock_guard<std::mutex> lock(s.mutex);
        if(!s.ansi()) return false;
        s.styled=true;
        return s.emit("\033["+std::to_string(code)+"m");
    }
    bool reset() const {
        auto& s=terminal_detail::state();std::lock_guard<std::mutex> lock(s.mutex);
        if(!s.ansi()) return false;
        const bool ok=s.emit("\033[0m");
        if(ok) s.styled=false;
        return ok;
    }
    bool clear() const {return control("\033[2J\033[H");}
    bool clearLine() const {return control("\033[2K\r");}
    bool moveTo(double row,double column) const {
        if(!terminal_detail::integer(row,1,65535) || !terminal_detail::integer(column,1,65535)) return false;
        return control("\033["+std::to_string(static_cast<int>(row))+";"+std::to_string(static_cast<int>(column))+"H");
    }
    bool moveBy(double rows,double columns) const {
        if(!terminal_detail::integer(rows,-65535,65535) || !terminal_detail::integer(columns,-65535,65535)) return false;
        std::string text;
        if(rows!=0) text+="\033["+std::to_string(static_cast<int>(std::abs(rows)))+(rows>0?"B":"A");
        if(columns!=0) text+="\033["+std::to_string(static_cast<int>(std::abs(columns)))+(columns>0?"C":"D");
        return control(text);
    }
    bool hideCursor() const {return cursor(false);}
    bool showCursor() const {return cursor(true);}
private:
    static bool writeLocked(const std::string& text) {
#ifdef _WIN32
        if(terminal_detail::tty()) {
            if(text.size()>static_cast<std::size_t>(2147483647)) return false;
            if(text.empty()) return true;
            const int length=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),static_cast<int>(text.size()),nullptr,0);
            if(length<=0) return false;
            std::wstring wide(static_cast<std::size_t>(length),L'\0');
            if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),static_cast<int>(text.size()),wide.data(),length)) return false;
            std::cout.flush();
            std::size_t offset=0;
            while(offset<wide.size()) {
                DWORD written=0;
                DWORD chunk=static_cast<DWORD>((wide.size()-offset)>16384?16384:wide.size()-offset);
                if(offset+chunk<wide.size() && wide[offset+chunk-1]>=0xD800 && wide[offset+chunk-1]<=0xDBFF) --chunk;
                if(!WriteConsoleW(GetStdHandle(STD_OUTPUT_HANDLE),wide.data()+offset,chunk,&written,nullptr) || written==0) return false;
                offset+=written;
            }
            return true;
        }
#endif
        std::cout << text;return std::cout.good();
    }
    static double dimension(bool columns) {
#ifdef _WIN32
        CONSOLE_SCREEN_BUFFER_INFO info{};
        if(!GetConsoleScreenBufferInfo(GetStdHandle(STD_OUTPUT_HANDLE),&info)) return 0;
        return columns ? info.srWindow.Right-info.srWindow.Left+1 : info.srWindow.Bottom-info.srWindow.Top+1;
#else
        struct winsize size{};
        if(!terminal_detail::tty() || ::ioctl(STDOUT_FILENO,TIOCGWINSZ,&size)!=0) return 0;
        return columns?size.ws_col:size.ws_row;
#endif
    }
    static bool setColor(const std::string& name,bool background) {
        const int code=terminal_detail::colorCode(name);
        if(code<0) return false;
        const char* noColor=std::getenv("NO_COLOR");if(noColor && *noColor) return false;
        auto& s=terminal_detail::state();std::lock_guard<std::mutex> lock(s.mutex);
        if(!s.ansi()) return false;
        s.styled=true;
        return s.emit("\033["+std::to_string((background?40:30)+code)+"m");
    }
    static bool control(const std::string& text) {
        auto& s=terminal_detail::state();std::lock_guard<std::mutex> lock(s.mutex);
        return s.ansi() && s.emit(text);
    }
    static bool cursor(bool visible) {
        auto& s=terminal_detail::state();std::lock_guard<std::mutex> lock(s.mutex);
        if(!s.ansi()) return false;
        const bool ok=s.emit(visible?"\033[?25h":"\033[?25l");
        if(ok) s.hidden=!visible;
        return ok;
    }
};
}
}

// Same console backend, selectively available inline definitions.
inline bool ets_console::write(const std::string& arg0) { return ::ets::terminal_detail::Operations{}.write(arg0); }
inline bool ets_console::writeLine(const std::string& arg0) { return ::ets::terminal_detail::Operations{}.writeLine(arg0); }
inline bool ets_console::flush() { return ::ets::terminal_detail::Operations{}.flush(); }
inline bool ets_console::isTTY() { return ::ets::terminal_detail::Operations{}.isTTY(); }
inline bool ets_console::supportsAnsi() { return ::ets::terminal_detail::Operations{}.supportsAnsi(); }
inline double ets_console::columns() { return ::ets::terminal_detail::Operations{}.columns(); }
inline double ets_console::rows() { return ::ets::terminal_detail::Operations{}.rows(); }
inline bool ets_console::color(const std::string& arg0) { return ::ets::terminal_detail::Operations{}.color(arg0); }
inline bool ets_console::background(const std::string& arg0) { return ::ets::terminal_detail::Operations{}.background(arg0); }
inline bool ets_console::style(const std::string& arg0) { return ::ets::terminal_detail::Operations{}.style(arg0); }
inline bool ets_console::reset() { return ::ets::terminal_detail::Operations{}.reset(); }
inline bool ets_console::clear() { return ::ets::terminal_detail::Operations{}.clear(); }
inline bool ets_console::clearLine() { return ::ets::terminal_detail::Operations{}.clearLine(); }
inline bool ets_console::moveTo(double arg0, double arg1) { return ::ets::terminal_detail::Operations{}.moveTo(arg0, arg1); }
inline bool ets_console::moveBy(double arg0, double arg1) { return ::ets::terminal_detail::Operations{}.moveBy(arg0, arg1); }
inline bool ets_console::hideCursor() { return ::ets::terminal_detail::Operations{}.hideCursor(); }
inline bool ets_console::showCursor() { return ::ets::terminal_detail::Operations{}.showCursor(); }
