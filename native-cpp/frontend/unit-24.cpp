// Generated module. Do not edit.
#include "estatic_common.hpp"

double irNumericWidth(std::string text) {
    if (((text == std::string("i8")) || (text == std::string("u8")))) {
        return 8.0;
    }
    if (((text == std::string("i16")) || (text == std::string("u16")))) {
        return 16.0;
    }
    if ((((text == std::string("i32")) || (text == std::string("u32"))) || (text == std::string("f32")))) {
        return 32.0;
    }
    if (((((text == std::string("i64")) || (text == std::string("u64"))) || (text == std::string("f64"))) || (text == std::string("number")))) {
        return 64.0;
    }
    return 0.0;
}

std::string irNumericKind(std::string text) {
    if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("i8"), std::string("u8"), std::string("i16"), std::string("u16"), std::string("i32"), std::string("u32"), std::string("i64"), std::string("u64")}, text)) {
        return std::string("integer");
    }
    if (ets_includes_vec<std::string>(std::vector<std::string>{std::string("number"), std::string("f32"), std::string("f64")}, text)) {
        return std::string("float");
    }
    return std::string("none");
}

bool irNumericSigned(std::string text) {
    return ets_includes_vec<std::string>(std::vector<std::string>{std::string("i8"), std::string("i16"), std::string("i32"), std::string("i64"), std::string("number"), std::string("f32"), std::string("f64")}, text);
}

bool irNumericConstant(std::string raw, bool floating) {
    if (nativeNumericLiteral(raw).valid) {
        return true;
    }
    if ((((!floating) || ::ets::string_startsWith(raw, std::string("0x"))) || ::ets::string_startsWith(raw, std::string("0X")))) {
        return false;
    }
    double split = (-1.0);
    for (double at = 0.0; (at < ::ets::string_length(raw)); (at = (at + 1.0))) {
        if (((::ets::string_charAt(raw, at) == std::string("e")) || (::ets::string_charAt(raw, at) == std::string("E")))) {
            if ((split >= 0.0)) {
                return false;
            }
            (split = at);
        }
    }
    if ((split <= 0.0)) {
        return false;
    }
    const auto mantissa = nativeNumericLiteral(::ets::string_slice(raw, 0.0, split));
    if ((!mantissa.valid)) {
        return false;
    }
    double at = (split + 1.0);
    bool negative = false;
    if (((::ets::string_charAt(raw, at) == std::string("+")) || (::ets::string_charAt(raw, at) == std::string("-")))) {
        (negative = (::ets::string_charAt(raw, at) == std::string("-")));
        (at = (at + 1.0));
    }
    if ((at >= ::ets::string_length(raw))) {
        return false;
    }
    double exponent = 0.0;
    for (; (at < ::ets::string_length(raw)); (at = (at + 1.0))) {
        const double digit = (::ets::string_charCodeAt(raw, at) - 48.0);
        if (((digit < 0.0) || (digit > 9.0))) {
            return false;
        }
        (exponent = ((exponent * 10.0) + digit));
        if ((exponent > 324.0)) {
            return false;
        }
    }
    const double value = (mantissa.value * Math.pow(10.0, (negative ? (-exponent) : exponent)));
    return ((value - value) == 0.0);
}

void ets_init_bootstrap_ir_type_traits_55205947() {
}
