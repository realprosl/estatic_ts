// check-ref-parity.ts — verifica que el CONTRATO DE PASO DE OBJETOS sea el
// mismo en stage 0 (`src/`) y en el frontend nativo (`bootstrap/ir`).
//
// El dialecto promete una sola semántica de paso, dé el pipeline que se use:
//
//   ref<T>       ->  T&                   (préstamo mutable)
//   constRef<T>  ->  const T&             (préstamo readonly)
//   out T        ->  T&
//   ptr<T>       ->  std::unique_ptr<T>   (ownership exclusivo)
//   constPtr<T>  ->  std::unique_ptr<const T>
//   T            ->  T                    (copia)
//
// Que sea la MISMA semántica es lo que hace que el dialecto sea un dialecto y
// no dos. Esta comprobación compara el observable —la forma del parámetro en
// la firma C++— no el texto: los dos backends emiten C++ estructuralmente
// distinto (`struct Counter` + `static inline` en stage 0; `ir_t2` + `ir_f0`
// en el nativo).
//
// Uso:  node --experimental-strip-types scripts/check-ref-parity.ts
// Salida: exit 0 si los contratos coinciden; exit 1 + lista si divergen.
//
// OJO — esta comprobación es TRANSITORIA y por eso NO está en `npm test`.
// `src/` existe hoy únicamente para compilar `bootstrap/`: cuando el
// compilador nativo sea el único que evoluciona, la paridad dejará de ser un
// invariante y este script debe dejar de usarse. Es una comprobación manual
// mientras ambos pipelines conviven.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { nativeIr, buildIrFrontend } from "../bootstrap/ir/cpp.ts";
import { generateCppFromIr } from "../src/codegen/ir/cpp-generator.ts";
import { compile } from "../src/compiler.ts";

// kind esperado -> (nombre de la funcion, tipo declarado)
const FIXTURE: { fn: string; declared: string; expected: string }[] = [
  { fn: "muta", declared: "ref<Counter>", expected: "ref" },
  { fn: "lee", declared: "constRef<Counter>", expected: "constRef" },
  { fn: "copia", declared: "Counter", expected: "value" },
  { fn: "toma", declared: "ptr<Counter>", expected: "ptr" },
  { fn: "tomaConst", declared: "constPtr<Counter>", expected: "constPtr" },
  { fn: "rellena", declared: "out Counter", expected: "ref" }
];

const SOURCE = [
  "class Counter{value:number;constructor(v:number){this.value=v;}}",
  "function muta(c:ref<Counter>):void{c.value=c.value+1;}",
  "function lee(c:constRef<Counter>):number{return c.value;}",
  "function copia(c:Counter):number{return c.value;}",
  "function toma(p:ptr<Counter>):number{return p.value;}",
  "function tomaConst(p:constPtr<Counter>):number{return p.value;}",
  "function rellena(out c:Counter):void{c.value=7;}",
  "function main():void{let c=new Counter(1);muta(c);print(lee(c));print(copia(c));}"
].join("\n");

// Clasifica el tipo C++ de un parámetro en su categoría de paso.
function classify(text: string): string {
  // El texto del parámetro incluye su nombre (`const Counter& c`); el tipo
  // es lo que hay antes.
  const t = text.trim().replace(/\s+[A-Za-z_]\w*$/, "");
  if (/^const\s+std::unique_ptr</.test(t)) return "constPtr";
  if (/^std::unique_ptr</.test(t)) return /^std::unique_ptr<const\s/.test(t) ? "constPtr" : "ptr";
  if (/^const\s+[A-Za-z_][\w:<>]*&$/.test(t)) return "constRef";
  if (/&/.test(t)) return "ref";
  return "value";
}

// Extrae la categoría de paso del primer parámetro de una firma.
function parameterKind(cpp: string, matcher: RegExp): string | undefined {
  const m = cpp.match(matcher);
  if (!m) return undefined;
  const params = m[1].split(",").map(s => s.trim()).filter(Boolean);
  if (!params.length) return undefined;
  return classify(params[0]);
}

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "estatic-ref-parity-"));
  try {
    const entry = join(directory, "main.ets");
    writeFileSync(entry, SOURCE);

    // Stage 0: el compilador de referencia que hoy compila `bootstrap/`.
    const stage0 = compile(SOURCE).cpp;

    // Nativo: el frontend de `bootstrap/ir` lowered a C++.
    const project = nativeIr(await buildIrFrontend(), entry);
    const native = generateCppFromIr(project).cpp;

    const index = new Map<string, number>();
    project.functions.forEach((fn: { name: string }, i: number) => index.set(fn.name, i));

    const failures: string[] = [];
    for (const { fn, declared, expected } of FIXTURE) {
      const slot = index.get(fn);
      if (slot === undefined) {
        failures.push(`${fn}: no aparece en el IR nativo`);
        continue;
      }
      const stage0Kind = parameterKind(stage0, new RegExp(`(?:static inline\\s+)?[A-Za-z_][\\w:<>,\\s&]*?\\b${fn}\\(([^)]*)\\)\\s*\\{`));
      const nativeKind = parameterKind(native, new RegExp(`\\bir_f${slot}\\(([^)]*)\\)\\s*\\{`));
      if (stage0Kind === undefined) failures.push(`${fn}: no se encontró la firma en stage 0`);
      else if (stage0Kind !== expected) failures.push(`${fn}(${declared}): stage 0 emite '${stage0Kind}', se esperaba '${expected}'`);
      if (nativeKind === undefined) failures.push(`${fn}: no se encontró la firma en el C++ nativo`);
      else if (nativeKind !== expected) failures.push(`${fn}(${declared}): el nativo emite '${nativeKind}', se esperaba '${expected}'`);
      if (stage0Kind !== undefined && nativeKind !== undefined && stage0Kind !== nativeKind) {
        failures.push(`${fn}(${declared}): divergencia stage 0 '${stage0Kind}' vs nativo '${nativeKind}'`);
      }
    }

    if (failures.length) {
      console.error("El contrato de paso NO coincide entre stage 0 y el frontend nativo:");
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Contrato de paso coherente en los ${FIXTURE.length} modificadores (stage 0 y nativo).`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

await main();
