#include "platform.hpp"
#include <iostream>
namespace estc {
class Usage:public std::runtime_error{public:using std::runtime_error::runtime_error;};
// Native configs are JSON or declarative export-default objects. They are never
// executed as JavaScript; computed/dynamic configurations fail explicitly.
class ConfigParser{
 S input;size_t at=0;
 void skip(){while(at<input.size()){if(std::isspace(static_cast<unsigned char>(input[at]))){at++;continue;}if(input.substr(at,2)=="//"){at=input.find('\n',at);if(at==S::npos)at=input.size();continue;}if(input.substr(at,2)=="/*"){auto end=input.find("*/",at+2);if(end==S::npos)throw Usage("Comentario de configuración sin cerrar");at=end+2;continue;}break;}}
 bool take(char c){skip();if(at<input.size()&&input[at]==c){at++;return true;}return false;}
 S word(){skip();size_t start=at;while(at<input.size()&&(std::isalnum(static_cast<unsigned char>(input[at]))||input[at]=='_'||input[at]=='$'))at++;if(start==at)throw Usage("Se esperaba una clave declarativa de configuración");return input.substr(start,at-start);}
 S string(){skip();char delimiter=input.at(at++);S token="\"";bool closed=false;while(at<input.size()){char c=input[at++];if(c==delimiter){closed=true;break;}if(c=='\\'){if(at>=input.size())break;char next=input[at++];if(next=='\''&&delimiter=='\'')token+='\'';else{token+='\\';token+=next;}}else if(c=='"')token+="\\\"";else token+=c;}if(!closed)throw Usage("String de configuración sin cerrar");token+='"';return str(parseJson(token));}
 J value(){skip();if(at>=input.size())throw Usage("Configuración incompleta");if(take('{')){J::Object object;while(!take('}')){skip();S key=input[at]=='"'||input[at]=='\''?string():word();if(!take(':'))throw Usage("Se esperaba ':' en configuración");if(object.contains(key))throw Usage("Clave duplicada en configuración: "+key);object.emplace(key,value());if(take('}'))break;if(!take(','))throw Usage("La configuración nativa sólo admite valores declarativos; utiliza estatic.config.json");}return J(object);}if(take('[')){J::Array values;while(!take(']')){values.push_back(value());if(take(']'))break;if(!take(','))throw Usage("Array de configuración inválido");}return J(values);}if(input[at]=='"'||input[at]=='\'')return js(string());size_t start=at;while(at<input.size()&&!std::isspace(static_cast<unsigned char>(input[at]))&&input[at]!=','&&input[at]!=']'&&input[at]!='}')at++;auto token=input.substr(start,at-start);try{return parseJson(token);}catch(...){throw Usage("La configuración nativa admite objetos declarativos, no código JavaScript: "+token);}}
public:explicit ConfigParser(S source):input(std::move(source)){}J parse(){skip();if(input.substr(at,6)=="export"){if(word()!="export"||word()!="default")throw Usage("Se esperaba export default");}J out=value();skip();if(input.substr(at,2)=="as"){if(word()!="as"||word()!="const")throw Usage("Configuración no declarativa");}take(';');skip();if(at!=input.size())throw Usage("La configuración contiene código ejecutable; utiliza JSON");if(!out.isObject())throw Usage("La configuración debe ser un objeto");return out;}
};
inline void diagnostics(const J& project){S errors;for(auto& d:array(get(project,"diagnostics"))){auto& source=get(d,"source");errors+=str(get(source,"file"))+":"+n(integer(get(source,"start"),0))+": "+str(get(d,"code"))+": "+str(get(d,"message"))+"\n";}throw std::runtime_error(errors.empty()?"El frontend nativo no produjo IR verificado":errors);}
S help(){return "Uso: etsc init [directorio]\n     etsc build [fuente.ets|fuente.ts] [opciones]\n     etsc run [fuente] [opciones] [-- argumentos]\n  --config archivo       JSON u objeto declarativo de configuración\n  -o archivo.cpp         Generar C++\n  --binary archivo       Ruta del ejecutable\n  --verbose              Mostrar fases, comandos, cachés y tiempos\n  --no-progress          Desactivar animaciones\n  --check                Verificar sin escribir resultados\n  --emit-ir archivo      Guardar IR verificado\n  --from-ir archivo      Entrada IR de confianza\n  --root directorio      Raíz de módulos (repetible)\n  --alias nombre ruta    Alias de módulos (repetible)\n  --cache directorio     Caché de sintaxis\n  --cxx compilador       Compilador C++20\n  --cxx-flag flag        Flag de compilación (repetible)\n  --link-flag flag       Flag de enlace (repetible)\n  --frontend binario     Frontend nativo alternativo\n  update-types [directorio]\n  --version | -version | -v | -V | /V\n  --help | -h | -H\n";}
int init(const fs::path& root,const fs::path& directory){auto templates=root/"templates";if(!fs::exists(templates))throw std::runtime_error("Instalación incompleta: faltan templates");if(fs::exists(directory/"types/estatic.d.ts"))throw std::runtime_error("No se sobrescribe "+(directory/"types/estatic.d.ts").string());V<fs::path> files;for(auto& entry:fs::recursive_directory_iterator(templates))if(entry.is_regular_file()){auto rel=fs::relative(entry.path(),templates);if(fs::exists(directory/rel))throw std::runtime_error("No se sobrescribe "+(directory/rel).string());files.push_back(rel);}S declarations=read(root/"types/estatic.d.ts");
 for(auto& rel:files)if(rel!=fs::path("types/estatic.d.ts"))write(directory/rel,read(templates/rel));
 write(directory/"types/estatic.d.ts",declarations);
 for(auto folder:{"cache","generated","runtime"})fs::create_directories(directory/".build"/folder);if(activeProgress)activeProgress->finish();std::cout<<"Proyecto creado en "<<directory.string()<<'\n';return 0;}
int main(V<S> args,const S& argv0){
 if(args.size()==1&&args[0]=="--codegen-json"){S input((std::istreambuf_iterator<char>(std::cin)),{});std::cout<<json(generateNativeCpp(parseJson(input)).wire())<<'\n';return 0;}
 bool verbose=false,animation=true;V<S> filtered;
 for(size_t at=0;at<args.size();at++){
  auto arg=args[at];if(arg=="--"){filtered.insert(filtered.end(),args.begin()+at,args.end());break;}
  if(arg=="--verbose"){verbose=true;continue;}if(arg=="--no-progress"){animation=false;continue;}
  filtered.push_back(arg);
  size_t values=arg=="--alias"?2:in(arg,{"-o","--binary","--config","--emit-ir","--from-ir","--frontend","--cache","--cxx","--root","--cxx-flag","--link-flag"})?1:0;
  while(values--&&at+1<args.size())filtered.push_back(args[++at]);
 }
 args=std::move(filtered);
 if(args.size()==1&&in(args[0],{"--help","-h","-H"})){std::cout<<help();return 0;}if(args.size()==1&&in(args[0],{"--version","-version","-v","-V","/V"})){std::cout<<ESTC_VERSION<<'\n';return 0;}
 Progress progress(verbose,animation);
 fs::path root=environment("ESTC_ROOT");if(root.empty())root=tool(argv0).parent_path()/"../lib/estc/current";root=fs::weakly_canonical(root);
 if(!args.empty()&&args[0]=="init"){if(args.size()>2||args.size()==2&&args[1].starts_with('-'))throw Usage("Uso: etsc init [directorio]");progress.start("Creando proyecto");return init(root,fs::absolute(args.size()==2?args[1]:"."));}
 if(!args.empty()&&args[0]=="update-types"){if(args.size()>2)throw Usage("Uso: etsc update-types [directorio]");progress.start("Actualizando tipos");auto directory=fs::absolute(args.size()==2?args[1]:".");auto target=directory/"types/estatic.d.ts";S types=read(root/"types/estatic.d.ts");if(fs::exists(target)){if(read(target)==types){progress.finish();std::cout<<"Tipos actualizados\n";return 0;}auto backup=fs::path(target.string()+".bak");if(fs::exists(backup))throw std::runtime_error("Ya existe "+backup.string());write(backup,read(target));}write(target,types);return 0;}
 bool build=false,run=false,check=false;S entry,output,binary,configPath,emitIr,fromIr,frontend,cxx,cache;V<S> roots,flags,linkFlags,programArgs;V<std::pair<S,S>> aliases;
 if(!args.empty()&&in(args[0],{"run","build"})){run=args[0]=="run";build=true;args.erase(args.begin());}
 auto next=[&](size_t& at){if(at+1>=args.size())throw Usage("Falta un valor para "+args[at]);return args[++at];};
 for(size_t at=0;at<args.size();at++){S arg=args[at];if(arg=="--"){programArgs.assign(args.begin()+at+1,args.end());break;}if(arg=="--run"){run=build=true;continue;}if(arg=="--build"){build=true;continue;}if(arg=="--check"){check=true;continue;}
  if(in(arg,{"-o","--binary","--config","--emit-ir","--from-ir","--frontend","--cache","--cxx","--root","--alias","--cxx-flag","--link-flag"})){S value=next(at);if(value.starts_with('-')&&!in(arg,{"--cxx-flag","--link-flag"}))throw Usage("Falta un valor para "+arg);if(arg=="-o")output=value;else if(arg=="--binary")binary=value;else if(arg=="--config")configPath=value;else if(arg=="--emit-ir")emitIr=value;else if(arg=="--from-ir")fromIr=value;else if(arg=="--frontend")frontend=value;else if(arg=="--cache")cache=value;else if(arg=="--cxx")cxx=value;else if(arg=="--root")roots.push_back(fs::absolute(value).string());else if(arg=="--alias")aliases.emplace_back(value,fs::absolute(next(at)).string());else if(arg=="--cxx-flag")flags.push_back(value);else linkFlags.push_back(value);continue;}
  if(arg.starts_with('-')||!entry.empty())throw Usage("Argumento inesperado: "+arg);entry=arg;
 }
 if(!entry.empty()&&!fromIr.empty())throw Usage("Usa una fuente o --from-ir");if(check&&(build||run||!output.empty()||!binary.empty()))throw Usage("--check no admite generación o ejecución");if(!programArgs.empty()&&!run)throw Usage("Los argumentos del programa requieren run");
 if(configPath.empty()&&entry.empty()&&fromIr.empty()){if(fs::exists("estatic.config.json"))configPath="estatic.config.json";else if(fs::exists("estatic.config.ts"))configPath="estatic.config.ts";}
 progress.start("Cargando configuración");
 J config;fs::path base=fs::current_path();if(!configPath.empty()){auto file=fs::absolute(configPath);base=file.parent_path();config=ConfigParser(read(file)).parse();}
 if(entry.empty()&&fromIr.empty()){entry=str(get(config,"entry"));if(entry.empty())throw Usage(help());entry=(base/entry).string();}entry=fs::absolute(fromIr.empty()?entry:fromIr).string();
 const auto& incremental=get(config,"incremental");
 bool reuse=config.isObject()&&(!get(incremental,"enabled").isBool()||boolean(get(incremental,"enabled")));
 fs::path projectCache=base/".build/cache";
 S configuredCache=str(get(incremental,"cacheDirectory"));if(!configuredCache.empty())projectCache=base/configuredCache;
 if(cache.empty()&&reuse&&fromIr.empty())cache=(projectCache/"syntax").string();
 V<S> loaderArgs;for(auto& item:array(get(config,"moduleRoots")))loaderArgs.insert(loaderArgs.end(),{"--root",(base/str(item)).lexically_normal().string()});for(auto& path:roots)loaderArgs.insert(loaderArgs.end(),{"--root",path});const auto& aliasMap=get(config,"aliases");if(aliasMap.isObject())for(auto& [name,path]:std::get<J::Object>(aliasMap.storage))loaderArgs.insert(loaderArgs.end(),{"--alias",name,(base/str(path)).lexically_normal().string()});for(auto& [name,path]:aliases)loaderArgs.insert(loaderArgs.end(),{"--alias",name,path});if(!cache.empty())loaderArgs.insert(loaderArgs.end(),{"--cache",fs::absolute(cache).string()});if(!fromIr.empty()&&!loaderArgs.empty())throw Usage("Las opciones de módulos requieren una fuente");
 progress.detail("Entrada: "+json(js(entry)));progress.detail("Caché de sintaxis: "+json(js(cache)));
 progress.start(fromIr.empty()?"Analizando fuentes y verificando IR":"Leyendo IR");
 J project;if(!fromIr.empty())project=parseJson(read(entry));else{if(frontend.empty())frontend=(root/"native/frontend").string();V<S> command{frontend,entry};command.insert(command.end(),loaderArgs.begin(),loaderArgs.end());progress.detail("Frontend: "+json(ja(command)));auto child=execute(command,true);try{project=parseJson(child.output);}catch(...){throw std::runtime_error("El frontend no produjo JSON válido ("+n(child.status)+")");}if(child.status||!boolean(get(project,"success")))diagnostics(project);}
 progress.start("Generando C++ desde IR verificado");
 auto generated=generateNativeCpp(project);if(!emitIr.empty())write(fs::absolute(emitIr),json(project)+"\n");if(check){progress.summary();std::cout<<"Comprobado: "<<entry<<'\n';return 0;}
 progress.start("Guardando resultados");
 const auto& out=get(config,"output");const auto& compiler=get(config,"compiler");if(output.empty()){S configured=str(get(out,"cpp"));output=config.isObject()?(base/(configured.empty()?"build/app.cpp":configured)).string():(fs::path("build")/(fs::path(entry).stem().string()+".cpp")).string();}auto cpp=fs::absolute(output);if(!fs::exists(cpp)||read(cpp)!=generated.cpp)write(cpp,generated.cpp);
 progress.detail("C++: "+json(js(cpp.string())));
 if(reuse){S configured=str(get(incremental,"generatedDirectory"));auto directory=base/(configured.empty()?".build/generated":configured);write(directory/(hash(generated.cpp)+".cpp"),generated.cpp);}
 if(build||boolean(get(compiler,"enabled"))){if(binary.empty()){S configured=str(get(out,"binary"));if(config.isObject())binary=(base/(configured.empty()?"build/app":configured)).string();else{binary=cpp.string();if(binary.ends_with(".cpp"))binary.resize(binary.size()-4);binary+=".bin";}}binary=fs::absolute(binary).string();if(cxx.empty())cxx=str(get(compiler,"command"));if(cxx.empty())cxx=environment("CXX");if(cxx.empty()){try{cxx=str(get(parseJson(read(root/"installation.json")),"compiler"));}catch(...){}}if(cxx.empty())cxx="g++";V<S> compileFlags,links;
  if(config.isObject()){compileFlags=get(compiler,"flags").isArray()?strings(get(compiler,"flags")):V<S>{"-std=c++20","-O2","-pthread","-fno-exceptions","-ffunction-sections","-fdata-sections"};links=get(compiler,"linkFlags").isArray()?strings(get(compiler,"linkFlags")):V<S>{"-Wl,--gc-sections","-Wl,--as-needed","-s"};}
  compileFlags.insert(compileFlags.end(),flags.begin(),flags.end());for(auto& lib:strings(get(config,"linkLibraries")))links.push_back("-l"+lib);links.insert(links.end(),linkFlags.begin(),linkFlags.end());buildCpp(generated,cpp,binary,root,cxx,compileFlags,links,reuse?projectCache:fs::path{},reuse?base/".build/runtime":fs::path{});progress.detail("Ejecutable: "+json(js(binary)));
 }
 progress.summary();
 if(run){V<S> command{binary};command.insert(command.end(),programArgs.begin(),programArgs.end());progress.detail("Ejecutando: "+json(ja(command)));return execute(command).status;}return 0;
}
}
int main(int argc,char** argv){try{estc::V<estc::S> args;for(int at=1;at<argc;at++)args.emplace_back(argv[at]);return estc::main(args,argv[0]);}catch(const estc::Usage& error){std::cerr<<error.what()<<'\n';return 2;}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
