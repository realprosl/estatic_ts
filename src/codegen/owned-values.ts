import type { ClassDeclaration, TypeName } from "../ast/nodes.ts";
import { arrayElement, fixedArrayElement, genericArguments, genericBase, isArrayType, isFixedArrayType, isGenericType, isTupleType, isUnionType, tupleElements, unionMembers } from "../types/type-system.ts";

/** Used only for lowering: ownership still has to be accepted by the checker.
 * Walk the reachable type graph once, including recursive classes, rather
 * than expanding every path through shared subgraphs.
 */
export function containsOwner(type: TypeName, classes: ReadonlyMap<string, ClassDeclaration>, cache = new Map<string, boolean>()): boolean {
  const cached = cache.get(type);
  if (cached !== undefined) return cached;
  const pending = [type], seen = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (isArrayType(current)) { pending.push(arrayElement(current)); continue; }
    if (isFixedArrayType(current)) { pending.push(fixedArrayElement(current)!); continue; }
    if (isTupleType(current)) { pending.push(...tupleElements(current)); continue; }
    if (isUnionType(current)) { pending.push(...unionMembers(current)); continue; }
    const base = isGenericType(current) ? genericBase(current) : current;
    const args = isGenericType(current) ? genericArguments(current) : [];
    if (base === "ptr" || base === "constPtr") { cache.set(type, true); return true; }
    if (base === "ref" || base === "constRef") continue;
    const cls = classes.get(base);
    if (!cls) { pending.push(...args); continue; }
    const bindings = new Map(cls.typeParameters.map((parameter, index) => [parameter.name, args[index] ?? parameter.default ?? parameter.name]));
    const substitute = (text: string) => text.replace(/[A-Za-z_$][\w$]*/g, token => bindings.get(token) ?? token);
    for (const field of cls.fields) if (!field.isStatic) pending.push(substitute(field.type));
    for (const method of cls.methods) if (method.name === "constructor") for (const p of method.params) if (p.access || p.readonly) pending.push(substitute(p.type));
  }
  cache.set(type, false);
  return false;
}
