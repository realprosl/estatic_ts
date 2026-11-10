// Generated module. Do not edit.
#include "estatic_common.hpp"

void validateSafety(ModuleGraph graph, BindingResult binding, ets_import_9_CheckResult& result, bool trace) {
    SafetyAnalyzer analyzer = SafetyAnalyzer{}.constructor(graph, binding, result);
    (analyzer.trace = trace);
    (result = analyzer.run());
}

void ets_init_bootstrap_checker_safety_88c3403a() {
}
