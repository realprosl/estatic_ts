// Regresiones de lifetime para ets::LibuvEventLoop.
//
// Ejecutar preferiblemente con ASan/UBSan. Los casos fuerzan crecimiento de
// las colecciones, cierre de timers asociados a polls y destruccion del loop
// con operaciones todavia pendientes.

#include <atomic>
#include <chrono>
#include <coroutine>
#include <cstdio>
#include <memory>
#include <utility>
#include <vector>
#include <unistd.h>

#include "ets_event_loop.hpp"

namespace {

struct Task {
    struct promise_type {
        Task get_return_object() {
            return Task{std::coroutine_handle<promise_type>::from_promise(*this)};
        }
        std::suspend_always initial_suspend() noexcept { return {}; }
        std::suspend_always final_suspend() noexcept { return {}; }
        void return_void() noexcept {}
        void unhandled_exception() { std::terminate(); }
    };

    std::coroutine_handle<promise_type> handle;
    explicit Task(std::coroutine_handle<promise_type> value) : handle(value) {}
    Task(const Task&) = delete;
    Task& operator=(const Task&) = delete;
    Task(Task&& other) noexcept : handle(std::exchange(other.handle, {})) {}
    Task& operator=(Task&& other) noexcept {
        if (this == &other) return *this;
        if (handle) handle.destroy();
        handle = std::exchange(other.handle, {});
        return *this;
    }
    ~Task() { if (handle) handle.destroy(); }
    void start() const { handle.resume(); }
};

struct SleepAwaiter {
    ets::EventLoop& loop;
    std::chrono::milliseconds delay;
    bool await_ready() const noexcept { return false; }
    void await_suspend(std::coroutine_handle<> handle) const {
        loop.waitUntil(std::chrono::steady_clock::now() + delay, handle);
    }
    void await_resume() const noexcept {}
};

struct PollAwaiter {
    ets::EventLoop& loop;
    int fd;
    std::chrono::milliseconds timeout;
    ets::WaitResult* result;
    bool await_ready() const noexcept { return false; }
    void await_suspend(std::coroutine_handle<> handle) const {
        loop.waitForUntil(fd, UV_READABLE,
            std::chrono::steady_clock::now() + timeout,
            ets::CancellationToken{}, result, handle);
    }
    void await_resume() const noexcept {}
};

Task sleepOnce(ets::EventLoop& loop, std::atomic<int>& completed) {
    co_await SleepAwaiter{loop, std::chrono::milliseconds(0)};
    completed.fetch_add(1, std::memory_order_relaxed);
}

Task waitReadable(ets::EventLoop& loop, int fd, std::chrono::milliseconds timeout,
                  ets::WaitResult* result, std::atomic<int>& completed) {
    co_await PollAwaiter{loop, fd, timeout, result};
    completed.fetch_add(1, std::memory_order_relaxed);
}

bool runUntil(ets::EventLoop& loop, const std::atomic<int>& value, int expected) {
    for (int i = 0; i < 10000 && value.load(std::memory_order_relaxed) < expected; ++i) {
        loop.runOne();
    }
    return value.load(std::memory_order_relaxed) == expected;
}

int failures = 0;

void check(bool condition, const char* label) {
    if (condition) std::printf("  ok: %s\n", label);
    else { std::printf("  FAIL: %s\n", label); ++failures; }
}

}  // namespace

int main() {
    std::printf("test 1: muchos timers conservan direccion estable\n");
    {
        constexpr int count = 2048;
        ets::EventLoop loop;
        std::atomic<int> completed{0};
        std::vector<Task> tasks;
        tasks.reserve(count);
        for (int i = 0; i < count; ++i) tasks.push_back(sleepOnce(loop, completed));
        for (const auto& task : tasks) task.start();
        check(runUntil(loop, completed, count), "2048 timers completan");
        loop.runOne();  // drena callbacks de uv_close
    }

    std::printf("test 2: muchas esperas sobre el mismo fd cancelan sus timers\n");
    {
        constexpr int count = 512;
        int fds[2];
        if (pipe(fds) != 0) return 2;
        ets::EventLoop loop;
        std::atomic<int> completed{0};
        std::vector<ets::WaitResult> results(count, ets::WaitResult::timedOut);
        std::vector<Task> tasks;
        tasks.reserve(count);
        for (int i = 0; i < count; ++i) {
            tasks.push_back(waitReadable(loop, fds[0], std::chrono::seconds(30),
                                         &results[i], completed));
        }
        for (const auto& task : tasks) task.start();
        const char byte = 'x';
        static_cast<void>(write(fds[1], &byte, 1));
        check(runUntil(loop, completed, count), "512 polls completan por readiness");
        bool allReady = true;
        for (const auto result : results) allReady &= result == ets::WaitResult::ready;
        check(allReady, "todos los timers asociados quedan cancelados");
        loop.runOne();
        close(fds[0]);
        close(fds[1]);
    }

    std::printf("test 3: destruccion con operaciones pendientes\n");
    {
        int fds[2];
        if (pipe(fds) != 0) return 2;
        std::atomic<int> completed{0};
        ets::WaitResult result = ets::WaitResult::ready;
        auto loop = std::make_unique<ets::EventLoop>();
        Task pending = waitReadable(*loop, fds[0], std::chrono::hours(1),
                                    &result, completed);
        pending.start();
        loop.reset();
        check(completed.load() == 0,
              "el loop cierra handles pendientes sin reanudar memoria invalida");
        close(fds[0]);
        close(fds[1]);
    }

    std::printf("\n%d failed\n", failures);
    return failures == 0 ? 0 : 1;
}
