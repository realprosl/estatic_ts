// Implementación síncrona de runtime/ets_file.hpp (#377).
// Con ETS_RUNTIME_PRECOMPILED se compila aparte; si no, la incluye la cabecera.
#include "runtime/ets_file.hpp"
#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <filesystem>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
namespace ets::file_detail {

ETS_API std::string systemError(const std::string& operation, const std::string& path) {
    return operation + ": " + path + ": " + std::strerror(errno);
}

ETS_API bool writeAll(int descriptor, const std::string& contents, const std::string& path, std::string& error) noexcept {
    std::size_t offset = 0;
    while (offset < contents.size()) {
        const ssize_t written = ::write(descriptor, static_cast<const void*>(contents.data() + offset), contents.size() - offset);
        if (written > 0) { offset += static_cast<std::size_t>(written); continue; }
        if (written < 0 && errno == EINTR) continue;
        error = systemError("Error durante la escritura", path);
        return false;
    }
    return true;
}

ETS_API bool store(const std::string& path, const std::string& contents, int flags, const std::string& openMessage, std::string& error) noexcept {
    const int descriptor = ::open(path.c_str(), O_WRONLY | O_CREAT | flags, 0666);
    if (descriptor < 0) { error = systemError(openMessage, path); return false; }
    const bool written = writeAll(descriptor, contents, path, error);
    const int closeResult = ::close(descriptor);
    if (!written) return false;
    if (closeResult != 0) { error = systemError("Error cerrando el archivo", path); return false; }
    error.clear();
    return true;
}
} // namespace ets::file_detail

ETS_API bool readFile(const std::string& path, std::string& contents, std::string& error) noexcept {
    const int descriptor = ::open(path.c_str(), O_RDONLY);
    if (descriptor < 0) {
        contents.clear();
        error = ets::file_detail::systemError("No se puede leer", path);
        return false;
    }

    struct stat metadata {};
    const bool sized = ::fstat(descriptor, &metadata) == 0 && metadata.st_size > 0 && S_ISREG(metadata.st_mode);
    contents.clear();
    if (sized) contents.resize(static_cast<std::size_t>(metadata.st_size));

    std::size_t offset = 0;
    while (offset < contents.size()) {
        const auto received = ::read(descriptor, contents.data() + offset, contents.size() - offset);
        if (received > 0) { offset += static_cast<std::size_t>(received); continue; }
        if (received == 0) { contents.resize(offset); break; }
        if (errno == EINTR) continue;
        error = ets::file_detail::systemError("Error durante la lectura", path);
        contents.clear();
        ::close(descriptor);
        return false;
    }

    char buffer[64 * 1024];
    for (;;) {
        const auto received = ::read(descriptor, buffer, sizeof(buffer));
        if (received > 0) { contents.append(buffer, static_cast<std::size_t>(received)); continue; }
        if (received == 0) break;
        if (errno == EINTR) continue;
        error = ets::file_detail::systemError("Error durante la lectura", path);
        contents.clear();
        ::close(descriptor);
        return false;
    }
    if (::close(descriptor) != 0) {
        error = ets::file_detail::systemError("Error cerrando el archivo", path);
        contents.clear();
        return false;
    }
    error.clear();
    return true;
}

ETS_API bool writeFile(const std::string& path, const std::string& contents, std::string& error) noexcept {
    return ets::file_detail::store(path, contents, O_TRUNC, "No se puede escribir", error);
}

ETS_API bool appendFile(const std::string& path, const std::string& contents, std::string& error) noexcept {
    return ets::file_detail::store(path, contents, O_APPEND, "No se puede abrir para anexar", error);
}

ETS_API bool fileExists(const std::string& path) noexcept {
    std::error_code statusError;
    const bool exists = std::filesystem::is_regular_file(path, statusError);
    return !statusError && exists;
}

ETS_API bool copyFile(const std::string& source, const std::string& destination, std::string& error) noexcept {
    std::error_code copyError;
    const bool copied = std::filesystem::copy_file(source, destination, std::filesystem::copy_options::none, copyError);
    if (copyError || !copied) {
        error = "No se puede copiar '" + source + "' a '" + destination + "'";
        if (copyError) error = error + ": " + copyError.message();
        return false;
    }
    error.clear();
    return true;
}

ETS_API bool moveFile(const std::string& source, const std::string& destination, std::string& error) noexcept {
    std::error_code moveError;
    std::filesystem::rename(source, destination, moveError);
    if (moveError) {
        error = "No se puede mover '" + source + "' a '" + destination + "': " + moveError.message();
        return false;
    }
    error.clear();
    return true;
}

ETS_API bool removeFile(const std::string& path, std::string& error) noexcept {
    std::error_code removeError;
    const bool removed = std::filesystem::remove(path, removeError);
    if (removeError || !removed) {
        error = "No se puede eliminar: " + path;
        if (removeError) error = error + ": " + removeError.message();
        return false;
    }
    error.clear();
    return true;
}

ETS_API std::string etsFsRead(const std::string& path) {
    std::string contents;
    std::string error;
    if (!readFile(path, contents, error)) return std::string();
    return contents;
}

ETS_API bool etsFsWrite(const std::string& path, const std::string& contents) {
    std::string error;
    return writeFile(path, contents, error);
}

ETS_API bool etsFsAppend(const std::string& path, const std::string& contents) {
    std::string error;
    return appendFile(path, contents, error);
}

ETS_API bool etsFsCopy(const std::string& source, const std::string& destination) {
    std::string error;
    return copyFile(source, destination, error);
}

ETS_API bool etsFsMove(const std::string& source, const std::string& destination) {
    std::string error;
    return moveFile(source, destination, error);
}

ETS_API bool etsFsRemove(const std::string& path) {
    std::string error;
    return removeFile(path, error);
}

ETS_API ets::Result<std::string> readFile(const std::string& path) {
    std::string contents;
    std::string error;
    return readFile(path, contents, error) ? ets::ok(std::move(contents)) : ets::err<std::string>(std::move(error));
}

ETS_API ets::Result<bool> writeFile(const std::string& path, const std::string& contents) {
    std::string error;
    return writeFile(path, contents, error) ? ets::ok(true) : ets::err<bool>(std::move(error));
}

ETS_API ets::Result<bool> appendFile(const std::string& path, const std::string& contents) {
    std::string error;
    return appendFile(path, contents, error) ? ets::ok(true) : ets::err<bool>(std::move(error));
}

ETS_API ets::Result<bool> copyFile(const std::string& source, const std::string& destination) {
    std::string error;
    return copyFile(source, destination, error) ? ets::ok(true) : ets::err<bool>(std::move(error));
}

ETS_API ets::Result<bool> moveFile(const std::string& source, const std::string& destination) {
    std::string error;
    return moveFile(source, destination, error) ? ets::ok(true) : ets::err<bool>(std::move(error));
}

ETS_API ets::Result<bool> removeFile(const std::string& path) {
    std::string error;
    return removeFile(path, error) ? ets::ok(true) : ets::err<bool>(std::move(error));
}

ETS_API FileReader openFileReader(const std::string& path) {
    return FileReader::open(path);
}
