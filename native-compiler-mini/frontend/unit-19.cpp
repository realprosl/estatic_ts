// Generated module. Do not edit.
#include "estatic_common.hpp"

FrontendProject analyzeProject(ModuleGraph graph, bool trace) {
    if (trace) {
        printError(std::string("frontend: expansion and binding"));
    }
    auto expansion = NativeExpansion{}.constructor(graph);
    const ModuleGraph expanded = expansion.run();
    const BindingResult binding = bindProject(expanded);
    return FrontendProject{}.constructor(expanded, binding, checkProject(expanded, binding, trace));
}

void ets_init_bootstrap_checker_expansion_7e0d4139() {
}
