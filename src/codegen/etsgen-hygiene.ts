import type { BlockStatement, Program } from "../ast/nodes.ts";
import type { Span, GeneratedSource } from "../core/span.ts";
import { DiagnosticError } from "../core/diagnostic.ts";
import { isTypeofType, typeofTarget, typeofType } from "../types/type-system.ts";

type Node = Record<string, any>;
type Binding = { id:string; name:string; emittedName:string; kind:string; span:Span };
class LexicalScope {
  values = new Map<string, Binding>();
  types = new Map<string, Binding>();
  parent: LexicalScope | undefined;
  constructor(parent?:LexicalScope) { this.parent=parent; }
  resolve(name:string, type=false):Binding|undefined { return (type ? this.types : this.values).get(name) ?? this.parent?.resolve(name,type); }
}

/** Bind identities inside each parsed ETS fragment before inserting it in the
 * caller. Only lexical names are rewritten, never strings, properties or C++.
 */
export class EtsgenHygiene {
  private occupied = new Set<string>();
  private nextName = 0;
  private generators = new Set<string>();
  private program: Program;
  constructor(program:Program, bodies:BlockStatement[]) {
    this.program=program;
    const reserve=(value:unknown):void=>{
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(reserve); return; }
      const node=value as Node;
      for (const [key,child] of Object.entries(node)) {
        if (["name","callee","className"].includes(key) && typeof child === "string") this.occupied.add(child);
        else if (!["parent","span","resolvedType","resolvedSignature","resolvedRuntimeType","generatedSources"].includes(key)) reserve(child);
      }
      // Reserve explicitly captured names even when the caller has no binding,
      // so an undefined capture cannot accidentally bind a fresh generated name.
      if (node.kind === "CallExpression" && node.callee === "etsCapture" && node.args?.[0]?.kind === "LiteralExpression" && typeof node.args[0].value === "string") this.occupied.add(node.args[0].value);
    };
    for(const stmt of program.statements) if(stmt.kind === "FunctionDeclaration" && stmt.decorators?.some(d=>d.name === "etsgen")) this.generators.add(stmt.name);
    reserve(program); bodies.forEach(reserve);
  }

  apply(body:BlockStatement, source:GeneratedSource, fragmentSpan:(span:Span)=>Span):void {
    const declarations=new WeakMap<object,Binding>();
    const bindings:Binding[]=[];
    const parameterLabels=new Map<string,Map<string,string>>();
    const namedCalls:{node:Node; binding:Binding}[]=[];
    const captures:NonNullable<GeneratedSource["captures"]>=[];
    const importedName=(name:string):string=>{
      const environment=source.callSpan.etsgenScope;
      return environment && Object.hasOwn(environment,name) ? environment[name] : name;
    };
    const importedNamespace=(name:string)=>{
      const environment=source.callSpan.etsgenNamespaces;
      return environment && Object.hasOwn(environment,name) ? environment[name] : undefined;
    };
    const published = new Set<object>();
    let fragmentRoot:LexicalScope;
    for (const declaration of body.statements as Node[]) {
      const markers=declaration.decorators?.filter((d:Node)=>d.name === "etsPublish") ?? [];
      if (!markers.length) continue;
      if (markers.length !== 1 || markers[0].args.length || !["VariableDeclaration","FunctionDeclaration","ClassDeclaration","InterfaceDeclaration"].includes(declaration.kind) || declaration.arrayBindings || declaration.objectBindings) {
        throw new DiagnosticError([{phase:"semantic",code:"ETSGEN_GENERATED_HYGIENE",message:"@etsPublish requiere una declaración simple de variable, función, clase o interface y no acepta argumentos",span:declaration.span}]);
      }
      published.add(declaration);
      declaration.decorators=declaration.decorators.filter((d:Node)=>d.name !== "etsPublish");
    }
    const fail=(node:Node,message:string):never=>{throw new DiagnosticError([{phase:"semantic",code:"ETSGEN_GENERATED_HYGIENE",message,span:node.span ?? body.span}]);};
    const mark=(node:Node,binding:Binding,role:"binding"|"reference")=>{
      if (node.span) node.span={...node.span,hygiene:{id:binding.id,name:binding.name,role}};
    };
    const define=(node:Node,name:string,scope:LexicalScope,kind:string,type=false,value=true):Binding=>{
      if (["etsCapture","etsDefinition"].includes(name)) fail(node,`${name} está reservado para capturas explícitas de @etsgen`);
      const moduleExports=source.callSpan.etsgenExports;
      const moduleName=published.has(node) && moduleExports && Object.hasOwn(moduleExports,name) ? moduleExports[name] : undefined;
      const moduleBindings=source.callSpan.etsgenBindings;
      const publicationName=published.has(node) && moduleBindings && Object.hasOwn(moduleBindings,name) ? moduleBindings[name] : undefined;
      if(published.has(node) && moduleBindings && importedNamespace(name)) fail(node,`La publicación '${name}' entra en conflicto con un namespace importado`);
      if(moduleName) node.exported=true;
      const old=(type ? scope.types : scope.values).get(name);
      if (old) {
        if (kind === "function" && old.kind === "function") { declarations.set(node,old); return old; }
        fail(node,`Símbolo duplicado '${name}' dentro del mismo fragmento`);
      }
      let emittedName:string;
      do {emittedName=`ets_macro_${this.nextName++}_${name.replace(/[^A-Za-z0-9_]/g,"_")}`;} while(this.occupied.has(emittedName));
      this.occupied.add(emittedName);
      if (published.has(node)) emittedName=moduleName ?? publicationName ?? name;
      const binding:Binding={id:`${source.id}/binding:${bindings.length}`,name,emittedName,kind,span:fragmentSpan(node.span ?? body.span)};
      if (value) scope.values.set(name,binding);
      if (type) scope.types.set(name,binding);
      bindings.push(binding); declarations.set(node,binding);
      return binding;
    };
    const capture=(node:Node,name:string,explicit:boolean,kind="value"):string=>{
      const environment=source.callSpan.etsgenScope;
      const emittedName=environment && Object.hasOwn(environment,name) ? environment[name] : name;
      captures.push({name,emittedName,explicit,kind,span:fragmentSpan(node.span)});
      node.span={...node.span,hygiene:{name,role:explicit ? "capture" : "external"}};
      return emittedName;
    };
    const ref=(node:Node,name:string,scope:LexicalScope):string=>{
      const binding=scope.resolve(name);
      if (!binding) return capture(node,name,false);
      mark(node,binding,"reference"); return binding.emittedName;
    };
    const typeName=(type:string|undefined,scope:LexicalScope):string|undefined=>{
      if (!type) return type;
      if (isTypeofType(type)) return typeofType(scope.resolve(typeofTarget(type))?.emittedName ?? importedName(typeofTarget(type)));
      type=type.replace(/\[([A-Za-z_$][\w$]*)\]/g,(_,name)=>`[${scope.resolve(name)?.emittedName ?? name}]`);
      return type.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g,word=>{
        if(word.startsWith('"') || word.startsWith("'")) return word;
        if(word.includes(".")) {
          const [namespace,...segments]=word.split(".");const member=segments.join(".");
          const members=!scope.resolve(namespace) && importedNamespace(namespace);
          if(members) {if(!Object.hasOwn(members,member)) fail(body as unknown as Node,`El namespace '${namespace}' no exporta '${member}'`);return members[member];}
        }
        return scope.resolve(word,true)?.emittedName ?? importedName(word);
      });
    };
    const declareVariable=(node:Node,scope:LexicalScope)=>{
      if (node.arrayBindings?.length || node.objectBindings?.length) {
        if (node.name) define(node,node.name,scope,"temporary");
        for (const binding of [...(node.arrayBindings ?? []),...(node.objectBindings ?? [])]) {binding.span ??= node.span; define(binding,binding.name,scope,"variable");}
      } else define(node,node.name,scope,"variable");
    };
    const predeclare=(statements:Node[],scope:LexicalScope)=>{
      for(const node of statements) {
        if (node.exported || node.kind.startsWith("Export")) fail(node,"Las declaraciones públicas generadas requieren una API de exportación explícita; todavía no están soportadas");
        switch(node.kind) {
          case "VariableDeclaration": case "UsingDeclaration": declareVariable(node,scope); break;
          case "FunctionDeclaration": { const binding=define(node,node.name,scope,"function"); if(node.decorators?.some((d:Node)=>d.name === "etsgen")) this.generators.add(binding.emittedName); break; }
          case "ClassDeclaration": case "EnumDeclaration": define(node,node.name,scope,"type",true); break;
          case "InterfaceDeclaration": case "TypeAliasDeclaration": define(node,node.name,scope,"type",true,false); break;
          case "UnionDeclaration":
            define(node,node.name,scope,"type",true,false);
            for (const variant of node.variants) define(variant,variant.name,scope,"variant");
            break;
        }
      }
    };
    const renameDeclaration=(node:Node)=>{
      const binding=declarations.get(node);
      if (binding) {node.name=binding.emittedName; mark(node,binding,"binding");}
    };
    const variable=(node:Node,scope:LexicalScope)=>{
      renameDeclaration(node);
      node.declaredType=typeName(node.declaredType,scope);
      for (const binding of node.objectBindings ?? []) {
        binding.property ??= binding.name;
      }
      for (const binding of [...(node.arrayBindings ?? []),...(node.objectBindings ?? [])]) {
        renameDeclaration(binding); binding.declaredType=typeName(binding.declaredType,scope);
        if(binding.defaultValue) binding.defaultValue=expression(binding.defaultValue,scope);
      }
      if(node.initializer) node.initializer=expression(node.initializer,scope);
    };
    const parameters=(node:Node,scope:LexicalScope,functionId?:string,preserveLabels=false)=>{
      for (const parameter of node.typeParameters ?? []) define(parameter,parameter.name,scope,"typeParameter",true,false);
      for (const parameter of node.typeParameters ?? []) {
        renameDeclaration(parameter);
        parameter.constraint=typeName(parameter.constraint,scope); parameter.default=typeName(parameter.default,scope);
      }
      for (const parameter of node.params ?? []) {
        if(parameter.access) fail(parameter,"Las parameter properties generadas no están soportadas por la higiene todavía");
        const binding=define(parameter,parameter.name,scope,"parameter");
        if(preserveLabels) binding.emittedName=binding.name;
        if(functionId) {
          const labels=parameterLabels.get(functionId) ?? new Map<string,string>();
          if(labels.has(binding.name)) binding.emittedName=labels.get(binding.name)!;
          else labels.set(binding.name,binding.emittedName);
          parameterLabels.set(functionId,labels);
        }
      }
      for (const parameter of node.params ?? []) {
        renameDeclaration(parameter); parameter.type=typeName(parameter.type,scope);
        if(parameter.defaultValue) parameter.defaultValue=expression(parameter.defaultValue,scope);
      }
      node.returnType=typeName(node.returnType,scope);
      if(node.variadicTypeParameters) node.variadicTypeParameters=node.variadicTypeParameters.map((name:string)=>scope.resolve(name,true)?.emittedName ?? name);
    };
    const block=(node:Node,parent:LexicalScope)=>{
      const scope=new LexicalScope(parent); predeclare(node.statements,scope);
      if(node === body) fragmentRoot=scope;
      node.statements=node.statements.map((item:Node)=>statement(item,scope)); return node;
    };
    const expression=(node:Node,scope:LexicalScope):Node=>{
      const memberPath=(object:Node):string[]|undefined=>object.kind === "IdentifierExpression" ? [object.name] : object.kind === "MemberExpression" && !object.optional ? memberPath(object.object)?.concat(object.member) : undefined;
      const path=["MemberExpression","MemberCallExpression"].includes(node.kind) ? memberPath(node.object) : undefined;
      if(path && !scope.resolve(path[0])) {
        const members=importedNamespace(path[0]);
        if(members) {
          const member=[...path.slice(1),node.kind === "MemberExpression" ? node.member : node.method].join(".");
          if(Object.hasOwn(members,member)) node=node.kind === "MemberExpression" ? {kind:"IdentifierExpression",name:members[member],span:node.span} : {kind:"CallExpression",callee:members[member],args:node.args,typeArguments:node.typeArguments,span:node.span};
          else if(!path.slice(1).some((_,index)=>Object.hasOwn(members,path.slice(1,index+2).join(".")))) fail(node,`El namespace '${path[0]}' no exporta '${member}'`);
        }
      }
      switch(node.kind) {
        case "IdentifierExpression":
          if(!["this","undefined","NaN","Infinity"].includes(node.name)) node.name=ref(node,node.name,scope);
          return node;
        case "GenericIdentifierExpression": node.name=ref(node,node.name,scope); break;
        case "CallExpression":
          if(node.callee === "etsDefinition") {
            const argument=node.args[0];
            if(node.typeArguments.length || argument?.kind !== "LiteralExpression" || typeof argument.value !== "string" || !/^[A-Za-z_$][\w$]*$/.test(argument.value)) fail(node,"etsDefinition requiere un nombre literal y, para funciones, sus argumentos");
            const originalName=argument.value;
            const name=source.definitionAliases && Object.hasOwn(source.definitionAliases,originalName) ? source.definitionAliases[originalName] : originalName;
            const target=this.program.statements.find((item:Node)=>item.name === name && (!source.definitionModule || item.span.module === source.definitionModule || source.definitionImports?.includes(name)));
            if(!target || !["FunctionDeclaration","VariableDeclaration"].includes(target.kind)) fail(node,`etsDefinition: '${name}' no es una función o variable visible desde el módulo de definición`);
            if(source.callSpan.module && target.span.module !== source.callSpan.module) {
              const group=this.program.statements.filter((item:Node)=>item.name === name && item.span.module === target.span.module);
              group.forEach(item=>item.span.etsgenShared=true);
            }
            node.span={...node.span,etsgenDefinition:true};
            captures.push({name:originalName,emittedName:name,explicit:true,kind:"definition",span:fragmentSpan(node.span)});
            if(target.kind === "FunctionDeclaration") {
              const lowered={...node,callee:name,args:node.args.slice(1)};
              if(this.generators.has(name)) return expression(lowered,scope);
              return {...lowered,args:lowered.args.map((arg:Node)=>expression(arg,scope))};
            }
            if(node.args.length !== 1) fail(node,"etsDefinition sobre una variable no acepta argumentos");
            return {kind:"IdentifierExpression",name,span:node.span};
          }
          if(node.callee === "etsCapture") {
            if(node.args.length !== 1 || node.typeArguments.length || node.args[0].kind !== "LiteralExpression" || typeof node.args[0].value !== "string" || !/^[A-Za-z_$][\w$]*$/.test(node.args[0].value)) fail(node,"etsCapture requiere exactamente un nombre literal de identificador");
            const name=capture(node,node.args[0].value,true);
            return {kind:"IdentifierExpression",name,span:node.span};
          }
          if(this.generators.has(node.callee) || this.generators.has(scope.resolve(node.callee)?.emittedName ?? "")) {
            const visible:Record<string,string>=Object.assign(Object.create(null),source.callSpan.etsgenScope ?? {});
            const chain:LexicalScope[]=[]; for(let current:LexicalScope|undefined=scope;current;current=current.parent) chain.unshift(current);
            for(const current of chain) for(const [name,binding] of current.values) visible[name]=binding.emittedName;
            const namespaces=Object.fromEntries(Object.entries(source.callSpan.etsgenNamespaces ?? {}).filter(([name])=>!scope.resolve(name)));
            node.span={...node.span,etsgenScope:visible,etsgenNamespaces:namespaces,...(scope === fragmentRoot && source.callSpan.etsgenExports ? {etsgenExports:source.callSpan.etsgenExports,etsgenBindings:source.callSpan.etsgenBindings} : {})};
          }
          const target=scope.resolve(node.callee);
          if(target?.kind === "function" && node.args.some((arg:Node)=>arg.kind === "NamedArgumentExpression")) namedCalls.push({node,binding:target});
          if(!node.span.etsgenDefinition) node.callee=ref(node,node.callee,scope);
          node.args=node.args.map((arg:Node)=>expression(arg,scope)); break;
        case "NewExpression": node.className=typeName(node.className,scope); node.args=node.args.map((arg:Node)=>expression(arg,scope)); break;
        case "ArrowFunctionExpression": {
          const child=new LexicalScope(scope); parameters(node,child);
          node.body=node.body.kind === "BlockStatement" ? block(node.body,child) : expression(node.body,child);
          return node;
        }
        case "ObjectLiteralExpression":
          for(const prop of node.properties) {if(prop.value) prop.value=expression(prop.value,scope);if(prop.spread) prop.spread=expression(prop.spread,scope);}
          return node;
        case "MemberExpression": case "MemberCallExpression":
          node.object=expression(node.object,scope);
          if(node.args) node.args=node.args.map((arg:Node)=>expression(arg,scope)); break;
        case "LiteralExpression": return node;
        case "RawCppExpression": fail(node,"No se puede garantizar higiene sobre C++ opaco dentro de Estatic generado");
        default:
          for(const [key,value] of Object.entries(node)) {
            if(["span","parent","resolvedType","resolvedSignature","resolvedRuntimeType"].includes(key)) continue;
            if (Array.isArray(value)) node[key]=value.map(item=>item && typeof item === "object" && "kind" in item ? expression(item,scope) : item && typeof item === "object" && "pattern" in item ? {...item,pattern:expression(item.pattern,scope),result:expression(item.result,scope)} : item);
            else if(value && typeof value === "object" && "kind" in value) node[key]=expression(value as Node,scope);
          }
      }
      for(const key of ["declaredType","targetType"]) if(node[key]) node[key]=typeName(node[key],scope);
      if(node.typeArguments) node.typeArguments=node.typeArguments.map((type:string)=>typeName(type,scope));
      return node;
    };
    const statement=(node:Node,scope:LexicalScope):Node=>{
      if(node.decorators?.some((d:Node)=>d.name === "etsPublish")) fail(node,"@etsPublish solo se admite en declaraciones directas del fragmento");
      switch(node.kind) {
        case "VariableDeclaration": case "UsingDeclaration": variable(node,scope); return node;
        case "BlockStatement": return block(node,scope);
        case "FunctionDeclaration": {
          renameDeclaration(node); const child=new LexicalScope(scope); parameters(node,child,declarations.get(node)?.id,published.has(node));
          node.body=block(node.body,child); return node;
        }
        case "ClassDeclaration": case "InterfaceDeclaration": case "TypeAliasDeclaration": case "UnionDeclaration": {
          renameDeclaration(node); const child=new LexicalScope(scope); parameters(node,child);
          if(node.type) node.type=typeName(node.type,child);
          for(const field of node.fields ?? []) {field.type=typeName(field.type,child); if(field.defaultValue) field.defaultValue=expression(field.defaultValue,child);}
          for(const method of node.methods ?? []) {const local=new LexicalScope(child);parameters(method,local,undefined,true);if(method.body) method.body=block(method.body,local);}
          for(const variant of node.variants ?? []) {renameDeclaration(variant);variant.payload=typeName(variant.payload,child);}
          return node;
        }
        case "EnumDeclaration": renameDeclaration(node);for(const member of node.members) if(member.value) member.value=expression(member.value,scope);return node;
        case "ForStatement": {
          const child=new LexicalScope(scope);
          if(node.initializer) {predeclare([node.initializer],child);node.initializer=statement(node.initializer,child);}
          if(node.condition) node.condition=expression(node.condition,child);
          if(node.increment) node.increment=expression(node.increment,child);
          node.body=statement(node.body,child);return node;
        }
        case "ForOfStatement": case "ForInStatement": {
          const key=node.kind === "ForOfStatement" ? "iterable" : "target";
          node[key]=expression(node[key],scope);const child=new LexicalScope(scope);
          declareVariable(node.binding,child);variable(node.binding,child);node.body=statement(node.body,child);return node;
        }
        case "SwitchStatement": {
          node.discriminant=expression(node.discriminant,scope);const child=new LexicalScope(scope);
          predeclare([...node.cases.flatMap((c:Node)=>c.body),...(node.defaultClause?.body ?? [])],child);
          for(const clause of node.cases) {clause.labels=clause.labels.map((label:Node)=>expression(label,child));clause.body=clause.body.map((item:Node)=>statement(item,child));}
          if(node.defaultClause) node.defaultClause.body=node.defaultClause.body.map((item:Node)=>statement(item,child));return node;
        }
        default:
          for(const [key,value] of Object.entries(node)) {
            if(["span","parent","resolvedType","resolvedSignature","resolvedRuntimeType"].includes(key)) continue;
            if(value && typeof value === "object" && "kind" in value) node[key]=String((value as Node).kind).endsWith("Statement") ? statement(value as Node,scope) : expression(value as Node,scope);
          }
          return node;
      }
    };
    block(body as unknown as Node,new LexicalScope());
    for(const {node,binding} of namedCalls) {
      const labels=parameterLabels.get(binding.id);
      for(const arg of node.args) if(arg.kind === "NamedArgumentExpression" && labels?.has(arg.name)) arg.name=labels.get(arg.name)!;
    }
    source.bindings=bindings;
    source.captures=captures;
  }
}
