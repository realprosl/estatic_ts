// Generated module. Do not edit.
#include "estatic_common.hpp"

std::vector<std::string> splitTypes(std::string text, std::string separator) {
    if ((((separator == std::string("|")) || (separator == std::string("&"))) && (functionClose(text) >= 0.0))) {
        std::vector<std::string> callable = std::vector<std::string>{text};
        return callable;
    }
    std::vector<std::string> result = std::vector<std::string>();
    double round = 0.0;
    double square = 0.0;
    double angle = 0.0;
    double start = 0.0;
    for (double i = 0.0; (i < ::ets::string_length(text)); (i = (i + 1.0))) {
        const std::string c = ::ets::string_charAt(text, i);
        if ((c == std::string("("))) {
            (round = (round + 1.0));
        } else {
            if ((c == std::string(")"))) {
                (round = (round - 1.0));
            } else {
                if ((c == std::string("["))) {
                    (square = (square + 1.0));
                } else {
                    if ((c == std::string("]"))) {
                        (square = (square - 1.0));
                    } else {
                        if ((c == std::string("<"))) {
                            (angle = (angle + 1.0));
                        } else {
                            if (((c == std::string(">")) && (::ets::string_charAt(text, (i - 1.0)) != std::string("=")))) {
                                (angle = (angle - 1.0));
                            } else {
                                if (((((c == separator) && (round == 0.0)) && (square == 0.0)) && (angle == 0.0))) {
                                    ets_push_vec<std::string>(result, (((separator == std::string("|")) || (separator == std::string("&"))) ? ungroupElement(::ets::string_trim(::ets::string_slice(text, start, i))) : ::ets::string_trim(::ets::string_slice(text, start, i))));
                                    (start = (i + 1.0));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if ((start < ::ets::string_length(text))) {
        ets_push_vec<std::string>(result, (((separator == std::string("|")) || (separator == std::string("&"))) ? ungroupElement(::ets::string_trim(::ets::string_slice(text, start, ::ets::string_length(text)))) : ::ets::string_trim(::ets::string_slice(text, start, ::ets::string_length(text)))));
    }
    return result;
}

std::string joinTypes(std::vector<std::string> parts, std::string separator) {
    if ((parts.size() == 1.0)) {
        return parts[static_cast<std::size_t>(0.0)];
    }
    std::vector<std::string> values = std::vector<std::string>();
    for (const auto& part : parts) {
        ets_push_vec<std::string>(values, ((functionClose(part) >= 0.0) ? ets::concat(std::string("("), part, std::string(")")) : part));
    }
    return ets_join_vec(values, separator);
}

double functionClose(std::string text) {
    if ((!::ets::string_startsWith(text, std::string("(")))) {
        return (-1.0);
    }
    double depth = 0.0;
    for (double i = 0.0; (i < ::ets::string_length(text)); (i = (i + 1.0))) {
        if ((::ets::string_charAt(text, i) == std::string("("))) {
            (depth = (depth + 1.0));
        }
        if ((::ets::string_charAt(text, i) == std::string(")"))) {
            (depth = (depth - 1.0));
            if (((depth == 0.0) && (::ets::string_slice(text, (i + 1.0), (i + 3.0)) == std::string("=>")))) {
                return i;
            }
        }
    }
    return (-1.0);
}

std::vector<std::string> functionParams(std::string text) {
    const double close = functionClose(text);
    if ((close < 0.0)) {
        std::vector<std::string> empty = std::vector<std::string>();
        return empty;
    }
    return splitTypes(::ets::string_slice(text, 1.0, close), std::string(","));
}

std::string functionReturn(std::string text) {
    const double close = functionClose(text);
    return ((close < 0.0) ? std::string("!error") : ::ets::string_slice(text, (close + 3.0), ::ets::string_length(text)));
}

double restPosition(std::string text) {
    const std::vector<std::string> params = functionParams(text);
    for (double at = 0.0; (at < params.size()); (at = (at + 1.0))) {
        if (::ets::string_startsWith(params[static_cast<std::size_t>(at)], std::string("..."))) {
            return at;
        }
    }
    return (-1.0);
}

std::string argumentType(std::string text, bool spread) {
    if ((!::ets::string_startsWith(text, std::string("...")))) {
        return text;
    }
    const std::string array = ::ets::string_slice(text, 3.0, ::ets::string_length(text));
    if ((!::ets::string_endsWith(array, std::string("[]")))) {
        return std::string("");
    }
    return (spread ? array : semanticElement(array));
}

bool numericType(std::string text) {
    return ets_includes_vec<std::string>(std::vector<std::string>{std::string("number"), std::string("i8"), std::string("u8"), std::string("i16"), std::string("u16"), std::string("i32"), std::string("u32"), std::string("i64"), std::string("u64"), std::string("f32"), std::string("f64")}, text);
}

bool primitiveType(std::string text) {
    return (numericType(text) || ets_includes_vec<std::string>(std::vector<std::string>{std::string("string"), std::string("boolean"), std::string("void")}, text));
}

double canonicalSymbol(std::string text) {
    const double open = ::ets::string_indexOf(text, std::string("<"), 0.0);
    const double end = ((open >= 0.0) ? open : ::ets::string_length(text));
    if (((end < 2.0) || (::ets::string_charAt(text, 0.0) != std::string("#")))) {
        return (-1.0);
    }
    double result = 0.0;
    for (double at = 1.0; (at < end); (at = (at + 1.0))) {
        const double digit = (::ets::string_charCodeAt(text, at) - 48.0);
        if (((digit < 0.0) || (digit > 9.0))) {
            return (-1.0);
        }
        (result = ((result * 10.0) + digit));
        if ((result > 2147483647.0)) {
            return (-1.0);
        }
    }
    return result;
}

bool typeCompatible(std::string actual, std::string expected) {
    if (((actual == std::string("!error")) || (expected == std::string("!error")))) {
        return true;
    }
    if (((actual == expected) || (numericType(actual) && numericType(expected)))) {
        return true;
    }
    const std::string a = ets_import_0_memoryMode(actual);
    const std::string e = ets_import_0_memoryMode(expected);
    if ((e == std::string("readonly"))) {
        return typeCompatible(ets_import_2_memoryInner(actual), ets_import_2_memoryInner(expected));
    }
    if (((e == std::string("ref")) || (e == std::string("constRef")))) {
        if (((e == std::string("ref")) && readonlyType(actual))) {
            return false;
        }
        return ((actual == ets_import_2_memoryInner(expected)) || (ets_import_4_memoryValue(actual) == ets_import_2_memoryInner(expected)));
    }
    if (((a == std::string("ref")) || (a == std::string("constRef")))) {
        return typeCompatible(ets_import_2_memoryInner(actual), expected);
    }
    const std::vector<std::string> unions = splitTypes(expected, std::string("|"));
    if ((unions.size() > 1.0)) {
        for (const auto& a : splitTypes(actual, std::string("|"))) {
            bool found = false;
            for (const auto& b : unions) {
                if (typeCompatible(a, b)) {
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

std::string replaceType(std::string text, std::string from, std::string to) {
    std::string result = std::string("");
    double at = 0.0;
    while ((at < ::ets::string_length(text))) {
        if ((::ets::string_slice(text, at, (at + ::ets::string_length(from))) == from)) {
            const double next = ::ets::string_charCodeAt(text, (at + ::ets::string_length(from)));
            if ((!((next >= 48.0) && (next <= 57.0)))) {
                const std::string before = ((at > 0.0) ? ::ets::string_charAt(text, (at - 1.0)) : std::string(""));
                const std::string after = ::ets::string_charAt(text, (at + ::ets::string_length(from)));
                std::string replacement = to;
                if ((after == std::string("["))) {
                    (replacement = aggregateElement(to));
                } else {
                    if (((functionClose(to) >= 0.0) && ((((before == std::string("|")) || (before == std::string("&"))) || (after == std::string("|"))) || (after == std::string("&"))))) {
                        (replacement = ets::concat(std::string("("), to, std::string(")")));
                    }
                }
                (result = ets::concat(result, replacement));
                (at = (at + ::ets::string_length(from)));
                continue;
            }
        }
        (result = ets::concat(result, ::ets::string_charAt(text, at)));
        (at = (at + 1.0));
    }
    return result;
}

std::string ets_import_0_memoryMode(std::string text) {
    for (const auto& name : std::vector<std::string>{std::string("ptr"), std::string("constPtr"), std::string("ref"), std::string("constRef"), std::string("readonly")}) {
        if ((::ets::string_startsWith(text, ets::concat(name, std::string("<"))) && ::ets::string_endsWith(text, std::string(">")))) {
            double depth = 0.0;
            for (double at = ::ets::string_length(name); (at < ::ets::string_length(text)); (at = (at + 1.0))) {
                if ((::ets::string_charAt(text, at) == std::string("<"))) {
                    (depth = (depth + 1.0));
                }
                if ((::ets::string_charAt(text, at) == std::string(">"))) {
                    (depth = (depth - 1.0));
                    if ((depth == 0.0)) {
                        return ((at == (::ets::string_length(text) - 1.0)) ? name : std::string(""));
                    }
                }
            }
        }
    }
    return std::string("");
}

std::string ets_import_2_memoryInner(std::string text) {
    const std::string mode = ets_import_0_memoryMode(text);
    return ((mode == std::string("")) ? text : ::ets::string_slice(text, (::ets::string_length(mode) + 1.0), (::ets::string_length(text) - 1.0)));
}

std::string ets_import_4_memoryValue(std::string text) {
    std::string result = text;
    while ((ets_import_0_memoryMode(result) != std::string(""))) {
        (result = ets_import_2_memoryInner(result));
    }
    return result;
}

bool ownedType(std::string text) {
    return ((ets_import_0_memoryMode(text) == std::string("ptr")) || (ets_import_0_memoryMode(text) == std::string("constPtr")));
}

bool borrowedType(std::string text) {
    return ((ets_import_0_memoryMode(text) == std::string("ref")) || (ets_import_0_memoryMode(text) == std::string("constRef")));
}

bool readonlyType(std::string text) {
    return ets_includes_vec<std::string>(std::vector<std::string>{std::string("readonly"), std::string("constRef"), std::string("constPtr")}, ets_import_0_memoryMode(text));
}

std::string aggregateElement(std::string element) {
    return ((((functionClose(element) >= 0.0) || (splitTypes(element, std::string("|")).size() > 1.0)) || (splitTypes(element, std::string("&")).size() > 1.0)) ? ets::concat(std::string("("), element, std::string(")")) : element);
}

std::string ungroupElement(std::string element) {
    if ((::ets::string_startsWith(element, std::string("(")) && ::ets::string_endsWith(element, std::string(")")))) {
        double depth = 0.0;
        for (double at = 0.0; (at < ::ets::string_length(element)); (at = (at + 1.0))) {
            if ((::ets::string_charAt(element, at) == std::string("("))) {
                (depth = (depth + 1.0));
            }
            if ((::ets::string_charAt(element, at) == std::string(")"))) {
                (depth = (depth - 1.0));
                if ((depth == 0.0)) {
                    return ((at == (::ets::string_length(element) - 1.0)) ? ::ets::string_slice(element, 1.0, (::ets::string_length(element) - 1.0)) : element);
                }
            }
        }
    }
    return element;
}

std::string semanticArray(std::string element) {
    return ets::concat(aggregateElement(element), std::string("[]"));
}

bool semanticTuple(std::string text) {
    if ((!::ets::string_startsWith(text, std::string("[")))) {
        return false;
    }
    double depth = 0.0;
    for (double at = 0.0; (at < ::ets::string_length(text)); (at = (at + 1.0))) {
        if ((::ets::string_charAt(text, at) == std::string("["))) {
            (depth = (depth + 1.0));
        }
        if ((::ets::string_charAt(text, at) == std::string("]"))) {
            (depth = (depth - 1.0));
            if ((depth == 0.0)) {
                return (at == (::ets::string_length(text) - 1.0));
            }
        }
    }
    return false;
}

std::string semanticElement(std::string text) {
    const std::string element = ::ets::string_slice(text, 0.0, (::ets::string_length(text) - 2.0));
    return ungroupElement(element);
}

double fixedArraySize(std::string text) {
    if (((!::ets::string_endsWith(text, std::string("]"))) || (functionClose(text) >= 0.0))) {
        return (-1.0);
    }
    const double open = ::ets::string_lastIndexOf(text, std::string("["));
    if ((open <= 0.0)) {
        return (-1.0);
    }
    double size = 0.0;
    if (((open + 1.0) == (::ets::string_length(text) - 1.0))) {
        return (-1.0);
    }
    for (double at = (open + 1.0); (at < (::ets::string_length(text) - 1.0)); (at = (at + 1.0))) {
        const double digit = (::ets::string_charCodeAt(text, at) - 48.0);
        if (((digit < 0.0) || (digit > 9.0))) {
            return (-1.0);
        }
        (size = ((size * 10.0) + digit));
    }
    return size;
}

std::string fixedArrayElement(std::string text) {
    const std::string element = ::ets::string_slice(text, 0.0, ::ets::string_lastIndexOf(text, std::string("[")));
    return ungroupElement(element);
}

std::string semanticFixedArray(std::string element, double size) {
    return ets::concat(aggregateElement(element), std::string("["), numberToString(size), std::string("]"));
}

bool containsMemory(std::string text) {
    for (const auto& name : std::vector<std::string>{std::string("ptr"), std::string("constPtr"), std::string("ref"), std::string("constRef"), std::string("readonly")}) {
        if ((::ets::string_indexOf(text, ets::concat(name, std::string("<")), 0.0) >= 0.0)) {
            return true;
        }
    }
    return false;
}

bool localBinding(std::string kind) {
    return ets_includes_vec<std::string>(std::vector<std::string>{std::string("VariableDeclaration"), std::string("UsingDeclaration"), std::string("ArrayBinding"), std::string("ObjectBinding")}, kind);
}

std::string genericBase(std::string text) {
    if ((functionClose(text) >= 0.0)) {
        return std::string("");
    }
    const double open = ::ets::string_indexOf(text, std::string("<"), 0.0);
    if (((open <= 0.0) || (!::ets::string_endsWith(text, std::string(">"))))) {
        return std::string("");
    }
    double depth = 0.0;
    for (double at = open; (at < ::ets::string_length(text)); (at = (at + 1.0))) {
        if ((::ets::string_charAt(text, at) == std::string("<"))) {
            (depth = (depth + 1.0));
        }
        if (((::ets::string_charAt(text, at) == std::string(">")) && (::ets::string_charAt(text, (at - 1.0)) != std::string("=")))) {
            (depth = (depth - 1.0));
            if (((depth == 0.0) && (at != (::ets::string_length(text) - 1.0)))) {
                return std::string("");
            }
        }
    }
    return ((depth == 0.0) ? ::ets::string_slice(text, 0.0, open) : std::string(""));
}

std::vector<std::string> genericArguments(std::string text) {
    const std::string base = genericBase(text);
    if ((base == std::string(""))) {
        std::vector<std::string> empty = std::vector<std::string>();
        return empty;
    }
    return splitTypes(::ets::string_slice(text, (::ets::string_length(base) + 1.0), (::ets::string_length(text) - 1.0)), std::string(","));
}

void ets_init_bootstrap_checker_types_f1a5f64a() {
}
