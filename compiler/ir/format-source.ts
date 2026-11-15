import { IrSource } from "./model";
import { quoteSource } from "../diag/index";
export function formatIrSource(source: IrSource): string {
  return "{\"moduleId\":"+quoteSource(source.moduleId)+",\"generatedId\":"+quoteSource(source.generatedId)+",\"generatedStart\":"+numberToString(source.generatedStart)+",\"generatedEnd\":"+numberToString(source.generatedEnd)+",\"sourceHash\":"+quoteSource(source.sourceHash)+",\"file\":"+quoteSource(source.file)+",\"node\":"+numberToString(source.node)+",\"start\":"+numberToString(source.start)+",\"end\":"+numberToString(source.end)+"}";
}
