#pragma once
#include "src/codegen/ir/native/model.hpp"
#include <filesystem>
#include <fstream>
#include <sstream>
#include <regex>
#include <signal.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <openssl/sha.h>
#include "install_config.hpp"
#include "progress.hpp"
#include <poll.h>
#include <fcntl.h>
namespace estc {
namespace fs=std::filesystem;
inline S read(const fs::path& path){std::ifstream stream(path,std::ios::binary);if(!stream)throw std::runtime_error("No se puede leer "+path.string());return S((std::istreambuf_iterator<char>(stream)),{});}
inline void write(const fs::path& path,const S& contents){if(!path.parent_path().empty())fs::create_directories(path.parent_path());std::ofstream stream(path,std::ios::binary);stream<<contents;if(!stream)throw std::runtime_error("No se puede escribir "+path.string());}
inline S hash(const S& data){unsigned char bytes[SHA256_DIGEST_LENGTH];SHA256(reinterpret_cast<const unsigned char*>(data.data()),data.size(),bytes);static const char* hex="0123456789abcdef";S out;for(auto c:bytes){out+=hex[c>>4];out+=hex[c&15];}return out;}
inline S fileHash(const fs::path& path){return hash(read(path));}
inline S environment(const char* name){auto value=std::getenv(name);return value?value:"";}
inline fs::path tool(const S& name){fs::path p(name);if(p.has_parent_path())return fs::canonical(fs::absolute(p));S search=environment("PATH");size_t begin=0;while(begin<=search.size()){auto end=search.find(':',begin);auto candidate=fs::path(search.substr(begin,end-begin))/p;if(access(candidate.c_str(),X_OK)==0)return fs::canonical(fs::absolute(candidate));if(end==S::npos)break;begin=end+1;}throw std::runtime_error("No se encuentra "+name+" en PATH");}
struct Process{int status=1;S output;};
inline Process executePlain(const V<S>& arguments,bool capture=false){if(arguments.empty())throw std::runtime_error("Comando vacío");int descriptors[2]{-1,-1};if(capture&&pipe(descriptors))throw std::runtime_error("No se puede crear pipe");pid_t pid=fork();if(pid<0)throw std::runtime_error("No se puede crear proceso");if(pid==0){if(capture){close(descriptors[0]);dup2(descriptors[1],STDOUT_FILENO);close(descriptors[1]);}V<char*> args;for(auto& s:arguments)args.push_back(const_cast<char*>(s.c_str()));args.push_back(nullptr);execvp(args[0],args.data());std::cerr<<"No se puede ejecutar "<<arguments[0]<<'\n';_exit(127);}Process result;if(capture){close(descriptors[1]);char buffer[8192];ssize_t count;while((count=::read(descriptors[0],buffer,sizeof(buffer)))>0){result.output.append(buffer,count);if(result.output.size()>128*1024*1024){close(descriptors[0]);kill(pid,SIGKILL);waitpid(pid,nullptr,0);throw std::runtime_error("Salida de herramienta demasiado grande");}}close(descriptors[0]);}int status;while(waitpid(pid,&status,0)<0){if(errno!=EINTR)throw std::runtime_error("No se puede esperar al proceso");}result.status=WIFEXITED(status)?WEXITSTATUS(status):128+WTERMSIG(status);return result;}
// Poll child output on interactive terminals so blocking tools do not freeze
// the spinner. No animation thread is alive across fork/exec.
inline Process execute(const V<S>& arguments,bool capture=false){
 if(!activeProgress||!activeProgress->animated())return executePlain(arguments,capture);
 if(arguments.empty())throw std::runtime_error("Comando vacío");
 int output[2]{-1,-1},errors[2]{-1,-1};
 auto closeFd=[](int& fd){if(fd>=0){close(fd);fd=-1;}};
 auto cleanup=[&](){for(auto pair:{output,errors})for(int at=0;at<2;at++)closeFd(pair[at]);};
 if((capture&&pipe(output))||pipe(errors)){cleanup();throw std::runtime_error("No se puede crear pipe");}
 for(auto pair:{output,errors})for(int at=0;at<2;at++)if(pair[at]>=0)fcntl(pair[at],F_SETFD,FD_CLOEXEC);
 pid_t pid=fork();
 if(pid<0){cleanup();throw std::runtime_error("No se puede crear proceso");}
 if(pid==0){
  if(capture)dup2(output[1],STDOUT_FILENO);dup2(errors[1],STDERR_FILENO);cleanup();
  V<char*> args;for(auto& s:arguments)args.push_back(const_cast<char*>(s.c_str()));args.push_back(nullptr);
  execvp(args[0],args.data());std::cerr<<"No se puede ejecutar "<<arguments[0]<<'\n';_exit(127);
 }
 closeFd(output[1]);closeFd(errors[1]);Process result;S errorText;int status=0;bool exited=false;
 try{
  while(!exited||output[0]>=0||errors[0]>=0){
   if(!exited){auto waited=waitpid(pid,&status,WNOHANG);if(waited==pid)exited=true;else if(waited<0&&errno!=EINTR)throw std::runtime_error("No se puede esperar al proceso");}
   pollfd fds[2]{{output[0],POLLIN,0},{errors[0],POLLIN,0}};
   if(poll(fds,2,exited?0:40)<0&&errno!=EINTR)throw std::runtime_error("No se puede leer la salida del proceso");
   for(int at=0;at<2;at++)if(fds[at].fd>=0&&(fds[at].revents&(POLLIN|POLLHUP|POLLERR))){
    char buffer[8192];auto count=::read(fds[at].fd,buffer,sizeof(buffer));
    if(count>0){auto& text=at==0?result.output:errorText;text.append(buffer,count);if(text.size()>128*1024*1024)throw std::runtime_error("Salida de herramienta demasiado grande");}
    else if(count==0)closeFd(at==0?output[0]:errors[0]);
    else if(errno!=EINTR)throw std::runtime_error("No se puede leer la salida del proceso");
   }
   activeProgress->tick();
  }
 }catch(...){if(!exited){kill(pid,SIGKILL);while(waitpid(pid,nullptr,0)<0&&errno==EINTR){}}cleanup();throw;}
 cleanup();if(!errorText.empty()){activeProgress->clear();std::cerr<<errorText;}
 result.status=WIFEXITED(status)?WEXITSTATUS(status):128+WTERMSIG(status);return result;
}
inline void checked(const V<S>& args){J::Array command;for(auto& arg:args)command.emplace_back(arg);progressDetail("Comando: "+json(J(command)));auto p=execute(args);if(p.status)throw std::runtime_error(args[0]+" terminó con "+n(p.status));}
inline J js(const S& value){return J(value);}
inline J ja(const V<S>& values){J::Array out;for(auto& value:values)out.emplace_back(value);return J(out);}
inline S replace(S text,const S& from,const S& to){if(from.empty())return text;size_t pos=0;while((pos=text.find(from,pos))!=S::npos){text.replace(pos,from.size(),to);pos+=to.size();}return text;}
inline S portable(const S& path,const fs::path& root){S prefix=root.string()+"/";return path.starts_with(prefix)?"$ROOT/"+path.substr(prefix.size()):path;}
inline fs::path materialize(const S& path,const fs::path& root){return path.starts_with("$ROOT/")?root/path.substr(6):fs::path(path);}
inline V<S> cacheOptions(const S& unit,const V<S>& flags,const fs::path& root){S standard="-std=c++20",exceptions="-fno-exceptions";V<S> others;static const std::regex optimization("^-O"),debug("^-g($|[0-9]|gdb|dwarf|line|split)");for(auto& flag:flags){if(flag.starts_with("-std=")){standard=flag;continue;}if(in(flag,{"-fexceptions","-fno-exceptions"})){exceptions=flag;continue;}if(std::regex_search(flag,optimization)||std::regex_search(flag,debug)||in(flag,{"-pthread","-ffunction-sections","-fdata-sections"}))continue;if(flag=="-I"+root.string()||flag=="-I"+(root/"build/libs/libuv/include").string()||flag=="-DCPPHTTPLIB_NO_EXCEPTIONS")continue;others.push_back(flag);}V<S> out{standard,"-O2","-pthread",exceptions,"-ffunction-sections","-fdata-sections","-I"+root.string()};out.insert(out.end(),others.begin(),others.end());if(unit=="libuv"){if(fs::exists(root/"build/libs/libuv/include/uv.h"))out.push_back("-I"+(root/"build/libs/libuv/include").string());}else out.push_back("-DCPPHTTPLIB_NO_EXCEPTIONS");return out;}
inline S compilerIdentity(const S& executable,bool version){auto binary=tool(executable);S output;if(version){auto p=execute({executable,"--version"},true);if(p.status)throw std::runtime_error("No se puede consultar "+executable);output=p.output;}return json(J(J::Array{js(binary.string()),js(fileHash(binary)),js(output),js(ESTC_PLATFORM),js(ESTC_ARCH)}));}
inline V<S> dependencyPaths(S input){input=replace(input,"\\\n","");auto colon=input.find(':');if(colon==S::npos)throw std::runtime_error("Dependencias inválidas");input=input.substr(colon+1);V<S> out;S word;for(size_t at=0;at<input.size();at++){char c=input[at];if(c=='\\'&&at+1<input.size()){word+=input[++at];continue;}if(std::isspace(static_cast<unsigned char>(c))){if(!word.empty()){out.push_back(fs::absolute(word).lexically_normal().string());word.clear();}}else word+=c;}if(!word.empty())out.push_back(fs::absolute(word).lexically_normal().string());return out;}
inline bool cacheValid(const fs::path& directory,const S& name,const fs::path& root){try{auto manifest=parseJson(read(directory/"manifest.json"));if(str(get(manifest,"archiveHash"))!=fileHash(directory/name))return false;auto& deps=array(get(manifest,"dependencies"));if(deps.empty())return false;for(auto& d:deps)if(fileHash(materialize(str(get(d,"path")),root))!=str(get(d,"hash")))return false;return true;}catch(...){return false;}}
inline fs::path runtimeArchive(const S& unit,const S& cxx,const V<S>& flags,const fs::path& root,const fs::path& projectCache={}){auto options=cacheOptions(unit,flags,root);S ar=environment("AR");if(ar.empty())ar="ar";V<S> paths=unit=="libuv"?V<S>{"runtime/runtime_ets_libuv.cpp","runtime/runtime_ets_net_libuv.cpp"}:V<S>{"runtime/external/httplib/httplib.cc"};V<S> hashes,normalized,env;for(auto& path:paths)hashes.push_back(fileHash(root/path));for(auto& option:options)normalized.push_back(replace(option,root.string(),"$ROOT"));for(auto key:{"CPATH","CPLUS_INCLUDE_PATH","C_INCLUDE_PATH","GCC_EXEC_PREFIX","COMPILER_PATH","SDKROOT"})env.push_back(environment(key));bool relative=false;const std::regex include("^-(I|iquote|isystem|include|imacros)");for(auto& flag:flags){if(!flag.starts_with('-'))relative=true;std::smatch match;if(std::regex_search(flag,match,include)&&!fs::path(flag.substr(match.length())).is_absolute())relative=true;}
 S key=hash(json(J(J::Array{js("ets-runtime-cache-1"),js(unit),js(compilerIdentity(cxx,true)),js(compilerIdentity(ar,false)),ja(normalized),ja(env),js(relative?fs::current_path().string():""),ja(hashes)})));S name="libets_"+unit+".a";auto prebuilt=root/"build/runtime-cache"/key;S user=environment("ESTC_RUNTIME_CACHE");if(user.empty())user=environment("ESTATIC_RUNTIME_CACHE");if(user.empty()){user=environment("XDG_CACHE_HOME");if(user.empty())user=environment("HOME")+"/.cache";user+="/estc/runtime";}auto writable=fs::exists(root/"installation.json")?fs::path(user)/key:root/"build/runtime-cache"/key;
 if(!projectCache.empty())writable=projectCache/key;
 if(cacheValid(writable,name,root)){progressDetail("Runtime "+unit+": caché reutilizada");return writable/name;}
 if(cacheValid(prebuilt,name,root)){
  progressDetail("Runtime "+unit+": distribución precompilada reutilizada");
  if(projectCache.empty())return prebuilt/name;
  fs::create_directories(writable);
  fs::copy_file(prebuilt/name,writable/name,fs::copy_options::overwrite_existing);
  fs::copy_file(prebuilt/"manifest.json",writable/"manifest.json",fs::copy_options::overwrite_existing);
  return writable/name;
 }
 progressDetail("Runtime "+unit+": compilando perfil nuevo");
 auto temporary=fs::path(writable.string()+".tmp-"+n(getpid()));fs::create_directories(temporary);try{std::set<S> dependencies;V<S> objects;for(size_t at=0;at<paths.size();at++){auto object=temporary/(n(at)+".o"),deps=temporary/(n(at)+".d");V<S> args{cxx};args.insert(args.end(),options.begin(),options.end());for(auto& x:V<S>{"-MD","-MF",deps.string(),"-c",(root/paths[at]).string(),"-o",object.string()})args.push_back(x);checked(args);objects.push_back(object.string());for(auto& d:dependencyPaths(read(deps)))dependencies.insert(d);}V<S> args{ar,"rcs",(temporary/name).string()};args.insert(args.end(),objects.begin(),objects.end());checked(args);J::Array deps;for(auto& path:dependencies)deps.emplace_back(J::Object{{"path",js(portable(path,root))},{"hash",js(fileHash(path))}});write(temporary/"manifest.json",json(J(J::Object{{"dependencies",J(deps)},{"archiveHash",js(fileHash(temporary/name))}}))+"\n");fs::create_directories(writable);fs::rename(temporary/name,writable/name);fs::rename(temporary/"manifest.json",writable/"manifest.json");fs::remove_all(temporary);return writable/name;}catch(...){fs::remove_all(temporary);throw;}
}
inline void buildCpp(const Result& result,const fs::path& cpp,const fs::path& binary,const fs::path& root,const S& cxx,const V<S>& flags,const V<S>& linkFlags,const fs::path& projectCache={},const fs::path& runtimeCache={}){V<S> args{"-std=c++20","-O0","-pthread","-fno-exceptions","-I"+root.string()};args.insert(args.end(),flags.begin(),flags.end());V<S> libs,units;
 auto uv=root/"build/libs/libuv";if(result.libuv){if(fs::exists(uv/"include/uv.h"))args.push_back("-I"+(uv/"include").string());units.push_back("libuv");libs.push_back(fs::exists(uv/"lib/libuv.a")?(uv/"lib/libuv.a").string():"-luv");if(S(ESTC_PLATFORM)=="linux"){libs.push_back("-ldl");libs.push_back("-lrt");}}
 if(result.headers.contains("runtime/ets_http_httplib.hpp")){args.push_back("-DCPPHTTPLIB_NO_EXCEPTIONS");units.push_back("httplib");}
 if(result.headers.contains("runtime/ets_http_drogon.hpp")){auto drogon=root/"build/libs/drogon";args.push_back("-fexceptions");args.push_back("-I/usr/include/jsoncpp");if(fs::exists(drogon/"include/drogon/drogon.h"))args.push_back("-I"+(drogon/"include").string());if(fs::exists(drogon/"lib/libdrogon.a"))libs.push_back("-L"+(drogon/"lib").string());for(auto lib:{"-ldrogon","-ltrantor","-ljsoncpp","-luuid","-lz","-lssl","-lcrypto","-lresolv","-ldl"})libs.push_back(lib);}
 if(result.tls){libs.push_back("-lssl");libs.push_back("-lcrypto");}if(result.curl)libs.push_back("-lcurl");progressStart("Preparando runtime");V<S> archives;for(auto& unit:units)archives.push_back(runtimeArchive(unit,cxx,args,root,runtimeCache).string());V<S> command{cxx};command.insert(command.end(),args.begin(),args.end());fs::path input=cpp;
 progressStart("Comprobando caché C++");
 if(!projectCache.empty()){
  V<S> env;for(auto key:{"CPATH","CPLUS_INCLUDE_PATH","C_INCLUDE_PATH","GCC_EXEC_PREFIX","COMPILER_PATH","SDKROOT"})env.push_back(environment(key));
  S key=hash(json(J(J::Array{js("estc-object-1"),js(cpp.string()),js(fileHash(cpp)),js(compilerIdentity(cxx,true)),ja(args),ja(env),js(fs::current_path().string())})));
  auto directory=projectCache/"objects"/key;
  if(!cacheValid(directory,"app.o",root)){
   progressDetail("Objeto C++: caché no válida; recompilando");progressStart("Compilando C++");
   auto temporary=fs::path(directory.string()+".tmp-"+n(getpid()));fs::create_directories(temporary);
   try{
    V<S> compile{cxx};compile.insert(compile.end(),args.begin(),args.end());
    for(auto& arg:V<S>{"-MD","-MF",(temporary/"app.d").string(),"-c",cpp.string(),"-o",(temporary/"app.o").string()})compile.push_back(arg);
    checked(compile);J::Array dependencies;
    for(auto& path:dependencyPaths(read(temporary/"app.d")))dependencies.emplace_back(J::Object{{"path",js(portable(path,root))},{"hash",js(fileHash(path))}});
    write(temporary/"manifest.json",json(J(J::Object{{"dependencies",J(dependencies)},{"archiveHash",js(fileHash(temporary/"app.o"))}}))+"\n");
    fs::create_directories(directory);fs::rename(temporary/"app.o",directory/"app.o");fs::rename(temporary/"manifest.json",directory/"manifest.json");fs::remove_all(temporary);
   }catch(...){fs::remove_all(temporary);throw;}
  }else progressDetail("Objeto C++: caché reutilizada");
  progressDetail("Objeto C++: "+(directory/"app.o").string());
  input=directory/"app.o";
 }
 progressStart(projectCache.empty()?"Compilando y enlazando C++":"Enlazando ejecutable");
 command.push_back(input.string());command.insert(command.end(),archives.begin(),archives.end());command.insert(command.end(),libs.begin(),libs.end());command.insert(command.end(),linkFlags.begin(),linkFlags.end());command.push_back("-o");command.push_back(binary.string());fs::create_directories(binary.parent_path());checked(command);
}
}
