import { cppType } from "../cpp-types.ts";
import { IrCodegenError, type IrProject, type IrType, type IrFunction, type IrInstruction, type IrSource } from "./model.ts";
import { emitRuntimeCall } from "./runtime-calls.ts";
import type { RuntimeBackends } from "../../modules/runtime-backends.ts";

export interface IrCppResult { cpp: string; headers: string[]; runtimeBackends: RuntimeBackends; capabilities: string[] }
const recordKinds = new Set(["record","interface","intersection","variant"]);
const sumKinds = new Set(["sum","union"]);
const ops = new Set(["constant","load","store","address","move","borrow","dropRemaining","aggregate","record","property","extractIndex","emptyRecord","collection","isPresent","unwrap","typeTag","typeTest","iterator","iterHasNext","iterNext","some","result","variant","convert","unary","binary","dropFrame","resume","endBorrow","own","dropValue","none","closure","callIndirect","call","taskCreate","runtimeCall","intrinsic"]);

/** A pure consumer of verified ets-ir-2. It never consults or reconstructs ASTs. */
export class IrCppGenerator {
  readonly headers = new Set(["runtime/ets_runtime.hpp","runtime/ets_ir.hpp"]);
  readonly backends: RuntimeBackends = {libuv:false,curl:false,tls:false,ioUring:false};
  readonly project: IrProject;
  constructor(project: IrProject) { this.project=project; }
  fail(message: string, source?: IrSource): never { throw new IrCodegenError(message, source); }
  shape(id: number): IrType { return this.project.typeDefinitions[id] ?? this.fail(`Tipo IR inexistente: ${id}`); }
  type(id: number): string {
    const s=this.shape(id), a=s.arguments, t=(n:number)=>this.type(n);
    if(recordKinds.has(s.kind)||sumKinds.has(s.kind))return `ir_t${id}`;
    switch(s.kind) {
      case "scalar": return cppType(this.project.types[id]);
      case "enum": return t(a[0]);
      case "ptr": case "constPtr": return `std::unique_ptr<${s.kind==="constPtr"?"const ":""}${t(a[0])}>`;
      case "ref": case "constRef": return `${s.kind==="constRef"?"const ":""}${t(a[0])}*`;
      case "readonly": return t(a[0]);
      case "array": return `std::vector<${this.elementType(a[0])}>`;
      case "fixedArray": return `std::array<${t(a[0])},${s.length}>`;
      case "tuple": case "pack": return `std::tuple<${a.map(t).join(",")}>`;
      case "function": return `std::function<${t(a.at(-1)!)}(${a.slice(0,-1).map(t).join(",")})>`;
      case "Optional": return `ets::Optional<${t(a[0])}>`;
      case "Result": if(this.project.types[a[1]]!=="string")this.fail("El runtime C++ requiere Result<T,string>"); this.headers.add("runtime/ets_async.hpp");this.backends.libuv=true;return `ets::Result<${t(a[0])}>`;
      case "Promise": this.headers.add("runtime/ets_async.hpp");this.backends.libuv=true;return `ets::Task<${t(a[0])}>`;
      case "Map": case "Set": return `ets::${s.kind}<${a.map(t).join(",")}>`;
      case "iterator": return `std::size_t`;
      case "parameter": return "std::monostate"; // unused generic metadata, rejected when an executable slot needs it
      case "runtime": {
        const name=this.project.types[id];
        if(name==="Timer")this.fail("runtime:Timer necesita un contrato de ownership/copia en el IR para reutilizar el Timer no copiable de C++");
        if(["JsonValue","Console","Regex","Request","Response","HttpClientResponse","FileReader","TcpListener","TcpConnection","TlsContext","TlsConnection","CancellationSource","CancellationToken","Server","Timer","FsWatcher","FsEvent"].includes(name)) {
          if(name==="Regex")this.headers.add("runtime/ets_regex.hpp");
          else if(!["JsonValue","Console"].includes(name)){this.headers.add("runtime/ets_runtime_full.hpp");this.backends.libuv=true;}
          return cppType(name);
        }
      }
    }
    return this.fail(`Shape C++ sin representación: ${s.kind}`);
  }
  elementType(id:number):string {return this.project.types[id]==="boolean"?"ets::ir::Boolean":this.type(id);}
  // Canonical names are only diagnostics. C++ identifiers come exclusively from IDs.
  record(id:number): boolean { return recordKinds.has(this.shape(id).kind); }
  choices(id:number): number[] { const s=this.shape(id);return s.kind==="union"?s.variants:s.arguments; }
  numeric(id:number): boolean { return this.shape(id).numericKind!=="none"; }
  deref(value:string,id:number):string { return ["ref","constRef","ptr","constPtr"].includes(this.shape(id).kind)?`(*(${value}))`:value; }
  inner(id:number):number { return ["ref","constRef","ptr","constPtr","readonly"].includes(this.shape(id).kind)?this.shape(id).arguments[0]:id; }
  literal(text:string,id:number):string {
    const s=this.shape(id);if(s.kind==="enum")return this.literal(text,s.arguments[0]);
    const name=this.project.types[id];
    if(name==="string")return `std::string(${JSON.stringify(text)},${Buffer.byteLength(text,"utf8")})`;
    if(name==="boolean"){if(!["true","false"].includes(text))this.fail("Constante boolean inválida");return text;}
    const raw=text.replaceAll("_","");
    if(!/^-?(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(raw))this.fail("Constante numérica inválida");
    if(name==="i64")return raw==="-9223372036854775808"?"(-9223372036854775807LL-1LL)":`${raw}LL`;
    if(name==="u64")return `${raw}ULL`;
    if(s.numericKind==="float") {
      let floating=/^-?0[xXbBoO]/.test(raw)?String(raw.startsWith("-")?-Number(BigInt(raw.slice(1))):Number(BigInt(raw))):raw;
      if(!/[.eE]/.test(floating))floating+=".0";
      return `static_cast<${this.type(id)}>(${floating})`;
    }
    const cppRaw=raw.replace(/^(-?)0[oO]/,"$10");
    return `static_cast<${this.type(id)}>(${cppRaw})`;
  }
  convert(value:string,from:number,to:number):string {
    if(from===to)return value;
    const a=this.shape(from), b=this.shape(to), T=this.type(to);
    if(["ref","constRef"].includes(a.kind)&&!["ref","constRef"].includes(b.kind))return this.convert(`(*(${value}))`,a.arguments[0],to);
    if(b.kind==="readonly")return this.convert(value,from,b.arguments[0]);
    if(this.numeric(from)&&this.numeric(to))return `ets::ir::cast<${T}>(${value})`;
    if(a.kind==="enum")return this.convert(value,a.arguments[0],to);
    if(b.kind==="enum")return this.convert(value,from,b.arguments[0]);
    if(this.project.types[to]==="string")return a.numericKind==="integer"?`std::to_string(${value})`:`ets::concat(${value})`;
    if(b.kind==="Optional"&&a.kind!=="Optional")return `${T}::some(${this.convert(value,from,b.arguments[0])})`;
    if(sumKinds.has(b.kind)) {
      const at=this.choices(to).indexOf(from);
      if(at>=0)return `${T}{std::variant<${this.choices(to).map(x=>this.type(x)).join(",")}>{std::in_place_index<${at}>,${value}}}`;
    }
    if(sumKinds.has(a.kind)&&this.choices(from).includes(to))return `std::get<${this.choices(from).indexOf(to)}>(${value}.data)`;
    if(this.record(from)&&this.record(to)) {
      const fields=b.names.map((name,k)=>{const at=a.names.indexOf(name);if(at<0)this.fail(`Campo ausente en conversión: ${name}`);return `out.f${k}.set(${this.convert(`input.f${at}.${this.shape(a.fields[at]).resource?"take":"get"}()`,a.fields[at],b.fields[k])});`;});
      return `([&](){auto input=${value};${T} out;${fields.join("")}return out;}())`;
    }
    if(a.kind==="function"&&b.kind==="function") {
      const args=b.arguments.slice(0,-1), ret=b.arguments.at(-1)!;
      const call=`fn(${a.arguments.slice(0,-1).map((x,k)=>this.convert(`x${k}`,args[k],x)).join(",")})`;
      return `([fn=${value}](${args.map((x,k)=>`${this.type(x)} x${k}`).join(",")})mutable->${this.type(ret)}{${this.project.types[ret]==="void"?`${call};`:`return ${this.convert(call,a.arguments.at(-1)!,ret)};`}})`;
    }
    // Structural container conversions remain explicit, never C++ reinterpret casts.
    if(["array","fixedArray"].includes(a.kind)&&["array","fixedArray"].includes(b.kind))return `([&](){auto input=${value};${T} out;${b.kind==="array"?"out.reserve(input.size());":"std::size_t k=0;"}for(auto&& x:input){${b.kind==="array"?"out.push_back(":"out[k++]=("}${this.convert(this.shape(a.arguments[0]).resource?"std::move(x)":"x",a.arguments[0],b.arguments[0])});}return out;}())`;
    if(a.kind==="ref"&&b.kind==="constRef"&&a.arguments[0]===b.arguments[0])return value;
    return this.fail(`Conversión C++ no soportada: ${this.project.types[from]} → ${this.project.types[to]}`);
  }
  field(base:string,type:number,index:number):string {
    const s=this.shape(type);
    if(!sumKinds.has(s.kind))return `(${base}).f${index}`;
    const name=s.names[index], alternatives=this.choices(type);
    const branches=alternatives.map((alt,k)=>{
      const shape=this.shape(alt), field=shape.names.indexOf(name);
      if(field<0||shape.fields[field]!==s.fields[index])this.fail(`Campo común de unión sin representación uniforme: ${name}`);
      return `${k?"else ":""}if constexpr(std::is_same_v<std::remove_cvref_t<decltype(x)>,${this.type(alt)}>)return (x.f${field});`;
    }).join("");
    return `std::visit([](auto& x)->decltype(auto){${branches}},(${base}).data)`;
  }
  place(f:IrFunction,id:number):string {
    const p=f.places[id];if(!p)return this.fail(`Place inexistente: ${id}`,f.source);
    if(p.global>=0)return `ir_g${p.global}`;
    if(p.kind==="local")return `p${id}`;
    if(p.kind==="capture")return `ets::ir::view(${f.captureModes[p.field]==="reference"?`*c${p.field}`:`c${p.field}`})`;
    const parent=f.places[p.base], raw=`${this.place(f,p.base)}.get()`;
    if(p.kind==="field")return this.field(raw,parent.typeId,p.field);
    if(p.kind==="deref")return this.shape(parent.typeId).kind==="readonly"?`ets::ir::view(${raw})`:`ets::ir::view(*(${raw}))`;
    if(p.kind==="checkedView")return sumKinds.has(this.shape(parent.typeId).kind)?`ets::ir::view(std::get<${this.choices(parent.typeId).indexOf(p.typeId)}>(${raw}.data))`:this.place(f,p.base);
    if(p.kind==="index") {
      const s=this.shape(parent.typeId);
      if(["tuple","pack"].includes(s.kind))return `ets::ir::view(std::get<${this.constantIndex(f,p.index)}>(${raw}))`;
      if(this.project.types[parent.typeId]==="string")return this.fail("Los índices de string requieren una lectura, no un place escribible",p.source);
      return `ets::ir::view((${raw}).at(static_cast<std::size_t>(v${p.index}.get()))${s.kind==="array"&&this.project.types[s.arguments[0]]==="boolean"?".value":""})`;
    }
    return this.fail(`Place C++ desconocido: ${p.kind}`,p.source);
  }
  constantIndex(f:IrFunction,value:number):number { for(const b of f.blocks)for(const i of b.instructions)if(i.result===value&&i.op==="constant")return Number(i.text);return this.fail("Índice de tupla no constante",f.source); }
  operand(f:IrFunction,i:IrInstruction,k:number,consume=true):string {
    const value=i.operands[k], type=f.values[value];if(type===undefined)this.fail("Operando IR inexistente",i.source);
    return `v${value}.${consume&&this.shape(type).resource?"take":"get"}()`;
  }
  callback(f:IrFunction,i:IrInstruction,k:number):string {
    const id=f.values[i.operands[k]], s=this.shape(id), args=s.arguments.slice(0,-1);
    return `[&](${args.map((_,n)=>`auto&& x${n}`).join(",")})->${this.type(s.arguments.at(-1)!)}{${this.project.types[s.arguments.at(-1)!]==="void"?"":"return "}${this.operand(f,i,k,false)}(${args.map((t,n)=>["ref","constRef"].includes(this.shape(t).kind)?`std::addressof(ets::ir::read(x${n}))`:`x${n}`).join(",")});}`;
  }
  instruction(f:IrFunction,i:IrInstruction,block:number):string {
    const a=(k:number,consume=true)=>this.operand(f,i,k,consume), s=this.shape.bind(this), T=i.typeId>=0?this.type(i.typeId):"void";
    let value:string|undefined;
    switch(i.op) {
      case "constant": value=this.literal(i.text,i.typeId);break;
      case "load": {
        const p=f.places[i.place];
        if(p?.kind==="index"&&this.project.types[f.places[p.base].typeId]==="string")value=`ets::string_charAt(${this.place(f,p.base)}.get(),v${p.index}.get())`;
        else value=`${this.place(f,i.place)}.get()`;break;
      }
      case "move": value=`${this.place(f,i.place)}.take()`;break;
      case "borrow": case "address": value=`std::addressof(${this.place(f,i.place)}.get())`;break;
      case "store": return `${this.place(f,i.place)}.set(${a(0)});`;
      case "dropRemaining": return `${this.place(f,i.place)}.drop();`;
      case "dropValue": return `v${i.operands[0]}.drop();`;
      case "endBorrow": return `// end lease ${i.lease}; statically verified, no runtime ownership`;
      case "dropFrame": return [...f.frameValues.map(v=>`v${v}.drop();`),...f.framePlaces.filter(p=>f.places[p].kind==="local").map(p=>`p${p}.drop();`)].join("\n");
      case "own": value=`std::make_unique<${this.type(s(i.typeId).arguments[0])}>(${a(0)})`;break;
      case "convert": value=this.convert(a(0),f.values[i.operands[0]],i.typeId);break;
      case "unary": value=i.text==="-"&&s(i.typeId).numericKind==="integer"?`ets::ir::sub<${T}>(0,${a(0)})`:i.text==="~"?`static_cast<${T}>(~static_cast<${s(i.typeId).numericKind==="float"?"std::int64_t":T}>(${a(0)}))`:`(${i.text}${a(0)})`;break;
      case "binary": {
        const helpers:Record<string,string>={"+":"add","-":"sub","*":"mul","/":"divide","%":"remainder","<<":"shiftLeft",">>":"shiftRight"};
        if(helpers[i.text]&&this.numeric(i.typeId))value=`ets::ir::${helpers[i.text]}<${T}>(${a(0)},${a(1)})`;
        else if(["&","|","^"].includes(i.text))value=`static_cast<${T}>(static_cast<std::int64_t>(${a(0)})${i.text}static_cast<std::int64_t>(${a(1)}))`;
        else value=`(${a(0)} ${i.text} ${a(1)})`;break;
      }
      case "aggregate": {
        const shape=s(i.typeId), tuple=["tuple","pack"].includes(shape.kind);
        if(tuple) {
          const parts=i.operands.map((v,k)=>i.names[k]==="spread"?a(k):`std::make_tuple(${a(k)})`);
          value=`std::tuple_cat(${parts.join(",")})`;
        } else if(shape.kind==="fixedArray") {
          const setup:string[]=[],elements:string[]=[];
          i.operands.forEach((v,k)=>{
            if(i.names[k]!=="spread"){elements.push(a(k));return;}
            const input=s(f.values[v]);const count=input.kind==="fixedArray"?input.length:["tuple","pack"].includes(input.kind)?input.arguments.length:-1;
            if(count<0)this.fail("Spread de longitud desconocida en array fijo",i.source);
            setup.push(`auto part${k}=${a(k)};`);
            for(let n=0;n<count;n++)elements.push(`std::move(${["tuple","pack"].includes(input.kind)?`std::get<${n}>(part${k})`:`part${k}[${n}]`})`);
          });
          value=`([&](){${setup.join("")}return ${T}{${elements.join(",")}};}())`;
        } else {
          const pieces=i.operands.map((_,k)=>{
            if(i.names[k]==="spread")return `auto part${k}=${a(k)};for(auto& x:part${k}){${shape.kind==="array"?"out.push_back(std::move(x));":"out.at(k++)=std::move(x);"}}`;
            return shape.kind==="array"?`out.push_back(${a(k)});`:`out.at(k++)=${a(k)};`;
          });
          value=`([&](){${T} out;${shape.kind==="fixedArray"?"std::size_t k=0;":""}${pieces.join("")}return out;}())`;
        }break;
      }
      case "emptyRecord": case "collection": value=`${T}{}`;break;
      case "record": case "variant": {
        const shape=s(i.typeId), fields=i.names.map((name,k)=>`out.f${shape.names.indexOf(name)}.set(${a(k)});`);
        if(i.op==="variant") {
          const kind=shape.names.indexOf("kind");if(kind>=0&&!i.names.includes("kind"))fields.push(`out.f${kind}.set(${this.literal(shape.tag,shape.fields[kind])});`);
          const disc=shape.names.indexOf(shape.discriminator);if(disc>=0&&!i.names.includes(shape.discriminator))fields.push(`out.f${disc}.set(${this.literal(shape.discriminatorValue,shape.discriminatorType)});`);
        }
        for(let k=0;k<shape.fields.length;k++)if(!i.names.includes(shape.names[k])&&s(shape.fields[k]).kind==="Optional")fields.push(`out.f${k}.set(${this.type(shape.fields[k])}::none());`);
        value=`([&](){${T} out;${fields.join("")}return out;}())`;break;
      }
      case "none": value=`${T}::none()`;break;
      case "some": value=`${T}::some(${a(0)})`;break;
      case "result": value=`${T}::${i.text==="Err"?"failure":"success"}(${a(0)})`;break;
      case "isPresent": value=`${this.deref(a(0),f.values[i.operands[0]])}.isPresent()`;break;
      case "unwrap": value=`(${this.deref(a(0),f.values[i.operands[0]])}).value()`;break;
      case "property": {
        const input=this.deref(a(0,false),f.values[i.operands[0]]), inputId=this.inner(f.values[i.operands[0]]), shape=s(inputId);
        if(["length","size"].includes(i.text))value=["tuple","pack"].includes(shape.kind)?`double(${shape.arguments.length})`:`double((${input}).size())`;
        else if(i.text==="ok")value=`(${input}).isOk()`;
        else if(i.text==="kind")value=shape.kind==="Optional"?`std::string((${input}).isPresent()?"Some":"None")`:`std::string((${input}).isOk()?"Ok":"Err")`;
        break;
      }
      case "extractIndex": value=["tuple","pack"].includes(s(f.values[i.operands[0]]).kind)?`std::get<${this.constantIndex(f,i.operands[1])}>(${a(0)})`:`(${a(0)}).at(static_cast<std::size_t>(${a(1)}))`;break;
      case "typeTag": {const id=this.inner(i.signature), name=this.project.types[id];value=this.literal(this.numeric(id)?"number":["string","boolean"].includes(name)?name:name==="void"?"undefined":"object",i.typeId);break;}
      case "typeTest": {const id=this.inner(f.values[i.operands[0]]);value=sumKinds.has(s(id).kind)?`(${this.deref(a(0,false),f.values[i.operands[0]])}.data.index()==${this.choices(id).indexOf(i.signature)})`:id===i.signature?"true":"false";break;}
      case "closure": {
        const target=this.project.functions[i.callee];const args=target.parameterTypes.map((t,k)=>`${this.type(t)} x${k}`).join(",");
        const captures=i.operands.map((_,k)=>`c${k}=${a(k)}`).join(",");
        value=`[${captures}](${args})mutable->${this.type(target.returns)}{${this.project.types[target.returns]==="void"?"":"return "}ir_f${i.callee}(${[...target.captureTypes.map((_,k)=>`c${k}`),...target.parameterTypes.map((_,k)=>`std::move(x${k})`)].join(",")});}`;break;
      }
      case "call": case "taskCreate": value=`ir_f${i.callee}(${i.operands.map((_,k)=>a(k)).join(",")})`;break;
      case "callIndirect": value=`${a(0)}(${i.operands.slice(1).map((_,k)=>a(k+1)).join(",")})`;break;
      case "runtimeCall": value=emitRuntimeCall(this,f,i);break;
      case "intrinsic": {
        if(i.operands.some(v=>s(this.inner(f.values[v])).kind==="pack")) {
          const parts=i.operands.map((v,k)=>{
            const id=this.inner(f.values[v]), shape=s(id), input=this.deref(a(k,false),f.values[v]);
            return shape.kind==="pack"?`std::make_tuple(${shape.arguments.map((t,n)=>this.output(`std::get<${n}>(${input})`,t)).join(",")})`:`std::make_tuple(${this.output(a(k,false),f.values[v])})`;
          });
          value=`std::apply([&](const auto&...xs){${i.text}(xs...);},std::tuple_cat(${parts.join(",")}))`;
        }
        else value=`${i.text}(${i.operands.map((_,k)=>this.output(a(k,false),f.values[i.operands[k]])).join(",")})`;break;
      }
      case "resume": value=`await${i.continuation}.take()`;if(this.project.types[i.typeId]==="void")return "// resumed void task";break;
      case "iterator": value="std::size_t{0}";break;
      case "iterHasNext": case "iterNext": {
        const cursor=i.operands[0], definition=this.findDefinition(f,cursor);const place=f.places[definition.place], base=this.deref(`${this.place(f,definition.place)}.get()`,place.typeId), shape=s(this.inner(place.typeId));
        if(i.op==="iterHasNext")value=`v${cursor}.get()<(${base}).size()`;
        else if(["Map","Set"].includes(shape.kind)) {
          const position=`v${cursor}.get()++`, map=shape.kind==="Map";
          value=`([&](){auto it=(${base}).data().begin();std::advance(it,${position});return ${definition.text==="keys"?(map?"it->first":"*it"):map?"std::make_tuple(it->first,it->second)":"*it"};}())`;
        } else if(definition.text==="keys")value=`static_cast<${T}>(v${cursor}.get()++)`;
        else if(this.project.types[this.inner(place.typeId)]==="string")value=`std::string(1,(${base}).at(v${cursor}.get()++))`;
        else {const element=`(${base}).at(v${cursor}.get()++)`;value=["ref","constRef"].includes(s(i.typeId).kind)?`std::addressof(ets::ir::read(${element}))`:s(i.typeId).resource?`std::move(${element})`:element;}
        break;
      }
    }
    if(value===undefined)return this.fail(`Opcode C++ sans contrat: ${i.op}`,i.source);
    return i.result>=0?`v${i.result}.set(${value});`:`${value};`;
  }
  printable(id:number,history:number[]=[]):boolean {
    if(history.includes(id))return false;const s=this.shape(id);
    if(["scalar","enum","variant","ptr","constPtr"].includes(s.kind))return true;
    if(["ref","constRef","readonly"].includes(s.kind))return this.printable(s.arguments[0],[...history,id]);
    return sumKinds.has(s.kind)&&this.choices(id).every(t=>this.printable(t,[...history,id]));
  }
  output(value:string,id:number):string {
    const s=this.shape(id);if(["ref","constRef"].includes(s.kind))return this.output(`(*(${value}))`,s.arguments[0]);
    if(!this.printable(id))this.fail(`Tipo sin contrato de impresión C++: ${this.project.types[id]}`);
    if(["ptr","constPtr"].includes(s.kind))return `(${value}).get()`;
    if(s.numericKind==="integer"&&s.bits===8)return `static_cast<int>(${value})`;return value;
  }
  findDefinition(f:IrFunction,value:number):IrInstruction {for(const b of f.blocks)for(const i of b.instructions)if(i.result===value)return i;return this.fail("Temporal sin definición",f.source);}
  signature(f:IrFunction,index:number):string {
    const ret=f.asynchronous&&this.shape(f.returns).kind!=="Promise"?`ets::Task<${this.type(f.bodyReturns)}>`:this.type(f.returns);
    if(f.asynchronous){this.headers.add("runtime/ets_async.hpp");this.backends.libuv=true;}
    return `${ret} ir_f${index}(${[...f.captureTypes.map((t,k)=>`${this.type(t)}${f.captureModes[k]==="reference"?"*":""} c${k}`),...f.parameterTypes.map((t,k)=>`${this.type(t)} a${k}`)].join(",")})`;
  }
  functionBody(f:IrFunction,index:number):string {
    const locals=f.places.flatMap((p,k)=>p.kind==="local"&&p.global<0?[`ets::ir::Slot<${this.type(p.typeId)}> p${k};`]:[]);
    const values=f.values.map((t,k)=>`ets::ir::Slot<${this.type(t)}> v${k};`);
    const awaited=f.blocks.flatMap((b,k)=>b.terminator==="suspend"&&this.project.types[this.shape(f.values[b.value]).arguments[0]]!=="void"?[`ets::ir::Slot<${this.type(this.shape(f.values[b.value]).arguments[0])}> await${k};`]:[]);
    let parameter=0;const initialize=f.places.flatMap((p,k)=>p.parameter?[`p${k}.set(std::move(a${parameter++}));`]:[]);
    const blocks=f.blocks.map((b,k)=>{
      const lines=b.instructions.map(i=>this.instruction(f,i,k));const ret=f.asynchronous?"co_return":"return";
      switch(b.terminator) {
        case "jump":lines.push(`goto b${b.targets[0]};`);break;
        case "branch":lines.push(`if(v${b.value}.get())goto b${b.targets[0]};else goto b${b.targets[1]};`);break;
        case "return":lines.push(`${ret}${b.value<0?"":` v${b.value}.${this.shape(f.values[b.value]).resource?"take":"get"}()`};`);break;
        case "suspend": {
          const result=this.shape(f.values[b.value]).arguments[0];
          lines.push(this.project.types[result]==="void"?`co_await v${b.value}.take();`:`await${k}.set(co_await v${b.value}.take());`);
          lines.push(`goto b${b.targets[0]};`);break;
        }
        case "cancel":lines.push(`${ret};`);if(this.project.types[f.bodyReturns]!=="void")lines[lines.length-1]="std::abort();";break;
        case "trap":case "unreachable":lines.push("std::abort();");break;
        default:this.fail(`Terminador sin soporte: ${b.terminator}`,b.source);
      }
      return `b${k}:\n${lines.join("\n")}`;
    });
    return `${this.signature(f,index)} {\n${[...locals,...values,...awaited,...initialize,"goto b0;",...blocks].join("\n")}\n}`;
  }
  declarations():string {
    const done=new Set<number>(),active=new Set<number>(),out:string[]=[];
    const dependency=(id:number):void=>{const s=this.shape(id);if(["ptr","constPtr","ref","constRef","function"].includes(s.kind))return;if(this.record(id)||sumKinds.has(s.kind))emit(id);else for(const a of s.arguments)dependency(a);};
    const emit=(id:number):void=>{
      if(done.has(id))return;if(active.has(id))this.fail("Ciclo de layout por valor en tipos IR");active.add(id);const s=this.shape(id);
      if(this.record(id)){for(const f of s.fields)dependency(f);out.push(`struct ir_t${id}{${s.fields.map((t,k)=>`ets::ir::Slot<${this.type(t)}> f${k};`).join("")}bool operator==(const ir_t${id}&)const=default;};`);}
      else {for(const a of this.choices(id))dependency(a);out.push(`struct ir_t${id}{std::variant<${this.choices(id).map(t=>this.type(t)).join(",")}> data;bool operator==(const ir_t${id}&)const=default;};`);}
      active.delete(id);done.add(id);
    };
    this.project.typeDefinitions.forEach((s,id)=>{if(this.record(id)||sumKinds.has(s.kind))emit(id);});return out.join("\n");
  }
  validateBoundary():void {
    const p=this.project;
    if(p.format!=="ets-ir-2"||p.success!==true||!Array.isArray(p.diagnostics)||p.diagnostics.length)this.fail("Se requiere ets-ir-2 verificado con success:true");
    if(!Array.isArray(p.types)||!Array.isArray(p.typeDefinitions)||p.types.length!==p.typeDefinitions.length)this.fail("Tablas de tipos incompletas");
    const type=(id:number)=>Number.isSafeInteger(id)&&id>=0&&id<p.types.length;
    const scalar=new Set(["number","string","boolean","void","i8","u8","i16","u16","i32","u32","i64","u64","f32","f64"]);
    for(let id=0;id<p.types.length;id++) {
      const s=this.shape(id);if(s.kind==="scalar"&&!scalar.has(p.types[id]))this.fail("Tipo escalar inválido");
      if(![...s.arguments,...s.fields,...s.variants].every(type))this.fail("Referencia de tipo inexistente");
      if(s.names.length!==s.fields.length)this.fail("Tabla de campos incompatible");
    }
    for(const f of p.functions) {
      if(![f.returns,f.bodyReturns,...f.parameterTypes,...f.values,...f.places.map(x=>x.typeId)].every(type))this.fail("Tipo de función/place/valor inexistente",f.source);
      for(const b of f.blocks) {
        if(!b.targets.every(t=>Number.isSafeInteger(t)&&t>=0&&t<f.blocks.length))this.fail("Destino de bloque inexistente",b.source);
        for(const i of b.instructions) {
          if(i.op==="binary"&&!["+","-","*","/","%","&","|","^","<<",">>","==","!=","<",">","<=",">="].includes(i.text))this.fail("Operador binario inválido",i.source);
          if(i.op==="unary"&&!["+","-","!","~"].includes(i.text))this.fail("Operador unario inválido",i.source);
          if(i.op==="intrinsic"&&!["print","write","printError","writeError"].includes(i.text))this.fail("Intrínseco inválido",i.source);
          if(!i.operands.every(v=>Number.isSafeInteger(v)&&v>=0&&v<f.values.length))this.fail("Operando inexistente",i.source);
          if(["call","taskCreate","closure"].includes(i.op)&&!p.functions[i.callee])this.fail("Callee inexistente",i.source);
        }
      }
    }
  }
  generate():IrCppResult {
    this.validateBoundary();
    for(const annotation of this.project.annotations??[])if(["cpp_name","cpp_type","cpp_drogon","include","link","cpp_header","cpp_include","cpp_link"].includes(annotation.name))this.fail(`ABI externo no implementado: @${annotation.name}`,annotation.source);
    if(this.project.format!=="ets-ir-2"||!this.project.success||this.project.diagnostics.length)this.fail("Se requiere ets-ir-2 verificado con success:true");
    if(this.project.types.length!==this.project.typeDefinitions.length)this.fail("Tablas de tipos incompletas");
    for(const f of this.project.functions)for(const t of [...f.values,...f.parameterTypes,...f.places.map(p=>p.typeId)])if(this.shape(t).kind==="parameter")this.fail("Parámetro genérico sin especializar en código ejecutable",f.source);
    for(const f of this.project.functions)for(const b of f.blocks)for(const i of b.instructions)if(!ops.has(i.op))this.fail(`Capacidad C++ no soportada: ${i.op}`,i.source);
    const declarations=this.declarations(),prototypes=this.project.functions.map((f,k)=>this.signature(f,k)+";"),bodies=this.project.functions.map((f,k)=>this.functionBody(f,k));
    const globals=this.project.globals.map((p,k)=>`ets::ir::Slot<${this.type(p.typeId)}> ir_g${k};`);
    const run=(id:number)=>this.project.functions[id].asynchronous?`ets::syncWait(ir_f${id}());`:`ir_f${id}();`;
    const main=`int main(int argc,char** argv){ets_argc=argc;ets_argv=argv;${this.project.initializationOrder.map(run).join("")}${this.backends.libuv?"ets::defaultEventLoop.drainDetached();":""}${this.project.runtimeContracts.some(c=>["builtin.watchFs","builtin.setInterval"].includes(c.name))?"ets::defaultEventLoop.run();":""}${this.project.finalizationOrder.map(run).join("")}return 0;}`;
    const forwards=this.project.typeDefinitions.flatMap((s,k)=>this.record(k)||sumKinds.has(s.kind)?[`struct ir_t${k};`]:[]);
    const printable=this.project.typeDefinitions.flatMap((s,k)=>s.kind==="variant"||sumKinds.has(s.kind)?[k]:[]);
    const printerPrototypes=printable.map(k=>`inline std::ostream& operator<<(std::ostream& out,const ir_t${k}& value);`);
    const printers=printable.map(k=>`inline std::ostream& operator<<(std::ostream& out,const ir_t${k}& value){${this.shape(k).kind==="variant"?`return out<<${JSON.stringify(this.shape(k).tag)};`:`std::visit([&](const auto& x){if constexpr(requires{out<<x;})out<<x;else std::abort();},value.data);return out;`}}`);
    const includes=["runtime/ets_runtime.hpp",...[...this.headers].filter(h=>h!=="runtime/ets_runtime.hpp").sort()].map(h=>`#include ${JSON.stringify(h)}`);
    return {cpp:["// Generated from verified ets-ir-2. No source AST is used.","#include <array>\n#include <tuple>\n#include <functional>\n#include <iterator>\n#include <variant>",...includes,...forwards,...printerPrototypes,declarations,...printers,...globals,...prototypes,...bodies,main,""].join("\n"),headers:[...this.headers].sort(),runtimeBackends:this.backends,capabilities:[...new Set(this.project.runtimeContracts.map(c=>c.capability))].sort()};
  }
}
export function generateCppFromIr(project:IrProject):IrCppResult{return new IrCppGenerator(project).generate();}
