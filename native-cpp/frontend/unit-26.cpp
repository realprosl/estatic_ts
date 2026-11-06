// Generated module. Do not edit.
#include "estatic_common.hpp"

bool irAssignable(const IrProject& project, double from, double to, double depth) {
    if ((((((from < 0.0) || (to < 0.0)) || (from >= project.types.size())) || (to >= project.types.size())) || (depth > 64.0))) {
        return false;
    }
    if ((from == to)) {
        return true;
    }
    const auto a = project.typeDefinitions[static_cast<std::size_t>(from)];
    const auto b = project.typeDefinitions[static_cast<std::size_t>(to)];
    if ((numericType(project.types[static_cast<std::size_t>(from)]) && numericType(project.types[static_cast<std::size_t>(to)]))) {
        return true;
    }
    if (((a.kind == std::string("enum")) && (a.arguments.size() == 1.0))) {
        return irAssignable(project, a.arguments[static_cast<std::size_t>(0.0)], to, (depth + 1.0));
    }
    if ((((a.kind == std::string("variant")) && (a.arguments.size() == 1.0)) && (a.arguments[static_cast<std::size_t>(0.0)] == to))) {
        return true;
    }
    if (((a.kind == std::string("union")) && ets_includes_vec<double>(a.variants, to))) {
        return true;
    }
    if (((a.kind == std::string("sum")) && ets_includes_vec<double>(a.arguments, to))) {
        return true;
    }
    if (((a.kind == std::string("function")) && (b.kind == std::string("function")))) {
        if (((a.arguments.size() > b.arguments.size()) || (a.arguments.size() == 0.0))) {
            return false;
        }
        for (double p = 0.0; (p < (a.arguments.size() - 1.0)); (p = (p + 1.0))) {
            if ((!irAssignable(project, b.arguments[static_cast<std::size_t>(p)], a.arguments[static_cast<std::size_t>(p)], (depth + 1.0)))) {
                return false;
            }
        }
        return irAssignable(project, a.arguments[static_cast<std::size_t>((a.arguments.size() - 1.0))], b.arguments[static_cast<std::size_t>((b.arguments.size() - 1.0))], (depth + 1.0));
    }
    if (((ets_includes_vec<std::string>(std::vector<std::string>{std::string("Optional"), std::string("Result")}, a.kind) && (a.kind == b.kind)) && (a.arguments.size() == b.arguments.size()))) {
        for (double at = 0.0; (at < a.arguments.size()); (at = (at + 1.0))) {
            if ((!irAssignable(project, a.arguments[static_cast<std::size_t>(at)], b.arguments[static_cast<std::size_t>(at)], (depth + 1.0)))) {
                return false;
            }
        }
        return true;
    }
    if (((b.kind == std::string("readonly")) && (b.arguments.size() == 1.0))) {
        return irAssignable(project, from, b.arguments[static_cast<std::size_t>(0.0)], (depth + 1.0));
    }
    if ((ets_includes_vec<std::string>(std::vector<std::string>{std::string("ref"), std::string("constRef"), std::string("readonly")}, a.kind) && (a.arguments.size() == 1.0))) {
        return irAssignable(project, a.arguments[static_cast<std::size_t>(0.0)], to, (depth + 1.0));
    }
    if (((b.kind == std::string("Optional")) && (b.arguments.size() == 1.0))) {
        return irAssignable(project, from, b.arguments[static_cast<std::size_t>(0.0)], (depth + 1.0));
    }
    if ((b.kind == std::string("sum"))) {
        for (const auto& choice : b.arguments) {
            if (irAssignable(project, from, choice, (depth + 1.0))) {
                return true;
            }
        }
    }
    if ((ets_includes_vec<std::string>(std::vector<std::string>{std::string("array"), std::string("fixedArray"), std::string("tuple"), std::string("pack")}, a.kind) && ets_includes_vec<std::string>(std::vector<std::string>{std::string("array"), std::string("fixedArray"), std::string("tuple"), std::string("pack")}, b.kind))) {
        if (((b.kind == std::string("tuple")) && ((a.kind != std::string("tuple")) || (a.arguments.size() != b.arguments.size())))) {
            return false;
        }
        for (double at = 0.0; (at < a.arguments.size()); (at = (at + 1.0))) {
            if ((!irAssignable(project, a.arguments[static_cast<std::size_t>(at)], b.arguments[static_cast<std::size_t>(((b.kind == std::string("tuple")) ? at : 0.0))], (depth + 1.0)))) {
                return false;
            }
        }
        return true;
    }
    if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("interface"), std::string("intersection")}, b.kind)) {
        for (double field = 0.0; (field < b.names.size()); (field = (field + 1.0))) {
            bool found = false;
            for (double source = 0.0; (source < a.names.size()); (source = (source + 1.0))) {
                if (((a.names[static_cast<std::size_t>(source)] == b.names[static_cast<std::size_t>(field)]) && irAssignable(project, a.fields[static_cast<std::size_t>(source)], b.fields[static_cast<std::size_t>(field)], (depth + 1.0)))) {
                    (found = true);
                }
            }
            if ((!found)) {
                return false;
            }
        }
        return true;
    }
    return false;
}

