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
#include <signal.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <unistd.h>
namespace ets_compiler_host {
inline thread_local std::string error;
inline std::string compilerRoot(){
 std::error_code ec;auto executable=std::filesystem::read_symlink("/proc/self/exe",ec);
 if(!ec){auto home=executable.parent_path().parent_path()/"lib/estc/current";
  if(std::filesystem::exists(home/"installation.json",ec))return std::filesystem::canonical(home,ec).string();}
 return std::filesystem::path(__FILE__).parent_path().parent_path().string();
}
inline std::string temporaryDirectory(std::string parent){
 error.clear();std::string pattern=(std::filesystem::path(parent)/".ets-build-XXXXXX").string();
 std::vector<char> buffer(pattern.begin(),pattern.end());buffer.push_back(0);
 if(auto result=mkdtemp(buffer.data()))return result;error="No se puede crear el directorio temporal";return "";
}
inline bool removeDirectory(std::string path){std::error_code ec;std::filesystem::remove_all(path,ec);return !ec;}
inline bool copyFile(std::string source,std::string target){
 error.clear();std::error_code ec;std::filesystem::create_directories(std::filesystem::path(target).parent_path(),ec);
 auto temp=target+".tmp-"+std::to_string(getpid());
 if(!ec)std::filesystem::copy_file(source,temp,std::filesystem::copy_options::overwrite_existing,ec);
 if(!ec)std::filesystem::rename(temp,target,ec);
 if(ec)error=ec.message();return !ec;
}
inline std::string lastError(){return error;}
inline std::string environment(std::string name){auto p=std::getenv(name.c_str());return p?p:"";}
inline bool environmentDefined(std::string name){return std::getenv(name.c_str())!=nullptr;}
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
