// Generated module. Do not edit.
#include "estatic_common.hpp"

std::string irPlacePath(const IrFunction& f, double place, double depth) {
    if ((((place < 0.0) || (place >= f.places.size())) || (depth > f.places.size()))) {
        return std::string("invalid");
    }
    const auto p = f.places[static_cast<std::size_t>(place)];
    if ((p.base < 0.0)) {
        return ets::concat(std::string("p"), numberToString(place));
    }
    const std::string base = irPlacePath(f, p.base, (depth + 1.0));
    if ((p.kind == std::string("field"))) {
        return ets::concat(base, std::string(".f"), numberToString(p.field));
    }
    if ((p.kind == std::string("deref"))) {
        return ets::concat(base, std::string(".d"));
    }
    if ((p.kind == std::string("index"))) {
        const double constant = irConstantIndex(f, p.index);
        return ets::concat(base, std::string(".i"), ((constant >= 0.0) ? numberToString(constant) : ets::concat(std::string("v"), numberToString(p.index))));
    }
    return base;
}

bool irInitialPlace(const IrFunction& f, double place) {
    double root = place;
    double steps = 0.0;
    while ((((f.places[static_cast<std::size_t>(root)].base >= 0.0) && (f.places[static_cast<std::size_t>(root)].base < root)) && (steps < f.places.size()))) {
        (root = f.places[static_cast<std::size_t>(root)].base);
        (steps = (steps + 1.0));
    }
    return ((f.places[static_cast<std::size_t>(root)].parameter || (f.places[static_cast<std::size_t>(root)].global >= 0.0)) || (f.places[static_cast<std::size_t>(root)].kind == std::string("capture")));
}

void ets_init_bootstrap_ir_verify_memory_9a5f20b0() {
}
