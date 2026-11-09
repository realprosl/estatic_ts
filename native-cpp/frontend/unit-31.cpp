// Generated module. Do not edit.
#include "estatic_common.hpp"

std::vector<IrIssue> verifyBorrowRoutes(const IrProject& project, IrFunction f) {
    std::vector<IrIssue> issues = std::vector<IrIssue>();
    auto analysis = IrBorrowAnalysis{}.constructor(f, project.types);
    analysis.propagate();
    std::vector<IrLeaseSet> availableOut = std::vector<IrLeaseSet>();
    std::vector<IrLeaseSet> activeOut = std::vector<IrLeaseSet>();
    std::vector<bool> reachable = std::vector<bool>();
    for (const auto& block : f.blocks) {
        ets_push_vec<IrLeaseSet>(activeOut, IrLeaseSet{}.constructor());
        auto available = IrLeaseSet{}.constructor();
        for (double lease = 0.0; (lease < f.leases.size()); (lease = (lease + 1.0))) {
            ets_push_vec<double>(available.values, lease);
        }
        ets_push_vec<IrLeaseSet>(availableOut, available);
        ets_push_vec<bool>(reachable, false);
    }
    if ((f.blocks.size() == 0.0)) {
        return issues;
    }
    ets_set_vec<bool>(reachable, 0.0, true);
    bool changed = true;
    while (changed) {
        (changed = false);
        for (double b = 0.0; (b < f.blocks.size()); (b = (b + 1.0))) {
            std::vector<double> active = std::vector<double>();
            std::vector<double> available = std::vector<double>();
            bool first = (b != 0.0);
            for (double predecessor = 0.0; (predecessor < f.blocks.size()); (predecessor = (predecessor + 1.0))) {
                if ((reachable[static_cast<std::size_t>(predecessor)] && ets_includes_vec<double>(f.blocks[static_cast<std::size_t>(predecessor)].targets, b))) {
                    if ((!reachable[static_cast<std::size_t>(b)])) {
                        ets_set_vec<bool>(reachable, b, true);
                        (changed = true);
                    }
                    (active = irLeaseUnion(active, activeOut[static_cast<std::size_t>(predecessor)].values));
                    if (first) {
                        (available = availableOut[static_cast<std::size_t>(predecessor)].values);
                        (first = false);
                    } else {
                        std::vector<double> common = std::vector<double>();
                        for (const auto& lease : available) {
                            if (ets_includes_vec<double>(availableOut[static_cast<std::size_t>(predecessor)].values, lease)) {
                                ets_push_vec<double>(common, lease);
                            }
                        }
                        (available = common);
                    }
                }
            }
            if ((!reachable[static_cast<std::size_t>(b)])) {
                continue;
            }
            for (const auto& i : f.blocks[static_cast<std::size_t>(b)].instructions) {
                if ((ets_includes_vec<std::string>(std::vector<std::string>{std::string("borrow"), std::string("address")}, i.op) && (i.lease >= 0.0))) {
                    (active = irLeaseUnion(active, std::vector<double>{i.lease}));
                    (available = irLeaseUnion(available, std::vector<double>{i.lease}));
                }
                if ((i.op == std::string("endBorrow"))) {
                    (active = irLeaseRemove(active, i.lease));
                    (available = irLeaseRemove(available, i.lease));
                }
            }
            if (((!irLeaseEqual(active, activeOut[static_cast<std::size_t>(b)].values)) || (!irLeaseEqual(available, availableOut[static_cast<std::size_t>(b)].values)))) {
                (activeOut[static_cast<std::size_t>(b)].values = active);
                (availableOut[static_cast<std::size_t>(b)].values = available);
                (changed = true);
            }
        }
    }
    for (double b = 0.0; (b < f.blocks.size()); (b = (b + 1.0))) {
        if (reachable[static_cast<std::size_t>(b)]) {
            std::vector<double> available = std::vector<double>();
            bool first = (b != 0.0);
            for (double predecessor = 0.0; (predecessor < f.blocks.size()); (predecessor = (predecessor + 1.0))) {
                if ((reachable[static_cast<std::size_t>(predecessor)] && ets_includes_vec<double>(f.blocks[static_cast<std::size_t>(predecessor)].targets, b))) {
                    if (first) {
                        (available = availableOut[static_cast<std::size_t>(predecessor)].values);
                        (first = false);
                    } else {
                        std::vector<double> common = std::vector<double>();
                        for (const auto& lease : available) {
                            if (ets_includes_vec<double>(availableOut[static_cast<std::size_t>(predecessor)].values, lease)) {
                                ets_push_vec<double>(common, lease);
                            }
                        }
                        (available = common);
                    }
                }
            }
            std::vector<double> active = std::vector<double>();
            for (double predecessor = 0.0; (predecessor < f.blocks.size()); (predecessor = (predecessor + 1.0))) {
                if ((reachable[static_cast<std::size_t>(predecessor)] && ets_includes_vec<double>(f.blocks[static_cast<std::size_t>(predecessor)].targets, b))) {
                    (active = irLeaseUnion(active, activeOut[static_cast<std::size_t>(predecessor)].values));
                }
            }
            for (const auto& i : f.blocks[static_cast<std::size_t>(b)].instructions) {
                const std::vector<double> uses = analysis.uses(i);
                for (const auto& lease : uses) {
                    if ((!ets_includes_vec<double>(available, lease))) {
                        ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Uso de préstamo fuera de su duración CFG"), i.source));
                    }
                }
                if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("borrow"), std::string("address")}, i.op)) {
                    if (((((i.lease < 0.0) || (i.lease >= f.leases.size())) || (f.leases[static_cast<std::size_t>(i.lease)].value != i.result)) || (f.leases[static_cast<std::size_t>(i.lease)].place != i.place))) {
                        ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Identidad de préstamo inválida"), i.source));
                        continue;
                    }
                    const std::string projectionKey = irPlacePath(f, i.place, 0.0);
                    for (const auto& previous : active) {
                        if (((previous >= 0.0) && (previous < f.leases.size()))) {
                            const std::string key = irPlacePath(f, f.leases[static_cast<std::size_t>(previous)].place, 0.0);
                            if ((((((projectionKey == key) || ::ets::string_startsWith(projectionKey, ets::concat(key, std::string(".")))) || ::ets::string_startsWith(key, ets::concat(projectionKey, std::string(".")))) && ((f.leases[static_cast<std::size_t>(previous)].mode == std::string("ref")) || (f.leases[static_cast<std::size_t>(i.lease)].mode == std::string("ref")))) && (!ets_includes_vec<double>(uses, previous)))) {
                                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Préstamos incompatibles sobre el mismo place"), i.source));
                            }
                        }
                    }
                    (active = irLeaseUnion(active, std::vector<double>{i.lease}));
                    (available = irLeaseUnion(available, std::vector<double>{i.lease}));
                }
                if ((ets_includes_vec<std::string>(std::vector<std::string>{std::string("store"), std::string("move"), std::string("dropRemaining")}, i.op) && (i.place >= 0.0))) {
                    const std::string projectionKey = irPlacePath(f, i.place, 0.0);
                    for (const auto& lease : active) {
                        if ((((lease >= 0.0) && (lease < f.leases.size())) && (!ets_includes_vec<double>(uses, lease)))) {
                            const std::string key = irPlacePath(f, f.leases[static_cast<std::size_t>(lease)].place, 0.0);
                            if ((((projectionKey == key) || ::ets::string_startsWith(projectionKey, ets::concat(key, std::string(".")))) || ::ets::string_startsWith(key, ets::concat(projectionKey, std::string("."))))) {
                                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Mutación/move/drop con préstamo activo"), i.source));
                            }
                        }
                    }
                }
                if ((i.op == std::string("endBorrow"))) {
                    if (((i.lease < 0.0) || (i.lease >= f.leases.size()))) {
                        ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Fin de préstamo inexistente"), i.source));
                    }
                    (active = irLeaseRemove(active, i.lease));
                    (available = irLeaseRemove(available, i.lease));
                }
            }
            if ((ets_includes_vec<std::string>(std::vector<std::string>{std::string("return"), std::string("cancel"), std::string("suspend"), std::string("trap")}, f.blocks[static_cast<std::size_t>(b)].terminator) && (active.size() > 0.0))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Salida con préstamos activos"), f.blocks[static_cast<std::size_t>(b)].source));
            }
        }
    }
    return issues;
}

void ets_init_bootstrap_ir_verify_borrows_7094b439() {
}
