// Generated module. Do not edit.
#include "estatic_common.hpp"

std::string ets_import_0_escapeLiteralValue(std::string value) {
    std::string result = std::string("");
    for (double at = 0.0; (at < ::ets::string_length(value)); (at = (at + 1.0))) {
        const std::string c = ::ets::string_charAt(value, at);
        if ((c == std::string("\\"))) {
            (result = ets::concat(result, std::string("\\\\")));
        } else {
            if ((c == std::string("|"))) {
                (result = ets::concat(result, std::string("\\|")));
            } else {
                if ((c == std::string("="))) {
                    (result = ets::concat(result, std::string("\\=")));
                } else {
                    (result = ets::concat(result, c));
                }
            }
        }
    }
    return result;
}

double nodeBegin(AstNode node) {
    return ((node.analysisStart >= 0.0) ? node.analysisStart : node.start.offset);
}

double nodeEnd(AstNode node) {
    return ((node.analysisEnd >= 0.0) ? node.analysisEnd : node.end.endOffset);
}

static inline std::string quoteAst(std::string text) {
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

static inline std::string positionAst(double offset, double line, double column) {
    return ets::concat(std::string("{\"offset\":"), numberToString(offset), std::string(",\"line\":"), numberToString(line), std::string(",\"column\":"), numberToString(column), std::string("}"));
}

static inline std::string spanAst(ParserToken start, ParserToken end) {
    return ets::concat(std::string("{\"start\":"), positionAst(start.offset, start.line, start.column), std::string(",\"end\":"), positionAst(end.endOffset, end.endLine, end.endColumn), std::string("}"));
}

std::string formatAst(ParseResult result) {
    std::vector<std::string> output = std::vector<std::string>{ets::concat(std::string("{\"root\":"), numberToString(result.root), std::string(",\"nodes\":["))};
    std::string separator = std::string("");
    for (const auto& item : result.nodes) {
        ets_push_vec<std::string>(output, ets::concat(separator, std::string("{\"kind\":"), quoteAst(nodeKindName(item.kind)), std::string(",\"span\":"), spanAst(item.start, item.end), std::string(",\"attributes\":[")));
        std::string comma = std::string("");
        for (const auto& field : item.attributes) {
            ets_push_vec<std::string>(output, ets::concat(comma, std::string("{\"name\":"), quoteAst(attributeKindName(field.name)), std::string(",\"value\":"), quoteAst(field.value), std::string("}")));
            (comma = std::string(","));
        }
        ets_push_vec<std::string>(output, std::string("],\"edges\":["));
        (comma = std::string(""));
        for (const auto& edge : item.edges) {
            ets_push_vec<std::string>(output, ets::concat(comma, std::string("{\"role\":"), quoteAst(edgeRoleName(edge.role)), std::string(",\"node\":"), numberToString(edge.node), std::string("}")));
            (comma = std::string(","));
        }
        ets_push_vec<std::string>(output, std::string("]}"));
        (separator = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("],\"diagnostics\":["));
    (separator = std::string(""));
    for (const auto& diagnostic : result.diagnostics) {
        ets_push_vec<std::string>(output, ets::concat(separator, std::string("{\"phase\":\"parser\",\"message\":"), quoteAst(diagnostic.message), std::string(",\"span\":"), spanAst(diagnostic.token, diagnostic.token), std::string("}")));
        (separator = std::string(","));
    }
    ets_push_vec<std::string>(output, std::string("]}"));
    return ets_join_vec(output, std::string(""));
}

ParseResult parseTokens(std::vector<ParserToken> tokens) {
    Parser parser = Parser{}.constructor(tokens);
    return parser.parseProgram();
}

std::string inspectAst(std::vector<ParserToken> tokens) {
    Parser parser = Parser{}.constructor(tokens);
    return parser.inspect();
}

void ets_init_bootstrap_parser_parser_42b9bbf9() {
}
