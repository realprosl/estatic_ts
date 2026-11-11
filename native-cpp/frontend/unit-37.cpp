// Generated module. Do not edit.
#include "estatic_common.hpp"

std::string formatIr(IrProject project) {
    std::vector<std::string> types = std::vector<std::string>();
    for (const auto& typeId : project.types) {
        ets_push_vec<std::string>(types, quoteSource(typeId));
    }
    std::vector<std::string> definitions = std::vector<std::string>();
    for (const auto& shape : project.typeDefinitions) {
        std::vector<std::string> names = std::vector<std::string>();
        for (const auto& name : shape.names) {
            ets_push_vec<std::string>(names, quoteSource(name));
        }
        std::vector<std::string> methods = std::vector<std::string>();
        for (const auto& name : shape.methods) {
            ets_push_vec<std::string>(methods, quoteSource(name));
        }
        ets_push_vec<std::string>(definitions, ets::concat(std::string("{\"methods\":["), ets_join_vec(methods, std::string(",")), std::string("],\"methodTypes\":"), bindingNumbers(shape.methodTypes), std::string(",\"kind\":"), quoteSource(shape.kind), std::string(",\"variants\":"), bindingNumbers(shape.variants), std::string(",\"tag\":"), quoteSource(shape.tag), std::string(",\"discriminator\":"), quoteSource(shape.discriminator), std::string(",\"discriminatorType\":"), numberToString(shape.discriminatorType), std::string(",\"discriminatorValue\":"), quoteSource(shape.discriminatorValue), std::string(",\"numericKind\":"), quoteSource(shape.numericKind), std::string(",\"bits\":"), numberToString(shape.bits), std::string(",\"signed\":"), bindingBoolean(shape.isSigned), std::string(",\"arguments\":"), bindingNumbers(shape.arguments), std::string(",\"fields\":"), bindingNumbers(shape.fields), std::string(",\"names\":["), ets_join_vec(names, std::string(",")), std::string("],\"symbolId\":"), quoteSource(shape.symbolId), std::string(",\"resource\":"), bindingBoolean(shape.resource), std::string(",\"length\":"), numberToString(shape.length), std::string("}")));
    }
    std::vector<std::string> dispatches = std::vector<std::string>();
    for (const auto& d : project.dispatches) {
        ets_push_vec<std::string>(dispatches, ets::concat(std::string("{\"interfaceType\":"), numberToString(d.interfaceType), std::string(",\"concreteType\":"), numberToString(d.concreteType), std::string(",\"name\":"), quoteSource(d.name), std::string(",\"signature\":"), numberToString(d.signature), std::string(",\"callee\":"), numberToString(d.callee), std::string("}")));
    }
    std::vector<std::string> contracts = std::vector<std::string>();
    for (const auto& contract : project.runtimeContracts) {
        std::vector<std::string> effects = std::vector<std::string>();
        for (const auto& effect : contract.effects) {
            ets_push_vec<std::string>(effects, quoteSource(effect));
        }
        ets_push_vec<std::string>(contracts, ets::concat(std::string("{\"name\":"), quoteSource(contract.name), std::string(",\"parameters\":"), bindingNumbers(contract.parameters), std::string(",\"returns\":"), numberToString(contract.returns), std::string(",\"effects\":["), ets_join_vec(effects, std::string(",")), std::string("],\"capability\":"), quoteSource(contract.capability), std::string("}")));
    }
    std::vector<std::string> annotations = std::vector<std::string>();
    for (const auto& a : project.annotations) {
        std::vector<std::string> args = std::vector<std::string>();
        for (const auto& value : a.arguments) {
            ets_push_vec<std::string>(args, quoteSource(value));
        }
        ets_push_vec<std::string>(annotations, ets::concat(std::string("{\"name\":"), quoteSource(a.name), std::string(",\"arguments\":["), ets_join_vec(args, std::string(",")), std::string("],\"source\":"), formatIrSource(a.source), std::string(",\"target\":"), formatIrSource(a.target), std::string("}")));
    }
    std::vector<std::string> output = std::vector<std::string>{ets::concat(std::string("{\"dispatches\":["), ets_join_vec(dispatches, std::string(",")), std::string("],\"annotations\":["), ets_join_vec(annotations, std::string(",")), std::string("],"), formatContracts(project), std::string(",\"format\":\"ets-ir-2\",\"success\":"), bindingBoolean(project.success), std::string(",\"types\":["), ets_join_vec(types, std::string(",")), std::string("],\"typeDefinitions\":["), ets_join_vec(definitions, std::string(",")), std::string("],\"runtimeContracts\":["), ets_join_vec(contracts, std::string(",")), std::string("],\"entry\":"), numberToString(project.entry), std::string(",\"initializationOrder\":"), bindingNumbers(project.initializationOrder), std::string(",\"finalizationOrder\":"), bindingNumbers(project.finalizationOrder), std::string(",\"modules\":["))};
    std::string comma = std::string("");
    for (const auto& module : project.modules) {
        ets_push_vec<std::string>(output, ets::concat(comma, std::string("{\"id\":"), quoteSource(module.id), std::string(",\"sourceHash\":"), quoteSource(module.sourceHash), std::string(",\"file\":"), quoteSource(module.file), std::string(",\"initializer\":"), numberToString(module.initializer), std::string(",\"finalizer\":"), numberToString(module.finalizer), std::string("}")));
        (comma = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("],\"globals\":["));
    (comma = std::string(""));
    for (const auto& p : project.globals) {
        ets_push_vec<std::string>(output, ets::concat(comma, std::string("{\"symbolId\":"), quoteSource(p.symbolId), std::string(",\"kind\":"), quoteSource(p.kind), std::string(",\"base\":"), numberToString(p.base), std::string(",\"index\":"), numberToString(p.index), std::string(",\"field\":"), numberToString(p.field), std::string(",\"typeId\":"), numberToString(p.typeId), std::string(",\"source\":"), formatIrSource(p.source), std::string("}")));
        (comma = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("],\"functions\":["));
    (comma = std::string(""));
    for (const auto& f : project.functions) {
        std::vector<std::string> leases = std::vector<std::string>();
        for (const auto& lease : f.leases) {
            ets_push_vec<std::string>(leases, ets::concat(std::string("{\"place\":"), numberToString(lease.place), std::string(",\"value\":"), numberToString(lease.value), std::string(",\"mode\":"), quoteSource(lease.mode), std::string("}")));
        }
        std::vector<std::string> symbols = std::vector<std::string>();
        std::vector<std::string> modes = std::vector<std::string>();
        for (const auto& value : f.captureSymbols) {
            ets_push_vec<std::string>(symbols, quoteSource(value));
        }
        for (const auto& value : f.captureModes) {
            ets_push_vec<std::string>(modes, quoteSource(value));
        }
        ets_push_vec<std::string>(output, ets::concat(comma, std::string("{\"name\":"), quoteSource(f.name), std::string(",\"effectContracts\":"), bindingNumbers(f.effectContracts), std::string(",\"signature\":"), quoteSource(f.signature), std::string(",\"leases\":["), ets_join_vec(leases, std::string(",")), std::string("],\"captureSymbols\":["), ets_join_vec(symbols, std::string(",")), std::string("],\"captureTypes\":"), bindingNumbers(f.captureTypes), std::string(",\"captureModes\":["), ets_join_vec(modes, std::string(",")), std::string("],\"symbolId\":"), quoteSource(f.symbolId), std::string(",\"returns\":"), numberToString(f.returns), std::string(",\"bodyReturns\":"), numberToString(f.bodyReturns), std::string(",\"asynchronous\":"), bindingBoolean(f.asynchronous), std::string(",\"frameValues\":"), bindingNumbers(f.frameValues), std::string(",\"framePlaces\":"), bindingNumbers(f.framePlaces), std::string(",\"parameterTypes\":"), bindingNumbers(f.parameterTypes), std::string(",\"values\":"), bindingNumbers(f.values), std::string(",\"source\":"), formatIrSource(f.source), std::string(",\"places\":[")));
        (comma = std::string(","));
        std::string separator = std::string("");
        for (const auto& p : f.places) {
            ets_push_vec<std::string>(output, ets::concat(separator, std::string("{\"name\":"), quoteSource(p.name), std::string(",\"symbolId\":"), quoteSource(p.symbolId), std::string(",\"kind\":"), quoteSource(p.kind), std::string(",\"base\":"), numberToString(p.base), std::string(",\"index\":"), numberToString(p.index), std::string(",\"field\":"), numberToString(p.field), std::string(",\"typeId\":"), numberToString(p.typeId), std::string(",\"global\":"), numberToString(p.global), std::string(",\"parameter\":"), bindingBoolean(p.parameter), std::string(",\"source\":"), formatIrSource(p.source), std::string("}")));
            (separator = std::string(","));
        }
        ets_push_vec<std::string>(output, std::string("],\"blocks\":["));
        (separator = std::string(""));
        for (const auto& block : f.blocks) {
            ets_push_vec<std::string>(output, ets::concat(separator, std::string("{\"terminator\":"), quoteSource(block.terminator), std::string(",\"value\":"), numberToString(block.value), std::string(",\"targets\":"), bindingNumbers(block.targets), std::string(",\"source\":"), formatIrSource(block.source), std::string(",\"instructions\":[")));
            (separator = std::string(","));
            std::string sep = std::string("");
            for (const auto& i : block.instructions) {
                std::vector<std::string> effects = std::vector<std::string>();
                for (const auto& effect : i.effects) {
                    ets_push_vec<std::string>(effects, quoteSource(effect));
                }
                std::vector<std::string> names = std::vector<std::string>();
                for (const auto& name : i.names) {
                    ets_push_vec<std::string>(names, quoteSource(name));
                }
                ets_push_vec<std::string>(output, ets::concat(sep, std::string("{\"op\":"), quoteSource(i.op), std::string(",\"effects\":["), ets_join_vec(effects, std::string(",")), std::string("],\"result\":"), numberToString(i.result), std::string(",\"typeId\":"), numberToString(i.typeId), std::string(",\"operands\":"), bindingNumbers(i.operands), std::string(",\"place\":"), numberToString(i.place), std::string(",\"callee\":"), numberToString(i.callee), std::string(",\"contract\":"), numberToString(i.contract), std::string(",\"lease\":"), numberToString(i.lease), std::string(",\"continuation\":"), numberToString(i.continuation), std::string(",\"signature\":"), numberToString(i.signature), std::string(",\"text\":"), quoteSource(i.text), std::string(",\"names\":["), ets_join_vec(names, std::string(",")), std::string("],\"source\":"), formatIrSource(i.source), std::string("}")));
                (sep = std::string(","));
            }
            ets_push_vec<std::string>(output, std::string("]}"));
        }
        ets_push_vec<std::string>(output, std::string("]}"));
    }
    ets_push_vec<std::string>(output, std::string("],\"diagnostics\":["));
    (comma = std::string(""));
    for (const auto& issue : project.diagnostics) {
        ets_push_vec<std::string>(output, ets::concat(comma, std::string("{\"code\":"), quoteSource(issue.code), std::string(",\"message\":"), quoteSource(issue.message), std::string(",\"source\":"), formatIrSource(issue.source), std::string("}")));
        (comma = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("]}"));
    return ets_join_vec(output, std::string(""));
}

void ets_init_bootstrap_ir_format_60a49266() {
}
