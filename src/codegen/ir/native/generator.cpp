#include "model.hpp"
#include "native-tables.hpp"
#include <regex>
#include <cmath>
namespace estc {
class Generator {
public:
 Project p;Result result;
 explicit Generator(const J& j):p(j){result.headers={"runtime/ets_runtime.hpp","runtime/ets_ir.hpp"};}
 [[noreturn]] S fail(const S& s,const Source& source={})const{throw Error(s,source);}
 const Type& shape(int id)const{if(id<0||id>=int(p.shapes.size()))throw Error("Tipo IR inexistente: "+n(id));return p.shapes[id];}
 bool record(int id)const{return in(shape(id).kind,{"record","interface","intersection","variant"});}
 bool sum(int id)const{return in(shape(id).kind,{"sum","union"});}
 bool interface(int id)const{return in(shape(id).kind,{"interface","intersection"})&&!shape(id).methods.empty();}
 V<int> choices(int id)const{return shape(id).kind=="union"?shape(id).variants:shape(id).arguments;}
 bool numeric(int id)const{return shape(id).numericKind!="none";}
 int inner(int id)const{const auto& s=shape(id);return in(s.kind,{"ref","constRef","ptr","constPtr","readonly"})?s.arguments.at(0):id;}
 S deref(const S& value,int id)const{return in(shape(id).kind,{"ref","constRef","ptr","constPtr"})?"(*("+value+"))":value;}
 void httpServer(){result.headers.insert(has(p.annotations,S("cpp_drogon"))?"runtime/ets_http_drogon.hpp":"runtime/ets_http_httplib.hpp");}
 S types(const V<int>& ids){V<S> out;for(int t:ids)out.push_back(type(t));return join(out);}
 S type(int id){const auto& s=shape(id);const auto& a=s.arguments;const S& k=s.kind;
  if(record(id)||sum(id))return "ir_t"+n(id);
  if(k=="scalar"){auto it=nativeTypes.find(p.types.at(id));if(it==nativeTypes.end())return fail("Tipo escalar inválido");return it->second;}
  if(k=="enum"||k=="readonly")return type(a.at(0));
  if(k=="ptr"||k=="constPtr")return "std::unique_ptr<"+S(k=="constPtr"?"const ":"")+type(a.at(0))+">";
  if(k=="ref"||k=="constRef")return S(k=="constRef"?"const ":"")+type(a.at(0))+"*";
  if(k=="array")return "std::vector<"+elementType(a.at(0))+">";
  if(k=="fixedArray")return "std::array<"+type(a.at(0))+","+n(s.length)+">";
  if(k=="tuple"||k=="pack")return "std::tuple<"+types(a)+">";
  if(k=="function")return "std::function<"+type(a.back())+"("+types(V<int>(a.begin(),a.end()-1))+")>";
  if(k=="Optional")return "ets::Optional<"+type(a.at(0))+">";
  if(k=="Result"){if(p.types.at(a.at(1))!="string")return fail("El runtime C++ requiere Result<T,string>");result.headers.insert("runtime/ets_async.hpp");result.libuv=true;return "ets::Result<"+type(a.at(0))+">";}
  if(k=="Promise"){result.headers.insert("runtime/ets_async.hpp");result.libuv=true;return "ets::Task<"+type(a.at(0))+">";}
  if(k=="Map"||k=="Set")return "ets::"+k+"<"+types(a)+">";
  if(k=="iterator")return "std::size_t";
  if(k=="parameter")return "std::monostate";
  if(k=="runtime"){
   const S& name=p.types.at(id);
   if(name=="Server"){httpServer();return "ets::Server";}
   if(name=="Request"||name=="Response"){httpServer();return name=="Request"?"const ets::HttpRequest*":"ets::HttpResponse*";}
   if(name=="HttpClientResponse"){result.headers.insert("runtime/ets_http_curl_async.hpp");result.libuv=result.curl=true;return "ets::HttpClientResponse";}
   if(name=="Timer")return fail("runtime:Timer necesita un contrato de ownership/copia en el IR");
   auto it=nativeTypes.find(name);if(it!=nativeTypes.end()){
    if(name=="Regex")result.headers.insert("runtime/ets_regex.hpp");else if(!in(name,{"JsonValue","Console"})){result.headers.insert("runtime/ets_runtime_full.hpp");result.libuv=true;}
    return it->second;
   }
  }
  return fail("Shape C++ sin representación: "+k);
 }
 S elementType(int id){return p.types.at(id)=="boolean"?"ets::ir::Boolean":type(id);}
 S interfaceVariant(int id){V<S> items;for(int t:shape(id).variants)items.push_back("ets::ir::Box<"+type(t)+">");return "std::variant<"+(items.empty()?S("std::monostate"):join(items))+">";}
 S literal(S text,int id){auto& s=shape(id);if(s.kind=="enum")return literal(text,s.arguments.at(0));const auto& name=p.types.at(id);
  if(name=="string")return "std::string("+quote(text)+","+std::to_string(text.size())+")";
  if(name=="boolean"){if(!in(text,{"true","false"}))return fail("Constante boolean inválida");return text;}
  text.erase(std::remove(text.begin(),text.end(),'_'),text.end());
  static const std::regex number("^-?(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|[0-9]+(\\.[0-9]+)?([eE][+-]?[0-9]+)?)$");if(!std::regex_match(text,number))return fail("Constante numérica inválida");
  if(name=="i64")return text=="-9223372036854775808"?"(-9223372036854775807LL-1LL)":text+"LL";
  if(name=="u64")return text+"ULL";
  if(s.numericKind=="float"){
   S raw=text;bool negative=raw.starts_with('-');S digits=negative?raw.substr(1):raw;
   if(digits.starts_with("0x")||digits.starts_with("0X")||digits.starts_with("0b")||digits.starts_with("0B")||digits.starts_with("0o")||digits.starts_with("0O")){int base=(digits[1]=='b'||digits[1]=='B')?2:(digits[1]=='o'||digits[1]=='O')?8:16;raw=(negative?"-":"")+std::to_string(std::stoull(digits.substr(2),nullptr,base));}
   if(raw.find_first_of(".eE")==S::npos)raw+=".0";return "static_cast<"+type(id)+">("+raw+")";
  }
  auto pos=text.starts_with('-')?1:0;if(text.substr(pos,2)=="0o"||text.substr(pos,2)=="0O")text.erase(pos+1,1);
  return "static_cast<"+type(id)+">("+text+")";
 }
 S convert(const S& value,int from,int to){if(from==to)return value;const auto& a=shape(from);const auto& b=shape(to);S T=type(to);
  if(in(a.kind,{"ref","constRef"})&&!in(b.kind,{"ref","constRef"}))return convert("(*("+value+"))",a.arguments.at(0),to);
  if(b.kind=="readonly")return convert(value,from,b.arguments.at(0));
  if(numeric(from)&&numeric(to))return "ets::ir::cast<"+T+">("+value+")";
  if(a.kind=="enum")return convert(value,a.arguments.at(0),to);if(b.kind=="enum")return convert(value,from,b.arguments.at(0));
  if(p.types.at(to)=="string")return (a.numericKind=="integer"?S("std::to_string("):S("ets::concat("))+value+")";
  if(b.kind=="Optional"&&a.kind!="Optional")return T+"::some("+convert(value,from,b.arguments.at(0))+")";
  if(in(a.kind,{"Optional","Result"})&&a.kind==b.kind){S read=shape(a.arguments.at(0)).resource?"std::move(input).value()":"input.value()";return "([&](){auto input="+value+";if(input."+(a.kind=="Optional"?"isPresent":"isOk")+"())return "+T+"::"+(a.kind=="Optional"?"some":"success")+"("+convert(read,a.arguments.at(0),b.arguments.at(0))+");return "+T+"::"+(a.kind=="Optional"?"none()":"failure(input.error())")+";}())";}
  if(in(a.kind,{"tuple","pack"})&&in(b.kind,{"tuple","pack"})){V<S> parts;for(int k=0;k<int(b.arguments.size());k++){S x="std::get<"+n(k)+">(input)";if(shape(a.arguments.at(k)).resource)x="std::move("+x+")";parts.push_back(convert(x,a.arguments.at(k),b.arguments[k]));}return "([&](){auto input="+value+";return "+T+"{"+join(parts)+"};}())";}
  if(sum(to)){auto ch=choices(to);int at=index(ch,from);if(at>=0)return T+"{std::variant<"+types(ch)+">{std::in_place_index<"+n(at)+">,"+value+"}}";}
  if(sum(from)&&has(choices(from),to))return "std::get<"+n(index(choices(from),to))+">("+value+".data)";
  if(interface(to)){
   if(sum(from)){S branches;for(int alt:choices(from))branches+=(branches.empty()?S{}:S("else "))+"if constexpr(std::is_same_v<std::remove_cvref_t<decltype(input)>,"+type(alt)+">)return "+convert("std::move(input)",alt,to)+";";return "([&](){auto source="+value+";return std::visit([&](auto&& input)->"+T+"{"+branches+"else std::abort();},source.data);}())";}
   if(interface(from))return "([&](){auto source="+value+";return std::visit([&](auto&& box)->"+T+"{using B=std::remove_cvref_t<decltype(box)>;if constexpr(std::is_same_v<B,std::monostate>)std::abort();else return "+T+"{"+interfaceVariant(to)+"{std::move(box)}};},source.data);}())";
   if(!has(b.variants,from))return fail("Implementación concreta ausente del contrato de interfaz");
   return T+"{"+interfaceVariant(to)+"{std::in_place_type<ets::ir::Box<"+type(from)+">>,"+value+"}}";
  }
  if(record(from)&&record(to)){S fields;for(int k=0;k<int(b.names.size());k++){int at=index(a.names,b.names[k]);if(at<0)return fail("Campo ausente en conversión: "+b.names[k]);fields+="out.f"+n(k)+".set("+convert(field("input",from,at)+"."+(shape(a.fields.at(at)).resource?"take":"get")+"()",a.fields.at(at),b.fields.at(k))+");";}return "([&](){auto input="+value+";"+T+" out;"+fields+"return out;}())";}
  if(a.kind=="function"&&b.kind=="function"){V<S> decl,args;for(int k=0;k<int(b.arguments.size())-1;k++)decl.push_back(type(b.arguments[k])+" x"+n(k));for(int k=0;k<int(a.arguments.size())-1;k++)args.push_back(convert("x"+n(k),b.arguments.at(k),a.arguments[k]));S call="fn("+join(args)+")";return "([fn="+value+"]("+join(decl)+")mutable->"+type(b.arguments.back())+"{"+(p.types.at(b.arguments.back())=="void"?call+";":"return "+convert(call,a.arguments.back(),b.arguments.back())+";")+"})";}
  if(in(a.kind,{"array","fixedArray"})&&in(b.kind,{"array","fixedArray"}))return "([&](){auto input="+value+";"+T+" out;"+(b.kind=="array"?"out.reserve(input.size());":"std::size_t k=0;")+"for(auto&& x:input){"+(b.kind=="array"?"out.push_back(":"out[k++]=(")+convert(shape(a.arguments.at(0)).resource?"std::move(x)":"x",a.arguments.at(0),b.arguments.at(0))+");}return out;}())";
  if(a.kind=="ref"&&b.kind=="constRef"&&a.arguments.at(0)==b.arguments.at(0))return value;
  return fail("Conversión C++ no soportada: "+p.types.at(from)+" -> "+p.types.at(to));
 }
 S field(const S& base,int id,int at){const auto& s=shape(id);
  if(interface(id)){S branches;for(int alt:s.variants){const auto& other=shape(alt);int k=index(other.names,s.names.at(at));if(k<0||other.fields.at(k)!=s.fields.at(at))return fail("Campo de interfaz incompatible");branches+=(branches.empty()?S{}:S("else "))+"if constexpr(std::is_same_v<B,ets::ir::Box<"+type(alt)+">>)return box.get().f"+n(k)+";";}S T="ets::ir::Slot<"+type(s.fields.at(at))+">";return "std::visit([](auto& box)->std::conditional_t<std::is_const_v<std::remove_reference_t<decltype(("+base+"))>>,const "+T+"&,"+T+"&>{using B=std::remove_cvref_t<decltype(box)>;"+branches+(branches.empty()?"":"else ")+"std::abort();},("+base+").data)";}
  if(!sum(id))return "("+base+").f"+n(at);
  S branches;for(int alt:choices(id)){const auto& other=shape(alt);int k=index(other.names,s.names.at(at));if(k<0||other.fields.at(k)!=s.fields.at(at))return fail("Campo común de unión sin representación uniforme");branches+=(branches.empty()?S{}:S("else "))+"if constexpr(std::is_same_v<std::remove_cvref_t<decltype(x)>,"+type(alt)+">)return (x.f"+n(k)+");";}
  return "std::visit([](auto& x)->decltype(auto){"+branches+"},("+base+").data)";
 }
 int constantIndex(const Function& f,int value)const{for(auto& b:f.blocks)for(auto& i:b.instructions)if(i.result==value&&i.op=="constant")return std::stoi(i.text);throw Error("Índice de tupla no constante",f.source);}
 S place(const Function& f,int id){const auto& p=f.places.at(id);if(p.global>=0)return "ir_g"+n(p.global);if(p.kind=="local")return "p"+n(id);if(p.kind=="capture")return "ets::ir::view("+S(f.captureModes.at(p.field)=="reference"?"*":"")+"c"+n(p.field)+")";
  const auto& parent=f.places.at(p.base);S raw=place(f,p.base)+".get()";
  if(p.kind=="field")return field(raw,parent.typeId,p.field);
  if(p.kind=="deref")return shape(parent.typeId).kind=="readonly"?"ets::ir::view("+raw+")":"ets::ir::view(*("+raw+"))";
  if(p.kind=="checkedView")return sum(parent.typeId)?"ets::ir::view(std::get<"+n(index(choices(parent.typeId),p.typeId))+">("+raw+".data))":place(f,p.base);
  if(p.kind=="index"){const auto& s=shape(parent.typeId);if(in(s.kind,{"tuple","pack"}))return "ets::ir::view(std::get<"+n(constantIndex(f,p.index))+">("+raw+"))";if(this->p.types.at(parent.typeId)=="string")return fail("Los índices de string requieren lectura",p.source);return "ets::ir::view(("+raw+").at(static_cast<std::size_t>(v"+n(p.index)+".get()))"+(s.kind=="array"&&this->p.types.at(s.arguments.at(0))=="boolean"?".value":"")+")"; }
  return fail("Place C++ desconocido: "+p.kind,p.source);
 }
 S operand(const Function& f,const Instruction& i,int k,bool consume=true){int value=i.operands.at(k);return "v"+n(value)+"."+(consume&&shape(f.values.at(value)).resource?"take":"get")+"()";}
 S callback(const Function& f,const Instruction& i,int k){int id=f.values.at(i.operands.at(k));const auto& s=shape(id);V<S> decl,args;for(int at=0;at<int(s.arguments.size())-1;at++){decl.push_back("auto&& x"+n(at));args.push_back(in(shape(s.arguments[at]).kind,{"ref","constRef"})?"std::addressof(ets::ir::read(x"+n(at)+"))":"x"+n(at));}return "[&]("+join(decl)+")->"+type(s.arguments.back())+"{"+(p.types.at(s.arguments.back())=="void"?S{}:S("return "))+operand(f,i,k,false)+"("+join(args)+");}";}
 S runtimeCall(const Function&,const Instruction&);
 S instruction(const Function&,const Instruction&,int);
 S signature(const Function&,int);
 S body(const Function&,int);
 S declarations();
 bool printable(int id,V<int> history={})const{if(has(history,id))return false;const auto& s=shape(id);if(in(s.kind,{"scalar","enum","variant","ptr","constPtr"}))return true;if(in(s.kind,{"ref","constRef","readonly"})){history.push_back(id);return printable(s.arguments.at(0),history);}if(sum(id)){history.push_back(id);for(int t:choices(id))if(!printable(t,history))return false;return true;}return false;}
 S output(const S& value,int id){const auto& s=shape(id);if(in(s.kind,{"ref","constRef"}))return output("(*("+value+"))",s.arguments.at(0));if(!printable(id))return fail("Tipo sin contrato de impresión C++: "+p.types.at(id));if(in(s.kind,{"ptr","constPtr"}))return "("+value+").get()";return s.numericKind=="integer"&&s.bits==8?"static_cast<int>("+value+")":value;}
 const Instruction& definition(const Function& f,int value)const{for(auto& b:f.blocks)for(auto& i:b.instructions)if(i.result==value)return i;throw Error("Temporal sin definición",f.source);}
 void validate();Result generate();
};
S Generator::instruction(const Function& f,const Instruction& i,int block){
 auto a=[&](int k,bool consume=true){return operand(f,i,k,consume);};S T=i.typeId>=0?type(i.typeId):"void",v;const auto& op=i.op;
 if(op=="constant")v=literal(i.text,i.typeId);
 else if(op=="load"){const auto& p=f.places.at(i.place);v=p.kind=="index"&&this->p.types.at(f.places.at(p.base).typeId)=="string"?"ets::string_charAt("+place(f,p.base)+".get(),v"+n(p.index)+".get())":place(f,i.place)+".get()";}
 else if(op=="move")v=place(f,i.place)+".take()";
 else if(op=="borrow"||op=="address")v="std::addressof("+place(f,i.place)+".get())";
 else if(op=="store")return place(f,i.place)+".set("+a(0)+");";
 else if(op=="dropRemaining")return place(f,i.place)+".drop();";
 else if(op=="dropValue")return "v"+n(i.operands.at(0))+".drop();";
 else if(op=="endBorrow")return "// end statically verified lease "+n(i.lease);
 else if(op=="dropFrame"){S out;for(int x:f.frameValues)out+="v"+n(x)+".drop();\n";for(int x:f.framePlaces)if(f.places.at(x).kind=="local")out+="p"+n(x)+".drop();\n";return out;}
 else if(op=="own")v="std::make_unique<"+type(shape(i.typeId).arguments.at(0))+">("+a(0)+")";
 else if(op=="convert")v=convert(a(0),f.values.at(i.operands.at(0)),i.typeId);
 else if(op=="unary"){const auto& s=shape(i.typeId);v=i.text=="-"&&s.numericKind=="integer"?"ets::ir::sub<"+T+">(0,"+a(0)+")":i.text=="~"?"static_cast<"+T+">(~static_cast<"+(s.numericKind=="float"?"std::int64_t":T)+">("+a(0)+"))":"("+i.text+a(0)+")";}
 else if(op=="binary"){static const std::map<S,S> helpers{{"+","add"},{"-","sub"},{"*","mul"},{"/","divide"},{"%","remainder"},{"<<","shiftLeft"},{">>","shiftRight"}};if(helpers.contains(i.text)&&numeric(i.typeId))v="ets::ir::"+helpers.at(i.text)+"<"+T+">("+a(0)+","+a(1)+")";else if(in(i.text,{"&","|","^"}))v="static_cast<"+T+">(static_cast<std::int64_t>("+a(0)+")"+i.text+"static_cast<std::int64_t>("+a(1)+"))";else v="("+a(0)+" "+i.text+" "+a(1)+")";}
 else if(op=="aggregate"){
  const auto& s=shape(i.typeId);V<S> pieces;
  if(in(s.kind,{"tuple","pack"})){for(int k=0;k<int(i.operands.size());k++)pieces.push_back(i.names.at(k)=="spread"?a(k):"std::make_tuple("+a(k)+")");v="std::tuple_cat("+join(pieces)+")";}
  else if(s.kind=="fixedArray"){S setup;for(int k=0;k<int(i.operands.size());k++){if(i.names.at(k)!="spread"){pieces.push_back(a(k));continue;}const auto& input=shape(f.values.at(i.operands[k]));int count=input.kind=="fixedArray"?input.length:in(input.kind,{"tuple","pack"})?int(input.arguments.size()):-1;if(count<0)return fail("Spread de longitud desconocida en array fijo",i.source);setup+="auto part"+n(k)+"="+a(k)+";";for(int x=0;x<count;x++)pieces.push_back("std::move("+(in(input.kind,{"tuple","pack"})?"std::get<"+n(x)+">(part"+n(k)+")":"part"+n(k)+"["+n(x)+"]")+")");}v="([&](){"+setup+"return "+T+"{"+join(pieces)+"};}())";}
  else{S body;for(int k=0;k<int(i.operands.size());k++)body+=i.names.at(k)=="spread"?"auto part"+n(k)+"="+a(k)+";for(auto& x:part"+n(k)+"){out.push_back(std::move(x));}":"out.push_back("+a(k)+");";v="([&](){"+T+" out;"+body+"return out;}())";}
 }
 else if(op=="emptyRecord"||op=="collection")v=T+"{}";
 else if(op=="record"||op=="variant"){
  const auto& s=shape(i.typeId);S fields;for(int k=0;k<int(i.names.size());k++)fields+="out.f"+n(index(s.names,i.names[k]))+".set("+a(k)+");";
  if(op=="variant"){int k=index(s.names,S("kind"));if(k>=0&&!has(i.names,S("kind")))fields+="out.f"+n(k)+".set("+literal(s.tag,s.fields.at(k))+");";k=index(s.names,s.discriminator);if(k>=0&&!has(i.names,s.discriminator))fields+="out.f"+n(k)+".set("+literal(s.discriminatorValue,s.discriminatorType)+");";}
  for(int k=0;k<int(s.fields.size());k++)if(!has(i.names,s.names[k])&&shape(s.fields[k]).kind=="Optional")fields+="out.f"+n(k)+".set("+type(s.fields[k])+"::none());";
  v="([&](){"+T+" out;"+fields+"return out;}())";
 }
 else if(op=="none")v=T+"::none()";
 else if(op=="some")v=T+"::some("+a(0)+")";
 else if(op=="result")v=T+"::"+(i.text=="Err"?"failure":"success")+"("+a(0)+")";
 else if(op=="isPresent")v=deref(a(0),f.values.at(i.operands.at(0)))+".isPresent()";
 else if(op=="unwrap")v="("+deref(a(0),f.values.at(i.operands.at(0)))+").value()";
 else if(op=="property"){int id=inner(f.values.at(i.operands.at(0)));S input=deref(a(0,false),f.values.at(i.operands.at(0)));const auto& s=shape(id);if(in(i.text,{"length","size"}))v=in(s.kind,{"tuple","pack"})?"double("+n(s.arguments.size())+")":"double(("+input+").size())";else if(i.text=="ok")v="("+input+").isOk()";else if(i.text=="kind")v=s.kind=="Optional"?"std::string(("+input+").isPresent()?\"Some\":\"None\")":"std::string(("+input+").isOk()?\"Ok\":\"Err\")";}
 else if(op=="extractIndex")v=in(shape(f.values.at(i.operands.at(0))).kind,{"tuple","pack"})?"std::get<"+n(constantIndex(f,i.operands.at(1)))+">("+a(0)+")":"("+a(0)+").at(static_cast<std::size_t>("+a(1)+"))";
 else if(op=="typeTag"){int id=inner(i.signature);S name=p.types.at(id);v=literal(numeric(id)?"number":in(name,{"string","boolean"})?name:name=="void"?"undefined":"object",i.typeId);}
 else if(op=="typeTest"){int id=inner(f.values.at(i.operands.at(0)));v=sum(id)?"("+deref(a(0,false),f.values.at(i.operands.at(0)))+".data.index()=="+n(index(choices(id),i.signature))+")":id==i.signature?"true":"false";}
 else if(op=="closure"){const auto& target=p.functions.at(i.callee);V<S> args,captures,params;for(int k=0;k<int(target.parameterTypes.size());k++){args.push_back(type(target.parameterTypes[k])+" x"+n(k));params.push_back("std::move(x"+n(k)+")");}for(int k=0;k<int(i.operands.size());k++)captures.push_back("c"+n(k)+"="+a(k));V<S> call;for(int k=0;k<int(target.captureTypes.size());k++)call.push_back("c"+n(k));call.insert(call.end(),params.begin(),params.end());v="["+join(captures)+"]("+join(args)+")mutable->"+type(target.returns)+"{"+(p.types.at(target.returns)=="void"?S{}:S("return "))+"ir_f"+n(i.callee)+"("+join(call)+");}";}
 else if(op=="call"||op=="taskCreate"){V<S> args;for(int k=0;k<int(i.operands.size());k++)args.push_back(a(k));v="ir_f"+n(i.callee)+"("+join(args)+")";}
 else if(op=="callIndirect"){V<S> args;for(int k=1;k<int(i.operands.size());k++)args.push_back(a(k));v=a(0)+"("+join(args)+")";}
 else if(op=="interfaceCall"){
  int receiver=inner(f.values.at(i.operands.at(0)));S branches;for(int concrete:shape(receiver).variants){const Dispatch* found=nullptr;for(auto& d:p.dispatches)if(d.interfaceType==receiver&&d.concreteType==concrete&&d.name==i.text&&d.signature==i.signature){found=&d;break;}if(!found)return fail("Dispatch de interfaz incompleto",i.source);const auto& target=p.functions.at(found->callee);V<S> args{"std::addressof(box.get())"};for(int k=1;k<int(i.operands.size());k++)args.push_back(convert(a(k),f.values.at(i.operands[k]),target.parameterTypes.at(k)));S call="ir_f"+n(found->callee)+"("+join(args)+")";branches+=(branches.empty()?S{}:S("else "))+"if constexpr(std::is_same_v<B,ets::ir::Box<"+type(concrete)+">>){"+(p.types.at(i.typeId)=="void"?call+";return;":"return "+convert(call,target.returns,i.typeId)+";")+"}";}
  v="std::visit([&](auto& box)->"+T+"{using B=std::remove_cvref_t<decltype(box)>;"+branches+(branches.empty()?"":"else ")+"std::abort();},("+deref(a(0,false),f.values.at(i.operands.at(0)))+").data)";
 }
 else if(op=="runtimeCall")v=runtimeCall(f,i);
 else if(op=="intrinsic"){
  bool pack=false;for(int x:i.operands)if(shape(inner(f.values.at(x))).kind=="pack")pack=true;
  V<S> args;for(int k=0;k<int(i.operands.size());k++){int id=inner(f.values.at(i.operands[k]));const auto& s=shape(id);if(pack){V<S> values;if(s.kind=="pack"){S input=deref(a(k,false),f.values.at(i.operands[k]));for(int x=0;x<int(s.arguments.size());x++)values.push_back(output("std::get<"+n(x)+">("+input+")",s.arguments[x]));}else values.push_back(output(a(k,false),f.values.at(i.operands[k])));args.push_back("std::make_tuple("+join(values)+")");}else args.push_back(output(a(k,false),f.values.at(i.operands[k])));}
  v=pack?"std::apply([&](const auto&...xs){"+i.text+"(xs...);},std::tuple_cat("+join(args)+"))":i.text+"("+join(args)+")";
 }
 else if(op=="resume"){if(p.types.at(i.typeId)=="void")return "// resumed void task";v="await"+n(i.continuation)+".take()";}
 else if(op=="iterator")v="std::size_t{0}";
 else if(op=="iterHasNext"||op=="iterNext"){
  int cursor=i.operands.at(0);const auto& def=definition(f,cursor);const auto& p=f.places.at(def.place);S base=deref(place(f,def.place)+".get()",p.typeId);const auto& s=shape(inner(p.typeId));S position="v"+n(cursor)+".get()++";
  if(op=="iterHasNext")v="v"+n(cursor)+".get()<("+base+").size()";
  else if(in(s.kind,{"Map","Set"})){bool map=s.kind=="Map";v="([&](){auto it=("+base+").data().begin();std::advance(it,"+position+");return "+(def.text=="keys"?(map?"it->first":"*it"):map?"std::make_tuple(it->first,it->second)":"*it")+";}())";}
  else if(def.text=="keys")v="static_cast<"+T+">("+position+")";
  else if(this->p.types.at(inner(p.typeId))=="string")v="std::string(1,("+base+").at("+position+"))";
  else{S element="("+base+").at("+position+")";v=in(shape(i.typeId).kind,{"ref","constRef"})?"std::addressof(ets::ir::read("+element+"))":shape(i.typeId).resource?"std::move("+element+")":element;}
 }
 if(v.empty())return fail("Capacidad C++ no soportada: "+op,i.source);
 return i.result>=0?"v"+n(i.result)+".set("+v+");":v+";";
}
S Generator::signature(const Function& f,int id){S ret=f.asynchronous&&shape(f.returns).kind!="Promise"?"ets::Task<"+type(f.bodyReturns)+">":type(f.returns);if(f.asynchronous){result.headers.insert("runtime/ets_async.hpp");result.libuv=true;}V<S> args;for(int k=0;k<int(f.captureTypes.size());k++)args.push_back(type(f.captureTypes[k])+(f.captureModes.at(k)=="reference"?"*":"")+" c"+n(k));for(int k=0;k<int(f.parameterTypes.size());k++)args.push_back(type(f.parameterTypes[k])+" a"+n(k));return ret+" ir_f"+n(id)+"("+join(args)+")";}
S Generator::body(const Function& f,int id){V<S> out;int parameter=0;
 for(int k=0;k<int(f.places.size());k++){auto& p=f.places[k];if(p.kind=="local"&&p.global<0)out.push_back("ets::ir::Slot<"+type(p.typeId)+"> p"+n(k)+";");}
 for(int k=0;k<int(f.values.size());k++)out.push_back("ets::ir::Slot<"+type(f.values[k])+"> v"+n(k)+";");
 for(int k=0;k<int(f.blocks.size());k++){auto& b=f.blocks[k];if(b.terminator=="suspend"){int t=shape(f.values.at(b.value)).arguments.at(0);if(p.types.at(t)!="void")out.push_back("ets::ir::Slot<"+type(t)+"> await"+n(k)+";");}}
 for(int k=0;k<int(f.places.size());k++)if(f.places[k].parameter)out.push_back("p"+n(k)+".set(std::move(a"+n(parameter++)+"));");out.push_back("goto b0;");
 for(int k=0;k<int(f.blocks.size());k++){const auto& b=f.blocks[k];out.push_back("b"+n(k)+":");for(auto& i:b.instructions)out.push_back(instruction(f,i,k));S ret=f.asynchronous?"co_return":"return";
  if(b.terminator=="jump")out.push_back("goto b"+n(b.targets.at(0))+";");
  else if(b.terminator=="branch")out.push_back("if(v"+n(b.value)+".get())goto b"+n(b.targets.at(0))+";else goto b"+n(b.targets.at(1))+";");
  else if(b.terminator=="return")out.push_back(ret+(b.value<0?S{}:" v"+n(b.value)+"."+(shape(f.values.at(b.value)).resource?"take":"get")+"()")+";");
  else if(b.terminator=="suspend"){int t=shape(f.values.at(b.value)).arguments.at(0);out.push_back(p.types.at(t)=="void"?"co_await v"+n(b.value)+".take();":"await"+n(k)+".set(co_await v"+n(b.value)+".take());");out.push_back("goto b"+n(b.targets.at(0))+";");}
  else if(b.terminator=="cancel")out.push_back(p.types.at(f.bodyReturns)=="void"?ret+";":"std::abort();");
  else if(in(b.terminator,{"trap","unreachable"}))out.push_back("std::abort();");else return fail("Terminador sin soporte: "+b.terminator,b.source);
 }
 return signature(f,id)+" {\n"+join(out,"\n")+"\n}";
}
S Generator::declarations(){std::set<int> done,active;V<S> out;std::function<void(int)> emit,dependency;
 dependency=[&](int id){const auto& s=shape(id);if(in(s.kind,{"ptr","constPtr","ref","constRef","function"}))return;if(record(id)||sum(id))emit(id);else for(int x:s.arguments)dependency(x);};
 emit=[&](int id){if(done.contains(id))return;if(active.contains(id))throw Error("Ciclo de layout por valor en tipos IR");active.insert(id);const auto& s=shape(id);S fields;
  if(interface(id))fields=interfaceVariant(id)+" data;";
  else if(record(id)){for(int x:s.fields)dependency(x);for(int k=0;k<int(s.fields.size());k++)fields+="ets::ir::Slot<"+type(s.fields[k])+"> f"+n(k)+";";}
  else{auto c=choices(id);for(int x:c)dependency(x);fields="std::variant<"+types(c)+"> data;";}
  out.push_back("struct ir_t"+n(id)+"{"+fields+"bool operator==(const ir_t"+n(id)+"&)const=default;};");active.erase(id);done.insert(id);
 };
 for(int id=0;id<int(p.shapes.size());id++)if(record(id)||sum(id))emit(id);return join(out,"\n");
}
S Generator::runtimeCall(const Function& f,const Instruction& i){const auto& c=p.contracts.at(i.contract);if(c.capability.empty()||c.effects.empty())return fail("Contrato runtime ausente",i.source);
 auto a=[&](int k,bool consume=true){return operand(f,i,k,consume);};auto args=[&](int start=0){V<S> out;for(int k=start;k<int(i.operands.size());k++){S value=a(k);if(in(shape(f.values.at(i.operands[k])).kind,{"ref","constRef"}))value="(*("+value+"))";out.push_back(value);}return join(out);};S T=type(i.typeId);
 if(c.name.starts_with("builtin.")){
  S name=c.name.substr(8);result.libuv=result.libuv||backend_libuv.contains(name);result.tls=result.tls||backend_tls.contains(name);result.curl=result.curl||backend_curl.contains(name);result.ioUring=result.ioUring||backend_ioUring.contains(name);
  for(auto* table:{&fileCalls,&netCalls,&networkCalls})if(table->contains(name)){result.headers.insert("runtime/ets_runtime_full.hpp");result.libuv=true;if(result.tls)result.headers.insert("runtime/ets_tls.hpp");return table->at(name)+"("+args()+")";}
  if(regexCalls.contains(name)){result.headers.insert("runtime/ets_regex.hpp");return regexCalls.at(name)+"("+args()+")";}
  if(asyncRuntimeCalls.contains(name)){result.headers.insert(name=="resolveDns"?"runtime/ets_dns.hpp":"runtime/ets_async.hpp");result.libuv=true;return asyncRuntimeCalls.at(name)+"("+args()+")";}
  if(in(name,{"setTimeout","setInterval","cancelTimer"})){result.headers.insert("runtime/ets_timer.hpp");result.libuv=true;return "ets::"+name+"("+args()+")";}
  if(in(name,{"optionalMap","optionalAndThen"}))return name+"("+a(0)+","+callback(f,i,1)+")";
  if(name=="stopLoop"){result.headers.insert("runtime/ets_async.hpp");result.libuv=true;return "ets::defaultEventLoop.stop()";}
  if(name=="length")return "ets::length("+a(0)+")";
  if(name=="optionalSome")return T+"::some("+a(0)+")";
  if(name=="optionalNone")return T+"::none()";
  if(in(name,{"ok","resultOk","err","resultErr"}))return T+"::"+(in(name,{"err","resultErr"})?"failure":"success")+"("+a(0)+")";
  if(name=="optionalIsPresent")return "("+a(0)+").isPresent()";
  if(name=="optionalValueOr")return "("+a(0)+").valueOr("+a(1)+")";
  if(name=="booleanToString")return "std::string("+a(0)+"?\"true\":\"false\")";
  if(name=="optionalOrElse")return "("+a(0)+").orElse("+a(1)+")";
  if(name=="resultIsOk")return "("+a(0)+").isOk()";
  if(globalCalls.contains(name)){if(name.find("File")!=S::npos||name=="fileExists"){result.headers.insert("runtime/ets_file.hpp");result.libuv=true;}return name+"("+args()+")";}
  if(asyncCalls.contains(name)){result.headers.insert("runtime/ets_async.hpp");result.libuv=true;if(in(name,{"all","promiseAll","race","promiseRace"})){bool race=in(name,{"race","promiseRace"});if(shape(i.typeId).kind=="Promise")return S("ets::")+(race?"task_race":"task_all")+"("+args()+")";return race?"([&](){auto tasks="+a(0)+";return ets::race(tasks);}())":"ets::all("+args()+")";}return "ets::"+name+"("+args()+")";}
  return fail("Capacidad runtime no implementada: "+c.capability,i.source);
 }
 auto dot=c.name.rfind('.');S base=c.name.substr(0,dot),method=c.name.substr(dot+1);
 if(base=="!http"){
  if(in(method,{"createServer","express","server"})){httpServer();return "ets::Server{}";}
  if(in(method,{"param","query","header"})){httpServer();return "ets::http_"+method+"(*("+a(0,false)+"),"+a(1)+")";}
  if(in(method,{"get","post"})){result.headers.insert("runtime/ets_http_curl_async.hpp");result.libuv=result.curl=true;S values=args();if(method=="post"&&i.operands.size()==2)values+=",std::string(\"text/plain\")";return S("ets::httpClient")+(method=="get"?"Get":"Post")+"Async("+values+")";}
 }
 if(base=="Request.property"&&in(method,{"method","path","rawQuery","body"})){httpServer();return "("+a(0,false)+")->"+method;}
 if(base=="Server"){httpServer();S receiver=deref(a(0,false),f.values.at(i.operands.at(0)));if(in(method,{"get","post","put","patch","delete"}))return "("+receiver+")."+(method=="delete"?"del":method)+"("+a(1)+",[handler="+a(2)+"](const ets::HttpRequest& request,ets::HttpResponse& response)mutable{handler(std::addressof(request),std::addressof(response));})";if(method=="listen")return "("+receiver+").listen("+args(1)+")";}
 if(base=="Response"&&in(method,{"status","header","send","json"})){httpServer();return "std::addressof(("+a(0,false)+")->"+method+"("+args(1)+"))";}
 if(base=="HttpClientResponse"&&in(method,{"status","body","header"}))return "("+deref(a(0,false),f.values.at(i.operands.at(0)))+")."+(method=="status"?"status_code":method=="body"?"body_str":method)+"("+args(1)+")";
 if(base=="Console"&&terminalMethods.contains(method)){result.headers.insert("runtime/ets_terminal.hpp");return "console."+method+"("+args()+")";}
 if(objectMethods.contains(base)&&objectMethods.at(base).contains(method)){
  if(in(base,{"!fs","!path","!process"})){result.headers.insert("runtime/ets_runtime_full.hpp");result.libuv=true;}S arguments=args();if(base=="Console"){V<S> values;for(int k=0;k<int(i.operands.size());k++)values.push_back(output(a(k,false),f.values.at(i.operands[k])));arguments=join(values);}
  return (base=="Console"?S("console"):base.substr(1))+"."+(method.starts_with("stringify")?"stringify":method)+"("+arguments+")";
 }
 if(base=="string"&&stringMethods.contains(method))return "ets::string_"+method+"("+args()+")";
 if(i.operands.empty())return fail("Capacidad runtime no implementada: "+c.capability,i.source);
 int actual=f.values.at(i.operands.at(0));const auto& s=shape(inner(actual));S receiver=deref(a(0,false),actual);
 if(in(base,{"Optional","Result"})){if(in(method,{"isPresent","isEmpty","isOk","value","error","valueOr","orElse"}))return "("+deref(a(0,shape(actual).resource),actual)+")."+method+"("+args(1)+")";if(in(method,{"map","andThen"}))return "("+receiver+")."+method+"("+callback(f,i,1)+")";}
 if(in(base,{"Map","Set"})){if(in(method,{"set","add","has","clear","size","delete"}))return "("+receiver+")."+(method=="delete"?"removeKey":method)+"("+args(1)+")";if(method=="get")return T+"::of(("+receiver+").get("+a(1)+"))";if(method=="forEach")return "("+receiver+").forEach("+callback(f,i,1)+")";}
 if(base=="array"){
  result.headers.insert("runtime/ets_collections.hpp");S E=elementType(s.arguments.at(0));auto cb=[&](){return callback(f,i,i.operands.size()-1);};
  if(method=="push")return "ets_push_vec<"+E+">("+receiver+","+a(1)+")";
  if(method=="pop")return "ets_pop_vec<"+E+">("+receiver+")";
  if(method=="delete")return "("+receiver+").erase(("+receiver+").begin()+static_cast<std::ptrdiff_t>("+a(1)+"))";
  if(in(method,{"map","flatMap"}))return S(method=="map"?"ets_map_vec<":"ets_flat_map_vec<")+E+","+elementType(shape(i.typeId).arguments.at(0))+">("+receiver+","+cb()+")";
  if(in(method,{"filter","some","every","find"}))return "ets_"+method+"_vec<"+E+">("+receiver+","+cb()+")";
  if(method=="forEach")return "ets_for_each_vec("+receiver+","+cb()+")";
  if(method=="reduce")return "ets_reduce("+a(1)+","+receiver+","+cb()+")";
  if(method=="slice")return "ets_slice_vec("+receiver+","+a(1)+","+(i.operands.size()>2?a(2):"static_cast<int>(("+receiver+").size())")+")";
  if(method=="includes")return "ets_includes_vec("+receiver+","+a(1)+")";
  if(method=="join")return "ets_join_vec("+receiver+","+a(1)+")";
  if(method=="concat"){V<S> values;for(int k=0;k<int(i.operands.size());k++)values.push_back(deref(a(k),f.values.at(i.operands[k])));return "ets_concat_vec<"+E+">({"+join(values)+"})";}
  if(method=="sort")return i.operands.size()==1?"([&](){std::sort(("+receiver+").begin(),("+receiver+").end());return "+(shape(i.typeId).resource?"std::move("+receiver+")":receiver)+";}())":"ets_sort_vec("+receiver+","+cb()+")";
 }
 return fail("Capacidad runtime no implementada: "+c.capability,i.source);
}
void Generator::validate(){
 if(p.types.size()!=p.shapes.size())throw Error("Tablas de tipos incompletas");auto valid=[&](int t){return t>=0&&t<int(p.types.size());};
 for(int id=0;id<int(p.shapes.size());id++){auto& s=shape(id);if(s.names.size()!=s.fields.size()||s.methods.size()!=s.methodTypes.size())throw Error("Tabla de campos/métodos incompatible");for(auto& list:{s.arguments,s.fields,s.variants,s.methodTypes})for(int t:list)if(!valid(t))throw Error("Referencia de tipo inexistente");for(int t:s.methodTypes)if(shape(t).kind!="function")throw Error("Tabla de métodos incompatible");if(s.kind=="scalar"&&!in(p.types[id],{"number","string","boolean","void","i8","u8","i16","u16","i32","u32","i64","u64","f32","f64"}))throw Error("Tipo escalar inválido");}
 std::set<S> dispatchKeys;for(auto& d:p.dispatches){S key=n(d.interfaceType)+":"+n(d.concreteType)+":"+d.name+":"+n(d.signature);if(!valid(d.interfaceType)||!valid(d.concreteType)||!valid(d.signature)||d.callee<0||d.callee>=int(p.functions.size())||!interface(d.interfaceType)||!has(shape(d.interfaceType).variants,d.concreteType)||shape(d.signature).kind!="function"||dispatchKeys.contains(key))throw Error("Contrato de dispatch de interfaz inválido");const auto& target=p.functions[d.callee];if(target.parameterTypes.size()!=shape(d.signature).arguments.size()||target.parameterTypes.empty()||shape(target.parameterTypes[0]).kind!="ref"||shape(target.parameterTypes[0]).arguments.at(0)!=d.concreteType)throw Error("Contrato de dispatch de interfaz inválido");dispatchKeys.insert(key);}
 for(auto& name:p.annotations)if(in(name,{"cpp_name","cpp_type","include","link","cpp_header","cpp_include","cpp_link"}))throw Error("ABI externo no implementado: @"+name);
 for(auto& f:p.functions){V<int> ids=f.parameterTypes;ids.insert(ids.end(),f.values.begin(),f.values.end());ids.push_back(f.returns);ids.push_back(f.bodyReturns);for(auto& place:f.places)ids.push_back(place.typeId);for(int id:ids){if(!valid(id))throw Error("Tipo de función/place/valor inexistente",f.source);if(shape(id).kind=="parameter")throw Error("Parámetro genérico sin especializar",f.source);}
  for(auto& b:f.blocks){for(int target:b.targets)if(target<0||target>=int(f.blocks.size()))throw Error("Destino de bloque inexistente",b.source);for(auto& i:b.instructions){for(int v:i.operands)if(v<0||v>=int(f.values.size()))throw Error("Operando inexistente",i.source);if(in(i.op,{"call","taskCreate","closure"})&&(i.callee<0||i.callee>=int(p.functions.size())))throw Error("Callee inexistente",i.source);if(i.op=="binary"&&!in(i.text,{"+","-","*","/","%","&","|","^","<<",">>","==","!=","<",">","<=",">="}))throw Error("Operador binario inválido",i.source);if(i.op=="unary"&&!in(i.text,{"+","-","!","~"}))throw Error("Operador unario inválido",i.source);if(i.op=="intrinsic"&&!in(i.text,{"print","write","printError","writeError"}))throw Error("Intrínseco inválido",i.source);if(i.op=="backendEscape")throw Error("Capacidad C++ no soportada: backendEscape",i.source);}}
 }
}
Result Generator::generate(){validate();S defs=declarations();V<S> prototypes,bodies,globals,forwards,printers,printerPrototypes;
 for(int k=0;k<int(p.functions.size());k++)prototypes.push_back(signature(p.functions[k],k)+";");for(int k=0;k<int(p.functions.size());k++)bodies.push_back(body(p.functions[k],k));
 for(int k=0;k<int(p.globals.size());k++)globals.push_back("ets::ir::Slot<"+type(p.globals[k].typeId)+"> ir_g"+n(k)+";");
 S main="int main(int argc,char** argv){ets_argc=argc;ets_argv=argv;";auto run=[&](int id){return p.functions.at(id).asynchronous?"ets::syncWait(ir_f"+n(id)+"());":"ir_f"+n(id)+"();";};for(int id:p.initialization)main+=run(id);if(result.libuv)main+="ets::defaultEventLoop.drainDetached();";for(auto& c:p.contracts)if(in(c.name,{"builtin.watchFs","builtin.setInterval"})){main+="ets::defaultEventLoop.run();";break;}for(int id:p.finalization)main+=run(id);main+="return 0;}";
 for(int k=0;k<int(p.shapes.size());k++){if(record(k)||sum(k))forwards.push_back("struct ir_t"+n(k)+";");if(shape(k).kind=="variant"||sum(k)){printerPrototypes.push_back("inline std::ostream& operator<<(std::ostream& out,const ir_t"+n(k)+"& value);");printers.push_back("inline std::ostream& operator<<(std::ostream& out,const ir_t"+n(k)+"& value){"+(shape(k).kind=="variant"?"return out<<"+quote(shape(k).tag)+";":"std::visit([&](const auto& x){if constexpr(requires{out<<x;})out<<x;else std::abort();},value.data);return out;")+"}");}}
 V<S> out{"// Generated natively from verified ets-ir-2.","#include <array>\n#include <tuple>\n#include <functional>\n#include <iterator>\n#include <variant>","#include \"runtime/ets_runtime.hpp\""};for(auto& h:result.headers)if(h!="runtime/ets_runtime.hpp")out.push_back("#include "+quote(h));for(auto* v:{&forwards,&printerPrototypes})out.insert(out.end(),v->begin(),v->end());out.push_back(defs);for(auto* v:{&printers,&globals,&prototypes,&bodies})out.insert(out.end(),v->begin(),v->end());out.push_back(main);out.push_back("");result.cpp=join(out,"\n");std::set<S> capabilities;for(auto& c:p.contracts)capabilities.insert(c.capability);result.capabilities.assign(capabilities.begin(),capabilities.end());return result;
}
Result generateNativeCpp(const J& project){return Generator(project).generate();}
}
