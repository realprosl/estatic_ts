// Implementación asíncrona de runtime/ets_file.hpp (#377): va aparte para que
// un programa que solo lee y escribe de forma síncrona no enlace el bucle de eventos.
#include "runtime/ets_file.hpp"
#include "runtime/ets_io_uring.hpp"
#include <filesystem>
#include <string>
#include <utility>

ETS_API ets::Task<ets::Result<std::string>> readFileAsync(std::string path) {
    co_return co_await ets::runBlocking([path = std::move(path)] {
#if defined(__linux__) && defined(__NR_io_uring_setup) && defined(__NR_io_uring_enter)
        if (ets::ioUringAvailable()) return ets::io_uring_detail::read(path);
#endif
        return readFile(path);
    });
}

ETS_API ets::Task<ets::Result<bool>> writeFileAsync(std::string path, std::string contents) {
    co_return co_await ets::runBlocking([path = std::move(path), contents = std::move(contents)] {
#if defined(__linux__) && defined(__NR_io_uring_setup) && defined(__NR_io_uring_enter)
        if (ets::ioUringAvailable()) return ets::io_uring_detail::write(path, contents, false);
#endif
        return writeFile(path, contents);
    });
}

ETS_API ets::Task<ets::Result<bool>> appendFileAsync(std::string path, std::string contents) {
    co_return co_await ets::runBlocking([path = std::move(path), contents = std::move(contents)] {
#if defined(__linux__) && defined(__NR_io_uring_setup) && defined(__NR_io_uring_enter)
        if (ets::ioUringAvailable()) return ets::io_uring_detail::write(path, contents, true);
#endif
        return appendFile(path, contents);
    });
}

ETS_API ets::Task<ets::Result<bool>> fileExistsAsync(std::string path) {
    co_return co_await ets::runBlocking([path = std::move(path)] {
        std::error_code error;
        const bool exists = std::filesystem::is_regular_file(path, error);
        return error ? ets::err<bool>("No se puede consultar: " + path + ": " + error.message()) : ets::ok(exists);
    });
}

ETS_API ets::Task<ets::Result<bool>> copyFileAsync(std::string source, std::string destination) {
    co_return co_await ets::runBlocking([source = std::move(source), destination = std::move(destination)] { return copyFile(source, destination); });
}

ETS_API ets::Task<ets::Result<bool>> moveFileAsync(std::string source, std::string destination) {
    co_return co_await ets::runBlocking([source = std::move(source), destination = std::move(destination)] { return moveFile(source, destination); });
}

ETS_API ets::Task<ets::Result<bool>> removeFileAsync(std::string path) {
    co_return co_await ets::runBlocking([path = std::move(path)] { return removeFile(path); });
}

ETS_API ets::Task<ets::Result<std::string>> readFileUntil(std::string path, double timeoutMilliseconds, ets::CancellationToken token) {
    co_return co_await ets::runBlocking([path = std::move(path), timeoutMilliseconds, token] {
        return fileOperationUntil<std::string>(timeoutMilliseconds, token, [&] { return readFile(path); });
    });
}

ETS_API ets::Task<ets::Result<bool>> writeFileUntil(std::string path, std::string contents, double timeoutMilliseconds, ets::CancellationToken token) {
    co_return co_await ets::runBlocking([path = std::move(path), contents = std::move(contents), timeoutMilliseconds, token] {
        return fileOperationUntil<bool>(timeoutMilliseconds, token, [&] { return writeFile(path, contents); });
    });
}

ETS_API ets::Task<ets::Result<bool>> appendFileUntil(std::string path, std::string contents, double timeoutMilliseconds, ets::CancellationToken token) {
    co_return co_await ets::runBlocking([path = std::move(path), contents = std::move(contents), timeoutMilliseconds, token] {
        return fileOperationUntil<bool>(timeoutMilliseconds, token, [&] { return appendFile(path, contents); });
    });
}

ETS_API ets::Task<ets::Result<bool>> copyFileUntil(std::string source, std::string destination, double timeoutMilliseconds, ets::CancellationToken token) {
    co_return co_await ets::runBlocking([source = std::move(source), destination = std::move(destination), timeoutMilliseconds, token] {
        return fileOperationUntil<bool>(timeoutMilliseconds, token, [&] { return copyFile(source, destination); });
    });
}

ETS_API ets::Task<ets::Result<bool>> moveFileUntil(std::string source, std::string destination, double timeoutMilliseconds, ets::CancellationToken token) {
    co_return co_await ets::runBlocking([source = std::move(source), destination = std::move(destination), timeoutMilliseconds, token] {
        return fileOperationUntil<bool>(timeoutMilliseconds, token, [&] { return moveFile(source, destination); });
    });
}

ETS_API ets::Task<ets::Result<bool>> removeFileUntil(std::string path, double timeoutMilliseconds, ets::CancellationToken token) {
    co_return co_await ets::runBlocking([path = std::move(path), timeoutMilliseconds, token] {
        return fileOperationUntil<bool>(timeoutMilliseconds, token, [&] { return removeFile(path); });
    });
}
