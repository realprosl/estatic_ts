// Generated module. Do not edit.
#include "estatic_common.hpp"

static inline std::string strings(std::vector<std::string> values) {
    std::vector<std::string> result = std::vector<std::string>();
    for (const auto& value : values) {
        ets_push_vec<std::string>(result, quoteSource(value));
    }
    return ets::concat(std::string("["), ets_join_vec(result, std::string(",")), std::string("]"));
}

std::string formatContracts(const IrProject& project) {
    std::vector<std::string> contracts = std::vector<std::string>();
    for (const auto& effect : project.effectContracts) {
        std::vector<std::string> borrows = std::vector<std::string>();
        for (const auto& lease : effect.borrows) {
            ets_push_vec<std::string>(borrows, ets::concat(std::string("{\"source\":"), formatIrSource(lease.source), std::string(",\"callback\":"), quoteSource(lease.callback), std::string(",\"root\":"), quoteSource(lease.root), std::string(",\"mode\":"), quoteSource(lease.mode), std::string("}")));
        }
        ets_push_vec<std::string>(contracts, ets::concat(std::string("{\"source\":"), formatIrSource(effect.source), std::string(",\"phase\":"), quoteSource(effect.phase), std::string(",\"creation\":"), numberToString(effect.creation), std::string(",\"callees\":"), bindingNumbers(effect.callees), std::string(",\"parameters\":"), strings(effect.parameters), std::string(",\"reads\":"), strings(effect.reads), std::string(",\"writes\":"), strings(effect.writes), std::string(",\"moves\":"), strings(effect.moves), std::string(",\"invokes\":"), strings(effect.invokes), std::string(",\"retains\":"), strings(effect.retains), std::string(",\"returned\":"), strings(effect.returned), std::string(",\"borrows\":["), ets_join_vec(borrows, std::string(",")), std::string("],\"unknown\":"), bindingBoolean(effect.unknown), std::string(",\"recursive\":"), bindingBoolean(effect.recursive), std::string(",\"external\":"), bindingBoolean(effect.external), std::string("}")));
    }
    std::vector<std::string> annotations = std::vector<std::string>();
    for (const auto& annotation : project.annotations) {
        ets_push_vec<std::string>(annotations, ets::concat(std::string("{\"source\":"), formatIrSource(annotation.source), std::string(",\"target\":"), formatIrSource(annotation.target), std::string(",\"name\":"), quoteSource(annotation.name), std::string(",\"arguments\":"), strings(annotation.arguments), std::string("}")));
    }
    return ets::concat(std::string("\"effectContracts\":["), ets_join_vec(contracts, std::string(",")), std::string("],\"annotations\":["), ets_join_vec(annotations, std::string(",")), std::string("]"));
}

void ets_init_bootstrap_ir_format_contracts_1cbcd575() {
}
