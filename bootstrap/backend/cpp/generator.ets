import {IrProject,IrType,IrFunction,IrInstruction,IrSource,IrDispatch,IrAnnotation,IrPlace,IrBlock,IrRuntimeContract} from "../../ir/model";
import {cppType,fileCallee,regexCallee,netCallee,asyncCallee,networkCallee,globalCalls,asyncCalls,stringMethods,terminalMethods,objectMethod,backend_libuv,backend_curl,backend_tls,backend_ioUring} from "./tables";
import {quoteCpp,integerIndex,uniqueStrings,parseNumber,numericBase,validNumber,validCppSymbol,validHeader,binaryHelper,arrayIndex} from "./support";
export class RuntimeBackends {
 libuv:boolean;curl:boolean;tls:boolean;ioUring:boolean;
 constructor(){this.libuv=false;this.curl=false;this.tls=false;this.ioUring=false;}
}
export class IrCppResult {
 cpp:string;headers:string[];runtimeBackends:RuntimeBackends;capabilities:string[];
 constructor(cpp:string,headers:string[],backends:RuntimeBackends,capabilities:string[]){
 this.cpp=cpp;this.headers=headers;this.runtimeBackends=backends;this.capabilities=capabilities;}
}
export class HeaderSet {
 values:string[];
 constructor(){this.values=["runtime/ets_runtime.hpp","runtime/ets_ir.hpp"];}
 add(value:string):void{if(!this.values.includes(value))this.values.push(value);}
}
const recordKinds:string[]=["record","interface","intersection","variant"];
const sumKinds:string[]=["sum","union"];
const ops:string[]=["constant","load","store","address","move","borrow","dropRemaining","aggregate","record","property","extractIndex","emptyRecord","collection","isPresent","unwrap","typeTag","typeTest","iterator","iterHasNext","iterNext","some","result","variant","convert","unary","binary","dropFrame","resume","endBorrow","own","dropValue","none","closure","callIndirect","call","taskCreate","runtimeCall","interfaceCall","intrinsic","backendEscape"];

/** A pure consumer of verified ets-ir-2. It never consults or reconstructs ASTs. */
export class IrCppGenerator {
  headers:HeaderSet;
  backends:RuntimeBackends;
  project:IrProject;
  consuming:number[];cppGenerators:number[];layoutDone:number[];layoutActive:number[];layoutOutput:string[];
  constructor(project: IrProject) { this.project=project;this.headers=new HeaderSet();this.backends=new RuntimeBackends();this.consuming=[];this.cppGenerators=[];this.layoutDone=[];this.layoutActive=[];this.layoutOutput=[]; }
  fail(message:string,source:IrSource=new IrSource("","","",-1,0,0)):string{printError("IR_CPP_UNSUPPORTED: "+source.file+":"+numberToString(source.start)+": "+message);exitProcess(1);return "";}
  shape(id:number):IrType{if(id<0||id>=this.project.typeDefinitions.length)this.fail("Tipo IR inexistente: "+numberToString(id));return this.project.typeDefinitions[id];}
  cppTypeId(id: number): string {
    const s=this.shape(id);const  a=s.arguments;
    if(recordKinds.includes(s.kind)||sumKinds.includes(s.kind))return `ir_t${id}`;
    switch(s.kind) {
      case "scalar": return cppType(this.project.types[id]);
      // Un literal de tipo se materializa como su primitivo: en C++ el valor
      // concreto ya lo garantiza el checker.
      case "literal": return this.cppTypeId(s.discriminatorType);
      case "enum": return this.cppTypeId(a[0]);
      case "ptr": case "constPtr": return `std::unique_ptr<${s.kind=="constPtr"?"const ":""}${this.cppTypeId(a[0])}>`;
      case "ref": case "constRef": return `${s.kind=="constRef"?"const ":""}${this.cppTypeId(a[0])}*`;
      case "readonly": return this.cppTypeId(a[0]);
      case "array": return `std::vector<${this.elementType(a[0])}>`;
      case "fixedArray": return `std::array<${this.cppTypeId(a[0])},${s.length}>`;
      case "tuple": case "pack": {
let _cppLoop75Result:string[]=[];
const _cppLoop75Input:number[]=a;
for(let _cppLoop75Index:number=0;_cppLoop75Index<_cppLoop75Input.length;_cppLoop75Index=_cppLoop75Index+1){
const n:number=_cppLoop75Input[_cppLoop75Index];
_cppLoop75Result.push(this.cppTypeId(n));continue;
}
return `std::tuple<${_cppLoop75Result.join(",")}>`;}
      // El `std::function` de un callback es parte del contrato observable: un
      // callback `(x: constRef<T>) => void` se declara `std::function<void(const T&)>`,
      // igual que stage 0 y que los overloads del runtime.
      case "function": {
let _cppLoop62Result:string[]=[];
const _cppLoop62Input:number[]=a.slice(0,-1);
for(let _cppLoop62Index:number=0;_cppLoop62Index<_cppLoop62Input.length;_cppLoop62Index=_cppLoop62Index+1){
const x:number=_cppLoop62Input[_cppLoop62Index];
_cppLoop62Result.push(this.parameterType(x));continue;
}
return `std::function<${this.cppTypeId(a[a.length-1])}(${_cppLoop62Result.join(",")})>`;}
      case "Optional": return `ets::Optional<${this.cppTypeId(a[0])}>`;
      case "Result": {
        if (this.project.types[a[1]] != "string") this.fail("El runtime C++ requiere Result<T,string>");
        if (this.project.types[a[0]] == "void") {
          this.fail("No se puede generar Result<void>: el runtime C++ no admite Result<void> (usa std::optional<T> internamente). Indica un tipo concreto, por ejemplo Result<boolean>, y revisa las llamadas a ok()/err() sin tipo explícito.");
        }
        this.headers.add("runtime/ets_async.hpp");
        this.backends.libuv = true;
        return `ets::Result<${this.cppTypeId(a[0])}>`;
      }
      case "Promise": this.headers.add("runtime/ets_async.hpp");this.backends.libuv=true;return `ets::Task<${this.cppTypeId(a[0])}>`;
      case "Map": case "Set": {
let _cppLoop76Result:string[]=[];
const _cppLoop76Input:number[]=a;
for(let _cppLoop76Index:number=0;_cppLoop76Index<_cppLoop76Input.length;_cppLoop76Index=_cppLoop76Index+1){
const n:number=_cppLoop76Input[_cppLoop76Index];
_cppLoop76Result.push(this.cppTypeId(n));continue;
}
return `ets::${s.kind}<${_cppLoop76Result.join(",")}>`;}
      case "iterator": return `std::size_t`;
      case "parameter": return "std::monostate"; // unused generic metadata, rejected when an executable slot needs it
      case "runtime": {
        const name=this.project.types[id];
        if(name=="Server"){this.httpServer();return "ets::Server";}
        if(name=="Request"||name=="Response"){this.httpServer();return name=="Request"?"const ets::HttpRequest*":"ets::HttpResponse*";}
        if(name=="HttpClientResponse"){this.headers.add("runtime/ets_http_curl_async.hpp");this.backends.libuv=true;this.backends.curl=true;return "ets::HttpClientResponse";}
        if(name=="Timer")this.fail("runtime:Timer necesita un contrato de ownership/copia en el IR para reutilizar el Timer no copiable de C++");
        if(["JsonValue","Console","Regex","Request","Response","HttpClientResponse","FileReader","TcpListener","TcpConnection","TlsContext","TlsConnection","CancellationSource","CancellationToken","Server","Timer","FsWatcher","FsEvent"].includes(name)) {
          if(name=="Regex")this.headers.add("runtime/ets_regex.hpp");
          else if(!["JsonValue","Console"].includes(name)){this.headers.add("runtime/ets_runtime_full.hpp");this.backends.libuv=true;}
          return cppType(name);
        }
      }
    }
    return this.fail(`Shape C++ sin representación: ${s.kind}`);
  }
  // Contrato de paso observable del dialecto (V22). Un `ref<T>` declarado es
  // una referencia C++ `T&` y un `constRef<T>` es `const T&`, igual que emite
  // stage 0 en `cppMemoryType`. `typeId()` sigue devolviendo `T*`/`const T*`
  // porque ese es el valor INTERNO que el IR necesita para los slots
  // (`std::optional` no admite referencias) y para los temporales de
  // préstamo; el backend que lo necesita es un detalle del backend.
  parameterType(id:number):string {
    const s=this.shape(id);
    if(s.kind=="ref") return `${this.cppTypeId(s.arguments[0])}&`;
    if(s.kind=="constRef") return `const ${this.cppTypeId(s.arguments[0])}&`;
    return this.cppTypeId(id);
  }
  // Un argumento de un parámetro prestado viaja como puntero dentro del IR y
  // se desreferencia al llegar a la firma: `T&`/`const T&`.
  dereferenceIfBorrowed(text:string,formal:number):string {
    if(formal<0)return text;
    return ["ref","constRef"].includes(this.shape(formal).kind)?`(*(${text}))`:text;
  }
  borrowArgument(f:constRef<IrFunction>,i:constRef<IrInstruction>,k:number,formal:number):string {
    if(formal<0) return this.operand(f,i,k);
    const s=this.shape(formal);
    if(!["ref","constRef"].includes(s.kind)) return this.operand(f,i,k);
    const actual=f.values[i.operands[k]];
    if(actual<0||!["ref","constRef"].includes(this.shape(actual).kind)) this.fail("Un parámetro prestado exige un argumento prestado",i.source);
    return this.dereferenceIfBorrowed(this.operand(f,i,k,false),formal);
  }
  isInterface(id:number):boolean { return ["interface","intersection"].includes(this.shape(id).kind)&&this.shape(id).methods.length>0; }
  interfaceVariant(id:number):string { {
let _cppLoop37Result:string[]=[];
const _cppLoop37Input:number[]=this.shape(id).variants;
for(let _cppLoop37Index:number=0;_cppLoop37Index<_cppLoop37Input.length;_cppLoop37Index=_cppLoop37Index+1){
const t:number=_cppLoop37Input[_cppLoop37Index];
_cppLoop37Result.push(`ets::ir::Box<${this.cppTypeId(t)}>`);continue;
}
return `std::variant<${this.shape(id).variants.length>0?_cppLoop37Result.join(","):"std::monostate"}>`;} }
  httpServer():void {{
let _cppLoop51Result:boolean=false;
const _cppLoop51Input:IrAnnotation[]=this.project.annotations;
for(let _cppLoop51Index:number=0;_cppLoop51Index<_cppLoop51Input.length;_cppLoop51Index=_cppLoop51Index+1){
const a:IrAnnotation=_cppLoop51Input[_cppLoop51Index];
if(a.name=="cpp_drogon"){_cppLoop51Result=true;break;}continue;
}
this.headers.add(_cppLoop51Result?"runtime/ets_http_drogon.hpp":"runtime/ets_http_httplib.hpp");}}
  elementType(id:number):string {return this.project.types[id]=="boolean"?"ets::ir::Boolean":this.cppTypeId(id);}
  // Canonical names are only diagnostics. C++ identifiers come exclusively from IDs.
  record(id:number): boolean { return recordKinds.includes(this.shape(id).kind); }
  choices(id:number): number[] { const s=this.shape(id);return s.kind=="union"?s.variants:s.arguments; }
  numeric(id:number): boolean { return this.shape(id).numericKind!="none"; }
  deref(value:string,id:number):string { return ["ref","constRef","ptr","constPtr"].includes(this.shape(id).kind)?`(*(${value}))`:value; }
  inner(id:number):number { return ["ref","constRef","ptr","constPtr","readonly"].includes(this.shape(id).kind)?this.shape(id).arguments[0]:id; }
  literal(text:string,id:number):string {
    const s=this.shape(id);if(s.kind=="enum")return this.literal(text,s.arguments[0]);
    const name=this.project.types[id];
    if(name=="string")return `std::string(${quoteCpp(text)},${text.length})`;
    if(name=="boolean"){if(!["true","false"].includes(text))this.fail("Constante boolean inválida");return text;}
    const raw=text.replaceAll("_","");
    if(!validNumber(raw))this.fail("Constante numérica inválida");
    if(name=="i64")return raw=="-9223372036854775808"?"(-9223372036854775807LL-1LL)":raw+"LL";
    if(name=="u64")return raw+"ULL";
    if(s.numericKind=="float"){
      let floating=raw;if(numericBase(raw)==10&&!floating.includes(".")&&!floating.includes("e")&&!floating.includes("E"))floating+=".0";
      return "static_cast<"+this.cppTypeId(id)+">("+floating+")";
    }
    let cppRaw=raw;const pos=raw.startsWith("-")?1:0;
    if(raw.slice(pos,pos+2)=="0o"||raw.slice(pos,pos+2)=="0O")cppRaw=raw.slice(0,pos+1)+raw.slice(pos+2,raw.length);
    return "static_cast<"+this.cppTypeId(id)+">("+cppRaw+")";
  }

