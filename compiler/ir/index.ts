// API pública de compiler/ir/ (#177): lo único que pueden importar las demás capas.
// Generado a partir de los imports reales; añade aquí lo que otra capa necesite.

export { formatIr } from "./format";
export { lowerProject } from "./lower";
export { IrIssue, IrProject, IrSource } from "./model";
