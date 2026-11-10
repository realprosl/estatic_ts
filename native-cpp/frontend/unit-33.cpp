// Generated module. Do not edit.
#include "estatic_common.hpp"

static inline double irIndex(std::vector<double> values, double value) {
    for (double i = 0.0; (i < values.size()); (i = (i + 1.0))) {
        if ((values[static_cast<std::size_t>(i)] == value)) {
            return i;
        }
    }
    return (-1.0);
}

static inline std::string ets_import_3_memoryMode(std::string text) {
    const std::string base = genericBase(text);
    return (ets_includes_vec<std::string>(std::vector<std::string>{std::string("ptr"), std::string("constPtr"), std::string("ref"), std::string("constRef"), std::string("readonly")}, base) ? base : std::string(""));
}

static inline std::string ets_import_5_memoryInner(std::string text) {
    return ((ets_import_3_memoryMode(text) == std::string("")) ? text : genericArguments(text)[static_cast<std::size_t>(0.0)]);
}

static inline std::string ets_import_7_memoryValue(std::string text) {
    std::string value = text;
    while ((ets_import_3_memoryMode(value) != std::string(""))) {
        (value = ets_import_5_memoryInner(value));
    }
    return value;
}

static inline bool irSameNumbers(std::vector<double> left, std::vector<double> right) {
    if ((left.size() != right.size())) {
        return false;
    }
    for (double i = 0.0; (i < left.size()); (i = (i + 1.0))) {
        if ((left[static_cast<std::size_t>(i)] != right[static_cast<std::size_t>(i)])) {
            return false;
        }
    }
    return true;
}

IrProject lowerProject(ModuleGraph graph, BindingResult binding, ets_import_9_CheckResult checked, bool trace) {
    auto lowering = IrLowering{}.constructor(graph, binding, checked);
    return lowering.run(trace);
}

void ets_init_bootstrap_ir_lower_45e87b9b() {
}
