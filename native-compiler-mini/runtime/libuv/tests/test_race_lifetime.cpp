// Regresiones de ownership para race/timeout.
//
// Los perdedores deben conservar su frame hasta que terminen: los timers y
// otros awaitables guardan el coroutine_handle mientras la operacion sigue
// registrada en el event loop. Ejecutar preferiblemente con ASan/UBSan.

#include <atomic>
#include <cstdio>
#include <utility>
#include <vector>

#include "ets_async.hpp"

namespace {

ets::Task<int> delayedValue(double milliseconds, int value,
                            std::atomic<int>& completed) {
    co_await ets::sleep(milliseconds);
    completed.fetch_add(1, std::memory_order_relaxed);
    co_return value;
}

ets::Task<void> delayedVoid(double milliseconds,
                            std::atomic<int>& completed) {
    co_await ets::sleep(milliseconds);
    completed.fetch_add(1, std::memory_order_relaxed);
}

bool drainUntil(const std::atomic<int>& completed, int expected) {
    for (int iteration = 0;
         iteration < 10000 && completed.load(std::memory_order_relaxed) < expected;
         ++iteration) {
        ets::defaultEventLoop.runOne();
    }
    return completed.load(std::memory_order_relaxed) == expected;
}

int failures = 0;

void check(bool condition, const char* label) {
    if (condition) std::printf("  ok: %s\n", label);
    else { std::printf("  FAIL: %s\n", label); ++failures; }
}

}  // namespace

int main() {
    std::printf("test 1: race<T> transfiere los perdedores al event loop\n");
    {
        std::atomic<int> completed{0};
        std::vector<ets::Task<int>> tasks;
        tasks.push_back(delayedValue(0, 7, completed));
        tasks.push_back(delayedValue(1, 9, completed));
        auto raced = ets::task_race<int>(std::move(tasks));
        check(ets::syncWait(raced) == 7, "gana la tarea inmediata");
        check(drainUntil(completed, 2), "el perdedor termina sin use-after-free");
    }

    std::printf("test 2: race<void> conserva el frame perdedor\n");
    {
        std::atomic<int> completed{0};
        std::vector<ets::Task<void>> tasks;
        tasks.push_back(delayedVoid(0, completed));
        tasks.push_back(delayedVoid(1, completed));
        auto raced = ets::task_race<void>(std::move(tasks));
        ets::syncWait(raced);
        check(drainUntil(completed, 2), "race<void> drena el perdedor");
    }

    std::printf("test 3: timeout compila y conserva la tarea lenta\n");
    {
        std::atomic<int> completed{0};
        auto timed = ets::timeout<int>(delayedValue(2, 42, completed), 0, -1);
        check(ets::syncWait(timed) == -1, "vence el sentinel del timeout");
        check(drainUntil(completed, 1), "la tarea lenta termina con ownership valido");
    }

    std::printf("\n%d failed\n", failures);
    return failures == 0 ? 0 : 1;
}
