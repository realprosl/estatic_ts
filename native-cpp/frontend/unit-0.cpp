// Generated module. Do not edit.
#include "estatic_common.hpp"

std::string environment(std::string name) {
    return ets_compiler_host::environment(name);;
    return std::string("");
}

bool environmentDefined(std::string name) {
    return ets_compiler_host::environmentDefined(name);;
    return false;
}

bool setEnvironment(std::string name, std::string value) {
    return ets_compiler_host::setEnvironment(name,value);;
    return false;
}

double forkWorker() {
    return ets_compiler_host::forkWorker();;
    return (-1.0);
}

void finishWorker(double status) {
    ets_compiler_host::finishWorker(status);return;;
    return;
}

double waitWorker(double pid) {
    return ets_compiler_host::waitWorker(pid);;
    return 125.0;
}

std::string temporaryDirectory() {
    return ets_compiler_host::temporaryDirectory();;
    return std::string("");
}

std::vector<double> analysisUsage() {
    return ets_compiler_host::analysisUsage();;
    return std::vector<double>();
}

std::string hostError() {
    return ets_compiler_host::lastError();;
    return std::string("");
}

bool exists(std::string fileName) {
    return ets_compiler_host::exists(fileName);;
    return false;
}

std::string readText(std::string fileName) {
    return ets_compiler_host::readText(fileName);;
    return std::string("");
}

std::string stdinText() {
    return ets_compiler_host::stdinText();;
    return std::string("");
}

bool writeText(std::string fileName, std::string text) {
    return ets_compiler_host::writeText(fileName,text);;
    return false;
}

std::vector<std::string> files(std::string directory) {
    return ets_compiler_host::files(directory);;
    std::vector<std::string> empty = std::vector<std::string>();
    return empty;
}

bool remove(std::string fileName) {
    return ets_compiler_host::remove(fileName);;
    return false;
}

double launch(std::vector<std::string> args, std::string output, std::string errors) {
    return ets_compiler_host::launch(args,output,errors);;
    return (-2.0);
}

double poll(double processId) {
    return ets_compiler_host::poll(processId);;
    return 125.0;
}

void terminate(double processId) {
    ets_compiler_host::terminate(processId);return;;
    return;
}

double now() {
    return ets_compiler_host::now();;
    return 0.0;
}

void pause(double milliseconds) {
    ets_compiler_host::pause(milliseconds);return;;
    return;
}

bool terminal() {
    return ets_compiler_host::terminal();;
    return false;
}

double columns() {
    return ets_compiler_host::columns();;
    return 80.0;
}

std::string compilerHome() {
    return ets_compiler_host::compilerRoot();;
    return std::string("");
}

std::vector<std::string> objectKeys(ets_json::Value value) {
    return jsonObjectKeys(value);;
    std::vector<std::string> keys = std::vector<std::string>();
    return keys;
}

bool directories(std::string fileName) {
    return ets_compiler_host::directories(fileName);;
    return false;
}

void ets_init_bootstrap_driver_host_b5fb3be4() {

}
