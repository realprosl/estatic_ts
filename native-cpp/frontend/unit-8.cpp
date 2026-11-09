// Generated module. Do not edit.
#include "estatic_common.hpp"

struct Reader;

std::string field(std::string text) {
    return ets::concat(numberToString(::ets::string_length(text)), std::string(":"), text);
}

std::string integer(double value) {
    return field(numberToString(value));
}

static inline std::string encodeToken(ParserToken token) {
    return ets::concat(field(token.kind), field(token.lexeme), integer(token.offset), integer(token.line), integer(token.column), integer(token.endOffset), integer(token.endLine), integer(token.endColumn));
}

static inline ParserToken decodeToken(Reader& reader, double length) {
    const std::string kind = reader.take();
    const std::string lexeme = reader.take();
    const double offset = reader.natural();
    const double line = reader.natural();
    const double column = reader.natural();
    const double endOffset = reader.natural();
    const double endLine = reader.natural();
    const double endColumn = reader.natural();
    if ((((((((kind == std::string("")) || (endOffset < offset)) || (endOffset > length)) || (line < 1.0)) || (column < 1.0)) || (endLine < line)) || (endColumn < 1.0))) {
        (reader.valid = false);
    }
    if (((endLine == line) && ((endColumn - column) != (endOffset - offset)))) {
        (reader.valid = false);
    }
    if (((endLine > line) && ((endOffset - offset) < (endLine - line)))) {
        (reader.valid = false);
    }
    return ParserToken{}.constructor(kind, lexeme, offset, line, column, endOffset, endLine, endColumn);
}

std::string encodeSyntax(SourceResult result) {
    std::vector<std::string> parts = std::vector<std::string>{integer(result.tokens.size())};
    for (const auto& token : result.tokens) {
        ets_push_vec<std::string>(parts, encodeToken(token));
    }
    ets_push_vec<std::string>(parts, ets::concat(integer(result.ast.root), integer(result.ast.nodes.size())));
    for (const auto& node : result.ast.nodes) {
        ets_push_vec<std::string>(parts, ets::concat(field(nodeKindName(node.kind)), encodeToken(node.start), encodeToken(node.end), integer(node.attributes.size())));
        for (const auto& attribute : node.attributes) {
            ets_push_vec<std::string>(parts, ets::concat(field(attributeKindName(attribute.name)), field(attribute.value)));
        }
        ets_push_vec<std::string>(parts, integer(node.edges.size()));
        for (const auto& edge : node.edges) {
            ets_push_vec<std::string>(parts, ets::concat(field(edgeRoleName(edge.role)), integer(edge.node)));
        }
    }
    return ets_join_vec(parts, std::string(""));
}

static inline SourceResult emptySyntax(std::string file) {
    return SourceResult{}.constructor(file, std::vector<ParserToken>(), ParseResult{}.constructor((-1.0), std::vector<AstNode>(), std::vector<ParserDiagnostic>()), std::vector<SourceDiagnostic>(), false);
}

