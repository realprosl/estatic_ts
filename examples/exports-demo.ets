// exports-demo.ets — Fase 1.15: `export default` y `export { name as alias }`.
//
// Los exports definen la superficie pública del módulo. Un alias exportado
// es un nombre para sus consumidores; no declara otra variable local.

// `export const`: la variable se declara sin `static` (visible global).
export const PI: number = 3.14159;
export const E: number = 2.71828;

// `export function`: igual que una function top-level pero marcada como pública.
export function square(x: number): number { return x * x; }

// `export default function`: la función se publica como default. En runtime
// el dialecto la procesa como una function normal; el codegen emite un
// marcador `// export default:` antes de la declaración.
export default function greet(name: string): string {
  return "hello " + name;
}

// `export { name as alias }`: publica otro nombre para el mismo binding.
// E ya está exportado arriba y no debe publicarse dos veces con ese nombre.
export { PI as PI_RENAMED };
export { square as squareFn };

// Las funciones y variables exportadas se pueden usar normalmente en runtime.
print(PI);
print(E);
print(square(5));
print(greet("alice"));
print(PI);
print(square(7));
