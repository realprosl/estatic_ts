// Generated module. Do not edit.
#include "estatic_common.hpp"

ConstantValue constantError(std::string code, std::string message) {
    auto v = ConstantValue{}.constructor(std::string("error"), code);
    (v.text = message);
    return v;
}

ConstantValue constantNumber(double value, std::string name) {
    auto v = ConstantValue{}.constructor(std::string("number"), name);
    (v.scalar = value);
    return v;
}

ConstantValue constantBoolean(bool value) {
    auto v = ConstantValue{}.constructor(std::string("boolean"), std::string("boolean"));
    (v.scalar = (value ? 1.0 : 0.0));
    return v;
}

ConstantValue constantString(std::string value) {
    auto v = ConstantValue{}.constructor(std::string("string"), std::string("string"));
    (v.text = value);
    return v;
}

ConstantValue constantInteger(std::string text, std::string name) {
    uint64_t bits = static_cast<uint64_t>(0ULL);
    const uint64_t ten = static_cast<uint64_t>(10ULL);
    const uint64_t zero = static_cast<uint64_t>(0ULL);
    for (double at = ((::ets::string_charAt(text, 0.0) == std::string("-")) ? 1.0 : 0.0); (at < ::ets::string_length(text)); (at = (at + 1.0))) {
        (bits = ((bits * ten) + static_cast<uint64_t>((::ets::string_charCodeAt(text, at) - 48.0))));
    }
    if ((::ets::string_charAt(text, 0.0) == std::string("-"))) {
        (bits = (zero - bits));
    }
    auto v = ConstantValue{}.constructor(std::string("integer"), name);
    (v.bits = bits);
    return v;
}

double constantUnsignedDouble(uint64_t value) {
    return value;
}

double constantSignedDouble(int64_t value) {
    return value;
}

std::string constantIntegerText(ConstantValue v) {
    const uint64_t zero = static_cast<uint64_t>(0ULL);
    const uint64_t ten = static_cast<uint64_t>(10ULL);
    const uint64_t sign = static_cast<uint64_t>(9223372036854775808ULL);
    const bool negative = (::ets::string_startsWith(v.typeName, std::string("i")) && ((v.bits & sign) != zero));
    uint64_t bits = (negative ? (zero - v.bits) : v.bits);
    std::string text = std::string("");
    while ((bits != zero)) {
        (text = ets::concat(::ets::string_charAt(std::string("0123456789"), constantUnsignedDouble((bits % ten))), text));
        (bits = (bits / ten));
    }
    if ((text == std::string(""))) {
        (text = std::string("0"));
    }
    return (negative ? ets::concat(std::string("-"), text) : text);
}

ConstantValue constantFloat(ConstantValue v, bool explicitCast) {
    if ((v.kind != std::string("integer"))) {
        return v;
    }
    const uint64_t max = static_cast<uint64_t>(9007199254740991ULL);
    const uint64_t zero = static_cast<uint64_t>(0ULL);
    const uint64_t sign = static_cast<uint64_t>(9223372036854775808ULL);
    const bool negative = (::ets::string_startsWith(v.typeName, std::string("i")) && ((v.bits & sign) != zero));
    const uint64_t magnitude = (negative ? (zero - v.bits) : v.bits);
    if (((!explicitCast) && (magnitude > max))) {
        return constantError(std::string("COMPTIME_INTEGER_PRECISION"), std::string("conversión implícita pierde precisión"));
    }
    return constantNumber((negative ? (-constantUnsignedDouble(magnitude)) : constantUnsignedDouble(magnitude)));
}

