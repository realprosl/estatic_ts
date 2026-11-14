// API pública de compiler/backend/cpp/ (#177): lo único que pueden importar las demás capas.
// Generado a partir de los imports reales; añade aquí lo que otra capa necesite.

export { parseIrProject } from "./decode";
export { generateCppFromIr, IrCppResult, IrCppUnit } from "./generator";
export { formatCppResult } from "./wire";
