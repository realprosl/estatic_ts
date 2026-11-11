// Generated module. Do not edit.
#include "estatic_common.hpp"

std::string bindingBoolean(bool value) {
    return (value ? std::string("true") : std::string("false"));
}

std::string bindingNumbers(std::vector<double> values) {
    std::vector<std::string> output = std::vector<std::string>();
    for (const auto& value : values) {
        ets_push_vec<std::string>(output, numberToString(value));
    }
    return ets::concat(std::string("["), ets_join_vec(output, std::string(",")), std::string("]"));
}

std::string formatBinding(BindingResult result, ModuleGraph graph) {
    std::vector<std::string> output = std::vector<std::string>{ets::concat(std::string("{\"success\":"), bindingBoolean(result.success), std::string(",\"files\":["))};
    std::string comma = std::string("");
    for (double m = 0.0; (m < graph.modules.size()); (m = (m + 1.0))) {
        ets_push_vec<std::string>(output, ets::concat(comma, std::string("{\"file\":"), quoteSource(graph.modules[static_cast<std::size_t>(m)].file)));
        if ((m < result.files.size())) {
            ets_push_vec<std::string>(output, ets::concat(std::string(",\"scope\":"), numberToString(result.files[static_cast<std::size_t>(m)].scope), std::string(",\"nodeScopes\":"), bindingNumbers(result.files[static_cast<std::size_t>(m)].nodeScopes), std::string(",\"declarations\":"), bindingNumbers(result.files[static_cast<std::size_t>(m)].declarations)));
        }
        ets_push_vec<std::string>(output, std::string(",\"nodes\":["));
        std::string separator = std::string("");
        for (const auto& node : graph.modules[static_cast<std::size_t>(m)].cached.result.ast.nodes) {
            ets_push_vec<std::string>(output, ets::concat(separator, std::string("{\"kind\":"), quoteSource(nodeKindName(node.kind)), std::string(",\"name\":"), quoteSource(node.get(AttributeKind::Name)), std::string(",\"offset\":"), numberToString(node.start.offset), std::string("}")));
            (separator = std::string(","));
        }
        ets_push_vec<std::string>(output, std::string("]}"));
        (comma = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("],\"scopes\":["));
    (comma = std::string(""));
    for (const auto& scope : result.scopes) {
        ets_push_vec<std::string>(output, ets::concat(comma, std::string("{\"parent\":"), numberToString(scope.parent), std::string(",\"module\":"), numberToString(scope.module), std::string(",\"node\":"), numberToString(scope.node), std::string(",\"kind\":"), quoteSource(scope.kind), std::string(",\"symbols\":"), bindingNumbers(scope.symbols), std::string("}")));
        (comma = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("],\"symbols\":["));
    (comma = std::string(""));
    for (const auto& symbol : result.symbols) {
        ets_push_vec<std::string>(output, ets::concat(comma, std::string("{\"name\":"), quoteSource(symbol.name), std::string(",\"kind\":"), quoteSource(symbol.kind), std::string(",\"scope\":"), numberToString(symbol.scope), std::string(",\"module\":"), numberToString(symbol.module), std::string(",\"node\":"), numberToString(symbol.node), std::string(",\"declarations\":"), bindingNumbers(symbol.declarations), std::string(",\"values\":"), bindingBoolean(symbol.values), std::string(",\"types\":"), bindingBoolean(symbol.types), std::string(",\"target\":"), numberToString(symbol.target), std::string(",\"namespaceModule\":"), numberToString(symbol.namespaceModule), std::string(",\"typeOnly\":"), bindingBoolean(symbol.typeOnly), std::string("}")));
        (comma = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("],\"references\":["));
    (comma = std::string(""));
    for (const auto& ref : result.references) {
        ets_push_vec<std::string>(output, ets::concat(comma, std::string("{\"module\":"), numberToString(ref.module), std::string(",\"node\":"), numberToString(ref.node), std::string(",\"scope\":"), numberToString(ref.scope), std::string(",\"name\":"), quoteSource(ref.name), std::string(",\"space\":"), quoteSource(ref.space), std::string(",\"symbol\":"), numberToString(ref.symbol), std::string(",\"target\":"), numberToString(ref.target), std::string(",\"deferred\":"), bindingBoolean(ref.deferred), std::string("}")));
        (comma = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("],\"exports\":["));
    (comma = std::string(""));
    for (const auto& entry : result.exports) {
        ets_push_vec<std::string>(output, ets::concat(comma, std::string("{\"module\":"), numberToString(entry.module), std::string(",\"name\":"), quoteSource(entry.name), std::string(",\"symbol\":"), numberToString(entry.symbol), std::string(",\"typeOnly\":"), bindingBoolean(entry.typeOnly), std::string("}")));
        (comma = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("],\"diagnostics\":["));
    (comma = std::string(""));
    for (const auto& diagnostic : result.diagnostics) {
        ets_push_vec<std::string>(output, ets::concat(comma, formatDiagnostic(diagnostic)));
        (comma = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("]}"));
    return ets_join_vec(output, std::string(""));
}

void ets_init_bootstrap_binder_format_d243f694() {
}
