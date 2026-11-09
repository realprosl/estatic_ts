// Generated module. Do not edit.
#include "estatic_common.hpp"

static inline std::string framed(std::string text) {
    return ets::concat(numberToString(::ets::string_length(text)), std::string(":"), text);
}

static inline double compareKeys(std::string a, std::string b) {
    const double length = Math.min(::ets::string_length(a), ::ets::string_length(b));
    for (double at = 0.0; (at < length); (at = (at + 1.0))) {
        const double difference = (::ets::string_charCodeAt(a, at) - ::ets::string_charCodeAt(b, at));
        if ((difference != 0.0)) {
            return difference;
        }
    }
    return (::ets::string_length(a) - ::ets::string_length(b));
}

static inline std::string framedList(std::vector<std::string> values) {
    std::string output = std::string("");
    for (const auto& value : values) {
        (output = ets::concat(output, framed(value)));
    }
    return output;
}

ets_import_7_CheckResult attachModuleRecords(ModuleGraph graph, BindingResult binding, ets_import_7_CheckResult checked) {
    auto builder = ModuleRecordBuilder{}.constructor(graph, binding, checked);
    return builder.run();
}

void ets_init_bootstrap_checker_module_records_e828114e() {
}
