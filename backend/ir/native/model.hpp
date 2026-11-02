#pragma once
#include "runtime/ets_runtime.hpp"
#include <algorithm>
#include <functional>
#include <set>
#include <stdexcept>

namespace estc {
using S=std::string;using J=ets_json_value;
template<class T> using V=std::vector<T>;
inline const J& get(const J& j,const S& key){static const J empty; if(!j.isObject())return empty;const auto& o=std::get<J::Object>(j.storage);auto it=o.find(key);return it==o.end()?empty:it->second;}
inline S str(const J& j){return j.isString()?std::get<S>(j.storage):S{};}
inline int integer(const J& j,int fallback=-1){if(!j.isNumber())return fallback;double n=std::get<double>(j.storage);if(!std::isfinite(n)||n!=std::trunc(n)||n<-2147483648.0||n>2147483647.0)throw std::runtime_error("Índice IR inválido");return static_cast<int>(n);}
inline bool boolean(const J& j){return j.isBool()&&std::get<bool>(j.storage);}
inline const J::Array& array(const J& j){static const J::Array empty;return j.isArray()?std::get<J::Array>(j.storage):empty;}
inline V<int> numbers(const J& j){V<int> out;for(auto& x:array(j))out.push_back(integer(x));return out;}
inline V<S> strings(const J& j){V<S> out;for(auto& x:array(j))out.push_back(str(x));return out;}
inline S join(const V<S>& items,const S& delimiter=","){S out;for(auto& item:items){if(!out.empty())out+=delimiter;out+=item;}return out;}
inline bool in(const S& s,std::initializer_list<const char*> values){for(auto x:values)if(s==x)return true;return false;}
template<class T> bool has(const V<T>& v,const T& x){return std::find(v.begin(),v.end(),x)!=v.end();}
template<class T> int index(const V<T>& v,const T& x){auto it=std::find(v.begin(),v.end(),x);return it==v.end()?-1:int(it-v.begin());}
inline S n(int value){return std::to_string(value);}
inline S quote(const S& text){S out="\"";for(unsigned char c:text){if(c=='"'||c=='\\'){out+='\\';out+=c;}else if(c=='\n')out+="\\n";else if(c=='\r')out+="\\r";else if(c=='\t')out+="\\t";else if(c<32||c==127){out+='\\';out+=char('0'+((c>>6)&7));out+=char('0'+((c>>3)&7));out+=char('0'+(c&7));}else out+=c;}return out+'"';}
inline J parseJson(const S& input){J out;S error;if(!ets_json_parser::parseDocument(input,out,error))throw std::runtime_error("JSON inválido: "+error);return out;}
inline S json(const J& input){return ets_json::stringify(input);}
struct Source {S file;int start=0;Source()=default;Source(const J& j):file(str(get(j,"file"))),start(integer(get(j,"start"),0)){} };
struct Error:std::runtime_error {Error(const S& message,const Source& source={}):std::runtime_error("IR_CPP_UNSUPPORTED: "+(source.file.empty()?"":source.file+":"+n(source.start)+": ")+message){} };
struct Type {S kind,numericKind,tag,discriminator,discriminatorValue;V<int> arguments,fields,variants,methodTypes;V<S> names,methods;int bits=0,length=-1,discriminatorType=-1;bool resource=false;Type(const J& j):kind(str(get(j,"kind"))),numericKind(str(get(j,"numericKind"))),tag(str(get(j,"tag"))),discriminator(str(get(j,"discriminator"))),discriminatorValue(str(get(j,"discriminatorValue"))),arguments(numbers(get(j,"arguments"))),fields(numbers(get(j,"fields"))),variants(numbers(get(j,"variants"))),methodTypes(numbers(get(j,"methodTypes"))),names(strings(get(j,"names"))),methods(strings(get(j,"methods"))),bits(integer(get(j,"bits"),0)),length(integer(get(j,"length"))),discriminatorType(integer(get(j,"discriminatorType"))),resource(boolean(get(j,"resource"))){} };
struct Place {S kind;int typeId=-1,base=-1,index=-1,field=-1,global=-1;bool parameter=false;Source source;Place(const J& j):kind(str(get(j,"kind"))),typeId(integer(get(j,"typeId"))),base(integer(get(j,"base"))),index(integer(get(j,"index"))),field(integer(get(j,"field"))),global(integer(get(j,"global"))),parameter(boolean(get(j,"parameter"))),source(get(j,"source")){} };
struct Instruction {S op,text;V<int> operands;V<S> names;int result=-1,typeId=-1,place=-1,callee=-1,contract=-1,lease=-1,continuation=-1,signature=-1;Source source;Instruction(const J& j):op(str(get(j,"op"))),text(str(get(j,"text"))),operands(numbers(get(j,"operands"))),names(strings(get(j,"names"))),result(integer(get(j,"result"))),typeId(integer(get(j,"typeId"))),place(integer(get(j,"place"))),callee(integer(get(j,"callee"))),contract(integer(get(j,"contract"))),lease(integer(get(j,"lease"))),continuation(integer(get(j,"continuation"))),signature(integer(get(j,"signature"))),source(get(j,"source")){} };
struct Block {S terminator;V<int> targets;int value=-1;V<Instruction> instructions;Source source;Block(const J& j):terminator(str(get(j,"terminator"))),targets(numbers(get(j,"targets"))),value(integer(get(j,"value"))),source(get(j,"source")){for(auto& x:array(get(j,"instructions")))instructions.emplace_back(x);} };
struct Function {int returns=-1,bodyReturns=-1;bool asynchronous=false;V<int> parameterTypes,values,captureTypes,frameValues,framePlaces;V<S> captureModes;V<Place> places;V<Block> blocks;Source source;Function(const J& j):returns(integer(get(j,"returns"))),bodyReturns(integer(get(j,"bodyReturns"))),asynchronous(boolean(get(j,"asynchronous"))),parameterTypes(numbers(get(j,"parameterTypes"))),values(numbers(get(j,"values"))),captureTypes(numbers(get(j,"captureTypes"))),frameValues(numbers(get(j,"frameValues"))),framePlaces(numbers(get(j,"framePlaces"))),captureModes(strings(get(j,"captureModes"))),source(get(j,"source")){for(auto& x:array(get(j,"places")))places.emplace_back(x);for(auto& x:array(get(j,"blocks")))blocks.emplace_back(x);} };
struct Contract {S name,capability;V<S> effects;Contract(const J& j):name(str(get(j,"name"))),capability(str(get(j,"capability"))),effects(strings(get(j,"effects"))){} };
struct Dispatch {int interfaceType,concreteType,signature,callee;S name;Dispatch(const J& j):interfaceType(integer(get(j,"interfaceType"))),concreteType(integer(get(j,"concreteType"))),signature(integer(get(j,"signature"))),callee(integer(get(j,"callee"))),name(str(get(j,"name"))){} };
struct Project {V<S> types,annotations;V<Type> shapes;V<Function> functions;V<Place> globals;V<Contract> contracts;V<Dispatch> dispatches;V<int> initialization,finalization;
 explicit Project(const J& j){if(str(get(j,"format"))!="ets-ir-2"||!boolean(get(j,"success"))||!get(j,"diagnostics").isArray()||!array(get(j,"diagnostics")).empty())throw Error("Se requiere ets-ir-2 verificado con success:true");types=strings(get(j,"types"));for(auto& x:array(get(j,"typeDefinitions")))shapes.emplace_back(x);for(auto& x:array(get(j,"functions")))functions.emplace_back(x);for(auto& x:array(get(j,"globals")))globals.emplace_back(x);for(auto& x:array(get(j,"runtimeContracts")))contracts.emplace_back(x);for(auto& x:array(get(j,"dispatches")))dispatches.emplace_back(x);for(auto& x:array(get(j,"annotations")))annotations.push_back(str(get(x,"name")));initialization=numbers(get(j,"initializationOrder"));finalization=numbers(get(j,"finalizationOrder"));}
};
struct Result {S cpp;std::set<S> headers;bool libuv=false,curl=false,tls=false,ioUring=false;V<S> capabilities;
 J wire()const{J::Array hs,cs;for(auto& h:headers)hs.emplace_back(h);for(auto& c:capabilities)cs.emplace_back(c);return J::Object{{"cpp",J(cpp)},{"headers",J(hs)},{"runtimeBackends",J(J::Object{{"libuv",J(libuv)},{"curl",J(curl)},{"tls",J(tls)},{"ioUring",J(ioUring)}})},{"capabilities",J(cs)}};}
};
Result generateNativeCpp(const J& project);
}
