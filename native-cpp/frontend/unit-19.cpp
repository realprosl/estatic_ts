// Generated module. Do not edit.
#include "estatic_common.hpp"

bool resourceType(const ModuleGraph& graph, const BindingResult& binding, const ets_import_9_CheckResult& checked, std::string text, std::vector<std::string> history) {
    if ((ownedType(text) || (text == std::string("Server")))) {
        return true;
    }
    if ((borrowedType(text) || (functionClose(text) >= 0.0))) {
        return false;
    }
    if ((ets_import_2_memoryMode(text) != std::string(""))) {
        return resourceType(graph, binding, checked, ets_import_4_memoryInner(text), history);
    }
    if ((genericBase(text) == std::string("Promise"))) {
        return true;
    }
    if (ets_includes_vec<std::string>(history, text)) {
        return false;
    }
    if ((history.size() > 128.0)) {
        return true;
    }
    std::vector<std::string> next = history;
    ets_push_vec<std::string>(next, text);
    if ((fixedArraySize(text) >= 0.0)) {
        return resourceType(graph, binding, checked, fixedArrayElement(text), next);
    }
    if (::ets::string_endsWith(text, std::string("[]"))) {
        return resourceType(graph, binding, checked, semanticElement(text), next);
    }
    if (semanticTuple(text)) {
        for (const auto& item : splitTypes(::ets::string_slice(text, 1.0, (::ets::string_length(text) - 1.0)), std::string(","))) {
            if (resourceType(graph, binding, checked, item, next)) {
                return true;
            }
        }
        return false;
    }
    for (const auto& separator : std::vector<std::string>{std::string("|"), std::string("&")}) {
        const std::vector<std::string> parts = splitTypes(text, separator);
        if ((parts.size() > 1.0)) {
            for (const auto& part : parts) {
                if (resourceType(graph, binding, checked, part, next)) {
                    return true;
                }
            }
            return false;
        }
    }
    if ((genericBase(text) == std::string("variant"))) {
        return resourceType(graph, binding, checked, genericArguments(text)[static_cast<std::size_t>(0.0)], next);
    }
    const std::vector<std::string> arguments = genericArguments(text);
    if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("Optional"), std::string("Result"), std::string("Map"), std::string("Set"), std::string("pack")}, genericBase(text))) {
        for (const auto& item : arguments) {
            if (resourceType(graph, binding, checked, item, next)) {
                return true;
            }
        }
        return false;
    }
    const double sid = canonicalSymbol(text);
    if (((sid >= 0.0) && (sid < binding.symbols.size()))) {
        const auto owner = binding.symbols[static_cast<std::size_t>(sid)];
        const auto declaration = graph.modules[static_cast<std::size_t>(owner.module)].cached.result.ast.nodes[static_cast<std::size_t>(owner.node)];
        std::vector<std::string> tokens = std::vector<std::string>();
        for (const auto& edge : declaration.edges) {
            if ((edge.role == EdgeRole::TypeParameters)) {
                ets_push_vec<std::string>(tokens, ets::concat(std::string("@"), numberToString(binding.files[static_cast<std::size_t>(owner.module)].declarations[static_cast<std::size_t>(edge.node)])));
            }
        }
        for (double member = 0.0; (member < binding.symbols.size()); (member = (member + 1.0))) {
            const auto field = binding.symbols[static_cast<std::size_t>(member)];
            if ((((field.module != owner.module) || (field.scope < 0.0)) || ((field.kind == std::string("UnionVariant")) ? (binding.files[static_cast<std::size_t>(field.module)].parents[static_cast<std::size_t>(field.node)] != owner.node) : (binding.scopes[static_cast<std::size_t>(field.scope)].node != owner.node)))) {
                continue;
            }
            if ((!ets_includes_vec<std::string>(std::vector<std::string>{std::string("ClassField"), std::string("InterfaceField"), std::string("UnionVariant")}, field.kind))) {
                continue;
            }
            const auto node = graph.modules[static_cast<std::size_t>(field.module)].cached.result.ast.nodes[static_cast<std::size_t>(field.node)];
            if ((node.get(AttributeKind::IsStatic) == std::string("true"))) {
                continue;
            }
            std::string value = checked.symbolTypes[static_cast<std::size_t>(member)];
            for (double at = 0.0; ((at < tokens.size()) && (at < arguments.size())); (at = (at + 1.0))) {
                (value = replaceType(value, tokens[static_cast<std::size_t>(at)], arguments[static_cast<std::size_t>(at)]));
            }
            if ((field.kind == std::string("UnionVariant"))) {
                for (const auto& payload : functionParams(value)) {
                    if (resourceType(graph, binding, checked, payload, next)) {
                        return true;
                    }
                }
            } else {
                if (resourceType(graph, binding, checked, value, next)) {
                    return true;
                }
            }
        }
    }
    return false;
}

std::string resourceSubstitution(std::string pattern, std::string actual, std::string token) {
    if (::ets::string_startsWith(pattern, std::string("..."))) {
        (pattern = ::ets::string_slice(pattern, 3.0, ::ets::string_length(pattern)));
    }
    if (::ets::string_startsWith(actual, std::string("..."))) {
        (actual = ::ets::string_slice(actual, 3.0, ::ets::string_length(actual)));
    }
    if ((pattern == token)) {
        return actual;
    }
    if ((::ets::string_endsWith(pattern, std::string("[]")) && ::ets::string_endsWith(actual, std::string("[]")))) {
        return resourceSubstitution(semanticElement(pattern), semanticElement(actual), token);
    }
    if (((ets_import_2_memoryMode(pattern) != std::string("")) && (ets_import_2_memoryMode(pattern) == ets_import_2_memoryMode(actual)))) {
        return resourceSubstitution(ets_import_4_memoryInner(pattern), ets_import_4_memoryInner(actual), token);
    }
    std::vector<std::string> patterns = std::vector<std::string>();
    std::vector<std::string> values = std::vector<std::string>();
    if (((genericBase(pattern) != std::string("")) && (genericBase(pattern) == genericBase(actual)))) {
        (patterns = genericArguments(pattern));
        (values = genericArguments(actual));
    } else {
        if ((semanticTuple(pattern) && semanticTuple(actual))) {
            (patterns = splitTypes(::ets::string_slice(pattern, 1.0, (::ets::string_length(pattern) - 1.0)), std::string(",")));
            (values = splitTypes(::ets::string_slice(actual, 1.0, (::ets::string_length(actual) - 1.0)), std::string(",")));
        } else {
            if (((functionClose(pattern) >= 0.0) && (functionClose(actual) >= 0.0))) {
                (patterns = functionParams(pattern));
                (values = functionParams(actual));
                ets_push_vec<std::string>(patterns, ::ets::string_slice(pattern, (functionClose(pattern) + 3.0), ::ets::string_length(pattern)));
                ets_push_vec<std::string>(values, ::ets::string_slice(actual, (functionClose(actual) + 3.0), ::ets::string_length(actual)));
            }
        }
    }
    if ((patterns.size() != values.size())) {
        return std::string("");
    }
    std::string inferred = std::string("");
    for (double at = 0.0; (at < patterns.size()); (at = (at + 1.0))) {
        const std::string value = resourceSubstitution(patterns[static_cast<std::size_t>(at)], values[static_cast<std::size_t>(at)], token);
        if ((value != std::string(""))) {
            if (((inferred != std::string("")) && (inferred != value))) {
                return std::string("!conflicting-inference");
            }
            (inferred = value);
        }
    }
    return inferred;
}

void ets_init_bootstrap_checker_ownership_f6ad3ebb() {
}
