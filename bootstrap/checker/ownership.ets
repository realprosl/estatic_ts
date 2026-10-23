import { ModuleGraph } from "../modules/loader";
import { BindingResult } from "../binder/binder";
import { memoryMode, memoryInner, ownedType, borrowedType, splitTypes, genericBase, genericArguments, functionClose, functionParams, semanticTuple, semanticElement, fixedArraySize, fixedArrayElement, replaceType } from "./types";

// A structural property of canonical types, independent of expression syntax.
// Borrowed views do not own their referents. Callable signatures describe calls,
// not their environments; closure capture ownership is checked separately.
export function resourceType(graph: ModuleGraph, binding: BindingResult, types: string[], text: string, history: string[]): boolean {
  if (ownedType(text)) return true;
  if (borrowedType(text) || functionClose(text) >= 0) return false;
  if (memoryMode(text) != "") return resourceType(graph,binding,types,memoryInner(text),history);
  if (genericBase(text) == "Promise") return true;
  if (history.includes(text)) return false;
  if (history.length > 128) return true;
  let next: string[] = history; next.push(text);
  if (fixedArraySize(text) >= 0) return resourceType(graph,binding,types,fixedArrayElement(text),next);
  if (text.endsWith("[]")) return resourceType(graph,binding,types,semanticElement(text),next);
  if (semanticTuple(text)) { for (const item of splitTypes(text.slice(1,text.length-1),",")) if (resourceType(graph,binding,types,item,next)) return true; return false; }
  for (const separator of ["|","&"]) {
    const parts: string[] = splitTypes(text,separator);
    if (parts.length > 1) { for (const part of parts) if (resourceType(graph,binding,types,part,next)) return true; return false; }
  }
  if (genericBase(text) == "variant") return resourceType(graph,binding,types,genericArguments(text)[0],next);
  const arguments: string[] = genericArguments(text);
  if (["Optional","Result","Map","Set","pack"].includes(genericBase(text))) { for (const item of arguments) if (resourceType(graph,binding,types,item,next)) return true; return false; }
  const base: string = text.indexOf("<",0) >= 0 ? text.slice(0,text.indexOf("<",0)) : text;
  for (let sid: number = 0; sid < binding.symbols.length; sid = sid + 1) if (base == "#" + numberToString(sid)) {
    const owner = binding.symbols[sid]; const declaration = graph.modules[owner.module].cached.result.ast.nodes[owner.node]; let tokens: string[] = [];
    for (const edge of declaration.edges) if (edge.role == "typeParameters") tokens.push("@" + numberToString(binding.files[owner.module].declarations[edge.node]));
    for (let member: number = 0; member < binding.symbols.length; member = member + 1) {
      const field = binding.symbols[member]; if (field.module != owner.module || (field.scope) < 0 || (field.kind == "UnionVariant" ? binding.files[field.module].parents[field.node] != owner.node : binding.scopes[field.scope].node != owner.node)) continue;
      if (!["ClassField","InterfaceField","UnionVariant"].includes(field.kind)) continue;
      const node = graph.modules[field.module].cached.result.ast.nodes[field.node]; if (node.get("isStatic") == "true") continue;
      let value: string = types[member];
      for (let at: number = 0; at < tokens.length && at < arguments.length; at = at + 1) value = replaceType(value,tokens[at],arguments[at]);
      if (field.kind == "UnionVariant") { for (const payload of functionParams(value)) if (resourceType(graph,binding,types,payload,next)) return true; }
      else if (resourceType(graph,binding,types,value,next)) return true;
    }
  }
  return false;
}

export function resourceSubstitution(pattern: string, actual: string, token: string): string {
  if (pattern.startsWith("...")) pattern = pattern.slice(3,pattern.length);
  if (actual.startsWith("...")) actual = actual.slice(3,actual.length);
  if (pattern == token) return actual;
  if (pattern.endsWith("[]") && actual.endsWith("[]")) return resourceSubstitution(semanticElement(pattern),semanticElement(actual),token);
  if (memoryMode(pattern) != "" && memoryMode(pattern) == memoryMode(actual)) return resourceSubstitution(memoryInner(pattern),memoryInner(actual),token);
  let patterns: string[] = []; let values: string[] = [];
  if (genericBase(pattern) != "" && genericBase(pattern) == genericBase(actual)) { patterns = genericArguments(pattern); values = genericArguments(actual); }
  else if (semanticTuple(pattern) && semanticTuple(actual)) { patterns = splitTypes(pattern.slice(1,pattern.length-1),","); values = splitTypes(actual.slice(1,actual.length-1),","); }
  if (patterns.length != values.length) return ""; let inferred: string = "";
  for (let at: number = 0; at < patterns.length; at = at+1) {
    const value: string = resourceSubstitution(patterns[at],values[at],token);
    if (value != "") { if (inferred != "" && inferred != value) return "!conflicting-inference"; inferred = value; }
  }
  return inferred;
}
