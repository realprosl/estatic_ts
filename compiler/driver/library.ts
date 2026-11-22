// etsc init lib [directorio] (#192): estructura básica de una librería.
//
// Una librería no tiene punto de entrada: cada módulo se importa como
// "<nombre>/<ruta>". Su estatic.config.json da el nombre, alias internos,
// dependencias y flags de enlazado; las versiones son etiquetas git vX.Y.Z.
import { exists, readText, writeText, currentDirectory, hostError } from "../platform/index";
import { exitProcess } from "estatic:process/args";
import { normalizePath } from "estatic:path";

function libraryError(message: string): void { printError(message); exitProcess(1); }

function baseName(path: string): string {
  let text: string = normalizePath(path == "." ? currentDirectory() : path);
  while (text.length > 1 && text.endsWith("/")) text = text.slice(0, text.length - 1);
  return text.slice(text.lastIndexOf("/") + 1, text.length);
}

export function initializeLibrary(root: string, directory: string): void {
  const name: string = baseName(directory);
  let types: string = readText(root + "/types/estatic.d.ts");
  if (types == "") { types = readText(root + "/native-cpp/templates/types/estatic.d.ts"); }
  if (types == "") libraryError("Faltan los tipos del editor (types/estatic.d.ts) en " + root);
  // Las declaraciones de los modulos del runtime (`estatic:*`) van aparte: el
  // .d.ts del nucleo es un modulo y en un modulo TS trata `declare module "x"`
  // como augmentacion, no como declaracion ambiental.
  let moduleTypes: string = readText(root + "/types/estatic-modules.d.ts");
  if (moduleTypes == "") { moduleTypes = readText(root + "/native-cpp/templates/types/estatic-modules.d.ts"); }
  let paths: string[] = ["estatic.config.json", "tsconfig.json", "saludo.ts", "internal/formato.ts", "README.md", ".gitignore", "types/estatic.d.ts"];
  if (moduleTypes != "") paths.push("types/estatic-modules.d.ts");
  let texts: string[] = [];
  texts.push("{\n  \"name\": " + JSON.stringify(name) + ",\n  \"aliases\": {\n    \"@interno\": \"internal\"\n  },\n  \"dependencies\": {},\n  \"compiler\": {\n    \"linkFlags\": []\n  },\n  \"linkLibraries\": []\n}\n");
  texts.push("{\n  \"compilerOptions\": {\n    \"target\": \"ES2022\",\n    \"module\": \"ESNext\",\n    \"moduleResolution\": \"bundler\",\n    \"lib\": [\"es2022\"],\n    \"types\": [],\n    \"strict\": true,\n    \"noEmit\": true,\n    \"skipLibCheck\": true,\n    \"isolatedModules\": true,\n    \"paths\": {\n      \"@interno/*\": [\"./internal/*\"]\n    }\n  },\n  \"include\": [\"**/*.ts\", \"types/**/*\"],\n  \"exclude\": [\".build\", \"build\"]\n}\n");
  texts.push("// Módulo público: quien instale la librería lo importa así:\n//   import { saludar } from \"" + name + "/saludo\";\nimport { enMayusculas } from \"@interno/formato\";\n\nexport function saludar(nombre: string): string {\n  return \"Hola, \" + enMayusculas(nombre);\n}\n");
  texts.push("// Módulo interno: lo usan los demás módulos de la librería con el alias @interno.\nexport function enMayusculas(texto: string): string {\n  return texto.toUpperCase();\n}\n");
  texts.push("# " + name + "\n\nLibrería para Estatic. No tiene punto de entrada: cada módulo se importa por su ruta.\n\n## Usarla en un proyecto\n\n```sh\netsc install <url-de-este-repositorio> 0.1.0\n```\n\n```ts\nimport { saludar } from \"" + name + "/saludo\";\nprint(saludar(\"mundo\"));\n```\n\n## Desarrollarla\n\n- Cada `.ts` de la raíz (o de sus carpetas) es un módulo público: `" + name + "/<ruta>`.\n- `internal/` y el alias `@interno` son para uso interno de la librería.\n- Dependencias: en `dependencies` de `estatic.config.json`, con `{ \"url\": …, \"version\": … }`;\n  se importan por su nombre (`\"otra/modulo\"`). `etsc install` las instala también.\n- Bibliotecas nativas: `compiler.linkFlags` / `linkLibraries`.\n- Comprobar un módulo: `etsc saludo.ts --check --config estatic.config.json`.\n\n## Publicar una versión\n\n```sh\ngit tag v0.1.0 && git push --tags\n```\n");
  texts.push(".build/\nbuild/\n.estatic-cache/\n");
  texts.push(types);
  if (moduleTypes != "") texts.push(moduleTypes);
  for (const path of paths) if (exists(directory + "/" + path)) libraryError("No se sobrescribe " + directory + "/" + path);
  for (let k: number = 0; k < paths.length; k = k + 1) if (!writeText(directory + "/" + paths[k], texts[k])) libraryError(hostError());
  print("✓ Librería '" + name + "' creada en " + directory + "\n  Módulos: " + name + "/saludo (público) · internal/ (@interno)\n  Publica una versión con: git tag v0.1.0 && git push --tags");
}