  convert(value:string,from:number,to:number):string {
    if(from==to)return value;
    const a=this.shape(from);const  b=this.shape(to);const  T=this.cppTypeId(to);
    // Un literal de tipo se materializa como su primitivo: el valor concreto
    // ya lo garantiza el checker, asi que la conversion es la identidad.
    if(a.kind=="literal")return this.convert(value,a.discriminatorType,to);
    if(b.kind=="literal")return this.convert(value,from,b.discriminatorType);
    if(["ref","constRef"].includes(a.kind)&&!["ref","constRef"].includes(b.kind))return this.convert(`(*(${value}))`,a.arguments[0],to);
    if(b.kind=="readonly")return this.convert(value,from,b.arguments[0]);
    if(this.numeric(from)&&this.numeric(to))return `ets::ir::cast<${T}>(${value})`;
    if(a.kind=="enum")return this.convert(value,a.arguments[0],to);
    if(b.kind=="enum")return this.convert(value,from,b.arguments[0]);
    if(this.project.types[to]=="string")return a.numericKind=="integer"?`std::to_string(${value})`:`ets::concat(${value})`;
    if(b.kind=="Optional"&&a.kind!="Optional")return `${T}::some(${this.convert(value,from,b.arguments[0])})`;
    if(a.kind=="Optional"&&b.kind=="Optional")return `([&](){auto input=${value};if(input.isPresent())return ${T}::some(${this.convert(this.shape(a.arguments[0]).resource?"std::move(input).value()":"input.value()",a.arguments[0],b.arguments[0])});return ${T}::none();}())`;
    if(a.kind=="Result"&&b.kind=="Result")return `([&](){auto input=${value};if(input.isOk())return ${T}::success(${this.convert(this.shape(a.arguments[0]).resource?"std::move(input).value()":"input.value()",a.arguments[0],b.arguments[0])});return ${T}::failure(input.error());}())`;
    if(["tuple","pack"].includes(a.kind)&&["tuple","pack"].includes(b.kind)){
let _cppLoop13Result:string[]=[];
const _cppLoop13Input:number[]=b.arguments;
for(let k:number=0;k<_cppLoop13Input.length;k=k+1){
const t:number=_cppLoop13Input[k];
_cppLoop13Result.push(this.convert(`${this.shape(a.arguments[k]).resource?"std::move(":""}std::get<${k}>(input)${this.shape(a.arguments[k]).resource?")":""}`,a.arguments[k],t));continue;
}
return `([&](){auto input=${value};return ${T}{${_cppLoop13Result.join(",")}};}())`;}
    if(sumKinds.includes(b.kind)) {
      const at=arrayIndex(this.choices(to),from);
      if(at>=0){
let _cppLoop64Result:string[]=[];
const _cppLoop64Input:number[]=this.choices(to);
for(let _cppLoop64Index:number=0;_cppLoop64Index<_cppLoop64Input.length;_cppLoop64Index=_cppLoop64Index+1){
const x:number=_cppLoop64Input[_cppLoop64Index];
_cppLoop64Result.push(this.cppTypeId(x));continue;
}
return `${T}{std::variant<${_cppLoop64Result.join(",")}>{std::in_place_index<${at}>,${value}}}`;}
    }
    if(sumKinds.includes(a.kind)&&this.choices(from).includes(to))return `std::get<${arrayIndex(this.choices(from),to)}>(${value}.data)`;
    if(this.isInterface(to)) {
      if(sumKinds.includes(a.kind)) {
        
let _cppLoop12Result:string[]=[];
const _cppLoop12Input:number[]=this.choices(from);
for(let k:number=0;k<_cppLoop12Input.length;k=k+1){
const alt:number=_cppLoop12Input[k];
_cppLoop12Result.push(`${k>0?"else ":""}if constexpr(std::is_same_v<std::remove_cvref_t<decltype(input)>,${this.cppTypeId(alt)}>)return ${this.convert("std::move(input)",alt,to)};`);continue;
}
const branches=_cppLoop12Result.join("");
        return `([&](){auto source=${value};return std::visit([&](auto&& input)->${T}{${branches}else std::abort();},source.data);}())`;
      }
      if(this.isInterface(from))return `([&](){auto source=${value};return std::visit([&](auto&& box)->${T}{using B=std::remove_cvref_t<decltype(box)>;if constexpr(std::is_same_v<B,std::monostate>)std::abort();else return ${T}{${this.interfaceVariant(to)}{std::move(box)}};},source.data);}())`;
      if(!b.variants.includes(from))this.fail("Implementación concreta ausente del contrato de interfaz");
      return `${T}{${this.interfaceVariant(to)}{std::in_place_type<ets::ir::Box<${this.cppTypeId(from)}>>,${value}}}`;
    }
    if(this.record(from)&&this.record(to)) {
      
let _cppLoop10Result:string[]=[];
const _cppLoop10Input:string[]=b.names;
for(let k:number=0;k<_cppLoop10Input.length;k=k+1){
const name:string=_cppLoop10Input[k];
const at=arrayIndex(a.names,name);if(at<0)this.fail(`Campo ausente en conversión: ${name}`);_cppLoop10Result.push(`out.f${k}.set(${this.convert(`${this.field("input",from,at)}.${this.shape(a.fields[at]).resource?"take":"get"}()`,a.fields[at],b.fields[k])});`);continue;
}
let fields=_cppLoop10Result;
      return `([&](){auto input=${value};${T} out;${fields.join("")}return out;}())`;
    }
    if(a.kind=="function"&&b.kind=="function") {
      let args=b.arguments.slice(0,-1);let  ret=b.arguments[b.arguments.length-1];
      
let _cppLoop33Result:string[]=[];
const _cppLoop33Input:number[]=a.arguments.slice(0,-1);
for(let k:number=0;k<_cppLoop33Input.length;k=k+1){
const x:number=_cppLoop33Input[k];
_cppLoop33Result.push(this.convert(`x${k}`,args[k],x));continue;
}
const call=`fn(${_cppLoop33Result.join(",")})`;
      {
let _cppLoop56Result:string[]=[];
const _cppLoop56Input:number[]=args;
for(let k:number=0;k<_cppLoop56Input.length;k=k+1){
const x:number=_cppLoop56Input[k];
_cppLoop56Result.push(`${this.parameterType(x)} x${k}`);continue;
}
return `([fn=${value}](${_cppLoop56Result.join(",")})mutable->${this.cppTypeId(ret)}{${this.project.types[ret]=="void"?`${call};`:`return ${this.convert(call,a.arguments[a.arguments.length-1],ret)};`}})`;}
    }
    // Structural container conversions remain explicit, never C++ reinterpret casts.
    if(["array","fixedArray"].includes(a.kind)&&["array","fixedArray"].includes(b.kind))return `([&](){auto input=${value};${T} out;${b.kind=="array"?"out.reserve(input.size());":"std::size_t k=0;"}for(auto&& x:input){${b.kind=="array"?"out.push_back(":"out[k++]=("}${this.convert(this.shape(a.arguments[0]).resource?"std::move(x)":"x",a.arguments[0],b.arguments[0])});}return out;}())`;
    if(a.kind=="ref"&&b.kind=="constRef"&&a.arguments[0]==b.arguments[0])return value;
    return this.fail(`Conversión C++ no soportada: ${this.project.types[from]} → ${this.project.types[to]}`);
  }
  field(base:string,typeId:number,index:number):string {
    const s=this.shape(typeId);
    if(this.isInterface(typeId)) {
      const name=s.names[index];const fieldType=s.fields[index];
      
let _cppLoop7Result:string[]=[];
const _cppLoop7Input:number[]=s.variants;
for(let k:number=0;k<_cppLoop7Input.length;k=k+1){
const alt:number=_cppLoop7Input[k];
const shape=this.shape(alt);const field=arrayIndex(shape.names,name);if(field<0||shape.fields[field]!=fieldType)this.fail(`Campo de interfaz incompatible: ${name}`);_cppLoop7Result.push(`${k>0?"else ":""}if constexpr(std::is_same_v<B,ets::ir::Box<${this.cppTypeId(alt)}>>)return box.get().f${field};`);continue;
}
const branches=_cppLoop7Result.join("");
      return `std::visit([](auto& box)->std::conditional_t<std::is_const_v<std::remove_reference_t<decltype((${base}))>>,const ets::ir::Slot<${this.cppTypeId(fieldType)}>&,ets::ir::Slot<${this.cppTypeId(fieldType)}>&>{using B=std::remove_cvref_t<decltype(box)>;${branches}${branches!=""?"else ":""}std::abort();},(${base}).data)`;
    }
    if(!sumKinds.includes(s.kind))return `(${base}).f${index}`;
    const name=s.names[index];const  alternatives=this.choices(typeId);
    
let _cppLoop5Result:string[]=[];
const _cppLoop5Input:number[]=alternatives;
for(let k:number=0;k<_cppLoop5Input.length;k=k+1){
const alt:number=_cppLoop5Input[k];

      const shape=this.shape(alt);const  field=arrayIndex(shape.names,name);
      if(field<0||shape.fields[field]!=s.fields[index])this.fail(`Campo común de unión sin representación uniforme: ${name}`);
      _cppLoop5Result.push(`${k>0?"else ":""}if constexpr(std::is_same_v<std::remove_cvref_t<decltype(x)>,${this.cppTypeId(alt)}>)return (x.f${field});`);continue;
    
}
const branches=_cppLoop5Result.join("");
    return `std::visit([](auto& x)->decltype(auto){${branches}},(${base}).data)`;
  }
  place(f:constRef<IrFunction>,id:number):string {
    const p=f.places[id];if(id<0||id>=f.places.length)this.fail(`Place inexistente: ${id}`,f.source);
    if(p.global>=0)return `ir_g${p.global}`;
    if(p.kind=="local")return `p${id}`;
    if(p.kind=="capture")return `ets::ir::view(${f.captureModes[p.field]=="reference"?`*c${p.field}`:`c${p.field}`})`;
    const parent=f.places[p.base];const  raw=`${this.place(f,p.base)}.get()`;
    if(p.kind=="field")return this.field(raw,parent.typeId,p.field);
    if(p.kind=="deref")return this.shape(parent.typeId).kind=="readonly"?`ets::ir::view(${raw})`:`ets::ir::view(*(${raw}))`;
    if(p.kind=="checkedView")return sumKinds.includes(this.shape(parent.typeId).kind)?`ets::ir::view(std::get<${arrayIndex(this.choices(parent.typeId),p.typeId)}>(${raw}.data))`:this.place(f,p.base);
    if(p.kind=="index") {
      const s=this.shape(parent.typeId);
      if(["tuple","pack"].includes(s.kind))return `ets::ir::view(std::get<${this.constantIndex(f,p.index)}>(${raw}))`;
      if(this.project.types[parent.typeId]=="string")return this.fail("Los índices de string requieren una lectura, no un place escribible",p.source);
      return `ets::ir::view((${raw}).at(static_cast<std::size_t>(v${p.index}.get()))${s.kind=="array"&&this.project.types[s.arguments[0]]=="boolean"?".value":""})`;
    }
    return this.fail(`Place C++ desconocido: ${p.kind}`,p.source);
  }
  constantIndex(f:constRef<IrFunction>,value:number):number { for(const b of f.blocks)for(const i of b.instructions)if(i.result==value&&i.op=="constant")return parseNumber(i.text);this.fail("Índice de tupla no constante",f.source);return -1; }
  operand(f:constRef<IrFunction>,i:constRef<IrInstruction>,k:number,consume:boolean=true):string {
    const value=i.operands[k];const  typeId=f.values[value];if(typeId<0)this.fail("Operando IR inexistente",i.source);
    return `v${value}.${consume&&(this.shape(typeId).resource||this.consuming.includes(value))?"take":"get"}()`;
  }
  callback(f:constRef<IrFunction>,i:constRef<IrInstruction>,k:number):string {
    const id=f.values[i.operands[k]];const  s=this.shape(id);let  args=s.arguments.slice(0,-1);
    {
let _cppLoop23Result:string[]=[];
const _cppLoop23Input:number[]=args;
for(let n:number=0;n<_cppLoop23Input.length;n=n+1){
const t:number=_cppLoop23Input[n];
_cppLoop23Result.push(["ref","constRef"].includes(this.shape(t).kind)?`ets::ir::read(x${n})`:`x${n}`);continue;
}
{
let _cppLoop68Result:string[]=[];
const _cppLoop68Input:number[]=args;
for(let n:number=0;n<_cppLoop68Input.length;n=n+1){
const _:number=_cppLoop68Input[n];
_cppLoop68Result.push(`auto&& x${n}`);continue;
}
return `[&](${_cppLoop68Result.join(",")})->${this.cppTypeId(s.arguments[s.arguments.length-1])}{${this.project.types[s.arguments[s.arguments.length-1]]=="void"?"":"return "}${this.operand(f,i,k,false)}(${_cppLoop23Result.join(",")});}`;}}
  }
  instruction(f:constRef<IrFunction>,i:constRef<IrInstruction>,block:number):string {
    const  T=i.typeId>=0?this.cppTypeId(i.typeId):"void";
    let value:string="";
    switch(i.op) {
      case "backendEscape":return this.cppEscape(f,i);
      case "constant": value=this.literal(i.text,i.typeId);break;
      case "load": {
        const p=f.places[i.place];
        if(p.kind=="index"&&this.project.types[f.places[p.base].typeId]=="string")value=`ets::string_charAt(${this.place(f,p.base)}.get(),v${p.index}.get())`;
        else value=`${this.place(f,i.place)}.get()`;break;
      }
      case "move": value=`${this.place(f,i.place)}.take()`;break;
      case "borrow": case "address": value=`std::addressof(${this.place(f,i.place)}.get())`;break;
      case "store": return `${this.place(f,i.place)}.set(${this.operand(f,i,0)});`;
      case "dropRemaining": return `${this.place(f,i.place)}.drop();`;
      case "dropValue": return `v${i.operands[0]}.drop();`;
      case "endBorrow": return `// end lease ${i.lease}; statically verified, no runtime ownership`;
      case "dropFrame": {
let _cppLoop28Result:string[]=[];

let _cppLoop59Result:number[]=[];
const _cppLoop59Input:number[]=f.framePlaces;
for(let _cppLoop59Index:number=0;_cppLoop59Index<_cppLoop59Input.length;_cppLoop59Index=_cppLoop59Index+1){
const p:number=_cppLoop59Input[_cppLoop59Index];
if(f.places[p].kind=="local"){_cppLoop59Result.push(p);continue;}
}
const _cppLoop28Input:number[]=_cppLoop59Result;
for(let _cppLoop28Index:number=0;_cppLoop28Index<_cppLoop28Input.length;_cppLoop28Index=_cppLoop28Index+1){
const p:number=_cppLoop28Input[_cppLoop28Index];
_cppLoop28Result.push(`p${p}.drop();`);continue;
}
{
let _cppLoop67Result:string[]=[];
const _cppLoop67Input:number[]=f.frameValues;
for(let _cppLoop67Index:number=0;_cppLoop67Index<_cppLoop67Input.length;_cppLoop67Index=_cppLoop67Index+1){
const v:number=_cppLoop67Input[_cppLoop67Index];
_cppLoop67Result.push(`v${v}.drop();`);continue;
}
return [..._cppLoop67Result,..._cppLoop28Result].join("\n");}}
      case "own": value=`std::make_unique<${this.cppTypeId(this.shape(i.typeId).arguments[0])}>(${this.operand(f,i,0)})`;break;
      case "convert": value=this.convert(this.operand(f,i,0),f.values[i.operands[0]],i.typeId);break;
      case "unary": value=(i.text=="-"&&this.shape(i.typeId).numericKind=="integer"?`ets::ir::sub<${T}>(0,${this.operand(f,i,0)})`:i.text=="~"?`static_cast<${T}>(~static_cast<${this.shape(i.typeId).numericKind=="float"?"std::int64_t":T}>(${this.operand(f,i,0)}))`:`(${i.text}${this.operand(f,i,0)})`);break;
      case "binary": {
        
        if(binaryHelper(i.text)!=""&&this.numeric(i.typeId))value=`ets::ir::${binaryHelper(i.text)}<${T}>(${this.operand(f,i,0)},${this.operand(f,i,1)})`;
        else if(["&","|","^"].includes(i.text))value=`static_cast<${T}>(static_cast<std::int64_t>(${this.operand(f,i,0)})${i.text}static_cast<std::int64_t>(${this.operand(f,i,1)}))`;
        else value=`(${this.operand(f,i,0)} ${i.text} ${this.operand(f,i,1)})`;break;
      }
      case "aggregate": {
        const shape=this.shape(i.typeId);const  tuple=["tuple","pack"].includes(shape.kind);
        if(tuple) {
          
let _cppLoop29Result:string[]=[];
const _cppLoop29Input:number[]=i.operands;
for(let k:number=0;k<_cppLoop29Input.length;k=k+1){
const v:number=_cppLoop29Input[k];
_cppLoop29Result.push(i.names[k]=="spread"?this.operand(f,i,k):`std::make_tuple(${this.operand(f,i,k)})`);continue;
}
const parts=_cppLoop29Result;
          value=`std::tuple_cat(${parts.join(",")})`;
        } else if(shape.kind=="fixedArray") {
          let setup:string[]=[];let elements:string[]=[];
          {
let _cppLoop3Result:number=0;
const _cppLoop3Input:number[]=i.operands;
for(let k:number=0;k<_cppLoop3Input.length;k=k+1){
const v:number=_cppLoop3Input[k];

            if(i.names[k]!="spread"){elements.push(this.operand(f,i,k));continue;}
            const input=this.shape(f.values[v]);const count=input.kind=="fixedArray"?input.length:["tuple","pack"].includes(input.kind)?input.arguments.length:-1;
            if(count<0)this.fail("Spread de longitud desconocida en array fijo",i.source);
            setup.push(`auto part${k}=${this.operand(f,i,k)};`);
            for(let n=0;n<count;n=n+1)elements.push(`std::move(${["tuple","pack"].includes(input.kind)?`std::get<${n}>(part${k})`:`part${k}[${n}]`})`);
          
}
_cppLoop3Result;}
          value=`([&](){${setup.join("")}return ${T}{${elements.join(",")}};}())`;
        } else {
          
let _cppLoop8Result:string[]=[];
const _cppLoop8Input:number[]=i.operands;
for(let k:number=0;k<_cppLoop8Input.length;k=k+1){
const _:number=_cppLoop8Input[k];

            if(i.names[k]=="spread"){_cppLoop8Result.push(`auto part${k}=${this.operand(f,i,k)};for(auto& x:part${k}){${shape.kind=="array"?"out.push_back(std::move(x));":"out.at(k++)=std::move(x);"}}`);continue;}
            _cppLoop8Result.push(shape.kind=="array"?`out.push_back(${this.operand(f,i,k)});`:`out.at(k++)=${this.operand(f,i,k)};`);continue;
          
}
const pieces=_cppLoop8Result;
          value=`([&](){${T} out;${shape.kind=="fixedArray"?"std::size_t k=0;":""}${pieces.join("")}return out;}())`;
        }break;
      }
      case "emptyRecord": case "collection": value=`${T}{}`;break;
      case "record": case "variant": {
        const shape=this.shape(i.typeId);
let _cppLoop30Result:string[]=[];
const _cppLoop30Input:string[]=i.names;
for(let k:number=0;k<_cppLoop30Input.length;k=k+1){
const name:string=_cppLoop30Input[k];
_cppLoop30Result.push(`out.f${arrayIndex(shape.names,name)}.set(${this.operand(f,i,k)});`);continue;
}
let  fields=_cppLoop30Result;
        if(i.op=="variant") {
          const kind=arrayIndex(shape.names,"kind");if(kind>=0&&!i.names.includes("kind"))fields.push(`out.f${kind}.set(${this.literal(shape.tag,shape.fields[kind])});`);
          const disc=arrayIndex(shape.names,shape.discriminator);if(disc>=0&&!i.names.includes(shape.discriminator))fields.push(`out.f${disc}.set(${this.literal(shape.discriminatorValue,shape.discriminatorType)});`);
        }
        for(let k=0;k<shape.fields.length;k=k+1)if(!i.names.includes(shape.names[k])&&this.shape(shape.fields[k]).kind=="Optional")fields.push(`out.f${k}.set(${this.cppTypeId(shape.fields[k])}::none());`);
        value=`([&](){${T} out;${fields.join("")}return out;}())`;break;
      }
      case "none": value=`${T}::none()`;break;
      case "some": value=`${T}::some(${this.operand(f,i,0)})`;break;
      case "result": value=`${T}::${i.text=="Err"?"failure":"success"}(${this.operand(f,i,0)})`;break;
      case "isPresent": value=`${this.deref(this.operand(f,i,0),f.values[i.operands[0]])}.isPresent()`;break;
      case "unwrap": value=`(${this.deref(this.operand(f,i,0),f.values[i.operands[0]])}).value()`;break;
      case "property": {
        const input=this.deref(this.operand(f,i,0,false),f.values[i.operands[0]]);const  inputId=this.inner(f.values[i.operands[0]]);const  shape=this.shape(inputId);
        if(["length","size"].includes(i.text))value=(["tuple","pack"].includes(shape.kind)?`double(${shape.arguments.length})`:`double((${input}).size())`);
        else if(i.text=="ok")value=`(${input}).isOk()`;
        else if(i.text=="kind")value=(shape.kind=="Optional"?`std::string((${input}).isPresent()?"Some":"None")`:`std::string((${input}).isOk()?"Ok":"Err")`);
        break;
      }
      case "extractIndex": value=(["tuple","pack"].includes(this.shape(f.values[i.operands[0]]).kind)?`std::get<${this.constantIndex(f,i.operands[1])}>(${this.operand(f,i,0)})`:`(${this.operand(f,i,0)}).at(static_cast<std::size_t>(${this.operand(f,i,1)}))`);break;
      case "typeTag": {const id=this.inner(i.signature);const  name=this.project.types[id];value=this.literal(this.numeric(id)?"number":["string","boolean"].includes(name)?name:name=="void"?"undefined":"object",i.typeId);break;}
      case "typeTest": {const id=this.inner(f.values[i.operands[0]]);value=(sumKinds.includes(this.shape(id).kind)?`(${this.deref(this.operand(f,i,0,false),f.values[i.operands[0]])}.data.index()==${arrayIndex(this.choices(id),i.signature)})`:id==i.signature?"true":"false");break;}
      case "closure": {
        const target=this.project.functions[i.callee];
let _cppLoop34Result:string[]=[];
const _cppLoop34Input:number[]=target.parameterTypes;
for(let k:number=0;k<_cppLoop34Input.length;k=k+1){
const t:number=_cppLoop34Input[k];
_cppLoop34Result.push(`${this.parameterType(t)} x${k}`);continue;
}
let args=_cppLoop34Result.join(",");
        
let _cppLoop63Result:string[]=[];
const _cppLoop63Input:number[]=i.operands;
for(let k:number=0;k<_cppLoop63Input.length;k=k+1){
const _:number=_cppLoop63Input[k];
_cppLoop63Result.push(`c${k}=${this.operand(f,i,k)}`);continue;
}
const captures=_cppLoop63Result.join(",");
        // Un parámetro prestado ya es una referencia: reenviarlo con
        // `std::move` la degradaría a un rvalue que no enlaza con `T&`.
        
let _cppLoop19Result:string[]=[];
const _cppLoop19Input:number[]=target.parameterTypes;
for(let k:number=0;k<_cppLoop19Input.length;k=k+1){
const t:number=_cppLoop19Input[k];
_cppLoop19Result.push(["ref","constRef"].includes(this.shape(t).kind)?`x${k}`:`std::move(x${k})`);continue;
}
const forwarded=_cppLoop19Result;
        {
let _cppLoop61Result:string[]=[];
const _cppLoop61Input:number[]=target.captureTypes;
for(let k:number=0;k<_cppLoop61Input.length;k=k+1){
const _:number=_cppLoop61Input[k];
_cppLoop61Result.push(`c${k}`);continue;
}
value=`[${captures}](${args})mutable->${this.cppTypeId(target.returns)}{${this.project.types[target.returns]=="void"?"":"return "}ir_f${i.callee}(${[..._cppLoop61Result,...forwarded].join(",")});}`;}break;
      }
      case "call": case "taskCreate": {
        const target=this.project.functions[i.callee];
        {
let _cppLoop16Result:string[]=[];
const _cppLoop16Input:number[]=i.operands;
for(let k:number=0;k<_cppLoop16Input.length;k=k+1){
const _:number=_cppLoop16Input[k];
_cppLoop16Result.push(this.borrowArgument(f,i,k,(k<target.parameterTypes.length?target.parameterTypes[k]:-1)));continue;
}
value=`ir_f${i.callee}(${_cppLoop16Result.join(",")})`;}break;
      }
      case "callIndirect": {
        const formals=this.shape(i.signature).arguments.slice(0,-1);
        {
let _cppLoop25Result:string[]=[];
const _cppLoop25Input:number[]=i.operands.slice(1,i.operands.length);
for(let k:number=0;k<_cppLoop25Input.length;k=k+1){
const _:number=_cppLoop25Input[k];
_cppLoop25Result.push(this.borrowArgument(f,i,k+1,formals[k]));continue;
}
value=`${this.operand(f,i,0)}(${_cppLoop25Result.join(",")})`;}break;
      }
      case "interfaceCall": {
        const receiver=this.inner(f.values[i.operands[0]]);const returnType=this.cppTypeId(i.typeId);
        
let _cppLoop2Result:string[]=[];
const _cppLoop2Input:number[]=this.shape(receiver).variants;
for(let k:number=0;k<_cppLoop2Input.length;k=k+1){
const concrete:number=_cppLoop2Input[k];

          const d=this.dispatch(receiver,concrete,i.text,i.signature);
          if(d.callee<0)this.fail("Dispatch de interfaz incompleto",i.source);
          const target=this.project.functions[d.callee];
          // El receptor implícito es un `ref<T>` → llega a la firma como `T&`.
          let args=[`box.get()`];
          for(let n=1;n<i.operands.length;n=n+1){
            const formal=target.parameterTypes[n];
            args.push(this.dereferenceIfBorrowed(this.convert(this.operand(f,i,n),f.values[i.operands[n]],formal),formal));
          }
          const call=`ir_f${d.callee}(${args.join(",")})`;
          _cppLoop2Result.push(`${k>0?"else ":""}if constexpr(std::is_same_v<B,ets::ir::Box<${this.cppTypeId(concrete)}>>){${this.project.types[i.typeId]=="void"?`${call};return;`:`return ${this.convert(call,target.returns,i.typeId)};`}}`);continue;
        
}
const branches=_cppLoop2Result.join("");
        value=`std::visit([&](auto& box)->${returnType}{using B=std::remove_cvref_t<decltype(box)>;${branches}${branches!=""?"else ":""}std::abort();},(${this.deref(this.operand(f,i,0,false),f.values[i.operands[0]])}).data)`;break;
      }
      case "runtimeCall": value=this.runtimeCall(f,i);break;
      case "intrinsic": {
        {
let _cppLoop54Result:boolean=false;
const _cppLoop54Input:number[]=i.operands;
for(let _cppLoop54Index:number=0;_cppLoop54Index<_cppLoop54Input.length;_cppLoop54Index=_cppLoop54Index+1){
const v:number=_cppLoop54Input[_cppLoop54Index];
if(this.shape(this.inner(f.values[v])).kind=="pack"){_cppLoop54Result=true;break;}continue;
}
if(_cppLoop54Result) {
          
let _cppLoop6Result:string[]=[];
const _cppLoop6Input:number[]=i.operands;
for(let k:number=0;k<_cppLoop6Input.length;k=k+1){
const v:number=_cppLoop6Input[k];

            const id=this.inner(f.values[v]);const  shape=this.shape(id);const  input=this.deref(this.operand(f,i,k,false),f.values[v]);
            {
let _cppLoop32Result:string[]=[];
const _cppLoop32Input:number[]=shape.arguments;
for(let n:number=0;n<_cppLoop32Input.length;n=n+1){
const t:number=_cppLoop32Input[n];
_cppLoop32Result.push(this.output(`std::get<${n}>(${input})`,t));continue;
}
_cppLoop6Result.push(shape.kind=="pack"?`std::make_tuple(${_cppLoop32Result.join(",")})`:`std::make_tuple(${this.output(this.operand(f,i,k,false),f.values[v])})`);}continue;
          
}
const parts=_cppLoop6Result;
          value=`std::apply([&](const auto&...xs){${i.text}(xs...);},std::tuple_cat(${parts.join(",")}))`;
        }
        else {
let _cppLoop31Result:string[]=[];
const _cppLoop31Input:number[]=i.operands;
for(let k:number=0;k<_cppLoop31Input.length;k=k+1){
const _:number=_cppLoop31Input[k];
_cppLoop31Result.push(this.output(this.operand(f,i,k,false),f.values[i.operands[k]]));continue;
}
value=`${i.text}(${_cppLoop31Result.join(",")})`;}}break;
      }
      case "resume": value=`await${i.continuation}.take()`;if(this.project.types[i.typeId]=="void")return "// resumed void task";break;
      case "iterator": value="std::size_t{0}";break;
      case "iterHasNext": case "iterNext": {
        const cursor=i.operands[0];const  definition=this.findDefinition(f,cursor);const place=f.places[definition.place];const  base=this.deref(`${this.place(f,definition.place)}.get()`,place.typeId);const  shape=this.shape(this.inner(place.typeId));
        if(i.op=="iterHasNext")value=`v${cursor}.get()<(${base}).size()`;
        else if(["Map","Set"].includes(shape.kind)) {
          const position=`v${cursor}.get()++`;const  map=shape.kind=="Map";
          value=`([&](){auto it=(${base}).data().begin();std::advance(it,${position});return ${definition.text=="keys"?(map?"it->first":"*it"):map?"std::make_tuple(it->first,it->second)":"*it"};}())`;
        } else if(definition.text=="keys")value=`static_cast<${T}>(v${cursor}.get()++)`;
        else if(this.project.types[this.inner(place.typeId)]=="string")value=`std::string(1,(${base}).at(v${cursor}.get()++))`;
        else {const element=`(${base}).at(v${cursor}.get()++)`;value=(["ref","constRef"].includes(this.shape(i.typeId).kind)?`std::addressof(ets::ir::read(${element}))`:this.shape(i.typeId).resource?`std::move(${element})`:element);}
        break;
      }
    }
    if(value=="")return this.fail(`Opcode C++ sans contrat: ${i.op}`,i.source);
    return i.result>=0?`v${i.result}.set(${value});`:`${value};`;
  }
  printable(id:number,history:number[]=[]):boolean {
    if(history.includes(id))return false;const s=this.shape(id);
    // Un literal de tipo se imprime como su primitivo.
    if(s.kind=="literal")return this.printable(s.discriminatorType,[...history,id]);
    if(["scalar","enum","variant","ptr","constPtr"].includes(s.kind))return true;
    if(["ref","constRef","readonly"].includes(s.kind))return this.printable(s.arguments[0],[...history,id]);
    {
let _cppLoop52Result:boolean=true;
const _cppLoop52Input:number[]=this.choices(id);
for(let _cppLoop52Index:number=0;_cppLoop52Index<_cppLoop52Input.length;_cppLoop52Index=_cppLoop52Index+1){
const t:number=_cppLoop52Input[_cppLoop52Index];
if(!(this.printable(t,[...history,id]))){_cppLoop52Result=false;break;}continue;
}
return sumKinds.includes(s.kind)&&_cppLoop52Result;}
  }
  output(value:string,id:number):string {
    const s=this.shape(id);if(["ref","constRef"].includes(s.kind))return this.output(`(*(${value}))`,s.arguments[0]);
    if(!this.printable(id))this.fail(`Tipo sin contrato de impresión C++: ${this.project.types[id]}`);
    if(["ptr","constPtr"].includes(s.kind))return `(${value}).get()`;
    if(s.numericKind=="integer"&&s.bits==8)return `static_cast<int>(${value})`;return value;
  }
  findDefinition(f:constRef<IrFunction>,value:number):IrInstruction {for(const b of f.blocks)for(const i of b.instructions)if(i.result==value)return i;this.fail("Temporal sin definición",f.source);return new IrInstruction("",-1,-1,f.source);}
  signature(f:constRef<IrFunction>,index:number):string {
    const ret=f.asynchronous&&this.shape(f.returns).kind!="Promise"?`ets::Task<${this.cppTypeId(f.bodyReturns)}>`:this.cppTypeId(f.returns);
    if(f.asynchronous){this.headers.add("runtime/ets_async.hpp");this.backends.libuv=true;}
    {
let _cppLoop24Result:string[]=[];
const _cppLoop24Input:number[]=f.captureTypes;
for(let k:number=0;k<_cppLoop24Input.length;k=k+1){
const t:number=_cppLoop24Input[k];
_cppLoop24Result.push(`${this.cppTypeId(t)}${f.captureModes[k]=="reference"?"*":""} c${k}`);continue;
}
{
let _cppLoop40Result:string[]=[];
const _cppLoop40Input:number[]=f.parameterTypes;
for(let k:number=0;k<_cppLoop40Input.length;k=k+1){
const t:number=_cppLoop40Input[k];
_cppLoop40Result.push(`${this.parameterType(t)} a${k}`);continue;
}
return `${ret} ir_f${index}(${[..._cppLoop24Result,..._cppLoop40Result].join(",")})`;}}
  }
  nativeBinding(f:constRef<IrFunction>):string {
    
let _cppLoop15Result:IrAnnotation[]=[];
const _cppLoop15Input:IrAnnotation[]=this.project.annotations;
for(let _cppLoop15Index:number=0;_cppLoop15Index<_cppLoop15Input.length;_cppLoop15Index=_cppLoop15Index+1){
const a:IrAnnotation=_cppLoop15Input[_cppLoop15Index];
if(a.name=="cpp_native"&&a.target.moduleId==f.source.moduleId&&a.target.node==f.source.node){_cppLoop15Result.push(a);continue;}
}
const matches=_cppLoop15Result;
    // A module may be visited through multiple imports; identical annotation records are not conflicting bindings.
    let unique:IrAnnotation[]=[];
    for(const a of matches){let present:boolean=false;for(const b of unique)if(b.source.moduleId==a.source.moduleId&&b.source.node==a.source.node&&b.arguments.length==a.arguments.length){let equal:boolean=true;for(let k:number=0;k<a.arguments.length;k=k+1)if(a.arguments[k]!=b.arguments[k])equal=false;if(equal)present=true;}if(!present)unique.push(a);}

    if(unique.length>1)this.fail("Multiple @cpp_native bindings",f.source);
    if(unique.length==0)return "";const a=unique[0];
    const symbol=a.arguments[0];
    if(a.arguments.length!=1||symbol==""||!validCppSymbol(symbol))this.fail("Invalid @cpp_native symbol",a.source);
    if(f.asynchronous||f.captureTypes.length!=0)this.fail("@cpp_native does not support async or captures",f.source);
    return symbol;
  }
  functionBody(f:constRef<IrFunction>,index:number):string {
    const native=this.nativeBinding(f);
    if(native!="") {
      
let _cppLoop57Result:string[]=[];
const _cppLoop57Input:number[]=f.parameterTypes;
for(let k:number=0;k<_cppLoop57Input.length;k=k+1){
const _:number=_cppLoop57Input[k];
_cppLoop57Result.push("std::move(a"+k+")");continue;
}
const call=native+"("+_cppLoop57Result.join(",")+")";
      return this.signature(f,index)+" {"+(this.project.types[f.returns]=="void"?call+";":"return "+call+";")+"}";
    }
    
let _cppLoop17Result:string[]=[];
const _cppLoop17Input:IrPlace[]=f.places;
for(let k:number=0;k<_cppLoop17Input.length;k=k+1){
const p:IrPlace=_cppLoop17Input[k];
{const _cppLoop17Part:string[]=p.kind=="local"&&p.global<0?[`ets::ir::Slot<${this.cppTypeId(p.typeId)}> p${k};`]:[];for(const _cppLoop17Item of _cppLoop17Part)_cppLoop17Result.push(_cppLoop17Item);continue;}
}
const locals=_cppLoop17Result;
    
let _cppLoop35Result:string[]=[];
const _cppLoop35Input:number[]=f.values;
for(let k:number=0;k<_cppLoop35Input.length;k=k+1){
const t:number=_cppLoop35Input[k];
_cppLoop35Result.push(`ets::ir::Slot<${this.cppTypeId(t)}> v${k};`);continue;
}
let values=_cppLoop35Result;
    
let _cppLoop11Result:string[]=[];
const _cppLoop11Input:IrBlock[]=f.blocks;
for(let k:number=0;k<_cppLoop11Input.length;k=k+1){
const b:IrBlock=_cppLoop11Input[k];
{const _cppLoop11Part:string[]=b.terminator=="suspend"&&this.project.types[this.shape(f.values[b.value]).arguments[0]]!="void"?[`ets::ir::Slot<${this.cppTypeId(this.shape(f.values[b.value]).arguments[0])}> await${k};`]:[];for(const _cppLoop11Item of _cppLoop11Part)_cppLoop11Result.push(_cppLoop11Item);continue;}
}
const awaited=_cppLoop11Result;
    let parameter=0;
let _cppLoop4Result:string[]=[];
const _cppLoop4Input:IrPlace[]=f.places;
for(let k:number=0;k<_cppLoop4Input.length;k=k+1){
const p:IrPlace=_cppLoop4Input[k];

      if(!p.parameter){const _cppLoop4Part:string[]=[];for(const _cppLoop4Item of _cppLoop4Part)_cppLoop4Result.push(_cppLoop4Item);continue;}
      // Un parámetro prestado llega a la firma como `T&`/`const T&`; el slot
      // guarda el puntero al referente, que es lo que el IR necesita para
      // proyectar el `deref` sin copiar el objeto.
      const borrowed=["ref","constRef"].includes(this.shape(p.typeId).kind);
      const current:number=parameter;parameter+=1;{const _cppLoop4Part:string[]=[borrowed?`p${k}.set(std::addressof(a${current}));`:`p${k}.set(std::move(a${current}));`];for(const _cppLoop4Item of _cppLoop4Part)_cppLoop4Result.push(_cppLoop4Item);continue;}
    
}
const initialize=_cppLoop4Result;
    // Only fuse an immediately consumed, single-use load. No call or mutation
    // can occur between the snapshot and its size query; other loads retain
    // value semantics, including snapshots that survive a later mutation.
    let uses:number[]=[];let definitionBlocks:number[]=[];let definitionPositions:number[]=[];
    for(let value:number=0;value<f.values.length;value=value+1){uses.push(0);definitionBlocks.push(-1);definitionPositions.push(-1);}
    for(let blockId:number=0;blockId<f.blocks.length;blockId=blockId+1)for(let position:number=0;position<f.blocks[blockId].instructions.length;position=position+1){const result:number=f.blocks[blockId].instructions[position].result;if(result>=0){definitionBlocks[result]=blockId;definitionPositions[result]=position;}}
    for(const block of f.blocks){
      if(block.value>=0)uses[block.value]+=1;
      for(const operation of block.instructions)for(const operand of operation.operands)uses[operand]+=1;
    }
    for(const place of f.places)if(place.index>=0)uses[place.index]+=1;
    for(const value of f.frameValues)uses[value]+=1;
let _cppLoop1Result:string[]=[];
const _cppLoop1Input:IrBlock[]=f.blocks;
for(let k:number=0;k<_cppLoop1Input.length;k=k+1){
const b:IrBlock=_cppLoop1Input[k];

      
let _cppLoop58Result:string[]=[];
const _cppLoop58Input:IrInstruction[]=b.instructions;
for(let _cppLoop58Index:number=0;_cppLoop58Index<_cppLoop58Input.length;_cppLoop58Index=_cppLoop58Index+1){
const i:IrInstruction=_cppLoop58Input[_cppLoop58Index];
this.consuming=[];
// A temporary defined earlier in this straight-line block and used only here
// can transfer its owned storage into a by-value call argument. Borrowed
// formals still use get(), so references keep their original referents.
if(i.op=="call"||i.op=="taskCreate")for(const value of i.operands)if(uses[value]==1&&definitionBlocks[value]==k&&definitionPositions[value]<_cppLoop58Index)this.consuming.push(value);
// Adjacent initialization has no opportunity to expose the temporary itself.
if(i.op=="store"&&i.operands.length==1&&uses[i.operands[0]]==1&&_cppLoop58Index>0&&_cppLoop58Input[_cppLoop58Index-1].result==i.operands[0]){
 _cppLoop58Result.push(this.place(f,i.place)+".set(v"+numberToString(i.operands[0])+".take());");continue;
}
if(i.op=="load"&&i.result>=0&&uses[i.result]==1&&i.place>=0&&f.places[i.place].kind!="index"&&_cppLoop58Index+1<_cppLoop58Input.length){
 const next:IrInstruction=_cppLoop58Input[_cppLoop58Index+1];
 const kind:string=this.shape(i.typeId).kind;
 if(next.op=="property"&&["length","size"].includes(next.text)&&next.operands.length==1&&next.operands[0]==i.result&&(kind=="array"||kind=="fixedArray"||this.project.types[i.typeId]=="string")){
  _cppLoop58Result.push("v"+numberToString(next.result)+".set(static_cast<double>(("+this.place(f,i.place)+".get()).size()));");
  _cppLoop58Index+=1;continue;
 }
}
_cppLoop58Result.push(this.instruction(f,i,k));continue;
}
let lines=_cppLoop58Result;const ret=f.asynchronous?"co_return":"return";
      switch(b.terminator) {
        case "jump":lines.push(`goto b${b.targets[0]};`);break;
        case "branch":lines.push(`if(v${b.value}.get())goto b${b.targets[0]};else goto b${b.targets[1]};`);break;
        case "return":lines.push(`${ret}${b.value<0?"":` v${b.value}.${this.shape(f.values[b.value]).resource?"take":"get"}()`};`);break;
        case "suspend": {
          const result=this.shape(f.values[b.value]).arguments[0];
          lines.push(this.project.types[result]=="void"?`co_await v${b.value}.take();`:`await${k}.set(co_await v${b.value}.take());`);
          lines.push(`goto b${b.targets[0]};`);break;
        }
        case "cancel":lines.push(`${ret};`);if(this.project.types[f.bodyReturns]!="void")lines[lines.length-1]="std::abort();";break;
        case "trap":case "unreachable":lines.push("std::abort();");break;
        default:this.fail(`Terminador sin soporte: ${b.terminator}`,b.source);
      }
      _cppLoop1Result.push(`b${k}:
${lines.join("\n")}`);continue;
    
}
const blocks=_cppLoop1Result;
    return `${this.signature(f,index)} {
${[...locals,...values,...awaited,...initialize,"goto b0;",...blocks].join("\n")}
}`;
  }
  layoutDependency(id:number):void {
    const s=this.shape(id);if(["ptr","constPtr","ref","constRef","function"].includes(s.kind))return;
    if(this.record(id)||sumKinds.includes(s.kind))this.layoutEmit(id);else for(const a of s.arguments)this.layoutDependency(a);
  }
  layoutEmit(id:number):void {
    if(this.layoutDone.includes(id))return;
    if(this.layoutActive.includes(id))this.fail("Ciclo de layout por valor en tipos IR");
    this.layoutActive.push(id);const s=this.shape(id);
    if(this.isInterface(id)){const text=`struct ir_t${id}{${this.interfaceVariant(id)} data;bool operator==(const ir_t${id}&)const=default;};`;this.layoutOutput.push(text);}
    else if(this.record(id)){for(const f of s.fields)this.layoutDependency(f);
let _cppLoop36Result:string[]=[];
const _cppLoop36Input:number[]=s.fields;
for(let k:number=0;k<_cppLoop36Input.length;k=k+1){
const t:number=_cppLoop36Input[k];
_cppLoop36Result.push(`ets::ir::Slot<${this.cppTypeId(t)}> f${k};`);continue;
}
const text=`struct ir_t${id}{${_cppLoop36Result.join("")}bool operator==(const ir_t${id}&)const=default;};`;this.layoutOutput.push(text);}
    else{for(const a of this.choices(id))this.layoutDependency(a);
let _cppLoop65Result:string[]=[];
const _cppLoop65Input:number[]=this.choices(id);
for(let _cppLoop65Index:number=0;_cppLoop65Index<_cppLoop65Input.length;_cppLoop65Index=_cppLoop65Index+1){
const t:number=_cppLoop65Input[_cppLoop65Index];
_cppLoop65Result.push(this.cppTypeId(t));continue;
}
const text=`struct ir_t${id}{std::variant<${_cppLoop65Result.join(",")}> data;bool operator==(const ir_t${id}&)const=default;};`;this.layoutOutput.push(text);}
    this.layoutActive.pop();this.layoutDone.push(id);
  }
  declarations():string{
    this.layoutDone=[];this.layoutActive=[];this.layoutOutput=[];
    for(let id:number=0;id<this.project.typeDefinitions.length;id=id+1)if(this.record(id)||sumKinds.includes(this.shape(id).kind))this.layoutEmit(id);
    return this.layoutOutput.join("\n");
  }
  dispatch(receiver:number,concrete:number,name:string,signature:number):IrDispatch {
    for(const d of this.project.dispatches)if(d.interfaceType==receiver&&d.concreteType==concrete&&d.name==name&&d.signature==signature)return d;
    return new IrDispatch(-1,-1,name,-1,-1);
  }
  validateBoundary():void {
    const p=this.project;
    if(p.success!=true||p.diagnostics.length!=0)this.fail("Se requiere ets-ir-2 verificado con success:true");
    if(p.types.length!=p.typeDefinitions.length)this.fail("Tablas de tipos incompletas");
    
    const scalar=["number","string","boolean","void","i8","u8","i16","u16","i32","u32","i64","u64","f32","f64"];
    for(let id=0;id<p.types.length;id=id+1) {
      const s=this.shape(id);if(s.kind=="scalar"&&!scalar.includes(p.types[id]))this.fail("Tipo escalar inválido");
      {
let _cppLoop60Result:boolean=true;
const _cppLoop60Input:number[]=[...s.arguments,...s.fields,...s.variants];
for(let _cppLoop60Index:number=0;_cppLoop60Index<_cppLoop60Input.length;_cppLoop60Index=_cppLoop60Index+1){
const id:number=_cppLoop60Input[_cppLoop60Index];
if(!(integerIndex(id)&&id>=0&&id<p.types.length)){_cppLoop60Result=false;break;}continue;
}
if(!_cppLoop60Result)this.fail("Referencia de tipo inexistente");}
      if(s.names.length!=s.fields.length)this.fail("Tabla de campos incompatible");
      {
let _cppLoop42Result:boolean=true;
const _cppLoop42Input:number[]=s.methodTypes;
for(let _cppLoop42Index:number=0;_cppLoop42Index<_cppLoop42Input.length;_cppLoop42Index=_cppLoop42Index+1){
const t:number=_cppLoop42Input[_cppLoop42Index];
if(!(this.validType(t)&&this.shape(t).kind=="function")){_cppLoop42Result=false;break;}continue;
}
if(s.methods.length!=s.methodTypes.length||!_cppLoop42Result)this.fail("Tabla de métodos incompatible");}
    }
    let dispatchKeys=new Set<string>();
    for(const d of p.dispatches) {
      const target=p.functions[d.callee];const key=`${d.interfaceType}:${d.concreteType}:${d.name}:${d.signature}`;
      if(!this.validType(d.interfaceType)||!this.validType(d.concreteType)||!this.validType(d.signature)||d.callee<0||d.callee>=p.functions.length||!this.isInterface(d.interfaceType)||!this.shape(d.interfaceType).variants.includes(d.concreteType)||this.shape(d.signature).kind!="function"||target.parameterTypes.length!=this.shape(d.signature).arguments.length||this.shape(target.parameterTypes[0]).kind!="ref"||this.shape(target.parameterTypes[0]).arguments[0]!=d.concreteType||dispatchKeys.has(key))this.fail("Contrato de dispatch de interfaz inválido");
      dispatchKeys.add(key);
    }
    for(const f of p.functions) {
      {
let _cppLoop21Result:boolean=true;

let _cppLoop73Result:number[]=[];
const _cppLoop73Input:IrPlace[]=f.places;
for(let _cppLoop73Index:number=0;_cppLoop73Index<_cppLoop73Input.length;_cppLoop73Index=_cppLoop73Index+1){
const x:IrPlace=_cppLoop73Input[_cppLoop73Index];
_cppLoop73Result.push(x.typeId);continue;
}
const _cppLoop21Input:number[]=[f.returns,f.bodyReturns,...f.parameterTypes,...f.values,..._cppLoop73Result];
for(let _cppLoop21Index:number=0;_cppLoop21Index<_cppLoop21Input.length;_cppLoop21Index=_cppLoop21Index+1){
const id:number=_cppLoop21Input[_cppLoop21Index];
if(!(integerIndex(id)&&id>=0&&id<p.types.length)){_cppLoop21Result=false;break;}continue;
}
if(!_cppLoop21Result)this.fail("Tipo de función/place/valor inexistente",f.source);}
      for(const b of f.blocks) {
        {
let _cppLoop53Result:boolean=true;
const _cppLoop53Input:number[]=b.targets;
for(let _cppLoop53Index:number=0;_cppLoop53Index<_cppLoop53Input.length;_cppLoop53Index=_cppLoop53Index+1){
const t:number=_cppLoop53Input[_cppLoop53Index];
if(!(integerIndex(t)&&t>=0&&t<f.blocks.length)){_cppLoop53Result=false;break;}continue;
}
if(!_cppLoop53Result)this.fail("Destino de bloque inexistente",b.source);}
        for(const i of b.instructions) {
          if(i.op=="binary"&&!["+","-","*","/","%","&","|","^","<<",">>","==","!=","<",">","<=",">="].includes(i.text))this.fail("Operador binario inválido",i.source);
          if(i.op=="unary"&&!["+","-","!","~"].includes(i.text))this.fail("Operador unario inválido",i.source);
          if(i.op=="intrinsic"&&!["print","write","printError","writeError"].includes(i.text))this.fail("Intrínseco inválido",i.source);
          {
let _cppLoop44Result:boolean=true;
const _cppLoop44Input:number[]=i.operands;
for(let _cppLoop44Index:number=0;_cppLoop44Index<_cppLoop44Input.length;_cppLoop44Index=_cppLoop44Index+1){
const v:number=_cppLoop44Input[_cppLoop44Index];
if(!(integerIndex(v)&&v>=0&&v<f.values.length)){_cppLoop44Result=false;break;}continue;
}
if(!_cppLoop44Result)this.fail("Operando inexistente",i.source);}
          if(["call","taskCreate","closure"].includes(i.op)&&(i.callee<0||i.callee>=p.functions.length))this.fail("Callee inexistente",i.source);
        }
      }
    }
  }
 validType(id:number):boolean{return integerIndex(id)&&id<this.project.types.length;}
 runtimeArgument(f:constRef<IrFunction>,i:constRef<IrInstruction>,k:number):string{
 const value:string=this.operand(f,i,k);return ["ref","constRef"].includes(this.shape(f.values[i.operands[k]]).kind)?"(*("+value+"))":value;}
 runtimeArguments(f:constRef<IrFunction>,i:constRef<IrInstruction>):string{
 let parts:string[]=[];for(let k:number=0;k<i.operands.length;k=k+1)parts.push(this.runtimeArgument(f,i,k));return parts.join(",");}

runtimeCall(f:constRef<IrFunction>,i:constRef<IrInstruction>):string {
  const c=this.project.runtimeContracts[i.contract];if(c.capability==""||c.effects.length==0)this.fail("Contrato runtime ausente",i.source);
  
  
  
let _cppLoop66Result:string[]=[];
const _cppLoop66Input:number[]=i.operands;
for(let k:number=0;k<_cppLoop66Input.length;k=k+1){
const _:number=_cppLoop66Input[k];
_cppLoop66Result.push(this.runtimeArgument(f,i,k));continue;
}
let  T=this.cppTypeId(i.typeId);
  if(c.name.startsWith("builtin.")) {
    const name=c.name.slice(8,c.name.length);
    const tls=backend_tls(name);
    if(backend_libuv(name))this.backends.libuv=true;
    if(backend_curl(name))this.backends.curl=true;
    if(tls)this.backends.tls=true;
    if(backend_ioUring(name))this.backends.ioUring=true;
    if(fileCallee(name)!=""||netCallee(name)!=""||networkCallee(name)!="") {
      this.headers.add("runtime/ets_runtime_full.hpp");this.backends.libuv=true;
      if(tls)this.headers.add("runtime/ets_tls.hpp");
      return `${(fileCallee(name)!=""?fileCallee(name):netCallee(name)!=""?netCallee(name):networkCallee(name))}(${this.runtimeArguments(f,i)})`;
    }
    if(regexCallee(name)!=""){this.headers.add("runtime/ets_regex.hpp");return `${regexCallee(name)}(${this.runtimeArguments(f,i)})`;}
    if(asyncCallee(name)!=""){this.headers.add(name=="resolveDns"?"runtime/ets_dns.hpp":"runtime/ets_async.hpp");this.backends.libuv=true;return `${asyncCallee(name)}(${this.runtimeArguments(f,i)})`;}
    if(["setTimeout","setInterval","cancelTimer"].includes(name)){this.headers.add("runtime/ets_timer.hpp");this.backends.libuv=true;return `ets::${name}(${this.runtimeArguments(f,i)})`;}
    if(["optionalMap","optionalAndThen"].includes(name))return `${name}(${this.operand(f,i,0)},${this.callback(f,i,1)})`;

    if(name=="stopLoop"){this.headers.add("runtime/ets_async.hpp");this.backends.libuv=true;return "ets::defaultEventLoop.stop()";}
    if(name=="length")return `ets::length(${this.operand(f,i,0)})`;
    if(name=="optionalSome")return `${T}::some(${this.operand(f,i,0)})`;
    if(name=="optionalNone")return `${T}::none()`;
    if(["ok","resultOk","err","resultErr"].includes(name))return `${T}::${["err","resultErr"].includes(name)?"failure":"success"}(${this.operand(f,i,0)})`;
    if(name=="optionalIsPresent")return `(${this.operand(f,i,0)}).isPresent()`;
    if(name=="optionalValueOr")return `(${this.operand(f,i,0)}).valueOr(${this.operand(f,i,1)})`;
    if(name=="booleanToString")return `std::string(${this.operand(f,i,0)}?"true":"false")`;
    if(name=="optionalOrElse")return `(${this.operand(f,i,0)}).orElse(${this.operand(f,i,1)})`;
    if(name=="resultIsOk")return `(${this.operand(f,i,0)}).isOk()`;
    if(globalCalls(name)) {
      if(name.includes("File")||name=="fileExists"){this.headers.add("runtime/ets_file.hpp");this.backends.libuv=true;}
      return `${name}(${this.runtimeArguments(f,i)})`;
    }
    if(asyncCalls(name)) {
      this.headers.add("runtime/ets_async.hpp");this.backends.libuv=true;
      if(["all","promiseAll","race","promiseRace"].includes(name)) {
        const race=["race","promiseRace"].includes(name);
        if(this.shape(i.typeId).kind=="Promise")return `ets::${race?"task_race":"task_all"}(${this.runtimeArguments(f,i)})`;
        return race?`([&](){auto tasks=${this.operand(f,i,0)};return ets::race(tasks);}())`:`ets::all(${this.runtimeArguments(f,i)})`;
      }
      return `ets::${name}(${this.runtimeArguments(f,i)})`;
    }
    return this.fail(`Capacidad runtime no implementada: ${c.capability}`,i.source);
  }
  const dot=c.name.lastIndexOf(".");const  base=c.name.slice(0,dot);const  method=c.name.slice(dot+1,c.name.length);
  if(base=="!http") {
    if(["createServer","express","server"].includes(method)){this.httpServer();return "ets::Server{}";}
    if(["param","query","header"].includes(method)){this.httpServer();return `ets::http_${method}(*(${this.operand(f,i,0,false)}),${this.operand(f,i,1)})`;}
    if(["get","post"].includes(method)) {
      this.headers.add("runtime/ets_http_curl_async.hpp");this.backends.curl=true;this.backends.libuv=true;
      
let _cppLoop69Result:string[]=[];
const _cppLoop69Input:number[]=i.operands;
for(let k:number=0;k<_cppLoop69Input.length;k=k+1){
const _:number=_cppLoop69Input[k];
_cppLoop69Result.push(this.operand(f,i,k));continue;
}
let values=_cppLoop69Result;if(method=="post"&&values.length==2)values.push('std::string("text/plain")');
      return `ets::httpClient${method=="get"?"Get":"Post"}Async(${values.join(",")})`;
    }
  }
  if(base=="Request.property"&&["method","path","rawQuery","body"].includes(method)){this.httpServer();return `(${this.operand(f,i,0,false)})->${method}`;}
  if(base=="Server") {
    this.httpServer();const receiver=this.deref(this.operand(f,i,0,false),f.values[i.operands[0]]);
    if(["get","post","put","patch","delete"].includes(method))return `(${receiver}).${method=="delete"?"del":method}(${this.operand(f,i,1)},[handler=${this.operand(f,i,2)}](const ets::HttpRequest& request,ets::HttpResponse& response)mutable{handler(std::addressof(request),std::addressof(response));})`;
    if(method=="listen"){
let _cppLoop45Result:string[]=[];
const _cppLoop45Input:number[]=i.operands.slice(1,i.operands.length);
for(let k:number=0;k<_cppLoop45Input.length;k=k+1){
const _:number=_cppLoop45Input[k];
_cppLoop45Result.push(this.operand(f,i,k+1));continue;
}
return `(${receiver}).listen(${_cppLoop45Result.join(",")})`;}
  }
  if(base=="Response"&&["status","header","send","json"].includes(method)){this.httpServer();{
let _cppLoop46Result:string[]=[];
const _cppLoop46Input:number[]=i.operands.slice(1,i.operands.length);
for(let k:number=0;k<_cppLoop46Input.length;k=k+1){
const _:number=_cppLoop46Input[k];
_cppLoop46Result.push(this.operand(f,i,k+1));continue;
}
return `std::addressof((${this.operand(f,i,0,false)})->${method}(${_cppLoop46Result.join(",")}))`;}}
  if(base=="HttpClientResponse"&&["status","body","header"].includes(method)){
let _cppLoop47Result:string[]=[];
const _cppLoop47Input:number[]=i.operands.slice(1,i.operands.length);
for(let k:number=0;k<_cppLoop47Input.length;k=k+1){
const _:number=_cppLoop47Input[k];
_cppLoop47Result.push(this.operand(f,i,k+1));continue;
}
return `(${this.deref(this.operand(f,i,0,false),f.values[i.operands[0]])}).${method=="status"?"status_code":method=="body"?"body_str":method}(${_cppLoop47Result.join(",")})`;}
  if(base=="Console"&&terminalMethods(method)){this.headers.add("runtime/ets_terminal.hpp");return `console.${method}(${this.runtimeArguments(f,i)})`;}
  if(objectMethod(base,method)) {
    if(["!fs","!path","!process"].includes(base)){this.headers.add("runtime/ets_runtime_full.hpp");this.backends.libuv=true;}
    const object=base=="Console"?"console":base.slice(1,base.length);
    {
let _cppLoop43Result:string[]=[];
const _cppLoop43Input:number[]=i.operands;
for(let k:number=0;k<_cppLoop43Input.length;k=k+1){
const v:number=_cppLoop43Input[k];
_cppLoop43Result.push(this.output(this.operand(f,i,k,false),f.values[v]));continue;
}
return `${object}.${method.startsWith("stringify")?"stringify":method}(${base=="Console"?_cppLoop43Result.join(","):this.runtimeArguments(f,i)})`;}
  }
  if(base=="string"&&stringMethods(method))return `ets::string_${method}(${this.runtimeArguments(f,i)})`;
  if(i.operands.length==0)this.fail(`Capacidad runtime no implementada: ${c.capability}`,i.source);
  const actual=f.values[i.operands[0]];const  input=this.inner(actual);const  shape=this.shape(input);const  receiver=this.deref(this.operand(f,i,0,false),actual);
  if(["Optional","Result"].includes(base)) {
    if(["isPresent","isEmpty","isOk","value","error","valueOr","orElse"].includes(method)) {
      const value=this.shape(actual).resource?this.operand(f,i,0):this.operand(f,i,0,false);
      {
let _cppLoop48Result:string[]=[];
const _cppLoop48Input:number[]=i.operands.slice(1,i.operands.length);
for(let k:number=0;k<_cppLoop48Input.length;k=k+1){
const _:number=_cppLoop48Input[k];
_cppLoop48Result.push(this.operand(f,i,k+1));continue;
}
return `(${this.deref(value,actual)}).${method}(${_cppLoop48Result.join(",")})`;}
    }
    if(["map","andThen"].includes(method))return `(${receiver}).${method}(${this.callback(f,i,1)})`;
  }
  if(["Map","Set"].includes(base)) {
    if(["set","add","has","clear","size","delete"].includes(method)){
let _cppLoop49Result:string[]=[];
const _cppLoop49Input:number[]=i.operands.slice(1,i.operands.length);
for(let k:number=0;k<_cppLoop49Input.length;k=k+1){
const _:number=_cppLoop49Input[k];
_cppLoop49Result.push(this.operand(f,i,k+1));continue;
}
return `(${receiver}).${method=="delete"?"removeKey":method}(${_cppLoop49Result.join(",")})`;}
    if(method=="get")return `${T}::of((${receiver}).get(${this.operand(f,i,1)}))`;
    if(method=="forEach")return `(${receiver}).forEach(${this.callback(f,i,1)})`;
  }
  if(base=="array") {
    this.headers.add("runtime/ets_collections.hpp");const E=this.elementType(shape.arguments[0]);
    
    if(method=="push")return `ets_push_vec<${E}>(${receiver},${this.operand(f,i,1)})`;
    if(method=="pop")return `ets_pop_vec<${E}>(${receiver})`;
    if(method=="delete")return `(${receiver}).erase((${receiver}).begin()+static_cast<std::ptrdiff_t>(${this.operand(f,i,1)}))`;
    if(method=="map")return `ets_map_vec<${E},${this.elementType(this.shape(i.typeId).arguments[0])}>(${receiver},${this.callback(f,i,i.operands.length-1)})`;
    if(method=="flatMap")return `ets_flat_map_vec<${E},${this.elementType(this.shape(i.typeId).arguments[0])}>(${receiver},${this.callback(f,i,i.operands.length-1)})`;
    if(method=="filter")return `ets_filter_vec<${E}>(${receiver},${this.callback(f,i,i.operands.length-1)})`;
    if(method=="forEach")return `ets_for_each_vec(${receiver},${this.callback(f,i,i.operands.length-1)})`;
    if(method=="some")return `ets_some_vec(${receiver},${this.callback(f,i,i.operands.length-1)})`;
    if(method=="every")return `ets_every_vec(${receiver},${this.callback(f,i,i.operands.length-1)})`;
    if(method=="find")return `ets_find_vec(${receiver},${this.callback(f,i,i.operands.length-1)})`;
    if(method=="reduce")return `ets_reduce(${this.operand(f,i,1)},${receiver},${this.callback(f,i,i.operands.length-1)})`;
    if(method=="slice")return `ets_slice_vec(${receiver},${this.operand(f,i,1)},${i.operands.length>2?this.operand(f,i,2):`static_cast<int>((${receiver}).size())`})`;
    if(method=="includes")return `ets_includes_vec(${receiver},${this.operand(f,i,1)})`;
    if(method=="join")return `ets_join_vec(${receiver},${this.operand(f,i,1)})`;
    if(method=="concat"){
let _cppLoop38Result:string[]=[];
const _cppLoop38Input:number[]=i.operands;
for(let k:number=0;k<_cppLoop38Input.length;k=k+1){
const _:number=_cppLoop38Input[k];
_cppLoop38Result.push(this.deref(this.operand(f,i,k),f.values[i.operands[k]]));continue;
}
return `ets_concat_vec<${E}>({${_cppLoop38Result.join(",")}})`;}
    if(method=="sort")return i.operands.length==1?`([&](){std::sort((${receiver}).begin(),(${receiver}).end());return ${this.shape(i.typeId).resource?`std::move(${receiver})`:receiver};}())`:`ets_sort_vec(${receiver},${this.callback(f,i,i.operands.length-1)})`;
  }
  return this.fail(`Capacidad runtime no implementada: ${c.capability}`,i.source);
}

