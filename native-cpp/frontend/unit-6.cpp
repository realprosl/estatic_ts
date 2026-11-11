// Generated module. Do not edit.
#include "estatic_common.hpp"

SourceDiagnostic diagnosticAt(std::string phase, std::string message, std::string file, AstNode node) {
    auto result = SourceDiagnostic{}.constructor(phase, message, file, node.start);
    (result.endToken = node.end);
    (result.generatedId = node.generatedId);
    (result.generatedToken = node.generatedStart);
    (result.generatedEndToken = node.generatedEnd);
    return result;
}

static inline ParserToken parserToken(LexerToken token) {
    return ParserToken{}.constructor(token.kind, token.lexeme, token.offset, token.line, token.column, token.endOffset, token.endLine, token.endColumn);
}

static inline ParserToken errorToken(LexerDiagnostic diagnostic) {
    return ParserToken{}.constructor(std::string("error"), std::string(""), diagnostic.offset, diagnostic.line, diagnostic.column, diagnostic.endOffset, diagnostic.endLine, diagnostic.endColumn);
}

SourceResult parseSource(std::string source, std::string file) {
    const LexerResult lexical = tokenizeExpanded(source);
    std::vector<ParserToken> tokens = std::vector<ParserToken>();
    for (const auto& token : lexical.tokens) {
        ets_push_vec<ParserToken>(tokens, parserToken(token));
    }
    std::vector<SourceDiagnostic> diagnostics = std::vector<SourceDiagnostic>();
    for (const auto& diagnostic : lexical.diagnostics) {
        ets_push_vec<SourceDiagnostic>(diagnostics, SourceDiagnostic{}.constructor(std::string("lexer"), diagnostic.message, file, errorToken(diagnostic)));
    }
    const bool parsed = (diagnostics.size() == 0.0);
    ParseResult ast = ParseResult{}.constructor((-1.0), std::vector<AstNode>(), std::vector<ParserDiagnostic>());
    if (parsed) {
        (ast = parseTokens(tokens));
        for (const auto& diagnostic : ast.diagnostics) {
            ets_push_vec<SourceDiagnostic>(diagnostics, SourceDiagnostic{}.constructor(std::string("parser"), diagnostic.message, file, diagnostic.token));
        }
    }
    return SourceResult{}.constructor(file, tokens, ast, diagnostics, parsed);
}

std::string quoteSource(std::string text) {
    std::string result = std::string("\"");
    const std::string hex = std::string("0123456789abcdef");
    for (double i = 0.0; (i < ::ets::string_length(text)); (i = (i + 1.0))) {
        const std::string c = ::ets::string_charAt(text, i);
        const double code = ::ets::string_charCodeAt(text, i);
        if ((c == std::string("\""))) {
            (result = ets::concat(result, std::string("\\\"")));
        } else {
            if ((c == std::string("\\"))) {
                (result = ets::concat(result, std::string("\\\\")));
            } else {
                if ((code < 32.0)) {
                    (result = ets::concat(result, std::string("\\u00"), ::ets::string_charAt(hex, Math.floor((code / 16.0))), ::ets::string_charAt(hex, std::fmod(code, 16.0))));
                } else {
                    (result = ets::concat(result, c));
                }
            }
        }
    }
    return ets::concat(result, std::string("\""));
}

static inline std::string positionSource(double offset, double line, double column) {
    return ets::concat(std::string("{\"offset\":"), numberToString(offset), std::string(",\"line\":"), numberToString(line), std::string(",\"column\":"), numberToString(column), std::string("}"));
}

static inline std::string spanSource(ParserToken token) {
    return ets::concat(std::string("{\"start\":"), positionSource(token.offset, token.line, token.column), std::string(",\"end\":"), positionSource(token.endOffset, token.endLine, token.endColumn), std::string("}"));
}

static inline std::string diagnosticSpan(ParserToken start, ParserToken end) {
    return ets::concat(std::string("{\"start\":"), positionSource(start.offset, start.line, start.column), std::string(",\"end\":"), positionSource(end.endOffset, end.endLine, end.endColumn), std::string("}"));
}

std::string formatDiagnostic(SourceDiagnostic diagnostic) {
    std::string generated = std::string("null");
    if ((diagnostic.generatedId != std::string(""))) {
        (generated = ets::concat(std::string("{\"sourceId\":"), quoteSource(diagnostic.generatedId), std::string(",\"span\":"), diagnosticSpan(diagnostic.generatedToken, diagnostic.generatedEndToken), std::string(",\"offset\":"), numberToString(diagnostic.generatedToken.offset), std::string(",\"line\":"), numberToString(diagnostic.generatedToken.line), std::string(",\"column\":"), numberToString(diagnostic.generatedToken.column), std::string("}")));
    }
    return ets::concat(std::string("{\"schema\":\"ets-diagnostic-1\",\"file\":"), quoteSource(diagnostic.file), std::string(",\"phase\":"), quoteSource(diagnostic.phase), std::string(",\"code\":"), quoteSource(diagnostic.code), std::string(",\"severity\":"), quoteSource(diagnostic.severity), std::string(",\"message\":"), quoteSource(diagnostic.message), std::string(",\"span\":"), diagnosticSpan(diagnostic.token, diagnostic.endToken), std::string(",\"generated\":"), generated, std::string(",\"offset\":"), numberToString(diagnostic.token.offset), std::string(",\"line\":"), numberToString(diagnostic.token.line), std::string(",\"column\":"), numberToString(diagnostic.token.column), std::string("}"));
}

std::string formatSource(SourceResult result) {
    std::vector<std::string> output = std::vector<std::string>{ets::concat(std::string("{\"file\":"), quoteSource(result.file), std::string(",\"parsed\":"), (result.parsed ? std::string("true") : std::string("false")), std::string(",\"success\":"), (result.success ? std::string("true") : std::string("false")), std::string(",\"tokens\":["))};
    std::string separator = std::string("");
    for (const auto& token : result.tokens) {
        ets_push_vec<std::string>(output, ets::concat(separator, std::string("{\"kind\":"), quoteSource(token.kind), std::string(",\"lexeme\":"), quoteSource(token.lexeme), std::string(",\"span\":"), spanSource(token), std::string("}")));
        (separator = std::string(","));
    }
    ets_push_vec<std::string>(output, ets::concat(std::string("],\"ast\":"), formatAst(result.ast), std::string(",\"diagnostics\":[")));
    (separator = std::string(""));
    for (const auto& diagnostic : result.diagnostics) {
        ets_push_vec<std::string>(output, ets::concat(separator, formatDiagnostic(diagnostic)));
        (separator = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("]}"));
    return ets_join_vec(output, std::string(""));
}

std::string inspectSource(std::string source, std::string file) {
    const SourceResult result = parseSource(source, file);
    return formatSource(result);
}

void ets_init_bootstrap_frontend_frontend_a7343264() {
}
