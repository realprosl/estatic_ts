// Implementación de runtime/ets_timer.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se compila
// aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/ets_timer.hpp"
#include <cstdint>
#include <functional>
#include <utility>
#include <uv.h>
#include "runtime/ets_async.hpp"  // para defaultEventLoop
namespace ets::detail {

ETS_API Timer makeTimer(std::function<void()> cb, uint64_t ms, bool repeat) {
    Timer t;
    uv_timer_t* handle = new uv_timer_t{};
    t.handle_ = handle;
    uv_loop_t* loop = defaultEventLoop.raw_loop();
    if (!loop) {
        delete handle;
        t.handle_ = nullptr;
        return t;
    }
    if (uv_timer_init(loop, handle) != 0) {
        delete handle;
        t.handle_ = nullptr;
        return t;
    }
    handle->data = new std::function<void()>(std::move(cb));
    if (uv_timer_start(handle, [](uv_timer_t* h) {
            auto* cb = static_cast<std::function<void()>*>(h->data);
            if (!cb || !*cb) return;
            (*cb)();
        }, ms, repeat ? ms : 0) != 0) {
        uv_close(reinterpret_cast<uv_handle_t*>(handle), [](uv_handle_t* hh) {
            auto* timer = reinterpret_cast<uv_timer_t*>(hh);
            delete static_cast<std::function<void()>*>(timer->data);
            timer->data = nullptr;
            delete timer;
        });
        t.handle_ = nullptr;
        return t;
    }
    return t;
}
} // namespace ets::detail
