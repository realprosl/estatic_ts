#include "runtime/ets_http_httplib.hpp"

#include <cstdio>
#include <thread>

int main() {
    ets::Server server;
    server.get("/users/:id", [](const ets::HttpRequest& req, ets::HttpResponse& res) {
        res.send(ets::http_param(req, "id"));
    });
    server.get("/teams/:team/members/:member", [](const ets::HttpRequest& req, ets::HttpResponse& res) {
        res.send(ets::http_param(req, "team") + ":" + ets::http_param(req, "member") +
                 ":" + ets::http_param(req, "id"));
    });
    server.post("/orders/:orderId", [](const ets::HttpRequest& req, ets::HttpResponse& res) {
        res.send(ets::http_param(req, "orderId") + ":" + ets::http_param(req, "team"));
    });
    server.get("/headers", [](const ets::HttpRequest& req, ets::HttpResponse& res) {
        res.send(ets::http_header(req, "x-test") + ":" + ets::http_header(req, "X-Test") +
                 ":" + ets::http_header(req, "X-TEST") + ":" + ets::http_header(req, "missing"));
    });
    auto running = std::move(server);
    const int port = running.impl().bind_to_any_port("127.0.0.1");
    if (port <= 0) {
        std::fputs("http-routing: cannot bind loopback\n", stderr);
        return 2;
    }
    std::thread listener([&] { running.impl().listen_after_bind(); });
    running.impl().wait_until_ready();
    httplib::Client client("127.0.0.1", port);
    client.set_connection_timeout(2);
    client.set_read_timeout(2);
    client.set_write_timeout(2);

    int failures = 0;
    auto check = [&](const httplib::Result& result, const std::string& expected, const char* label) {
        if (result && result->status == 200 && result->body == expected) {
            std::printf("  ok: %s\n", label);
        } else {
            std::printf("  FAIL: %s (expected '%s', got '%s')\n", label,
                        expected.c_str(), result ? result->body.c_str() : "connection error");
            ++failures;
        }
    };
    check(client.Get("/users/42"), "42", "first route");
    check(client.Get("/teams/red/members/alice"), "red:alice:", "nested route has its own names");
    check(client.Post("/orders/77", "", "text/plain"), "77:", "POST has its own names");
    check(client.Get("/headers", httplib::Headers{{"x-TeSt", "value"}}), "value:value:value:", "case-insensitive header lookup");
    check(client.Get("/teams/blue/members/bob"), "blue:bob:", "params do not persist between requests");
    check(client.Get("/users/99"), "99", "earlier route remains valid after registration and move");
    running.impl().stop();
    listener.join();
    std::printf("http-routing: %d failed\n", failures);
    return failures == 0 ? 0 : 1;
}