ConstantValue constantCast(ConstantValue v, std::string name) {
    if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("number"), std::string("f32"), std::string("f64")}, name)) {
        if (((name == std::string("f32")) && (v.kind == std::string("integer")))) {
            auto f = constantNumber(0.0, std::string("f32"));
            if (::ets::string_startsWith(v.typeName, std::string("i"))) {
                const int64_t input = static_cast<int64_t>(v.bits);
                const float rounded = static_cast<float>(input);
                (f.scalar = rounded);
            } else {
                const float rounded = static_cast<float>(v.bits);
                (f.scalar = rounded);
            }
            return f;
        }
        auto f = constantFloat(v, true);
        if ((f.kind != std::string("number"))) {
            return f;
        }
        if ((name == std::string("f32"))) {
            const float rounded = static_cast<float>(f.scalar);
            (f.scalar = rounded);
        }
        (f.typeName = name);
        return f;
    }
    if ((!ets_includes_vec<std::string>(std::vector<std::string>{std::string("i8"), std::string("u8"), std::string("i16"), std::string("u16"), std::string("i32"), std::string("u32"), std::string("i64"), std::string("u64")}, name))) {
        return v;
    }
    auto result = ConstantValue{}.constructor(std::string("integer"), name);
    const uint64_t zero = static_cast<uint64_t>(0ULL);
    const uint64_t one = static_cast<uint64_t>(1ULL);
    const uint64_t high = static_cast<uint64_t>(9223372036854775808ULL);
    double width = (::ets::string_endsWith(name, std::string("8")) ? 8.0 : (::ets::string_endsWith(name, std::string("16")) ? 16.0 : (::ets::string_endsWith(name, std::string("32")) ? 32.0 : 64.0)));
    const uint64_t mask = ((width == 64.0) ? (~zero) : ((one << static_cast<uint64_t>(width)) - one));
    if ((v.kind == std::string("integer"))) {
        (result.bits = (v.bits & mask));
    } else {
        if ((v.kind == std::string("number"))) {
            if (((v.scalar - v.scalar) != 0.0)) {
                return constantError(std::string("COMPTIME_INTEGER_CAST"), std::string("entero desde un valor no finito"));
            }
            const double truncated = ((v.scalar < 0.0) ? Math.ceil(v.scalar) : Math.floor(v.scalar));
            const double limit = Math.pow(2.0, (::ets::string_startsWith(name, std::string("i")) ? (width - 1.0) : width));
            if (((::ets::string_startsWith(name, std::string("i")) && ((truncated < (-limit)) || (truncated >= limit))) || (::ets::string_startsWith(name, std::string("u")) && ((truncated < 0.0) || (truncated >= limit))))) {
                return constantError(std::string("COMPTIME_INTEGER_CAST_RANGE"), std::string("conversión fuera de rango"));
            }
            (result.bits = ((truncated < 0.0) ? (zero - static_cast<uint64_t>((-truncated))) : static_cast<uint64_t>(truncated)));
            (result.bits = (result.bits & mask));
        } else {
            return constantError(std::string("COMPTIME_INTEGER_CAST"), std::string("valor no numérico"));
        }
    }
    const uint64_t sign = ((width == 64.0) ? high : (one << static_cast<uint64_t>((width - 1.0))));
    if ((::ets::string_startsWith(name, std::string("i")) && ((result.bits & sign) != zero))) {
        (result.bits = (result.bits | (~mask)));
    }
    return result;
}

int32_t constantWord(double value) {
    if (((value - value) != 0.0)) {
        return static_cast<int32_t>(0);
    }
    double truncated = ((value < 0.0) ? Math.ceil(value) : Math.floor(value));
    (truncated = std::fmod(truncated, 4294967296.0));
    if ((truncated < 0.0)) {
        (truncated = (truncated + 4294967296.0));
    }
    if ((truncated >= 2147483648.0)) {
        (truncated = (truncated - 4294967296.0));
    }
    return static_cast<int32_t>(truncated);
}

