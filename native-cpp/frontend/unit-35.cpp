// Generated module. Do not edit.
#include "estatic_common.hpp"

std::string formatIrSource(IrSource source) {
    return ets::concat(std::string("{\"moduleId\":"), quoteSource(source.moduleId), std::string(",\"generatedId\":"), quoteSource(source.generatedId), std::string(",\"generatedStart\":"), numberToString(source.generatedStart), std::string(",\"generatedEnd\":"), numberToString(source.generatedEnd), std::string(",\"sourceHash\":"), quoteSource(source.sourceHash), std::string(",\"file\":"), quoteSource(source.file), std::string(",\"node\":"), numberToString(source.node), std::string(",\"start\":"), numberToString(source.start), std::string(",\"end\":"), numberToString(source.end), std::string("}"));
}

void ets_init_bootstrap_ir_format_source_f8a27d8a() {
}
