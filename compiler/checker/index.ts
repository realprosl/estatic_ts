// API pública de compiler/checker/ (#177): lo único que pueden importar las demás capas.
// Generado a partir de los imports reales; añade aquí lo que otra capa necesite.

export { NativeComptime } from "./comptime";
export { constantIntegerText } from "./constant";
export { analyzeProject } from "./expansion";
export { formatModuleInterface } from "./format";
export { CheckResult, readonlyMethodReceiver } from "./model";
export { nativeBinaryPromotion, nativeInteger64, nativeNumericLiteral, nativeUnaryPromotion } from "./numeric";
export { resourceSubstitution, resourceType } from "./ownership";
export { canonicalSymbol, fixedArrayElement, fixedArraySize, functionClose, functionParams, functionReturn, genericArguments, genericBase, joinTypes, literalKind, literalType, literalValue, numericType, primitiveType, replaceType, semanticElement, semanticTuple, splitTypes } from "./types";
