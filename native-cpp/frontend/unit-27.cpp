// Generated module. Do not edit.
#include "estatic_common.hpp"

std::vector<IrIssue> verifyIrTables(const IrProject& project) {
    std::vector<IrIssue> issues = std::vector<IrIssue>();
    const auto source = IrSource{}.constructor(std::string(""), std::string(""), std::string(""), (-1.0), 0.0, 0.0);
    const double count = project.types.size();
    if ((project.typeDefinitions.size() != count)) {
        ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Tabla de tipos incompleta"), source));
        return issues;
    }
    for (double at = 0.0; (at < count); (at = (at + 1.0))) {
        const auto shape = project.typeDefinitions[static_cast<std::size_t>(at)];
        if ((!ets_includes_vec<std::string>(std::vector<std::string>{std::string("scalar"), std::string("ref"), std::string("constRef"), std::string("ptr"), std::string("constPtr"), std::string("readonly"), std::string("function"), std::string("array"), std::string("fixedArray"), std::string("tuple"), std::string("sum"), std::string("intersection"), std::string("variant"), std::string("enum"), std::string("union"), std::string("interface"), std::string("record"), std::string("Optional"), std::string("Result"), std::string("Map"), std::string("Set"), std::string("Promise"), std::string("pack"), std::string("iterator"), std::string("runtime"), std::string("parameter"), std::string("literal")}, shape.kind))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Shape desconocida"), source));
        }
        for (const auto& child : shape.arguments) {
            if (((child < 0.0) || (child >= count))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Argumento de tipo inexistente"), source));
            }
        }
        for (const auto& child : shape.fields) {
            if (((child < 0.0) || (child >= count))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Campo de tipo inexistente"), source));
            }
        }
        if ((shape.methods.size() != shape.methodTypes.size())) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Tabla de métodos incompleta"), source));
        }
        for (const auto& child : shape.methodTypes) {
            if (((child < 0.0) || (child >= count))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Firma de método inexistente"), source));
            }
        }
        for (const auto& child : shape.variants) {
            if (((child < 0.0) || (child >= count))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Variante de tipo inexistente"), source));
            }
        }
        if ((shape.fields.size() != shape.names.size())) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Tabla de campos incompatible"), source));
        }
        std::vector<std::string> names = std::vector<std::string>();
        for (const auto& name : shape.names) {
            if (((name == std::string("")) || ets_includes_vec<std::string>(names, name))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Identidad de campo duplicada/vacía"), source));
            }
            ets_push_vec<std::string>(names, name);
        }
        const bool unary = ets_includes_vec<std::string>(std::vector<std::string>{std::string("ref"), std::string("constRef"), std::string("ptr"), std::string("constPtr"), std::string("readonly"), std::string("array"), std::string("fixedArray"), std::string("Optional"), std::string("Set"), std::string("Promise"), std::string("enum"), std::string("variant")}, shape.kind);
        const bool binary = ets_includes_vec<std::string>(std::vector<std::string>{std::string("Map"), std::string("Result"), std::string("iterator")}, shape.kind);
        if ((((unary && (shape.arguments.size() != 1.0)) || (binary && (shape.arguments.size() != 2.0))) || ((shape.kind == std::string("function")) && (shape.arguments.size() == 0.0)))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Aridad de shape incompatible"), source));
        }
        if (((shape.kind == std::string("fixedArray")) ? ((shape.length < 0.0) || (std::fmod(shape.length, 1.0) != 0.0)) : (shape.length != (-1.0)))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Longitud de shape incompatible"), source));
        }
        if ((((shape.discriminatorType < (-1.0)) || (shape.discriminatorType >= count)) || ((shape.discriminator != std::string("")) && (shape.discriminatorType < 0.0)))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Discriminador de shape incompatible"), source));
        }
    }
    if ((issues.size() == 0.0)) {
        std::vector<bool> resources = std::vector<bool>();
        for (const auto& shape : project.typeDefinitions) {
            ets_push_vec<bool>(resources, (ets_includes_vec<std::string>(std::vector<std::string>{std::string("ptr"), std::string("constPtr"), std::string("Promise")}, shape.kind) || ((shape.kind == std::string("runtime")) && (project.types[static_cast<std::size_t>(resources.size())] == std::string("Server")))));
        }
        bool changed = true;
        while (changed) {
            (changed = false);
            for (double at = 0.0; (at < count); (at = (at + 1.0))) {
                if ((!resources[static_cast<std::size_t>(at)])) {
                    const auto shape = project.typeDefinitions[static_cast<std::size_t>(at)];
                    bool owns = false;
                    if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("array"), std::string("fixedArray"), std::string("tuple"), std::string("pack"), std::string("Optional"), std::string("Result"), std::string("Map"), std::string("Set"), std::string("sum"), std::string("intersection"), std::string("variant")}, shape.kind)) {
                        for (const auto& child : shape.arguments) {
                            if (resources[static_cast<std::size_t>(child)]) {
                                (owns = true);
                            }
                        }
                    }
                    if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("record"), std::string("interface"), std::string("union")}, shape.kind)) {
                        for (const auto& child : shape.fields) {
                            if (resources[static_cast<std::size_t>(child)]) {
                                (owns = true);
                            }
                        }
                        for (const auto& child : shape.variants) {
                            if (resources[static_cast<std::size_t>(child)]) {
                                (owns = true);
                            }
                        }
                    }
                    if (owns) {
                        ets_set_vec<bool>(resources, at, true);
                        (changed = true);
                    }
                }
            }
        }
        for (double at = 0.0; (at < count); (at = (at + 1.0))) {
            if ((resources[static_cast<std::size_t>(at)] != project.typeDefinitions[static_cast<std::size_t>(at)].resource)) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Propiedad de recurso incompatible con su shape"), source));
            }
        }
    }
    for (const auto& contract : project.runtimeContracts) {
        if ((((((contract.name == std::string("")) || (contract.capability == std::string(""))) || (contract.effects.size() == 0.0)) || (contract.returns < 0.0)) || (contract.returns >= count))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Contrato runtime inválido"), source));
        }
        for (const auto& parameter : contract.parameters) {
            if ((((parameter < 0.0) || (parameter >= count)) || (project.types[static_cast<std::size_t>(parameter)] == std::string("void")))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Parámetro runtime inválido"), source));
            }
        }
    }
    for (const auto& f : project.functions) {
        if (((((f.returns < 0.0) || (f.returns >= count)) || (f.bodyReturns < 0.0)) || (f.bodyReturns >= count))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Tipo de retorno inexistente"), f.source));
        }
        for (const auto& typeId : f.values) {
            if ((((typeId < 0.0) || (typeId >= count)) || (project.types[static_cast<std::size_t>(typeId)] == std::string("void")))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Tipo de valor inválido"), f.source));
            }
        }
        for (const auto& typeId : f.parameterTypes) {
            if ((((typeId < 0.0) || (typeId >= count)) || (project.types[static_cast<std::size_t>(typeId)] == std::string("void")))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Tipo de parámetro inválido"), f.source));
            }
        }
        for (double p = 0.0; (p < f.places.size()); (p = (p + 1.0))) {
            const auto place = f.places[static_cast<std::size_t>(p)];
            if ((((place.typeId < 0.0) || (place.typeId >= count)) || (project.types[static_cast<std::size_t>(place.typeId)] == std::string("void")))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Tipo de place inválido"), place.source));
            }
            if (((((place.base < (-1.0)) || (place.base >= p)) || (place.global < (-1.0))) || (place.global >= project.globals.size()))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Referencia de place inválida"), place.source));
            }
        }
        for (const auto& block : f.blocks) {
            for (const auto& target : block.targets) {
                if (((target < 0.0) || (target >= f.blocks.size()))) {
                    ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Destino de bloque inexistente"), block.source));
                }
            }
            for (const auto& i : block.instructions) {
                if ((((i.typeId < (-1.0)) || (i.typeId >= count)) || ((i.typeId == (-1.0)) && (!ets_includes_vec<std::string>(std::vector<std::string>{std::string("store"), std::string("dropValue"), std::string("dropRemaining"), std::string("dropFrame"), std::string("endBorrow")}, i.op))))) {
                    ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Tipo de instrucción inválido"), i.source));
                }
                for (const auto& operand : i.operands) {
                    if (((operand < 0.0) || (operand >= f.values.size()))) {
                        ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Operando inexistente"), i.source));
                    }
                }
            }
        }
    }
    return issues;
}

