// API pública de compiler/diag/ (#177): lo único que pueden importar las demás capas.
// Generado a partir de los imports reales; añade aquí lo que otra capa necesite.

export { catalogArg, catalogVariant } from "./catalog";
export { diagnosticAt, formatDiagnostic, formatSource, parseSource, quoteSource, SourceDiagnostic, SourceResult } from "./source";
export { closestName } from "./suggest";
