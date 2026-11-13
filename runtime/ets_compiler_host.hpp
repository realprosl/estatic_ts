#pragma once
// OS primitives only. Compiler policy, code emission, flags and progress live in ETS.
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <thread>
#include <vector>
#include <cerrno>
#include <cstring>
#include <sys/resource.h>
#include <signal.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <mach-o/dyld.h>
#endif
namespace ets_compiler_host {
// Ruta real del ejecutable en marcha (vacía si no se puede saber).
inline std::filesystem::path executablePath(){
    std::error_code ec;
#if defined(__APPLE__)
    uint32_t size=0; _NSGetExecutablePath(nullptr,&size);
    std::string buffer(size,'\0');
    if(_NSGetExecutablePath(buffer.data(),&size)!=0) return {};
    auto path=std::filesystem::weakly_canonical(buffer.c_str(),ec);
#else
    auto path=std::filesystem::read_symlink("/proc/self/exe",ec);
#endif
    return ec?std::filesystem::path{}:path;
}
// Raíz del compilador (runtime/, templates/...). Un compilador instalado vive en
// <prefijo>/bin y su raíz es <prefijo>/lib/estc/current: se deduce del
// ejecutable para que un binario precompilado funcione en cualquier máquina.
// Si no es una instalación (compilador de desarrollo), se usa el árbol de
// fuentes con el que se compiló (__FILE__). ESTC_ROOT, si existe, manda.
inline std::string compilerRoot(){
    auto executable=executablePath();
    if(!executable.empty()){
        std::error_code ec;
        auto installed=executable.parent_path().parent_path()/"lib/estc/current";
        if(std::filesystem::exists(installed/"runtime/ets_runtime.hpp",ec)) return installed.string();
    }
    return std::filesystem::path(__FILE__).parent_path().parent_path().string();
}
inline thread_local std::string error;
inline std::string lastError(){return error;}
inline std::string environment(std::string name){auto p=std::getenv(name.c_str());return p?p:"";}
inline bool environmentDefined(std::string name){return std::getenv(name.c_str())!=nullptr;}
inline bool setEnvironment(std::string name,std::string value){error.clear();if(setenv(name.c_str(),value.c_str(),1)==0)return true;error=std::strerror(errno);return false;}
inline double forkWorker(){error.clear();auto pid=fork();if(pid<0)error=std::strerror(errno);return static_cast<double>(pid);}
inline void finishWorker(double code){_exit(static_cast<int>(code));}
inline double waitWorker(double process){int status=0;pid_t result;do{result=waitpid(static_cast<pid_t>(process),&status,0);}while(result<0&&errno==EINTR);if(result<0)return 125;return WIFEXITED(status)?WEXITSTATUS(status):128+WTERMSIG(status);}
inline std::string temporaryDirectory(){error.clear();auto base=std::getenv("TMPDIR");auto pattern=std::string(base&&*base?base:"/tmp")+"/ets-analysis-XXXXXX";std::vector<char> path(pattern.begin(),pattern.end());path.push_back(0);if(mkdtemp(path.data()))return path.data();error=std::strerror(errno);return "";}
inline std::vector<double> analysisUsage(){rusage self{},children{};getrusage(RUSAGE_SELF,&self);getrusage(RUSAGE_CHILDREN,&children);auto cpu=[](const rusage& r){return 1000.0*(r.ru_utime.tv_sec+r.ru_stime.tv_sec)+0.001*(r.ru_utime.tv_usec+r.ru_stime.tv_usec);};return {std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count(),cpu(self)+cpu(children),static_cast<double>(self.ru_maxrss),static_cast<double>(children.ru_maxrss)};}
inline bool exists(std::string path){std::error_code ec;return std::filesystem::exists(path,ec)&&!ec;}
inline std::string readText(std::string path){
 error.clear();std::ifstream in(path,std::ios::binary);if(!in){error="No se puede leer "+path;return "";}
 return std::string(std::istreambuf_iterator<char>(in),{});
}
inline std::string stdinText(){return std::string(std::istreambuf_iterator<char>(std::cin),{});}
inline bool writeText(std::string path,std::string text){
 error.clear();std::error_code ec;auto parent=std::filesystem::path(path).parent_path();
 if(!parent.empty())std::filesystem::create_directories(parent,ec);
 if(ec){error=ec.message();return false;}
 std::ofstream out(path,std::ios::binary);out.write(text.data(),static_cast<std::streamsize>(text.size()));
 if(!out){error="No se puede escribir "+path;return false;}return true;
}
inline std::vector<std::string> files(std::string path){
 error.clear();std::error_code ec;std::vector<std::string> out;
 std::filesystem::recursive_directory_iterator it(path,ec),end;
 while(!ec&&it!=end){if(it->is_regular_file(ec))out.push_back(std::filesystem::relative(it->path(),path,ec).generic_string());it.increment(ec);}
 if(ec)error=ec.message();return out;
}
inline bool directories(std::string path){error.clear();std::error_code ec;std::filesystem::create_directories(path,ec);if(ec)error=ec.message();return !ec;}
inline bool remove(std::string path){error.clear();std::error_code ec;std::filesystem::remove(path,ec);if(ec)error=ec.message();return !ec;}
// rename(2) es atómico dentro del mismo sistema de ficheros: publica un objeto
// de la caché completo o nada.
inline std::string executable(){return executablePath().string();}
inline bool rename(std::string from,std::string to){error.clear();std::error_code ec;std::filesystem::rename(from,to,ec);if(ec)error=ec.message();return !ec;}
inline double launch(std::vector<std::string> args,std::string output,std::string errors){
 error.clear();if(args.empty()){error="Comando vacío";return -2;}
 auto pid=fork();if(pid<0){error="No se puede crear proceso";return -2;}
 if(pid==0){
  for(auto pair:{std::pair{output,STDOUT_FILENO},std::pair{errors,STDERR_FILENO}})if(!pair.first.empty()){
   int fd=open(pair.first.c_str(),O_WRONLY|O_CREAT|O_TRUNC,0600);if(fd<0)_exit(126);dup2(fd,pair.second);close(fd);
  }
  std::vector<char*> argv;for(auto& arg:args)argv.push_back(arg.data());argv.push_back(nullptr);execvp(argv[0],argv.data());_exit(127);
 }
 return static_cast<double>(pid);
}
inline double poll(double process){
 int status=0;auto result=waitpid(static_cast<pid_t>(process),&status,WNOHANG);
 if(result==0||(result<0&&errno==EINTR))return -1;
 if(result<0){error="No se puede esperar al proceso";return 125;}
 return WIFEXITED(status)?WEXITSTATUS(status):128+WTERMSIG(status);
}
inline void terminate(double process){kill(static_cast<pid_t>(process),SIGTERM);}
inline double now(){return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();}
inline void pause(double ms){std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<long long>(ms)));}
inline bool terminal(){return isatty(STDERR_FILENO);}
inline double columns(){winsize w{};return ioctl(STDERR_FILENO,TIOCGWINSZ,&w)==0&&w.ws_col?w.ws_col:80;}
}
