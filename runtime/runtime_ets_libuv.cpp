// runtime_ets_libuv.cpp — Definiciones de LibuvEventLoop.
//
// V29.3: libuv es el unico backend soportado. El archivo se compila
// siempre (sin -DETS_EVENT_BACKEND_LIBUV). El .o cacheado vive en
// build/runtime_ets_libuv.o.
//
// Compilado una vez a build/runtime_ets_libuv.o (cacheado por hash de
// version + backend). El usuario enlaza este .o con su programa
// generado sin tener que recompilar el runtime.
//
// Uso:
//   g++ -c runtime/runtime_ets_libuv.cpp -o build/runtime_ets_libuv.o \
//       -std=c++20 -I/path/al/checkout
//   g++ build/runtime_ets_libuv.o programa.cpp -luv -pthread -o programa

#include "ets_event_loop_libuv_api.hpp"

#include <algorithm>
#include <cstdlib>

namespace ets {

LibuvEventLoop::LibuvEventLoop() {
    if (uv_loop_init(&loop_) != 0) std::abort();
    loop_.data = this;
    if (uv_async_init(&loop_, &wake_, onWake) != 0) std::abort();
    wake_.data = this;
}

LibuvEventLoop::~LibuvEventLoop() {
    // uv_close es asincrono: la memoria que contiene un uv_handle_t debe
    // sobrevivir hasta su callback de cierre. closeTimer/closePoll mueven o
    // conservan el ownership y los callbacks eliminan finalmente el objeto.
    for (auto& timer : timers_) closeTimer(timer.get());
    while (!polls_.empty()) {
        auto it = polls_.begin();
        closePoll(it->first, it->second.get());
    }
    uv_close(reinterpret_cast<uv_handle_t*>(&wake_), nullptr);
    uv_run(&loop_, UV_RUN_DEFAULT);

    // Ya no puede ejecutarse ningun callback que conserve estos handles.
    for (auto& d : detached_) {
        if (d.handle) d.handle.destroy();
    }
    detached_.clear();
    ready_.clear();
    {
        std::lock_guard lock(postedMutex_);
        posted_.clear();
    }

    if (!timers_.empty() || !closingPolls_.empty()) std::abort();
    if (uv_loop_close(&loop_) != 0) std::abort();
}

LibuvEventLoop::TimerEntry* LibuvEventLoop::createTimer() {
    auto timer = std::make_unique<TimerEntry>();
    timer->loop = this;
    TimerEntry* raw = timer.get();
    timers_.push_back(std::move(timer));
    if (uv_timer_init(&loop_, &raw->handle) != 0) std::abort();
    raw->handle.data = raw;
    return raw;
}

void LibuvEventLoop::closeTimer(TimerEntry* timer) noexcept {
    if (!timer || timer->closing) return;
    timer->closing = true;
    timer->pollPtr = nullptr;
    uv_timer_stop(&timer->handle);
    uv_close(reinterpret_cast<uv_handle_t*>(&timer->handle), onTimerClosed);
}

void LibuvEventLoop::closePoll(int fd, PollState* state) noexcept {
    if (!state || state->closing) return;
    state->closing = true;
    uv_poll_stop(&state->poll);

    auto it = polls_.find(fd);
    if (it == polls_.end() || it->second.get() != state) std::abort();
    closingPolls_.push_back(std::move(it->second));
    polls_.erase(it);
    uv_close(reinterpret_cast<uv_handle_t*>(&state->poll), onPollClosed);
}

void LibuvEventLoop::eraseClosedTimer(TimerEntry* timer) noexcept {
    const auto it = std::find_if(timers_.begin(), timers_.end(),
        [timer](const auto& candidate) { return candidate.get() == timer; });
    if (it == timers_.end()) std::abort();
    timers_.erase(it);
}

void LibuvEventLoop::eraseClosedPoll(PollState* state) noexcept {
    const auto it = std::find_if(closingPolls_.begin(), closingPolls_.end(),
        [state](const auto& candidate) { return candidate.get() == state; });
    if (it == closingPolls_.end()) std::abort();
    closingPolls_.erase(it);
}

void LibuvEventLoop::waitFor(int fd, short events, std::coroutine_handle<> handle) {
    waitForUntil(fd, events, std::chrono::steady_clock::time_point::max(),
                 CancellationToken{}, nullptr, handle);
}

void LibuvEventLoop::waitForUntil(int fd, short events,
                                   std::chrono::steady_clock::time_point deadline,
                                   CancellationToken token, WaitResult* result,
                                   std::coroutine_handle<> handle) {
    auto it = polls_.find(fd);
    if (it == polls_.end()) {
        auto state = std::make_unique<PollState>();
        state->fd = fd;
        state->loop = this;
        if (uv_poll_init(&loop_, &state->poll, fd) != 0) std::abort();
        state->poll.data = state.get();
        it = polls_.emplace(fd, std::move(state)).first;
    }
    PollState& ps = *it->second;
    PollEntry e;
    e.fd = fd;
    e.events = events;
    e.handle = handle;
    e.deadline = deadline;
    e.token = std::move(token);
    e.result = result;
    e.fired = false;
    e.parent = &ps;
    ps.entries.push_back(e);
    auto& back = ps.entries.back();
    back.parent = &ps;
    ps.poll.data = &ps;
    if (uv_poll_start(&ps.poll, events, onPoll) != 0) std::abort();
    if (deadline != std::chrono::steady_clock::time_point::max()) {
        const auto now = std::chrono::steady_clock::now();
        const auto ms = deadline <= now ? 0
            : std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now).count();
        TimerEntry* timer = createTimer();
        timer->coroutine = nullptr;
        timer->pollPtr = &back;
        back.timeoutTimer = timer;
        if (uv_timer_start(&timer->handle, onTimerForPoll, ms, 0) != 0) std::abort();
    }
}