std::vector<IrIssue> verifyFunctionContracts(const IrProject& project, const IrFunction& f) {
    std::vector<IrIssue> issues = std::vector<IrIssue>();
    if (((f.captureSymbols.size() != f.captureTypes.size()) || (f.captureModes.size() != f.captureTypes.size()))) {
        ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Tablas de capturas incompatibles"), f.source));
    }
    for (double at = 0.0; (at < f.captureTypes.size()); (at = (at + 1.0))) {
        if (((f.captureTypes[static_cast<std::size_t>(at)] < 0.0) || (f.captureTypes[static_cast<std::size_t>(at)] >= project.types.size()))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Tipo de captura inexistente"), f.source));
        }
        if (((at < f.captureModes.size()) && (!ets_includes_vec<std::string>(std::vector<std::string>{std::string("value"), std::string("reference")}, f.captureModes[static_cast<std::size_t>(at)])))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Modo de captura inválido"), f.source));
        }
    }
    std::vector<double> values = std::vector<double>();
    std::vector<double> places = std::vector<double>();
    for (const auto& value : f.frameValues) {
        if (((((!f.asynchronous) || (value < 0.0)) || (value >= f.values.size())) || ets_includes_vec<double>(values, value))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Valor de frame inválido/duplicado"), f.source));
        }
        ets_push_vec<double>(values, value);
    }
    for (const auto& place : f.framePlaces) {
        if (((((!f.asynchronous) || (place < 0.0)) || (place >= f.places.size())) || ets_includes_vec<double>(places, place))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Place de frame inválido/duplicado"), f.source));
        } else {
            if (((f.places[static_cast<std::size_t>(place)].base >= 0.0) || (f.places[static_cast<std::size_t>(place)].global >= 0.0))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Frame requiere un place raíz local"), f.source));
            }
        }
        ets_push_vec<double>(places, place);
    }
    if (f.asynchronous) {
        for (double at = 0.0; (at < f.values.size()); (at = (at + 1.0))) {
            if ((!ets_includes_vec<double>(values, at))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Valor ausente del frame lógico"), f.source));
            }
        }
        for (double at = 0.0; (at < f.places.size()); (at = (at + 1.0))) {
            if ((((f.places[static_cast<std::size_t>(at)].base < 0.0) && (f.places[static_cast<std::size_t>(at)].global < 0.0)) && (!ets_includes_vec<double>(places, at)))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Place ausente del frame lógico"), f.source));
            }
        }
    }
    for (double lease = 0.0; (lease < f.leases.size()); (lease = (lease + 1.0))) {
        const auto item = f.leases[static_cast<std::size_t>(lease)];
        double definitions = 0.0;
        if ((((((item.place < 0.0) || (item.place >= f.places.size())) || (item.value < 0.0)) || (item.value >= f.values.size())) || (!ets_includes_vec<std::string>(std::vector<std::string>{std::string("ref"), std::string("constRef")}, item.mode)))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Tabla de préstamos inválida"), f.source));
        }
        for (const auto& block : f.blocks) {
            for (const auto& i : block.instructions) {
                if ((ets_includes_vec<std::string>(std::vector<std::string>{std::string("borrow"), std::string("address")}, i.op) && (i.lease == lease))) {
                    (definitions = (definitions + 1.0));
                    if ((((i.result != item.value) || (i.place != item.place)) || (item.mode != ((i.op == std::string("address")) ? std::string("ref") : project.typeDefinitions[static_cast<std::size_t>(i.typeId)].kind)))) {
                        ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Modo/identidad de préstamo incompatible"), i.source));
                    }
                }
            }
        }
        if ((definitions != 1.0)) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Préstamo sin definición única"), f.source));
        }
    }
    for (double b = 0.0; (b < f.blocks.size()); (b = (b + 1.0))) {
        const auto block = f.blocks[static_cast<std::size_t>(b)];
        if (((block.terminator == std::string("suspend")) && (block.targets.size() == 2.0))) {
            double normal = block.targets[static_cast<std::size_t>(0.0)];
            double predecessor = b;
            double steps = 0.0;
            while ((steps < f.blocks.size())) {
                double incoming = 0.0;
                for (const auto& previous : f.blocks) {
                    for (const auto& target : previous.targets) {
                        if ((target == normal)) {
                            (incoming = (incoming + 1.0));
                        }
                    }
                }
                if (((incoming != 1.0) || (!ets_includes_vec<double>(f.blocks[static_cast<std::size_t>(predecessor)].targets, normal)))) {
                    ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Continuación con entrada ajena a su suspensión"), block.source));
                }
                double resumes = 0.0;
                bool cleanup = true;
                for (const auto& i : f.blocks[static_cast<std::size_t>(normal)].instructions) {
                    if (((i.op == std::string("resume")) && (i.continuation == b))) {
                        (resumes = (resumes + 1.0));
                    }
                    if ((i.op != std::string("endBorrow"))) {
                        (cleanup = false);
                    }
                }
                if ((resumes == 1.0)) {
                    break;
                }
                if ((((!cleanup) || (f.blocks[static_cast<std::size_t>(normal)].terminator != std::string("jump"))) || (f.blocks[static_cast<std::size_t>(normal)].targets.size() != 1.0))) {
                    ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Suspensión sin reanudación única"), block.source));
                    break;
                }
                (predecessor = normal);
                (normal = f.blocks[static_cast<std::size_t>(normal)].targets[static_cast<std::size_t>(0.0)]);
                (steps = (steps + 1.0));
            }
            if ((steps == f.blocks.size())) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Ciclo en continuación de suspensión"), block.source));
            }
        }
        for (const auto& i : block.instructions) {
            if ((i.op == std::string("resume"))) {
                double definitions = 0.0;
                for (const auto& candidate : f.blocks) {
                    for (const auto& other : candidate.instructions) {
                        if (((other.op == std::string("resume")) && (other.continuation == i.continuation))) {
                            (definitions = (definitions + 1.0));
                        }
                    }
                }
                if ((definitions != 1.0)) {
                    ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Reanudación duplicada"), i.source));
                }
            }
        }
    }
    return issues;
}

