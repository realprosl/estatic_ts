// Generated module. Do not edit.
#include "estatic_common.hpp"

LexerResult tokenize(std::string source) {
    Lexer lexer = Lexer{}.constructor(source);
    return lexer.tokenize();
}

LexerResult tokenizeExpanded(std::string source) {
    Lexer lexer = Lexer{}.constructor(source);
    (lexer.expandedTemplates = true);
    return lexer.tokenize();
}

static inline std::string jsonQuote(std::string text) {
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

static inline std::string jsonPosition(double offset, double line, double column) {
    return ets::concat(std::string("{\"offset\":"), numberToString(offset), std::string(",\"line\":"), numberToString(line), std::string(",\"column\":"), numberToString(column), std::string("}"));
}

std::string inspectTokens(std::string source) {
    const LexerResult result = tokenize(source);
    std::string output = std::string("{\"tokens\":[");
    std::string separator = std::string("");
    for (const auto& token : result.tokens) {
        (output = ets::concat(output, separator, std::string("{\"kind\":"), jsonQuote(token.kind), std::string(",\"lexeme\":"), jsonQuote(token.lexeme), std::string(",\"span\":{\"start\":"), jsonPosition(token.offset, token.line, token.column), std::string(",\"end\":"), jsonPosition(token.endOffset, token.endLine, token.endColumn), std::string("}}")));
        (separator = std::string(","));
    }
    (output = ets::concat(output, std::string("],\"diagnostics\":[")));
    (separator = std::string(""));
    for (const auto& diagnostic : result.diagnostics) {
        (output = ets::concat(output, separator, std::string("{\"phase\":\"lexer\",\"message\":"), jsonQuote(diagnostic.message), std::string(",\"span\":{\"start\":"), jsonPosition(diagnostic.offset, diagnostic.line, diagnostic.column), std::string(",\"end\":"), jsonPosition(diagnostic.endOffset, diagnostic.endLine, diagnostic.endColumn), std::string("}}")));
        (separator = std::string(","));
    }
    return ets::concat(output, std::string("]}"));
}

void ets_init_bootstrap_lexer_lexer_347006bc() {
}