SourceResult decodeSyntax(std::string text, std::string file, double length) {
    Reader reader = Reader{}.constructor(text);
    std::vector<ParserToken> tokens = std::vector<ParserToken>();
    std::vector<AstNode> nodes = std::vector<AstNode>();
    const double tokenCount = reader.count();
    for (double i = 0.0; ((i < tokenCount) && reader.valid); (i = (i + 1.0))) {
        const ParserToken token = decodeToken(reader, length);
        if (((i > 0.0) && (token.offset < tokens[static_cast<std::size_t>((i - 1.0))].endOffset))) {
            (reader.valid = false);
        }
        if ((((i + 1.0) < tokenCount) && (token.kind == std::string("eof")))) {
            (reader.valid = false);
        }
        ets_push_vec<ParserToken>(tokens, token);
    }
    if ((tokens.size() == 0.0)) {
        (reader.valid = false);
    } else {
        const ParserToken last = tokens[static_cast<std::size_t>((tokens.size() - 1.0))];
        if ((((last.kind != std::string("eof")) || (last.offset != length)) || (last.endOffset != length))) {
            (reader.valid = false);
        }
    }
    const double root = reader.natural();
    const double count = reader.count();
    for (double i = 0.0; ((i < count) && reader.valid); (i = (i + 1.0))) {
        const NodeKind kind = parseNodeKind(reader.take());
        const ParserToken start = decodeToken(reader, length);
        const ParserToken end = decodeToken(reader, length);
        if (((kind == NodeKind::Invalid) || (end.endOffset < start.offset))) {
            (reader.valid = false);
        }
        AstNode node = AstNode{}.constructor(kind, start, end);
        const double attributes = reader.count();
        for (double a = 0.0; ((a < attributes) && reader.valid); (a = (a + 1.0))) {
            const AttributeKind name = parseAttributeKind(reader.take());
            const std::string value = reader.take();
            if ((name == AttributeKind::Invalid)) {
                (reader.valid = false);
            }
            ets_push_vec<AstAttribute>(node.attributes, AstAttribute{}.constructor(name, value));
        }
        const double edges = reader.count();
        for (double e = 0.0; ((e < edges) && reader.valid); (e = (e + 1.0))) {
            const EdgeRole role = parseEdgeRole(reader.take());
            const double ets_local_index = reader.natural();
            if ((((role == EdgeRole::Invalid) || (ets_local_index >= count)) || (ets_local_index == i))) {
                (reader.valid = false);
            }
            ets_push_vec<AstEdge>(node.edges, AstEdge{}.constructor(role, ets_local_index));
        }
        ets_push_vec<AstNode>(nodes, node);
    }
    if (((!reader.done()) || (root >= nodes.size()))) {
        return emptySyntax(file);
    }
    if ((nodes[static_cast<std::size_t>(root)].kind != NodeKind::Program)) {
        return emptySyntax(file);
    }
    std::vector<double> states = std::vector<double>();
    for (const auto& node : nodes) {
        ets_push_vec<double>(states, 0.0);
    }
    for (double i = 0.0; (i < nodes.size()); (i = (i + 1.0))) {
        if ((states[static_cast<std::size_t>(i)] != 0.0)) {
            continue;
        }
        std::vector<double> stack = std::vector<double>{i};
        std::vector<double> cursors = std::vector<double>{0.0};
        ets_set_vec<double>(states, i, 1.0);
        while ((stack.size() > 0.0)) {
            const double top = (stack.size() - 1.0);
            const double ets_local_index = stack[static_cast<std::size_t>(top)];
            const double cursor = cursors[static_cast<std::size_t>(top)];
            if ((cursor >= nodes[static_cast<std::size_t>(ets_local_index)].edges.size())) {
                ets_set_vec<double>(states, ets_local_index, 2.0);
                ets_pop_vec<double>(stack);
                ets_pop_vec<double>(cursors);
            } else {
                ets_set_vec<double>(cursors, top, (cursor + 1.0));
                const double child = nodes[static_cast<std::size_t>(ets_local_index)].edges[static_cast<std::size_t>(cursor)].node;
                if ((states[static_cast<std::size_t>(child)] == 1.0)) {
                    return emptySyntax(file);
                }
                if ((states[static_cast<std::size_t>(child)] == 0.0)) {
                    ets_set_vec<double>(states, child, 1.0);
                    ets_push_vec<double>(stack, child);
                    ets_push_vec<double>(cursors, 0.0);
                }
            }
        }
    }
    return SourceResult{}.constructor(file, tokens, ParseResult{}.constructor(root, nodes, std::vector<ParserDiagnostic>()), std::vector<SourceDiagnostic>(), true);
}

double sourceUnits(std::string text) {
    double at = 0.0;
    double units = 0.0;
    while ((at < ::ets::string_length(text))) {
        const double byte = ::ets::string_charCodeAt(text, at);
        double width = 1.0;
        double count = 1.0;
        if (((byte >= 240.0) && (byte <= 244.0))) {
            (width = 4.0);
            (count = 2.0);
        } else {
            if (((byte >= 224.0) && (byte <= 239.0))) {
                (width = 3.0);
            } else {
                if (((byte >= 194.0) && (byte <= 223.0))) {
                    (width = 2.0);
                }
            }
        }
        (at = (at + width));
        (units = (units + count));
    }
    return units;
}

void ets_init_bootstrap_modules_syntax_cache_b49b13e5() {
}
