@include("experiments/cpp-native/e2e.hpp")
@cpp_native("ets_native::add")
export function nativeAdd(a: number, b: number): number;

@cpp_native("ets_native::greet")
export function nativeGreet(name: string): string;

@cpp_native("ets_native::checked_label")
export function nativeCheckedLabel(value: number): string;
