import type { Program } from "../ast/nodes.ts";
import { DiagnosticError } from "../core/diagnostic.ts";
import { isTypeofType, typeofTarget, typeofType } from "../types/type-system.ts";

type Node=Record<string,any>;
export type NamespaceBindings=Record<string,Record<string,string>>;
class Scope {
  parent?:Scope;
  values=new Map<string,string>();
  types=new Map<string,string>();
  namespaces=new Map<string,Record<string,string>|undefined>();
  constructor(parent?:Scope) {this.parent=parent;}
  value(name:string):string {return this.values.get(name) ?? this.parent?.value(name) ?? name;}
  valueOwner(name:string):Scope|undefined {return this.values.has(name) ? this : this.parent?.valueOwner(name);}
  type(name:string):string {return this.types.get(name) ?? this.parent?.type(name) ?? name;}
  namespace(name:string):Record<string,string>|undefined {return this.namespaces.has(name) ? this.namespaces.get(name) : this.parent?.namespace(name);}
}

/** Resolve imported aliases on parsed nodes, preserving every lexical shadow.
 * Fresh target names avoid capture by a local with the export's original name.
 * Text literals, fields, methods and named-argument labels are never rewritten. */
export function bindModuleNames(program:Program, own:Record<string,string>, imports:Record<string,string>, namespaces:NamespaceBindings={}, onReference?:(name:string,owner:Node)=>void, publications:Record<string,string>={}):void {
  const root=new Scope();
  let owner:Node;
  const value=(name:string,scope:Scope):string=>{
    const target=scope.value(name);if(scope.valueOwner(name) === root && owner) onReference?.(target,owner);return target;
  };
  for(const [local,target] of Object.entries(imports)) {root.values.set(local,target);root.types.set(local,target);}
  // Planned module publications have identities before their declarations
  // exist; lexical locals below still shadow these names normally.
  for(const [local,target] of Object.entries(publications)) {root.values.set(local,target);root.types.set(local,target);}
  for(const [local,members] of Object.entries(namespaces)) root.namespaces.set(local,members);
  const fail=(node:Node,message:string):never=>{throw new DiagnosticError([{phase:"semantic",code:"MODULE_IMPORT_BINDING",message,span:node.span}]);};
  const define=(scope:Scope,name:string,target=name,type=false,value=true)=>{
    if(value) {scope.values.set(name,target);scope.namespaces.set(name,undefined);}
    if(type) scope.types.set(name,target);
  };
  const predeclare=(statements:Node[],scope:Scope,top=false)=>{
    for(const node of statements) {
      if(node.kind === "ExportDefaultDeclaration") {predeclare([node.declaration],scope,top);continue;}
      const target=(name:string)=>top ? own[name] ?? name : name;
      switch(node.kind) {
        case "VariableDeclaration": case "UsingDeclaration":
          if(node.name) define(scope,node.name,target(node.name));
          for(const binding of [...(node.arrayBindings ?? []),...(node.objectBindings ?? [])]) define(scope,binding.name,target(binding.name));
          break;
        case "FunctionDeclaration": define(scope,node.name,target(node.name));break;
        case "ClassDeclaration": case "EnumDeclaration":case "UnionDeclaration":define(scope,node.name,target(node.name),true);break;
        case "InterfaceDeclaration":case "TypeAliasDeclaration":define(scope,node.name,target(node.name),true,false);break;
      }
    }
  };
  const qualified=(name:string,scope:Scope,node:Node):string=>{
    const dot=name.indexOf(".");
    if(dot < 0) return scope.type(name);
    const namespace=scope.namespace(name.slice(0,dot));
    if(!namespace) return name;
    const member=name.slice(dot+1);
    if(!Object.hasOwn(namespace,member)) fail(node,`El namespace '${name.slice(0,dot)}' no exporta '${member}'`);
    return namespace[member];
  };
  const type=(name:string|undefined,scope:Scope,node:Node):string|undefined=>{
    if(!name) return name;
    if(isTypeofType(name)) return typeofType(value(typeofTarget(name),scope));
    // Fixed-array sizes are value references; all other tokens are type names.
    name=name.replace(/\[([A-Za-z_$][\w$]*)\]/g,(_,size)=>`[${value(size,scope)}]`);
    return name.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g,word=>word.startsWith('"') || word.startsWith("'") ? word : qualified(word,scope,node));
  };
  const signature=(node:Node,parent:Scope):Scope=>{
    const local=new Scope(parent);
    for(const parameter of node.typeParameters ?? []) define(local,parameter.name,parameter.name,true,false);
    for(const parameter of node.typeParameters ?? []) {
      parameter.constraint=type(parameter.constraint,local,parameter);parameter.default=type(parameter.default,local,parameter);
    }
    for(const parameter of node.params ?? []) {
      parameter.type=type(parameter.type,local,parameter);
      if(parameter.defaultValue) parameter.defaultValue=expression(parameter.defaultValue,local);
      define(local,parameter.name);
    }
    node.returnType=type(node.returnType,local,node);
    return local;
  };
  const annotate=(node:Node,scope:Scope)=>{
    const visible:Record<string,string>=Object.create(null);
    const visibleNamespaces:NamespaceBindings=Object.create(null);
    const chain:Scope[]=[];for(let current:Scope|undefined=scope;current;current=current.parent) chain.unshift(current);
    for(const current of chain) {
      for(const [name,target] of current.values) {if(name !== target) visible[name]=target;else delete visible[name];}
      for(const [name,members] of current.namespaces) {if(members) visibleNamespaces[name]=members;else delete visibleNamespaces[name];}
    }
    node.span={...node.span,etsgenScope:Object.assign(Object.create(null),node.span.etsgenScope ?? {},visible),etsgenNamespaces:visibleNamespaces,...(scope === root ? {etsgenExports:publications,etsgenBindings:Object.assign(Object.create(null),own,imports)} : {})};
  };
  const expression=(node:Node,scope:Scope):Node=>{
    if(!node) return node;
    const memberPath=(object:Node):string[]|undefined=>object.kind === "IdentifierExpression" ? [object.name] : object.kind === "MemberExpression" && !object.optional ? memberPath(object.object)?.concat(object.member) : undefined;
    const path=["MemberExpression","MemberCallExpression"].includes(node.kind) ? memberPath(node.object) : undefined;
    if(path) {
      const namespace=scope.namespace(path[0]);
      if(namespace) {
        const member=[...path.slice(1),node.kind === "MemberExpression" ? node.member : node.method].join(".");
        if(Object.hasOwn(namespace,member)) {
          if(node.optional) fail(node,"Un namespace importado no admite acceso opcional");
          if(node.kind === "MemberExpression") return {kind:"IdentifierExpression",name:namespace[member],span:node.span};
          node={kind:"CallExpression",callee:namespace[member],args:node.args,typeArguments:node.typeArguments,span:node.span};
        } else if(!path.slice(1).some((_,index)=>Object.hasOwn(namespace,path.slice(1,index+2).join(".")))) fail(node,`El namespace '${path[0]}' no exporta el miembro estático '${member}'`);
      }
    }
    switch(node.kind) {
      case "IdentifierExpression":
        if(scope.namespace(node.name)) fail(node,"Un namespace importado requiere un miembro estático; no es un objeto runtime");
        node.name=value(node.name,scope);return node;
      case "GenericIdentifierExpression":node.name=value(node.name,scope);break;
      case "CallExpression":annotate(node,scope);node.callee=value(node.callee,scope);node.args=node.args.map((arg:Node)=>expression(arg,scope));break;
      case "NewExpression":node.className=type(node.className,scope,node);node.args=node.args.map((arg:Node)=>expression(arg,scope));break;
      case "ArrowFunctionExpression": {
        const local=signature(node,scope);node.body=node.body.kind === "BlockStatement" ? block(node.body,local) : expression(node.body,local);return node;
      }
      case "ObjectLiteralExpression":for(const property of node.properties) property.value=expression(property.value,scope);return node;
      case "MemberExpression":case "MemberCallExpression":node.object=expression(node.object,scope);if(node.args) node.args=node.args.map((arg:Node)=>expression(arg,scope));break;
      case "LiteralExpression":case "RawCppExpression":return node;
      default:
        for(const [key,value] of Object.entries(node)) {
          if(["span","parent","resolvedType","resolvedSignature","resolvedRuntimeType"].includes(key)) continue;
          if(Array.isArray(value)) node[key]=value.map(item=>item && typeof item === "object" && "kind" in item ? expression(item,scope) : item && typeof item === "object" && "pattern" in item ? {...item,pattern:expression(item.pattern,scope),result:expression(item.result,scope)} : item);
          else if(value && typeof value === "object" && "kind" in value) node[key]=expression(value as Node,scope);
        }
    }
    for(const key of ["declaredType","targetType"]) if(node[key]) node[key]=type(node[key],scope,node);
    if(node.typeArguments) node.typeArguments=node.typeArguments.map((name:string)=>type(name,scope,node));
    return node;
  };
  const variable=(node:Node,scope:Scope,top=false):Node=>{
    if(top && node.name) node.name=own[node.name] ?? node.name;
    for(const binding of node.objectBindings ?? []) binding.property ??= binding.name;
    for(const binding of [...(node.arrayBindings ?? []),...(node.objectBindings ?? [])]) {
      if(top) binding.name=own[binding.name] ?? binding.name;
      binding.declaredType=type(binding.declaredType,scope,node);
      if(binding.defaultValue) binding.defaultValue=expression(binding.defaultValue,scope);
    }
    node.declaredType=type(node.declaredType,scope,node);
    if(node.initializer) node.initializer=expression(node.initializer,scope);return node;
  };
  const block=(node:Node,parent:Scope):Node=>{
    const local=new Scope(parent);predeclare(node.statements,local);
    node.statements=node.statements.map((item:Node)=>statement(item,local));return node;
  };
  const statement=(node:Node,scope:Scope,top=false):Node=>{
    for(const decorator of node.decorators ?? []) decorator.args=decorator.args.map((arg:Node)=>expression(arg,scope));
    if(top && node.kind !== "VariableDeclaration" && node.kind !== "UsingDeclaration" && node.name) node.name=own[node.name] ?? node.name;
    switch(node.kind) {
      case "VariableDeclaration":case "UsingDeclaration":return variable(node,scope,top);
      case "BlockStatement":return block(node,scope);
      case "FunctionDeclaration": {
        node.span={...node.span,definitionAliases:Object.assign(Object.create(null),own,imports)};
        const local=signature(node,scope);node.body=block(node.body,local);return node;
      }
      case "ClassDeclaration":case "InterfaceDeclaration":case "TypeAliasDeclaration":case "UnionDeclaration": {
        const local=signature(node,scope);if(node.type) node.type=type(node.type,local,node);
        for(const field of node.fields ?? []) {field.type=type(field.type,local,field);if(field.defaultValue) field.defaultValue=expression(field.defaultValue,local);}
        for(const method of node.methods ?? []) {const methodScope=signature(method,local);if(method.body) method.body=block(method.body,methodScope);}
        for(const variant of node.variants ?? []) variant.payload=type(variant.payload,local,variant);
        return node;
      }
      case "EnumDeclaration":for(const member of node.members) if(member.value) member.value=expression(member.value,scope);return node;
      case "ForStatement": {
        const local=new Scope(scope);if(node.initializer) {predeclare([node.initializer],local);node.initializer=statement(node.initializer,local);}
        if(node.condition) node.condition=expression(node.condition,local);if(node.increment) node.increment=expression(node.increment,local);node.body=statement(node.body,local);return node;
      }
      case "ForOfStatement":case "ForInStatement": {
        const key=node.kind === "ForOfStatement" ? "iterable" : "target";node[key]=expression(node[key],scope);
        const local=new Scope(scope);predeclare([node.binding],local);variable(node.binding,local);node.body=statement(node.body,local);return node;
      }
      case "SwitchStatement": {
        node.discriminant=expression(node.discriminant,scope);const local=new Scope(scope);
        predeclare([...node.cases.flatMap((clause:Node)=>clause.body),...(node.defaultClause?.body ?? [])],local);
        for(const clause of node.cases) {clause.labels=clause.labels.map((label:Node)=>expression(label,local));clause.body=clause.body.map((item:Node)=>statement(item,local));}
        if(node.defaultClause) node.defaultClause.body=node.defaultClause.body.map((item:Node)=>statement(item,local));return node;
      }
      case "ExportDefaultDeclaration":node.declaration=statement(node.declaration,scope,top);return node;
      default:
        for(const [key,value] of Object.entries(node)) {
          if(["span","parent","resolvedType","resolvedSignature","resolvedRuntimeType"].includes(key)) continue;
          if(value && typeof value === "object" && "kind" in value) node[key]=String((value as Node).kind).endsWith("Statement") ? statement(value as Node,scope) : expression(value as Node,scope);
        }
        return node;
    }
  };
  predeclare(program.statements as Node[],root,true);
  program.statements=program.statements.map(node=>{owner=node;return statement(node,root,true);}) as Program["statements"];
}

/** Used for template linkage. Work on a clone so collection cannot alter
 * checker annotations or definition-site metadata in the actual program. */
export function referencedGlobals(program:Program,names:Set<string>):Map<string,Set<string>> {
  const result=new Map<string,Set<string>>();
  bindModuleNames(structuredClone(program),{},{},{},(target,owner)=>{
    if(owner.kind !== "FunctionDeclaration" || !names.has(owner.name)) return;
    const refs=result.get(owner.name) ?? new Set<string>();refs.add(target);result.set(owner.name,refs);
  });
  return result;
}
