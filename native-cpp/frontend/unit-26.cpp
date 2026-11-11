// Generated module. Do not edit.
#include "estatic_common.hpp"

static inline IrSource contractSource(const ModuleGraph& graph, const ets_import_9_CheckResult& checked, double module, double id) {
    const auto n = graph.modules[static_cast<std::size_t>(module)].cached.result.ast.nodes[static_cast<std::size_t>(id)];
    const auto record = checked.moduleRecords[static_cast<std::size_t>(module)];
    auto source = IrSource{}.constructor(record.id, record.sourceHash, graph.modules[static_cast<std::size_t>(module)].file, id, n.start.offset, n.end.endOffset);
    if ((n.generatedId != std::string(""))) {
        (source.generatedId = n.generatedId);
        (source.generatedStart = n.generatedStart.offset);
        (source.generatedEnd = n.generatedEnd.endOffset);
    }
    return source;
}

static inline std::vector<std::string> contractSymbols(const ets_import_9_CheckResult& checked, std::vector<double> symbols) {
    std::vector<std::string> result = std::vector<std::string>();
    for (const auto& symbol : symbols) {
        ets_push_vec<std::string>(result, (((symbol >= 0.0) && (symbol < checked.symbolIds.size())) ? checked.symbolIds[static_cast<std::size_t>(symbol)] : std::string("unknown")));
    }
    return result;
}

IrProject preserveContracts(const ModuleGraph& graph, const ets_import_9_CheckResult& checked, IrProject project) {
    for (const auto& effect : checked.effects) {
        auto result = IrEffectContract{}.constructor(contractSource(graph, checked, effect.module, effect.node));
        (result.phase = effect.phase);
        (result.creation = effect.creation);
        (result.callees = effect.callees);
        (result.parameters = contractSymbols(checked, effect.parameters));
        (result.reads = contractSymbols(checked, effect.reads));
        (result.writes = contractSymbols(checked, effect.writes));
        (result.moves = contractSymbols(checked, effect.moves));
        (result.invokes = contractSymbols(checked, effect.invokes));
        (result.retains = contractSymbols(checked, effect.retains));
        (result.returned = contractSymbols(checked, effect.returned));
        (result.unknown = effect.unknown);
        (result.recursive = effect.recursive);
        (result.external = effect.external);
        for (const auto& lease : effect.borrows) {
            ets_push_vec<IrEffectBorrow>(result.borrows, IrEffectBorrow{}.constructor(contractSource(graph, checked, effect.module, lease.call), checked.symbolIds[static_cast<std::size_t>(lease.callback)], checked.symbolIds[static_cast<std::size_t>(lease.root)], lease.mode));
        }
        ets_push_vec<IrEffectContract>(project.effectContracts, result);
    }
    for (double f = 0.0; (f < project.functions.size()); (f = (f + 1.0))) {
        for (double at = 0.0; (at < project.effectContracts.size()); (at = (at + 1.0))) {
            if (((project.functions[static_cast<std::size_t>(f)].source.moduleId == project.effectContracts[static_cast<std::size_t>(at)].source.moduleId) && (project.functions[static_cast<std::size_t>(f)].source.node == project.effectContracts[static_cast<std::size_t>(at)].source.node))) {
                ets_push_vec<double>(project.functions[static_cast<std::size_t>(f)].effectContracts, at);
            }
        }
    }
    for (const auto& annotation : checked.decorators) {
        ets_push_vec<IrAnnotation>(project.annotations, IrAnnotation{}.constructor(contractSource(graph, checked, annotation.module, annotation.node), contractSource(graph, checked, annotation.module, annotation.target), annotation.name, annotation.arguments));
    }
    return project;
}

void ets_init_bootstrap_ir_contracts_141fd47f() {
}
