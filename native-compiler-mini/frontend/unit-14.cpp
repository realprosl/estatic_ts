// Generated module. Do not edit.
#include "estatic_common.hpp"

ets_import_7_CheckResult evaluateNativeComptime(ModuleGraph graph, BindingResult binding, ets_import_7_CheckResult checked) {
    auto evaluator = NativeComptime{}.constructor(graph, binding, checked);
    return evaluator.run();
}

void ets_init_bootstrap_checker_comptime_0c032780() {
}