double irConstantIndex(const IrFunction& f, double value) {
    for (const auto& b : f.blocks) {
        for (const auto& i : b.instructions) {
            if (((i.result == value) && (i.op == std::string("constant")))) {
                double result = 0.0;
                if ((i.text == std::string(""))) {
                    return (-1.0);
                }
                for (double at = 0.0; (at < ::ets::string_length(i.text)); (at = (at + 1.0))) {
                    const double digit = (::ets::string_charCodeAt(i.text, at) - 48.0);
                    if (((digit < 0.0) || (digit > 9.0))) {
                        return (-1.0);
                    }
                    (result = ((result * 10.0) + digit));
                }
                return result;
            }
        }
    }
    return (-1.0);
}

double irElement(const IrProject& project, const IrFunction& f, double container, double ets_local_index) {
    if (((container < 0.0) || (container >= project.types.size()))) {
        return (-1.0);
    }
    const auto shape = project.typeDefinitions[static_cast<std::size_t>(container)];
    if (((shape.kind == std::string("array")) || (shape.kind == std::string("fixedArray")))) {
        return shape.arguments[static_cast<std::size_t>(0.0)];
    }
    if (((shape.kind == std::string("tuple")) || (shape.kind == std::string("pack")))) {
        const double at = irConstantIndex(f, ets_local_index);
        return (((at >= 0.0) && (at < shape.arguments.size())) ? shape.arguments[static_cast<std::size_t>(at)] : (-1.0));
    }
    if ((project.types[static_cast<std::size_t>(container)] == std::string("string"))) {
        return container;
    }
    return (-1.0);
}