void LibuvEventLoop::waitUntil(std::chrono::steady_clock::time_point deadline,
                                std::coroutine_handle<> handle) {
    TimerEntry* timer = createTimer();
    timer->coroutine = handle;
    const auto now = std::chrono::steady_clock::now();
    const auto ms = deadline <= now ? 0
        : std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now).count();
    if (uv_timer_start(&timer->handle, onTimerForWait, ms, 0) != 0) std::abort();
}

void LibuvEventLoop::detach(std::coroutine_handle<> handle) {
    if (!handle) return;
    // V26: si el handle ya termino, destruyo inmediatamente (sin pasar
    // por detached_). Esto convierte el caso comun de detach post-fire
    // en O(1) sin alocacion de vector.
    if (handle.done()) { handle.destroy(); return; }
    detached_.push_back({handle, false});
}

void LibuvEventLoop::post(std::coroutine_handle<> handle) {
    {
        std::lock_guard lock(postedMutex_);
        posted_.push_back(handle);
    }
    uv_async_send(&wake_);
}

void LibuvEventLoop::notify() noexcept { uv_async_send(&wake_); }

void LibuvEventLoop::stop() noexcept {
    stop_.store(true, std::memory_order_release);
    uv_async_send(&wake_);  // despierta al loop si esta bloqueado
}

// V26: run() bloquea hasta que stop() se llame desde otro thread.
// Cada iteracion hace uv_run(UV_RUN_ONCE). Asi onWake tiene la
// oportunidad de ejecutarse (consume posted_/ready_ y procesa stop_).
// El cleanup final de handles lo hace el destructor; run() solo
// sale del bucle.
void LibuvEventLoop::run() {
    stop_.store(false, std::memory_order_release);
    blockWhenIdle_ = true;
    while (!stop_.load(std::memory_order_acquire)) {
        runOne();
    }
    blockWhenIdle_ = false;
}

uv_loop_t* LibuvEventLoop::raw_loop() noexcept { return &loop_; }
uv_async_t* LibuvEventLoop::raw_wake() noexcept { return &wake_; }

void LibuvEventLoop::runOne() {
    // La cancelacion puede haberse solicitado antes de entrar al loop. Hay
    // que procesarla antes de bloquear en uv_run.
    processCancellations();
    cleanupFiredPollEntries();

    bool hasPosted;
    { std::lock_guard lock(postedMutex_); hasPosted = !posted_.empty(); }
    const bool hasTimers = std::any_of(timers_.begin(), timers_.end(),
        [](const auto& timer) { return !timer->closing; });
    bool hasPolls = !polls_.empty();
    if (!blockWhenIdle_ && (hasPosted || !ready_.empty() || (!hasTimers && !hasPolls))) {
        uv_run(&loop_, UV_RUN_NOWAIT);
    } else {
        uv_run(&loop_, UV_RUN_ONCE);
    }

    // Una cancelacion puede llegar mientras uv_run estaba bloqueado.
    processCancellations();
    cleanupFiredPollEntries();
    drainReady();

    // Cleanup detached done.
    // detached_to_reap_ se llena desde onWake / detach con handle.done().
    for (auto h : detached_to_reap_) {
        if (h && h.done()) h.destroy();
    }
    detached_to_reap_.clear();
    // Adicionalmente, limpiar handles que se marcaron done entre los
    // callbacks (caso normal: resume() dentro de onPoll hace handle
    // done). Esto sigue siendo O(K) sobre los que dispararon en este
    // ciclo.
    for (auto& d : detached_) {
        if (d.handle.done()) detached_to_reap_.push_back(d.handle);
    }
    if (!detached_to_reap_.empty()) {
        // Erase them all
        detached_.erase(
            std::remove_if(detached_.begin(), detached_.end(),
                           [](const DetachedEntry& d){ return d.handle.done(); }),
            detached_.end());
        for (auto h : detached_to_reap_) if (h && h.done()) h.destroy();
        detached_to_reap_.clear();
    }
}

