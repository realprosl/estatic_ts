@include("experiments/cpp-native/console.hpp")
@cpp_native("ets_native::print")
export function print(text: string): void;