ConstantValue constantNumeric(ConstantValue left, ConstantValue right, std::string op, std::string name) {
    const bool compare = ets_includes_vec<std::string>(std::vector<std::string>{std::string("=="), std::string("!="), std::string("<"), std::string("<="), std::string(">"), std::string(">=")}, op);
    if (((left.kind == std::string("integer")) && (right.kind == std::string("integer")))) {
        uint64_t a = left.bits;
        uint64_t b = right.bits;
        const uint64_t zero = static_cast<uint64_t>(0ULL);
        const uint64_t one = static_cast<uint64_t>(1ULL);
        const uint64_t high = static_cast<uint64_t>(9223372036854775808ULL);
        const bool isUnsigned = ::ets::string_startsWith(name, std::string("u"));
        if (compare) {
            bool yes = false;
            if ((op == std::string("=="))) {
                (yes = (a == b));
            } else {
                if ((op == std::string("!="))) {
                    (yes = (a != b));
                } else {
                    if (isUnsigned) {
                        if ((op == std::string("<"))) {
                            (yes = (a < b));
                        } else {
                            if ((op == std::string("<="))) {
                                (yes = (a <= b));
                            } else {
                                if ((op == std::string(">"))) {
                                    (yes = (a > b));
                                } else {
                                    (yes = (a >= b));
                                }
                            }
                        }
                    } else {
                        const int64_t x = static_cast<int64_t>(a);
                        const int64_t y = static_cast<int64_t>(b);
                        if ((op == std::string("<"))) {
                            (yes = (x < y));
                        } else {
                            if ((op == std::string("<="))) {
                                (yes = (x <= y));
                            } else {
                                if ((op == std::string(">"))) {
                                    (yes = (x > y));
                                } else {
                                    (yes = (x >= y));
                                }
                            }
                        }
                    }
                }
            }
            return constantBoolean(yes);
        }
        uint64_t bits = zero;
        const bool aSign = ((a & high) != zero);
        const bool bSign = ((b & high) != zero);
        if (((op == std::string("+")) || (op == std::string("-")))) {
            (bits = ((op == std::string("+")) ? (a + b) : (a - b)));
            if ((((!isUnsigned) && ((op == std::string("+")) ? (aSign == bSign) : (aSign != bSign))) && (((bits & high) != zero) != aSign))) {
                return constantError(std::string("COMPTIME_INTEGER_OVERFLOW"), std::string("desbordamiento firmado"));
            }
        } else {
            if ((op == std::string("*"))) {
                const uint64_t x = ((aSign && (!isUnsigned)) ? (zero - a) : a);
                const uint64_t y = ((bSign && (!isUnsigned)) ? (zero - b) : b);
                const uint64_t limit = ((aSign != bSign) ? high : (high - one));
                if ((((!isUnsigned) && (y != zero)) && (x > (limit / y)))) {
                    return constantError(std::string("COMPTIME_INTEGER_OVERFLOW"), std::string("multiplicación fuera de rango"));
                }
                (bits = (a * b));
            } else {
                if (((op == std::string("/")) || (op == std::string("%")))) {
                    if ((b == zero)) {
                        return constantError(std::string("COMPTIME_INTEGER_DIVISION_ZERO"), std::string("división por cero"));
                    }
                    if ((((!isUnsigned) && (a == high)) && (b == (~zero)))) {
                        return constantError(std::string("COMPTIME_INTEGER_OVERFLOW"), std::string("división o resto fuera de rango"));
                    } else {
                        if (isUnsigned) {
                            (bits = ((op == std::string("/")) ? (a / b) : (a % b)));
                        } else {
                            const int64_t x = static_cast<int64_t>(a);
                            const int64_t y = static_cast<int64_t>(b);
                            const int64_t quotient = ((op == std::string("/")) ? (x / y) : (x % y));
                            (bits = static_cast<uint64_t>(quotient));
                        }
                    }
                } else {
                    if ((op == std::string("&"))) {
                        (bits = (a & b));
                    } else {
                        if ((op == std::string("|"))) {
                            (bits = (a | b));
                        } else {
                            if ((op == std::string("^"))) {
                                (bits = (a ^ b));
                            } else {
                                if (((op == std::string("<<")) || (op == std::string(">>")))) {
                                    const uint64_t maxShift = static_cast<uint64_t>((((name == std::string("i64")) || (name == std::string("u64"))) ? 64.0 : 32.0));
                                    if ((b >= maxShift)) {
                                        return constantError(std::string("COMPTIME_INTEGER_SHIFT"), std::string("desplazamiento fuera de rango"));
                                    }
                                    if ((op == std::string("<<"))) {
                                        (bits = (a << b));
                                    } else {
                                        if (isUnsigned) {
                                            (bits = (a >> b));
                                        } else {
                                            const int64_t signedValue = static_cast<int64_t>(a);
                                            (bits = (signedValue >> static_cast<int64_t>(b)));
                                        }
                                    }
                                } else {
                                    return constantError(std::string("COMPTIME_UNSUPPORTED"), ets::concat(std::string("operador entero "), op));
                                }
                            }
                        }
                    }
                }
            }
        }
        if (((name == std::string("i32")) && ets_includes_vec<std::string>(std::vector<std::string>{std::string("+"), std::string("-"), std::string("*"), std::string("/"), std::string("%")}, op))) {
            const int64_t signedResult = static_cast<int64_t>(bits);
            const int64_t minimum = static_cast<int64_t>(-2147483648LL);
            const int64_t maximum = static_cast<int64_t>(2147483647LL);
            if (((signedResult < minimum) || (signedResult > maximum))) {
                return constantError(std::string("COMPTIME_INTEGER_OVERFLOW"), std::string("Aritmética i32 fuera de rango"));
            }
        }
        auto result = ConstantValue{}.constructor(std::string("integer"), name);
        (result.bits = bits);
        return constantCast(result, name);
    }
    const auto x = constantFloat(left, false);
    const auto y = constantFloat(right, false);
    if ((x.kind == std::string("error"))) {
        return x;
    }
    if ((y.kind == std::string("error"))) {
        return y;
    }
    const double a = x.scalar;
    const double b = y.scalar;
    if (compare) {
        if ((op == std::string("=="))) {
            return constantBoolean((a == b));
        }
        if ((op == std::string("!="))) {
            return constantBoolean((a != b));
        }
        if ((op == std::string("<"))) {
            return constantBoolean((a < b));
        }
        if ((op == std::string("<="))) {
            return constantBoolean((a <= b));
        }
        if ((op == std::string(">"))) {
            return constantBoolean((a > b));
        }
        return constantBoolean((a >= b));
    }
    if ((((op == std::string("/")) || (op == std::string("%"))) && (b == 0.0))) {
        return constantError(std::string("COMPTIME_FLOAT_DIVISION_ZERO"), std::string("división por cero"));
    }
    double value = 0.0;
    if ((op == std::string("+"))) {
        (value = (a + b));
    } else {
        if ((op == std::string("-"))) {
            (value = (a - b));
        } else {
            if ((op == std::string("*"))) {
                (value = (a * b));
            } else {
                if ((op == std::string("/"))) {
                    (value = (a / b));
                } else {
                    if ((op == std::string("%"))) {
                        (value = std::fmod(a, b));
                    } else {
                        if ((op == std::string("**"))) {
                            (value = Math.pow(a, b));
                        } else {
                            if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("&"), std::string("|"), std::string("^"), std::string("<<"), std::string(">>")}, op)) {
                                const int32_t l = constantWord(a);
                                const int32_t r = constantWord(b);
                                int32_t result = static_cast<int32_t>(0);
                                const int32_t shift = static_cast<int32_t>((static_cast<std::int64_t>(r) & static_cast<std::int64_t>(31.0)));
                                if ((op == std::string("&"))) {
                                    (result = (l & r));
                                } else {
                                    if ((op == std::string("|"))) {
                                        (result = (l | r));
                                    } else {
                                        if ((op == std::string("^"))) {
                                            (result = (l ^ r));
                                        } else {
                                            if ((op == std::string("<<"))) {
                                                (result = (l << shift));
                                            } else {
                                                (result = (l >> shift));
                                            }
                                        }
                                    }
                                }
                                (value = constantSignedDouble(static_cast<int64_t>(result)));
                            } else {
                                return constantError(std::string("COMPTIME_UNSUPPORTED"), ets::concat(std::string("operador numérico "), op));
                            }
                        }
                    }
                }
            }
        }
    }
    return constantCast(constantNumber(value), name);
}

void ets_init_bootstrap_checker_constant_10a3e67c() {
}
