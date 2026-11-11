// Generated module. Do not edit.
#include "estatic_common.hpp"

ParserToken originToken() {
    return ParserToken{}.constructor(std::string(""), std::string(""), 0.0, 1.0, 1.0, 0.0, 1.0, 1.0);
}

static inline bool hasExtension(std::string file) {
    double base = 0.0;
    double dot = (-1.0);
    for (double i = 0.0; (i < ::ets::string_length(file)); (i = (i + 1.0))) {
        if ((::ets::string_charAt(file, i) == std::string("/"))) {
            (base = (i + 1.0));
            (dot = (-1.0));
        } else {
            if ((::ets::string_charAt(file, i) == std::string("."))) {
                (dot = i);
            }
        }
    }
    return (dot > base);
}

std::string resolveSourceFile(std::string requested) {
    if (hasExtension(requested)) {
        return canonicalFile(requested);
    }
    const std::string ts = canonicalFile(ets::concat(requested, std::string(".ts")));
    return ((ts != std::string("")) ? ts : canonicalFile(ets::concat(requested, std::string(".ets"))));
}

static inline std::string requestedPath(std::string base, std::string specifier) {
    if ((specifier == std::string(""))) {
        return normalizePath(base);
    }
    return normalizePath((::ets::string_startsWith(specifier, std::string("/")) ? specifier : ets::concat(base, std::string("/"), specifier)));
}

std::string resolveRequest(std::string file, std::string specifier, LoaderOptions options) {
    if ((specifier == std::string(""))) {
        return std::string("");
    }
    if ((::ets::string_startsWith(specifier, std::string(".")) || ::ets::string_startsWith(specifier, std::string("/")))) {
        return resolveSourceFile(requestedPath(pathDirectory(file), specifier));
    }
    double selected = (-1.0);
    double longest = (-1.0);
    for (double i = 0.0; (i < options.aliases.size()); (i = (i + 1.0))) {
        const std::string name = options.aliases[static_cast<std::size_t>(i)].name;
        if ((((specifier == name) || ::ets::string_startsWith(specifier, ets::concat(name, std::string("/")))) && (::ets::string_length(name) > longest))) {
            (selected = i);
            (longest = ::ets::string_length(name));
        }
    }
    if ((selected >= 0.0)) {
        const PathAlias alias = options.aliases[static_cast<std::size_t>(selected)];
        const std::string suffix = ((specifier == alias.name) ? std::string("") : ::ets::string_slice(specifier, (::ets::string_length(alias.name) + 1.0), ::ets::string_length(specifier)));
        return resolveSourceFile(requestedPath(alias.target, suffix));
    }
    for (const auto& root : options.roots) {
        const std::string resolved = resolveSourceFile(requestedPath(root, specifier));
        if ((resolved != std::string(""))) {
            return resolved;
        }
    }
    return std::string("");
}

LoadedFile readModule(std::string file, ModuleGraph& graph, SyntaxCache& cache) {
    const std::vector<std::string> snapshot = readSnapshot(file);
    const std::string source = snapshot[static_cast<std::size_t>(0.0)];
    const std::string error = snapshot[static_cast<std::size_t>(1.0)];
    const std::string before = snapshot[static_cast<std::size_t>(2.0)];
    if ((error != std::string(""))) {
        ets_push_vec<SourceDiagnostic>(graph.diagnostics, SourceDiagnostic{}.constructor(std::string("loader"), error, file, originToken()));
        CachedSource failed = CachedSource{}.constructor(SourceResult{}.constructor(file, std::vector<ParserToken>(), ParseResult{}.constructor((-1.0), std::vector<AstNode>(), std::vector<ParserDiagnostic>()), std::vector<SourceDiagnostic>(), false), FileRecord{}.constructor(file, std::string(""), std::string(""), std::string("")), false);
        (failed.record.syntax = std::string(""));
        (failed.result.success = false);
        return LoadedFile{}.constructor(file, failed);
    }
    const std::string after = snapshot[static_cast<std::size_t>(3.0)];
    if (((before == std::string("")) || (before != after))) {
        ets_push_vec<SourceDiagnostic>(graph.diagnostics, SourceDiagnostic{}.constructor(std::string("loader"), std::string("El archivo cambió durante la lectura; vuelve a intentarlo"), file, originToken()));
        CachedSource unstable = CachedSource{}.constructor(SourceResult{}.constructor(file, std::vector<ParserToken>(), ParseResult{}.constructor((-1.0), std::vector<AstNode>(), std::vector<ParserDiagnostic>()), std::vector<SourceDiagnostic>(), false), FileRecord{}.constructor(file, std::string(""), std::string(""), std::string("")), false);
        (unstable.record.syntax = std::string(""));
        (unstable.result.success = false);
        return LoadedFile{}.constructor(file, unstable);
    }
    const CachedSource cached = cache.getOrParseModule(file, source, after);
    for (const auto& diagnostic : cached.result.diagnostics) {
        ets_push_vec<SourceDiagnostic>(graph.diagnostics, diagnostic);
    }
    return LoadedFile{}.constructor(file, cached);
}

std::string formatGraph(ModuleGraph graph) {
    std::vector<std::string> parts = std::vector<std::string>{ets::concat(std::string("{\"entry\":"), quoteSource(graph.entry), std::string(",\"success\":"), (graph.success ? std::string("true") : std::string("false")), std::string(",\"cache\":{\"hits\":"), numberToString(graph.hits), std::string(",\"misses\":"), numberToString(graph.misses), std::string(",\"writes\":"), numberToString(graph.writes), std::string("},\"modules\":["))};
    std::string separator = std::string("");
    for (const auto& module : graph.modules) {
        ets_push_vec<std::string>(parts, ets::concat(separator, std::string("{\"file\":"), quoteSource(module.file), std::string(",\"hash\":"), quoteSource(module.cached.record.hash), std::string(",\"metadata\":"), quoteSource(module.cached.record.metadata), std::string(",\"reused\":"), (module.cached.reused ? std::string("true") : std::string("false")), std::string(",\"dependencies\":[")));
        std::string comma = std::string("");
        for (const auto& dependency : module.dependencies) {
            ets_push_vec<std::string>(parts, ets::concat(comma, quoteSource(dependency)));
            (comma = std::string(","));
        }
        ets_push_vec<std::string>(parts, std::string("],\"requests\":["));
        (comma = std::string(""));
        for (const auto& request : module.requests) {
            ets_push_vec<std::string>(parts, ets::concat(comma, std::string("{\"specifier\":"), quoteSource(request.specifier), std::string(",\"kind\":"), quoteSource(request.kind), std::string(",\"typeOnly\":"), (request.typeOnly ? std::string("true") : std::string("false")), std::string(",\"node\":"), numberToString(request.node), std::string(",\"dependency\":"), quoteSource(request.dependency), std::string("}")));
            (comma = std::string(","));
        }
        ets_push_vec<std::string>(parts, ets::concat(std::string("],\"source\":"), formatSource(module.cached.result), std::string("}")));
        (separator = std::string(","));
    }
    ets_push_vec<std::string>(parts, std::string("],\"diagnostics\":["));
    (separator = std::string(""));
    for (const auto& diagnostic : graph.diagnostics) {
        ets_push_vec<std::string>(parts, ets::concat(separator, formatDiagnostic(diagnostic)));
        (separator = std::string(","));
    }
    ets_push_vec<std::string>(parts, std::string("]}"));
    return ets_join_vec(parts, std::string(""));
}

void ets_init_bootstrap_modules_loader_d0784388() {
}