void LibuvEventLoop::processCancellations() {
    for (auto& [fd, state] : polls_) {
        static_cast<void>(fd);
        for (auto& entry : state->entries) {
            if (entry.fired || !entry.token.isCancelled()) continue;
            entry.fired = true;
            if (entry.result) *entry.result = WaitResult::cancelled;
            ready_.push_back(entry.handle);
            if (entry.timeoutTimer) {
                TimerEntry* timer = entry.timeoutTimer;
                entry.timeoutTimer = nullptr;
                timer->pollPtr = nullptr;
                timer->fired = true;
                closeTimer(timer);
            }
        }
    }
}

void LibuvEventLoop::cleanupFiredPollEntries() {
    std::vector<std::pair<int, PollState*>> empty;
    for (auto& [fd, state] : polls_) {
        state->entries.remove_if([](const PollEntry& entry) { return entry.fired; });
        if (state->entries.empty()) empty.push_back({fd, state.get()});
    }
    for (const auto& [fd, state] : empty) closePoll(fd, state);
}

void LibuvEventLoop::drainReady() {
    std::vector<std::coroutine_handle<>> ready;
    ready.swap(ready_);
    for (auto handle : ready) {
        if (handle && !handle.done()) handle.resume();
    }
}

void LibuvEventLoop::onPoll(uv_poll_t* h, int status, int events) {
    (void)status; (void)events;
    auto* ps = static_cast<PollState*>(h->data);
    auto* self = ps->loop;
    for (auto& e : ps->entries) {
        if (!e.fired) {
            e.fired = true;
            if (e.result) *e.result = WaitResult::ready;
            if (e.timeoutTimer) {
                TimerEntry* timer = e.timeoutTimer;
                e.timeoutTimer = nullptr;
                timer->pollPtr = nullptr;
                timer->fired = true;
                self->closeTimer(timer);
            }
            self->ready_.push_back(e.handle);
        }
    }
}

void LibuvEventLoop::onTimerForPoll(uv_timer_t* h) {
    auto* t = static_cast<TimerEntry*>(h->data);
    if (t->fired) return;
    t->fired = true;
    PollEntry* entry = t->pollPtr;
    t->pollPtr = nullptr;
    if (entry && !entry->fired) {
        entry->fired = true;
        entry->timeoutTimer = nullptr;
        if (entry->result) *entry->result = WaitResult::timedOut;
        t->loop->ready_.push_back(entry->handle);
    }
    t->loop->closeTimer(t);
}

void LibuvEventLoop::onTimerForWait(uv_timer_t* h) {
    auto* t = static_cast<TimerEntry*>(h->data);
    if (t->fired) return;
    t->fired = true;
    t->loop->ready_.push_back(t->coroutine);
    t->loop->closeTimer(t);
}

void LibuvEventLoop::onTimerClosed(uv_handle_t* h) {
    auto* timer = static_cast<TimerEntry*>(h->data);
    timer->loop->eraseClosedTimer(timer);
}

void LibuvEventLoop::onPollClosed(uv_handle_t* h) {
    auto* state = static_cast<PollState*>(h->data);
    state->loop->eraseClosedPoll(state);
}

void LibuvEventLoop::onWake(uv_async_t* h) {
    auto* self = static_cast<LibuvEventLoop*>(h->data);
    std::vector<std::coroutine_handle<>> rp;
    { std::lock_guard lk(self->postedMutex_); rp.swap(self->posted_); }
    self->ready_.insert(self->ready_.end(), rp.begin(), rp.end());
}

}  // namespace ets
