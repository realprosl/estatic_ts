// Generated module. Do not edit.
#include "estatic_common.hpp"

ets_import_7_CheckResult checkProject(ModuleGraph graph, BindingResult binding, bool trace) {
    NativeChecker checker = NativeChecker{}.constructor(graph, binding);
    (checker.trace = trace);
    const ets_import_7_CheckResult checked = checker.check();
    if (trace) {
        progressDetail(std::string("frontend: module records"));
    }
    return attachModuleRecords(graph, binding, checked);
}

void ets_init_bootstrap_checker_checker_b1f45756() {
}