std::string verifyShapeInstruction(const IrProject& project, const IrFunction& f, const IrInstruction& i) {
    if (((i.typeId < 0.0) || (i.typeId >= project.types.size()))) {
        return std::string("Tipo de resultado inexistente");
    }
    const auto shape = project.typeDefinitions[static_cast<std::size_t>(i.typeId)];
    if (((i.op == std::string("some")) || (i.op == std::string("result")))) {
        if ((((((i.result < 0.0) || (i.operands.size() != 1.0)) || (i.operands[static_cast<std::size_t>(0.0)] < 0.0)) || (i.operands[static_cast<std::size_t>(0.0)] >= f.values.size())) || (shape.kind != ((i.op == std::string("some")) ? std::string("Optional") : std::string("Result"))))) {
            return std::string("Contenedor constante incompatible");
        }
        if (((i.op == std::string("result")) && (i.text == std::string("Err")))) {
            return ((project.types[static_cast<std::size_t>(f.values[static_cast<std::size_t>(i.operands[static_cast<std::size_t>(0.0)])])] == std::string("string")) ? std::string("") : std::string("Error de Result inválido"));
        }
        return (irAssignable(project, f.values[static_cast<std::size_t>(i.operands[static_cast<std::size_t>(0.0)])], shape.arguments[static_cast<std::size_t>(0.0)], 0.0) ? std::string("") : std::string("Payload de contenedor incompatible"));
    }
    if ((i.op == std::string("iterator"))) {
        if ((((((((shape.kind != std::string("iterator")) || (shape.arguments.size() != 2.0)) || (i.place < 0.0)) || (i.place >= f.places.size())) || (f.places[static_cast<std::size_t>(i.place)].typeId != shape.arguments[static_cast<std::size_t>(0.0)])) || (i.result < 0.0)) || (i.operands.size() != 0.0))) {
            return std::string("Iterador incompatible");
        }
        return std::string("");
    }
    if (((i.op == std::string("iterHasNext")) || (i.op == std::string("iterNext")))) {
        if ((((i.operands.size() != 1.0) || (i.operands[static_cast<std::size_t>(0.0)] < 0.0)) || (i.operands[static_cast<std::size_t>(0.0)] >= f.values.size()))) {
            return std::string("Cursor inexistente");
        }
        const auto cursor = project.typeDefinitions[static_cast<std::size_t>(f.values[static_cast<std::size_t>(i.operands[static_cast<std::size_t>(0.0)])])];
        if ((((cursor.kind != std::string("iterator")) || (i.result < 0.0)) || ((i.op == std::string("iterHasNext")) ? (project.types[static_cast<std::size_t>(i.typeId)] != std::string("boolean")) : (cursor.arguments[static_cast<std::size_t>(1.0)] != i.typeId)))) {
            return std::string("Operación de iteración incompatible");
        }
        return std::string("");
    }
    if ((i.op == std::string("typeTag"))) {
        return ((((((i.operands.size() == 0.0) && (i.result >= 0.0)) && (project.types[static_cast<std::size_t>(i.typeId)] == std::string("string"))) && (i.signature >= 0.0)) && (i.signature < project.types.size())) ? std::string("") : std::string("Typeof incompatible"));
    }
    if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("isPresent"), std::string("unwrap"), std::string("typeTest")}, i.op)) {
        if ((((i.operands.size() != 1.0) || (i.operands[static_cast<std::size_t>(0.0)] < 0.0)) || (i.operands[static_cast<std::size_t>(0.0)] >= f.values.size()))) {
            return std::string("Operando de inspección inválido");
        }
        double input = f.values[static_cast<std::size_t>(i.operands[static_cast<std::size_t>(0.0)])];
        if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("ref"), std::string("constRef")}, project.typeDefinitions[static_cast<std::size_t>(input)].kind)) {
            (input = project.typeDefinitions[static_cast<std::size_t>(input)].arguments[static_cast<std::size_t>(0.0)]);
        }
        if ((i.op == std::string("typeTag"))) {
            return ((project.types[static_cast<std::size_t>(i.typeId)] == std::string("string")) ? std::string("") : std::string("Typeof incompatible"));
        }
        if ((i.op == std::string("typeTest"))) {
            return ((((project.types[static_cast<std::size_t>(i.typeId)] == std::string("boolean")) && (i.signature >= 0.0)) && (i.signature < project.types.size())) ? std::string("") : std::string("Test de tipo incompatible"));
        }
        if ((project.typeDefinitions[static_cast<std::size_t>(input)].kind != std::string("Optional"))) {
            return std::string("Inspección requiere Optional");
        }
        return ((i.op == std::string("isPresent")) ? ((project.types[static_cast<std::size_t>(i.typeId)] == std::string("boolean")) ? std::string("") : std::string("Test de presencia incompatible")) : ((i.typeId == project.typeDefinitions[static_cast<std::size_t>(input)].arguments[static_cast<std::size_t>(0.0)]) ? std::string("") : std::string("Payload incompatible")));
    }
    if (((i.op == std::string("emptyRecord")) || (i.op == std::string("collection")))) {
        if ((((i.result < 0.0) || (i.operands.size() != 0.0)) || ((i.op == std::string("emptyRecord")) ? (shape.kind != std::string("record")) : (!ets_includes_vec<std::string>(std::vector<std::string>{std::string("Map"), std::string("Set")}, shape.kind))))) {
            return std::string("Construcción vacía inválida");
        }
        return std::string("");
    }
    if ((i.op == std::string("aggregate"))) {
        if ((((!ets_includes_vec<std::string>(std::vector<std::string>{std::string("array"), std::string("fixedArray"), std::string("tuple"), std::string("pack")}, shape.kind)) || (i.names.size() != i.operands.size())) || (i.result < 0.0))) {
            return std::string("Construcción de agregado inválida");
        }
        double position = 0.0;
        double knownLength = 0.0;
        for (double at = 0.0; (at < i.operands.size()); (at = (at + 1.0))) {
            if (((i.operands[static_cast<std::size_t>(at)] < 0.0) || (i.operands[static_cast<std::size_t>(at)] >= f.values.size()))) {
                return std::string("Elemento inexistente");
            }
            const double actual = f.values[static_cast<std::size_t>(i.operands[static_cast<std::size_t>(at)])];
            std::vector<double> elements = std::vector<double>{actual};
            if ((i.names[static_cast<std::size_t>(at)] == std::string("spread"))) {
                const auto input = project.typeDefinitions[static_cast<std::size_t>(actual)];
                if ((!ets_includes_vec<std::string>(std::vector<std::string>{std::string("array"), std::string("fixedArray"), std::string("tuple"), std::string("pack")}, input.kind))) {
                    return std::string("Spread inválido");
                }
                (elements = input.arguments);
                if (((knownLength < 0.0) || (input.kind == std::string("array")))) {
                    (knownLength = (-1.0));
                } else {
                    (knownLength = (knownLength + ((input.kind == std::string("fixedArray")) ? input.length : input.arguments.size())));
                }
            } else {
                if ((i.names[static_cast<std::size_t>(at)] != std::string("value"))) {
                    return std::string("Modo de elemento inválido");
                } else {
                    if ((knownLength >= 0.0)) {
                        (knownLength = (knownLength + 1.0));
                    }
                }
            }
            for (const auto& element : elements) {
                const double expected = (((shape.kind == std::string("tuple")) || (shape.kind == std::string("pack"))) ? ((position < shape.arguments.size()) ? shape.arguments[static_cast<std::size_t>(position)] : (-1.0)) : shape.arguments[static_cast<std::size_t>(0.0)]);
                if ((!irAssignable(project, element, expected, 0.0))) {
                    return std::string("Tipo de elemento incompatible");
                }
                (position = (position + 1.0));
            }
        }
        if (((shape.kind == std::string("fixedArray")) && (knownLength != shape.length))) {
            return std::string("Longitud de agregado fijo incompatible");
        }
        if ((((shape.kind == std::string("tuple")) || (shape.kind == std::string("pack"))) && (position != shape.arguments.size()))) {
            return std::string("Aridad de tupla incompatible");
        }
        return std::string("");
    }
    if (((i.op == std::string("record")) || (i.op == std::string("variant")))) {
        if (((i.op == std::string("variant")) && ((shape.kind != std::string("variant")) || (i.text != shape.tag)))) {
            return std::string("Identidad de variante incompatible");
        }
        if ((((!ets_includes_vec<std::string>(std::vector<std::string>{std::string("record"), std::string("interface"), std::string("intersection"), std::string("union"), std::string("variant")}, shape.kind)) || (i.names.size() != i.operands.size())) || (i.result < 0.0))) {
            return std::string("Construcción de registro inválida");
        }
        std::vector<std::string> seen = std::vector<std::string>();
        for (double at = 0.0; (at < i.operands.size()); (at = (at + 1.0))) {
            if ((((i.operands[static_cast<std::size_t>(at)] < 0.0) || (i.operands[static_cast<std::size_t>(at)] >= f.values.size())) || ets_includes_vec<std::string>(seen, i.names[static_cast<std::size_t>(at)]))) {
                return std::string("Campo duplicado/inexistente");
            }
            bool found = false;
            for (double field = 0.0; (field < shape.names.size()); (field = (field + 1.0))) {
                if (((shape.names[static_cast<std::size_t>(field)] == i.names[static_cast<std::size_t>(at)]) && irAssignable(project, f.values[static_cast<std::size_t>(i.operands[static_cast<std::size_t>(at)])], shape.fields[static_cast<std::size_t>(field)], 0.0))) {
                    (found = true);
                }
            }
            if ((!found)) {
                return std::string("Campo de registro incompatible");
            }
            ets_push_vec<std::string>(seen, i.names[static_cast<std::size_t>(at)]);
        }
        for (double field = 0.0; (field < shape.names.size()); (field = (field + 1.0))) {
            if (((((shape.names[static_cast<std::size_t>(field)] != std::string("kind")) && (shape.names[static_cast<std::size_t>(field)] != shape.discriminator)) && (!ets_includes_vec<std::string>(seen, shape.names[static_cast<std::size_t>(field)]))) && (project.typeDefinitions[static_cast<std::size_t>(shape.fields[static_cast<std::size_t>(field)])].kind != std::string("Optional")))) {
                return std::string("Campo requerido ausente");
            }
        }
        return std::string("");
    }
    if ((i.op == std::string("property"))) {
        if (((((i.operands.size() != 1.0) || (i.operands[static_cast<std::size_t>(0.0)] < 0.0)) || (i.operands[static_cast<std::size_t>(0.0)] >= f.values.size())) || (i.result < 0.0))) {
            return std::string("Receptor de propiedad inválido");
        }
        double input = f.values[static_cast<std::size_t>(i.operands[static_cast<std::size_t>(0.0)])];
        if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("ref"), std::string("constRef")}, project.typeDefinitions[static_cast<std::size_t>(input)].kind)) {
            (input = project.typeDefinitions[static_cast<std::size_t>(input)].arguments[static_cast<std::size_t>(0.0)]);
        }
        const auto container = project.typeDefinitions[static_cast<std::size_t>(input)];
        if (((ets_includes_vec<std::string>(std::vector<std::string>{std::string("length"), std::string("size")}, i.text) && (project.types[static_cast<std::size_t>(i.typeId)] == std::string("number"))) && (ets_includes_vec<std::string>(std::vector<std::string>{std::string("array"), std::string("fixedArray"), std::string("tuple"), std::string("Map"), std::string("Set")}, container.kind) || (project.types[static_cast<std::size_t>(input)] == std::string("string"))))) {
            return std::string("");
        }
        if ((((i.text == std::string("kind")) && (project.types[static_cast<std::size_t>(i.typeId)] == std::string("string"))) && ets_includes_vec<std::string>(std::vector<std::string>{std::string("Result"), std::string("Optional")}, container.kind))) {
            return std::string("");
        }
        if ((((i.text == std::string("ok")) && (project.types[static_cast<std::size_t>(i.typeId)] == std::string("boolean"))) && (container.kind == std::string("Result")))) {
            return std::string("");
        }
        return std::string("Propriété sin contrato");
    }
    if ((i.op == std::string("extractIndex"))) {
        if (((((((i.operands.size() != 2.0) || (i.operands[static_cast<std::size_t>(0.0)] < 0.0)) || (i.operands[static_cast<std::size_t>(0.0)] >= f.values.size())) || (i.operands[static_cast<std::size_t>(1.0)] < 0.0)) || (i.operands[static_cast<std::size_t>(1.0)] >= f.values.size())) || (i.result < 0.0))) {
            return std::string("Extracción inválida");
        }
        if (((irElement(project, f, f.values[static_cast<std::size_t>(i.operands[static_cast<std::size_t>(0.0)])], i.operands[static_cast<std::size_t>(1.0)]) != i.typeId) || (!numericType(project.types[static_cast<std::size_t>(f.values[static_cast<std::size_t>(i.operands[static_cast<std::size_t>(1.0)])])])))) {
            return std::string("Tipo de extracción incompatible");
        }
        return std::string("");
    }
    return std::string("Opcode de shape desconocido");
}

void ets_init_bootstrap_ir_verify_shapes_14484802() {
}