 validateAnnotations():void {
  this.cppGenerators=[];
  for(const a of this.project.annotations){
   if(["cpp_name","cpp_type","link","cpp_header","cpp_link","cpp_include"].includes(a.name))this.fail("ABI externo no implementado: @"+a.name,a.source);
   if(a.name=="include"){if(a.arguments.length!=1||!validHeader(a.arguments[0]))this.fail("@include: ruta inválida",a.source);this.headers.add(a.arguments[0]);}
   if(a.name!="cppgen")continue;
   if(a.arguments.length!=0)this.fail("@cppgen: anotación no admite argumentos",a.source);
   let matched:boolean=false;
   for(let k:number=0;k<this.project.functions.length;k=k+1){
    const f:IrFunction=this.project.functions[k];
    if(f.source.file!=a.target.file||f.source.start!=a.target.start||f.source.moduleId!=a.target.moduleId||f.source.node!=a.target.node)continue;
    matched=true;if(this.cppGenerators.includes(k))this.fail("@cppgen duplicado",a.source);this.cppGenerators.push(k);
    if(f.asynchronous||f.captureTypes.length!=0||f.parameterTypes.length!=1||this.project.types[f.parameterTypes[0]]!="string"||this.project.types[f.returns]!="string"||f.blocks.length!=1)this.fail("@cppgen requiere identidad (code:string):string",a.source);
    const b=f.blocks[0];if(b.terminator!="return"||b.instructions.length!=1)this.fail("@cppgen: cuerpo de identidad requerido",a.source);
    const i=b.instructions[0];
    {
let _cppLoop70Result:IrPlace[]=[];
const _cppLoop70Input:IrPlace[]=f.places;
for(let _cppLoop70Index:number=0;_cppLoop70Index<_cppLoop70Input.length;_cppLoop70Index=_cppLoop70Index+1){
const p:IrPlace=_cppLoop70Input[_cppLoop70Index];
if(p.parameter){_cppLoop70Result.push(p);continue;}
}
if(i.op!="load"||i.result!=b.value||i.result<0||i.result>=f.values.length||f.values[i.result]!=f.returns||i.typeId!=f.returns||i.place<0||i.place>=f.places.length||!f.places[i.place].parameter||f.places[i.place].typeId!=f.returns||_cppLoop70Result.length!=1)this.fail("@cppgen: cuerpo de identidad requerido",a.source);}
   }
   if(!matched)this.fail("@cppgen: destino inexistente",a.source);
  }
 }
 cppEscape(f:constRef<IrFunction>,i:constRef<IrInstruction>):string{
  if(!this.cppGenerators.includes(i.callee))return this.fail("Capacidad @cppgen sin anotación",i.source);
  if(f.asynchronous||i.result!=-1||i.typeId<0||this.project.types[i.typeId]!="void"||i.operands.length!=1)return this.fail("@cppgen requiere sentencia síncrona literal",i.source);
  const code=this.findDefinition(f,i.operands[0]);
  if(code.op!="constant"||code.typeId<0||this.project.types[code.typeId]!="string")return this.fail("@cppgen requiere literal string",i.source);
  for(let at:number=0;at<code.text.length;at=at+1)if(code.text.charCodeAt(at)==0)return this.fail("@cppgen: NUL no admitido",i.source);
  let names:string[]=[];for(const p of f.places)if(p.parameter){
   if(!validCppSymbol(p.name)||p.name.includes("::")||names.includes(p.name))return this.fail("@cppgen: parámetro inválido",i.source);names.push(p.name);
  }
  let prefix:string="ir_cpp_arg";let collision:boolean=true;
  while(collision){collision=false;for(let k:number=0;k<f.places.length;k=k+1)if(names.includes(prefix+numberToString(k)))collision=true;if(collision)prefix+="_";}
  let bridges:string="";let aliases:string="";
  for(let k:number=0;k<f.places.length;k=k+1)if(f.places[k].parameter){
   bridges+="auto& "+prefix+numberToString(k)+"="+this.place(f,k)+".get();\n";
   aliases+="auto& "+f.places[k].name+"="+prefix+numberToString(k)+";\n";
  }
  return "{\n"+bridges+"{\n"+aliases+code.text+"\n}\n}";
 }
  generate():IrCppResult {
    this.validateAnnotations();
    this.validateBoundary();
    for(const f of this.project.functions)for(const b of f.blocks)for(const i of b.instructions)if((i.op=="call"||i.op=="closure")&&this.cppGenerators.includes(i.callee))this.fail("@cppgen requiere llamada directa como sentencia",i.source);
    for(const annotation of this.project.annotations)if(["cpp_name","cpp_type","link","cpp_header","cpp_link"].includes(annotation.name))this.fail(`ABI externo no implementado: @${annotation.name}`,annotation.source);
    if(!this.project.success||this.project.diagnostics.length!=0)this.fail("Se requiere ets-ir-2 verificado con success:true");
    if(this.project.types.length!=this.project.typeDefinitions.length)this.fail("Tablas de tipos incompletas");
    for(const f of this.project.functions){
let _cppLoop74Result:number[]=[];
const _cppLoop74Input:IrPlace[]=f.places;
for(let _cppLoop74Index:number=0;_cppLoop74Index<_cppLoop74Input.length;_cppLoop74Index=_cppLoop74Index+1){
const p:IrPlace=_cppLoop74Input[_cppLoop74Index];
_cppLoop74Result.push(p.typeId);continue;
}
for(const t of [...f.values,...f.parameterTypes,..._cppLoop74Result])if(this.shape(t).kind=="parameter")this.fail("Parámetro genérico sin especializar en código ejecutable",f.source);}
    for(const f of this.project.functions)for(const b of f.blocks)for(const i of b.instructions)if(!ops.includes(i.op))this.fail(`Capacidad C++ no soportada: ${i.op}`,i.source);
    for(const a of this.project.annotations)if(["include","cpp_include"].includes(a.name)) {
      const h=a.arguments[0];
      if(a.arguments.length!=1||h==""||h.startsWith("/")||h.includes("..")||!validHeader(h))this.fail("Invalid @include header",a.source);
      this.headers.add(h);
    }
    const declarations=this.declarations();
let _cppLoop39Result:string[]=[];
const _cppLoop39Input:IrFunction[]=this.project.functions;
for(let k:number=0;k<_cppLoop39Input.length;k=k+1){
const f:IrFunction=_cppLoop39Input[k];
_cppLoop39Result.push(this.signature(f,k)+";");continue;
}
const prototypes=_cppLoop39Result;
let _cppLoop41Result:string[]=[];
const _cppLoop41Input:IrFunction[]=this.project.functions;
for(let k:number=0;k<_cppLoop41Input.length;k=k+1){
const f:IrFunction=_cppLoop41Input[k];
_cppLoop41Result.push(this.functionBody(f,k));continue;
}
const bodies=_cppLoop41Result;
    
let _cppLoop26Result:string[]=[];
const _cppLoop26Input:IrPlace[]=this.project.globals;
for(let k:number=0;k<_cppLoop26Input.length;k=k+1){
const p:IrPlace=_cppLoop26Input[k];
_cppLoop26Result.push(`ets::ir::Slot<${this.cppTypeId(p.typeId)}> ir_g${k};`);continue;
}
const globals=_cppLoop26Result;
    
    
let _cppLoop20Result:boolean=false;
const _cppLoop20Input:IrRuntimeContract[]=this.project.runtimeContracts;
for(let _cppLoop20Index:number=0;_cppLoop20Index<_cppLoop20Input.length;_cppLoop20Index=_cppLoop20Index+1){
const c:IrRuntimeContract=_cppLoop20Input[_cppLoop20Index];
if(["builtin.watchFs","builtin.setInterval"].includes(c.name)){_cppLoop20Result=true;break;}continue;
}

let _cppLoop71Result:string[]=[];
const _cppLoop71Input:number[]=this.project.initializationOrder;
for(let _cppLoop71Index:number=0;_cppLoop71Index<_cppLoop71Input.length;_cppLoop71Index=_cppLoop71Index+1){
const id:number=_cppLoop71Input[_cppLoop71Index];
_cppLoop71Result.push(this.project.functions[id].asynchronous?`ets::syncWait(ir_f${id}());`:`ir_f${id}();`);continue;
}

let _cppLoop72Result:string[]=[];
const _cppLoop72Input:number[]=this.project.finalizationOrder;
for(let _cppLoop72Index:number=0;_cppLoop72Index<_cppLoop72Input.length;_cppLoop72Index=_cppLoop72Index+1){
const id:number=_cppLoop72Input[_cppLoop72Index];
_cppLoop72Result.push(this.project.functions[id].asynchronous?`ets::syncWait(ir_f${id}());`:`ir_f${id}();`);continue;
}
const main=`int main(int argc,char** argv){ets_argc=argc;ets_argv=argv;${_cppLoop71Result.join("")}${this.backends.libuv?"ets::defaultEventLoop.drainDetached();":""}${_cppLoop20Result?"ets::defaultEventLoop.run();":""}${_cppLoop72Result.join("")}return 0;}`;
    
let _cppLoop18Result:string[]=[];
const _cppLoop18Input:IrType[]=this.project.typeDefinitions;
for(let k:number=0;k<_cppLoop18Input.length;k=k+1){
const s:IrType=_cppLoop18Input[k];
{const _cppLoop18Part:string[]=this.record(k)||sumKinds.includes(s.kind)?[`struct ir_t${k};`]:[];for(const _cppLoop18Item of _cppLoop18Part)_cppLoop18Result.push(_cppLoop18Item);continue;}
}
const forwards=_cppLoop18Result;
    
let _cppLoop22Result:number[]=[];
const _cppLoop22Input:IrType[]=this.project.typeDefinitions;
for(let k:number=0;k<_cppLoop22Input.length;k=k+1){
const s:IrType=_cppLoop22Input[k];
{const _cppLoop22Part:number[]=s.kind=="variant"||sumKinds.includes(s.kind)?[k]:[];for(const _cppLoop22Item of _cppLoop22Part)_cppLoop22Result.push(_cppLoop22Item);continue;}
}
const printable=_cppLoop22Result;
    
let _cppLoop27Result:string[]=[];
const _cppLoop27Input:number[]=printable;
for(let _cppLoop27Index:number=0;_cppLoop27Index<_cppLoop27Input.length;_cppLoop27Index=_cppLoop27Index+1){
const k:number=_cppLoop27Input[_cppLoop27Index];
_cppLoop27Result.push(`inline std::ostream& operator<<(std::ostream& out,const ir_t${k}& value);`);continue;
}
const printerPrototypes=_cppLoop27Result;
    
let _cppLoop9Result:string[]=[];
const _cppLoop9Input:number[]=printable;
for(let _cppLoop9Index:number=0;_cppLoop9Index<_cppLoop9Input.length;_cppLoop9Index=_cppLoop9Index+1){
const k:number=_cppLoop9Input[_cppLoop9Index];
_cppLoop9Result.push(`inline std::ostream& operator<<(std::ostream& out,const ir_t${k}& value){${this.shape(k).kind=="variant"?`return out<<${quoteCpp(this.shape(k).tag)};`:`std::visit([&](const auto& x){if constexpr(requires{out<<x;})out<<x;else std::abort();},value.data);return out;`}}`);continue;
}
const printers=_cppLoop9Result;
    
let _cppLoop14Result:string[]=[];

let _cppLoop55Result:string[]=[];
const _cppLoop55Input:string[]=this.headers.values;
for(let _cppLoop55Index:number=0;_cppLoop55Index<_cppLoop55Input.length;_cppLoop55Index=_cppLoop55Index+1){
const h:string=_cppLoop55Input[_cppLoop55Index];
if(h!="runtime/ets_runtime.hpp"){_cppLoop55Result.push(h);continue;}
}
const _cppLoop14Input:string[]=["runtime/ets_runtime.hpp",..._cppLoop55Result.sort()];
for(let _cppLoop14Index:number=0;_cppLoop14Index<_cppLoop14Input.length;_cppLoop14Index=_cppLoop14Index+1){
const h:string=_cppLoop14Input[_cppLoop14Index];
_cppLoop14Result.push(`#include ${quoteCpp(h)}`);continue;
}
const includes=_cppLoop14Result;
    
let _cppLoop50Result:string[]=[];
const _cppLoop50Input:IrRuntimeContract[]=this.project.runtimeContracts;
for(let _cppLoop50Index:number=0;_cppLoop50Index<_cppLoop50Input.length;_cppLoop50Index=_cppLoop50Index+1){
const c:IrRuntimeContract=_cppLoop50Input[_cppLoop50Index];
_cppLoop50Result.push(c.capability);continue;
}
let capabilities:string[]=uniqueStrings(_cppLoop50Result);capabilities.sort();
    const translationUnit:string[]=["// Generated from verified ets-ir-2. No source AST is used.","#include <array>\n#include <tuple>\n#include <functional>\n#include <iterator>\n#include <variant>",...includes,...forwards,...printerPrototypes,declarations,...printers,...globals,...prototypes,...bodies,main,""];return new IrCppResult(translationUnit.join("\n"),this.headers.values.sort(),this.backends,capabilities);
  }
}
export function generateCppFromIr(project:IrProject):IrCppResult{let generator=new IrCppGenerator(project);return generator.generate();}
