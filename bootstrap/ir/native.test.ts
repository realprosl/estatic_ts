// Run the same behavioral suite against the compiled native compiler.
import {buildNativeCompiler} from "../build/native-compiler.ts";
const compiler=buildNativeCompiler();
process.env.ESTATIC_NATIVE_CODEGEN=compiler;
process.env.ESTATIC_NATIVE_BUILD=compiler;
await import("./cpp.test.ts");