std::vector<IrIssue> verifyModuleContracts(const IrProject& project) {
    std::vector<IrIssue> issues = std::vector<IrIssue>();
    const auto source = IrSource{}.constructor(std::string(""), std::string(""), std::string(""), (-1.0), 0.0, 0.0);
    std::vector<std::string> ids = std::vector<std::string>();
    std::vector<double> finalizers = std::vector<double>();
    for (const auto& module : project.modules) {
        if (((((module.id == std::string("")) || (module.sourceHash == std::string(""))) || (module.file == std::string(""))) || ets_includes_vec<std::string>(ids, module.id))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Identidad de módulo inválida/duplicada"), source));
        }
        ets_push_vec<std::string>(ids, module.id);
        if ((((module.finalizer < 0.0) || (module.finalizer >= project.functions.size())) || ets_includes_vec<double>(finalizers, module.finalizer))) {
            ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Finalizador inexistente/duplicado"), source));
        } else {
            const auto f = project.functions[static_cast<std::size_t>(module.finalizer)];
            if (((((project.types[static_cast<std::size_t>(f.returns)] != std::string("void")) || (f.parameterTypes.size() != 0.0)) || f.asynchronous) || (f.source.moduleId != module.id))) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Contrato de finalizador inválido"), f.source));
            }
        }
        ets_push_vec<double>(finalizers, module.finalizer);
    }
    std::vector<double> expected = std::vector<double>();
    for (double at = (project.initializationOrder.size() - 1.0); (at >= 0.0); (at = (at - 1.0))) {
        for (const auto& module : project.modules) {
            if ((module.initializer == project.initializationOrder[static_cast<std::size_t>(at)])) {
                ets_push_vec<double>(expected, module.finalizer);
            }
        }
    }
    if ((project.finalizationOrder.size() != expected.size())) {
        ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Orden de finalización incompleto"), source));
    } else {
        for (double at = 0.0; (at < expected.size()); (at = (at + 1.0))) {
            if ((project.finalizationOrder[static_cast<std::size_t>(at)] != expected[static_cast<std::size_t>(at)])) {
                ets_push_vec<IrIssue>(issues, IrIssue{}.constructor(std::string("IR_INVALID"), std::string("Orden de finalización incompatible"), source));
            }
        }
    }
    return issues;
}

void ets_init_bootstrap_ir_verify_contracts_18b4bee9() {
}
