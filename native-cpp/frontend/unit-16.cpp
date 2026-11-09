// Generated module. Do not edit.
#include "estatic_common.hpp"

static inline double numericDigit(std::string c) {
    if ((c == std::string(""))) {
        return (-1.0);
    }
    const double ets_local_index = ::ets::string_indexOf(std::string("0123456789abcdefABCDEF"), c, 0.0);
    return ((ets_local_index >= 16.0) ? (ets_local_index - 6.0) : ets_local_index);
}

static inline std::string decimalAppend(std::string text, double radix, double digit) {
    std::string result = std::string("");
    double carry = digit;
    for (double at = (::ets::string_length(text) - 1.0); (at >= 0.0); (at = (at - 1.0))) {
        const double value = (((::ets::string_charCodeAt(text, at) - 48.0) * radix) + carry);
        (result = ets::concat(::ets::string_charAt(std::string("0123456789"), std::fmod(value, 10.0)), result));
        (carry = Math.floor((value / 10.0)));
    }
    while ((carry > 0.0)) {
        (result = ets::concat(::ets::string_charAt(std::string("0123456789"), std::fmod(carry, 10.0)), result));
        (carry = Math.floor((carry / 10.0)));
    }
    double at = 0.0;
    while ((((at + 1.0) < ::ets::string_length(result)) && (::ets::string_charAt(result, at) == std::string("0")))) {
        (at = (at + 1.0));
    }
    return ::ets::string_slice(result, at, ::ets::string_length(result));
}

std::string nativeIntegerText(std::string raw) {
    if ((!nativeNumericLiteral(raw).valid)) {
        return std::string("");
    }
    double radix = 10.0;
    double at = 0.0;
    const std::string prefix = ::ets::string_charAt(raw, 1.0);
    if ((::ets::string_charAt(raw, 0.0) == std::string("0"))) {
        if (((prefix == std::string("x")) || (prefix == std::string("X")))) {
            (radix = 16.0);
            (at = 2.0);
        } else {
            if (((prefix == std::string("b")) || (prefix == std::string("B")))) {
                (radix = 2.0);
                (at = 2.0);
            } else {
                if (((prefix == std::string("o")) || (prefix == std::string("O")))) {
                    (radix = 8.0);
                    (at = 2.0);
                }
            }
        }
    }
    std::string value = std::string("0");
    bool fraction = false;
    for (; (at < ::ets::string_length(raw)); (at = (at + 1.0))) {
        const std::string c = ::ets::string_charAt(raw, at);
        if ((c == std::string("_"))) {
            continue;
        }
        if ((c == std::string("."))) {
            (fraction = true);
        } else {
            if (fraction) {
                if ((c != std::string("0"))) {
                    return std::string("");
                }
            } else {
                (value = decimalAppend(value, radix, numericDigit(c)));
            }
        }
    }
    return value;
}

std::string nativeInteger64(std::string raw, bool negative, std::string expected) {
    const std::string magnitude = nativeIntegerText(raw);
    if ((magnitude == std::string(""))) {
        return std::string("");
    }
    const std::string limit = ((expected == std::string("u64")) ? std::string("18446744073709551615") : (negative ? std::string("9223372036854775808") : std::string("9223372036854775807")));
    if (((negative && (expected == std::string("u64"))) && (magnitude != std::string("0")))) {
        return std::string("");
    }
    if (((::ets::string_length(magnitude) > ::ets::string_length(limit)) || ((::ets::string_length(magnitude) == ::ets::string_length(limit)) && (::ets::string_localeCompare(magnitude, limit) > 0.0)))) {
        return std::string("");
    }
    return ((negative && (magnitude != std::string("0"))) ? ets::concat(std::string("-"), magnitude) : magnitude);
}

NativeNumericLiteral nativeNumericLiteral(std::string raw) {
    double radix = 10.0;
    double start = 0.0;
    if ((::ets::string_charAt(raw, 0.0) == std::string("0"))) {
        const std::string prefix = ::ets::string_charAt(raw, 1.0);
        if (((prefix == std::string("x")) || (prefix == std::string("X")))) {
            (radix = 16.0);
            (start = 2.0);
        }
        if (((prefix == std::string("b")) || (prefix == std::string("B")))) {
            (radix = 2.0);
            (start = 2.0);
        }
        if (((prefix == std::string("o")) || (prefix == std::string("O")))) {
            (radix = 8.0);
            (start = 2.0);
        }
    }
    double value = 0.0;
    double fraction = 1.0;
    bool point = false;
    double count = 0.0;
    for (double at = start; (at < ::ets::string_length(raw)); (at = (at + 1.0))) {
        const std::string c = ::ets::string_charAt(raw, at);
        if ((c == std::string("_"))) {
            const double before = numericDigit(::ets::string_charAt(raw, (at - 1.0)));
            const double after = numericDigit(::ets::string_charAt(raw, (at + 1.0)));
            if ((((((at == start) || (before < 0.0)) || (before >= radix)) || (after < 0.0)) || (after >= radix))) {
                return NativeNumericLiteral{}.constructor(0.0, false);
            }
        } else {
            if ((((c == std::string(".")) && (radix == 10.0)) && (!point))) {
                if ((((at == start) || (numericDigit(::ets::string_charAt(raw, (at - 1.0))) < 0.0)) || (numericDigit(::ets::string_charAt(raw, (at + 1.0))) < 0.0))) {
                    return NativeNumericLiteral{}.constructor(0.0, false);
                }
                (point = true);
            } else {
                const double digit = numericDigit(c);
                if (((digit < 0.0) || (digit >= radix))) {
                    return NativeNumericLiteral{}.constructor(0.0, false);
                }
                if (point) {
                    (fraction = (fraction / 10.0));
                    (value = (value + (digit * fraction)));
                } else {
                    (value = ((value * radix) + digit));
                }
                (count = (count + 1.0));
            }
        }
    }
    return NativeNumericLiteral{}.constructor(value, ((count > 0.0) && ((value - value) == 0.0)));
}

std::string nativeUnaryPromotion(std::string text) {
    return (ets_includes_vec<std::string>(std::vector<std::string>{std::string("i8"), std::string("u8"), std::string("i16"), std::string("u16")}, text) ? std::string("i32") : text);
}

std::string nativeBinaryPromotion(std::string left, std::string right, std::string op) {
    if (((left == std::string("number")) || (right == std::string("number")))) {
        return std::string("number");
    }
    if (((op == std::string("<<")) || (op == std::string(">>")))) {
        return nativeUnaryPromotion(left);
    }
    if (((left == std::string("f64")) || (right == std::string("f64")))) {
        return std::string("f64");
    }
    if (((left == std::string("f32")) || (right == std::string("f32")))) {
        return std::string("f32");
    }
    const std::string a = nativeUnaryPromotion(left);
    const std::string b = nativeUnaryPromotion(right);
    if ((a == b)) {
        return a;
    }
    if (((a == std::string("u64")) || (b == std::string("u64")))) {
        return std::string("u64");
    }
    if (((a == std::string("i64")) || (b == std::string("i64")))) {
        return std::string("i64");
    }
    return std::string("u32");
}

void ets_init_bootstrap_checker_numeric_99db9de7() {
}
