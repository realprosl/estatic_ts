// Backend libuv del EventLoop — header ligero (pre-compilable).
//
// Este header SOLO contiene DECLARACIONES. Las definiciones estan en
// runtime_ets_libuv.cpp, que se compila una vez a un .o cacheado.
//
// Reglas de lifetime:
//   - Todo uv_handle_t inicializado vive en un objeto reservado en heap.
//   - Un objeto no se mueve ni se destruye hasta el callback de uv_close.
//   - Las PollEntry viven en std::list para que los timers puedan apuntarlas
//     sin que una nueva espera sobre el mismo fd invalide su direccion.
//   - UV_RUN_NOWAIT cuando no hay handles que esperar.
//   - CancellationToken chequeado en runOne al inicio (idem Fase 2B.3).
//
// NO incluir directamente. Usar runtime/ets_event_loop.hpp.

#pragma once

#include <chrono>
#include <coroutine>
#include <list>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <vector>

#include <uv.h>

#include "ets_event_loop_iface.hpp"

namespace ets {

class LibuvEventLoop final : public IEventLoop {
public:
    LibuvEventLoop();
    LibuvEventLoop(const LibuvEventLoop&) = delete;
    LibuvEventLoop& operator=(const LibuvEventLoop&) = delete;
    ~LibuvEventLoop() override;

    void waitFor(int fd, short events, std::coroutine_handle<> handle) override;
    void waitForUntil(int fd, short events, std::chrono::steady_clock::time_point deadline,
                      CancellationToken token, WaitResult* result,
                      std::coroutine_handle<> handle) override;
    void waitUntil(std::chrono::steady_clock::time_point deadline,
                   std::coroutine_handle<> handle) override;
    void detach(std::coroutine_handle<> handle) override;
    void post(std::coroutine_handle<> handle) override;
    void notify() noexcept override;

    // Acceso al uv_loop_t raw. Para integracion con APIs y event loop
    // externos (e.g. uv_getaddrinfo directo). El caller es responsable
    // de no corromper el estado interno.
    uv_loop_t* raw_loop() noexcept;
    uv_async_t* raw_wake() noexcept;

    void runOne() override;
    // Finish owned detached tasks without entering the permanent service loop.
    void drainDetached();
    // V26: run() bloquea el thread actual hasta que stop() se llame.
    // Pensado para ejecutarse en un thread dedicado de un
    // MultiLoopRunner. NO es seguro llamar runOne() y run() en el
    // mismo loop.
    void run();
    // V26: solicita a run() que termine tras el `it` ciclo de eventos.
    // Thread-safe (puede llamarse desde otro thread).
    void stop() noexcept;

private:
    struct TimerEntry;
    struct PollState;
    struct PollEntry {
        int fd = -1;
        short events = 0;
        std::coroutine_handle<> handle;
        std::chrono::steady_clock::time_point deadline;
        CancellationToken token;
        WaitResult* result = nullptr;
        bool fired = false;
        TimerEntry* timeoutTimer = nullptr;
        PollState* parent = nullptr;
    };
    struct PollState {
        uv_poll_t poll{};
        std::list<PollEntry> entries;
        bool closing = false;
        int fd = -1;
        LibuvEventLoop* loop = nullptr;
    };
    struct TimerEntry {
        uv_timer_t handle{};
        std::coroutine_handle<> coroutine;
        PollEntry* pollPtr = nullptr;
        bool fired = false;
        bool closing = false;
        LibuvEventLoop* loop = nullptr;
    };
    struct DetachedEntry { std::coroutine_handle<> handle; bool fired; };

    static void onPoll(uv_poll_t* h, int status, int events);
    static void onTimerForPoll(uv_timer_t* h);
    static void onTimerForWait(uv_timer_t* h);
    static void onTimerClosed(uv_handle_t* h);
    static void onPollClosed(uv_handle_t* h);
    static void onWake(uv_async_t* h);

    TimerEntry* createTimer();
    void closeTimer(TimerEntry* timer) noexcept;
    void closePoll(int fd, PollState* state) noexcept;
    void eraseClosedTimer(TimerEntry* timer) noexcept;
    void eraseClosedPoll(PollState* state) noexcept;
    void processCancellations();
    void cleanupFiredPollEntries();
    void drainReady();

    uv_loop_t loop_{};
    uv_async_t wake_{};
    std::unordered_map<int, std::unique_ptr<PollState>> polls_;
    std::list<std::unique_ptr<PollState>> closingPolls_;
    std::list<std::unique_ptr<TimerEntry>> timers_;
    std::vector<DetachedEntry> detached_;
    std::mutex postedMutex_;
    std::vector<std::coroutine_handle<>> posted_;
    std::vector<std::coroutine_handle<>> ready_;
    std::vector<std::coroutine_handle<>> detached_to_reap_;
    // V26: stop() solicita al run() terminar.
    std::atomic<bool> stop_{false};
    bool blockWhenIdle_ = false;
};

}  // namespace ets
