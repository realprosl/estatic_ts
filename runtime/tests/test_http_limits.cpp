// Standalone, sin libuv ni Drogon. Los tests de red usan loopback y puerto efimero.
#include "runtime/ets_http_httplib.hpp"

#include <atomic>
#include <cassert>
#include <chrono>
#include <cstdio>
#include <future>
#include <thread>

int main(int argc, char** argv) {
    const bool queueOnly = argc == 2 && std::string(argv[1]) == "--queue-only";
    if (argc > 1 && !queueOnly) return 64;
    ets::HttplibServerLimits limits;
    assert(limits.valid());
    assert(limits.bodyBytes == 1024 * 1024);
    auto invalid = limits;
    invalid.queuedConnections = 0;
    assert(!invalid.valid());
    invalid = limits;
    invalid.workers = 0;
    assert(!invalid.valid());
    invalid = limits;
    invalid.readTimeoutSeconds = -1;
    assert(!invalid.valid());
    invalid = limits;
    invalid.bodyBytes = 0;
    assert(!invalid.valid());
    invalid = limits;
    invalid.writeTimeoutSeconds = 0;
    assert(!invalid.valid());
    invalid = limits;
    invalid.keepAliveTimeoutSeconds = 0;
    assert(!invalid.valid());
    invalid = limits;
    invalid.keepAliveRequests = 0;
    assert(!invalid.valid());

    limits.workers = 1;
    limits.queuedConnections = 2;
    limits.bodyBytes = 32;
    ets::Server server(limits);
    // La factory conserva su configuracion por valor, no referencias externas.
    limits.queuedConnections = 100;
    {
        std::unique_ptr<httplib::TaskQueue> queue(server.impl().new_task_queue());
        std::promise<void> started;
        std::promise<void> release;
        auto released = release.get_future().share();
        auto running = started.get_future();
        std::atomic<int> completed{0};
        assert(queue->enqueue([&] {
            started.set_value();
            released.wait();
            ++completed;
        }));
        assert(running.wait_for(std::chrono::seconds(5)) == std::future_status::ready);
        assert(queue->enqueue([&] { ++completed; }));
        assert(queue->enqueue([&] { ++completed; }));
        assert(!queue->enqueue([&] { ++completed; }));
        release.set_value();
        queue->shutdown();
        assert(completed == 3);
    }
    std::puts("http-limits: queue OK (1 worker, 2 pending, overflow rejected)");

    // Se puede validar la cola sin abrir sockets en entornos restringidos.
    if (queueOnly) return 0;

    std::atomic<int> calls{0};
    server.post("/echo", [&](const ets::HttpRequest& req, ets::HttpResponse& res) {
        ++calls;
        res.send(req.body);
    });
    const int port = server.impl().bind_to_any_port("127.0.0.1");
    if (port <= 0) {
        std::fputs("http-limits: cannot bind loopback\n", stderr);
        return 2;
    }
    std::thread listener([&] { server.impl().listen_after_bind(); });
    server.impl().wait_until_ready();
    httplib::Client client("127.0.0.1", port);
    client.set_connection_timeout(2);
    client.set_read_timeout(2);
    client.set_write_timeout(2);
    auto accepted = client.Post("/echo", std::string(32, 'x'), "text/plain");
    auto rejected = client.Post("/echo", std::string(33, 'x'), "text/plain");
    server.impl().stop();
    listener.join();
    assert(accepted && accepted->status == 200 && accepted->body.size() == 32);
    assert(rejected && rejected->status == 413);
    assert(calls == 1);
    std::puts("http-limits: body OK (32 accepted, 33 rejected with 413)");
}
