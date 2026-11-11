// Generated module. Do not edit.
#include "estatic_common.hpp"

double argumentParameter(const ets_import_8_TypedFile& file, double node, double position) {
    return ((file.argumentParameters[static_cast<std::size_t>(node)] >= 0.0) ? file.argumentParameters[static_cast<std::size_t>(node)] : position);
}

bool readonlyMethodReceiver(const BindingResult& binding, const ets_import_9_CheckResult& checked, double module, double node) {
    for (double at = 0.0; (at < checked.captures.size()); (at = (at + 1.0))) {
        const auto symbol = binding.symbols[static_cast<std::size_t>(checked.captures[static_cast<std::size_t>(at)].symbol)];
        if (((((symbol.kind == std::string("receiver")) && (symbol.module == module)) && (symbol.scope >= 0.0)) && (binding.scopes[static_cast<std::size_t>(symbol.scope)].node == node))) {
            return false;
        }
    }
    for (double at = 0.0; (at < checked.effects.size()); (at = (at + 1.0))) {
        const auto summary = checked.effects[static_cast<std::size_t>(at)];
        if ((((summary.module != module) || (summary.node != node)) || (summary.phase != std::string("body")))) {
            continue;
        }
        if (((summary.unknown || summary.external) || (summary.invokes.size() > 0.0))) {
            return false;
        }
        if ((summary.retains.size() > 0.0)) {
            return false;
        }
        for (const auto& borrow : summary.borrows) {
            if ((borrow.mode == std::string("ref"))) {
                return false;
            }
        }
        for (const auto& sid : ets_concat_vec<double>({summary.writes, summary.moves})) {
            if (((sid < 0.0) || (sid >= binding.symbols.size()))) {
                return false;
            }
            const auto symbol = binding.symbols[static_cast<std::size_t>(sid)];
            if (((((symbol.kind == std::string("receiver")) && (symbol.module == module)) && (symbol.scope >= 0.0)) && (binding.scopes[static_cast<std::size_t>(symbol.scope)].node == node))) {
                return false;
            }
        }
        return true;
    }
    return false;
}

void ets_init_bootstrap_checker_model_f556179b() {
}
