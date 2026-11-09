// Generated module. Do not edit.
#include "estatic_common.hpp"

std::vector<IrIssue> verifyOwnershipRoutes(const IrProject& project, const IrFunction& f) {
    std::vector<IrIssue> issues = std::vector<IrIssue>();
    const double offset = f.values.size();
    const double count = (offset + f.places.size());
    std::vector<IrOwnershipFacts> facts = std::vector<IrOwnershipFacts>();
    std::vector<bool> tracked = std::vector<bool>();
    for (const auto& typeId : f.values) {
        ets_push_vec<bool>(tracked, project.typeDefinitions[static_cast<std::size_t>(typeId)].resource);
    }
    for (const auto& p : f.places) {
        ets_push_vec<bool>(tracked, (((p.kind == std::string("local")) && (p.global < 0.0)) && project.typeDefinitions[static_cast<std::size_t>(p.typeId)].resource));
    }
    for (const auto& b : f.blocks) {
        ets_push_vec<IrOwnershipFacts>(facts, IrOwnershipFacts{}.constructor(count));
    }
    if ((facts.size() == 0.0)) {
        return issues;
    }
    (facts[static_cast<std::size_t>(0.0)].reachable = true);
    bool changed = true;
    while (changed) {
        (changed = false);
        for (double b = 0.0; (b < f.blocks.size()); (b = (b + 1.0))) {
            std::vector<bool> must = std::vector<bool>();
            std::vector<bool> may = std::vector<bool>();
            for (double at = 0.0; (at < count); (at = (at + 1.0))) {
                const bool entry = (((at >= offset) && f.places[static_cast<std::size_t>((at - offset))].parameter) && tracked[static_cast<std::size_t>(at)]);
                ets_push_vec<bool>(must, ((b == 0.0) ? entry : true));
                ets_push_vec<bool>(may, ((b == 0.0) ? entry : false));
            }
            for (double predecessor = 0.0; (predecessor < f.blocks.size()); (predecessor = (predecessor + 1.0))) {
                if ((facts[static_cast<std::size_t>(predecessor)].reachable && ets_includes_vec<double>(f.blocks[static_cast<std::size_t>(predecessor)].targets, b))) {
                    if ((!facts[static_cast<std::size_t>(b)].reachable)) {
                        (facts[static_cast<std::size_t>(b)].reachable = true);
                        (changed = true);
                    }
                    if ((b != 0.0)) {
                        for (double at = 0.0; (at < count); (at = (at + 1.0))) {
                            ets_set_vec<bool>(must, at, (must[static_cast<std::size_t>(at)] && facts[static_cast<std::size_t>(predecessor)].must[static_cast<std::size_t>(at)]));
                            ets_set_vec<bool>(may, at, (may[static_cast<std::size_t>(at)] || facts[static_cast<std::size_t>(predecessor)].may[static_cast<std::size_t>(at)]));
                        }
                    }
                }
            }
            if ((!facts[static_cast<std::size_t>(b)].reachable)) {
                continue;
            }
            for (const auto& i : f.blocks[static_cast<std::size_t>(b)].instructions) {
                if ((i.op == std::string("dropFrame"))) {
                    for (double at = 0.0; (at < count); (at = (at + 1.0))) {
                        ets_set_vec<bool>(must, at, false);
                        ets_set_vec<bool>(may, at, false);
                    }
                }
                for (const auto& operand : i.operands) {
                    if ((((operand >= 0.0) && (operand < offset)) && tracked[static_cast<std::size_t>(operand)])) {
                        ets_set_vec<bool>(must, operand, false);
                        ets_set_vec<bool>(may, operand, false);
                    }
                }
                if ((((i.op == std::string("store")) && (i.place >= 0.0)) && tracked[static_cast<std::size_t>((offset + i.place))])) {
                    ets_set_vec<bool>(must, (offset + i.place), true);
                    ets_set_vec<bool>(may, (offset + i.place), true);
                }
                if (((((i.op == std::string("move")) || (i.op == std::string("dropRemaining"))) && (i.place >= 0.0)) && tracked[static_cast<std::size_t>((offset + i.place))])) {
                    ets_set_vec<bool>(must, (offset + i.place), false);
                    ets_set_vec<bool>(may, (offset + i.place), false);
                }
                if (((i.result >= 0.0) && tracked[static_cast<std::size_t>(i.result)])) {
                    ets_set_vec<bool>(must, i.result, true);
                    ets_set_vec<bool>(may, i.result, true);
                }
            }
            if (((((f.blocks[static_cast<std::size_t>(b)].terminator == std::string("return")) || (f.blocks[static_cast<std::size_t>(b)].terminator == std::string("suspend"))) && (f.blocks[static_cast<std::size_t>(b)].value >= 0.0)) && tracked[static_cast<std::size_t>(f.blocks[static_cast<std::size_t>(b)].value)])) {
                ets_set_vec<bool>(must, f.blocks[static_cast<std::size_t>(b)].value, false);
                ets_set_vec<bool>(may, f.blocks[static_cast<std::size_t>(b)].value, false);
            }
            for (double at = 0.0; (at < count); (at = (at + 1.0))) {
                if (((facts[static_cast<std::size_t>(b)].must[static_cast<std::size_t>(at)] != must[static_cast<std::size_t>(at)]) || (facts[static_cast<std::size_t>(b)].may[static_cast<std::size_t>(at)] != may[static_cast<std::size_t>(at)]))) {
                    ets_set_vec<bool>(facts[static_cast<std::size_t>(b)].must, at, must[static_cast<std::size_t>(at)]);
                    ets_set_vec<bool>(facts[static_cast<std::size_t>(b)].may, at, may[static_cast<std::size_t>(at)]);
                    (changed = true);
                }
            }
        }
    }
    for (double b = 0.0; (b < f.blocks.size()); (b = (b + 1.0))) {
        if (facts[static_cast<std::size_t>(b)].reachable) {
            std::vector<bool> must = std::vector<bool>();
            std::vector<bool> may = std::vector<bool>();
            for (double at = 0.0; (at < count); (at = (at + 1.0))) {
                const bool entry = (((at >= offset) && f.places[static_cast<std::size_t>((at - offset))].parameter) && tracked[static_cast<std::size_t>(at)]);
                ets_push_vec<bool>(must, ((b == 0.0) ? entry : true));
                ets_push_vec<bool>(may, ((b == 0.0) ? entry : false));
            }
            if ((b != 0.0)) {
                for (double predecessor = 0.0; (predecessor < f.blocks.size()); (predecessor = (predecessor + 1.0))) {
                    if ((facts[static_cast<std::size_t>(predecessor)].reachable && ets_includes_vec<double>(f.blocks[static_cast<std::size_t>(predecessor)].targets, b))) {
                        for (double at = 0.0; (at < count); (at = (at + 1.0))) {
                            ets_set_vec<bool>(must, at, (must[static_cast<std::size_t>(at)] && facts[static_cast<std::size_t>(predecessor)].must[static_cast<std::size_t>(at)]));
                            ets_set_vec<bool>(may, at, (may[static_cast<std::size_t>(at)] || facts[static_cast<std::size_t>(predecessor)].may[static_cast<std::size_t>(at)]));
                        }
                    }
                }
            }
            for (const auto& i : f.blocks[static_cast<std::size_t>(b)].instructions) {
                if ((i.op == std::string("dropFrame"))) {
                    for (double at = 0.0; (at < count); (at = (at + 1.0))) {
                        ets_set_vec<bool>(must, at, false);
                        ets_set_vec<bool>(may, at, false);
                    }
                }
                for (const auto& operand : i.operands) {
                    if ((((operand >= 0.0) && (operand < offset)) && tracked[static_cast<std::size_t>(operand)])) {
                        if ((!must[static_cast<std::size_t>(operand)])) {
                            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Temporal con ownership consumido o no disponible en todas las rutas"), i.source));
                        }
                        ets_set_vec<bool>(must, operand, false);
                        ets_set_vec<bool>(may, operand, false);
                    }
                }
                if ((((i.op == std::string("store")) && (i.place >= 0.0)) && tracked[static_cast<std::size_t>((offset + i.place))])) {
                    ets_set_vec<bool>(must, (offset + i.place), true);
                    ets_set_vec<bool>(may, (offset + i.place), true);
                }
                if (((((i.op == std::string("move")) || (i.op == std::string("dropRemaining"))) && (i.place >= 0.0)) && tracked[static_cast<std::size_t>((offset + i.place))])) {
                    if (((i.op == std::string("move")) && (!must[static_cast<std::size_t>((offset + i.place))]))) {
                        ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Move de owner no disponible"), i.source));
                    }
                    ets_set_vec<bool>(must, (offset + i.place), false);
                    ets_set_vec<bool>(may, (offset + i.place), false);
                }
                if (((i.result >= 0.0) && tracked[static_cast<std::size_t>(i.result)])) {
                    if (may[static_cast<std::size_t>(i.result)]) {
                        ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Temporal owner sobrescrito sin consumo"), i.source));
                    }
                    ets_set_vec<bool>(must, i.result, true);
                    ets_set_vec<bool>(may, i.result, true);
                }
            }
            if (((((f.blocks[static_cast<std::size_t>(b)].terminator == std::string("return")) || (f.blocks[static_cast<std::size_t>(b)].terminator == std::string("suspend"))) && (f.blocks[static_cast<std::size_t>(b)].value >= 0.0)) && tracked[static_cast<std::size_t>(f.blocks[static_cast<std::size_t>(b)].value)])) {
                if ((!must[static_cast<std::size_t>(f.blocks[static_cast<std::size_t>(b)].value)])) {
                    ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Retorno de owner consumido"), f.blocks[static_cast<std::size_t>(b)].source));
                }
                ets_set_vec<bool>(may, f.blocks[static_cast<std::size_t>(b)].value, false);
            }
            if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("return"), std::string("cancel")}, f.blocks[static_cast<std::size_t>(b)].terminator)) {
                for (double at = 0.0; (at < count); (at = (at + 1.0))) {
                    if ((tracked[static_cast<std::size_t>(at)] && may[static_cast<std::size_t>(at)])) {
                        ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Salida sin consumir o limpiar un recurso"), f.blocks[static_cast<std::size_t>(b)].source));
                    }
                }
            }
        }
    }
    return issues;
}

void ets_init_bootstrap_ir_verify_ownership_b1da2c6e() {
}
