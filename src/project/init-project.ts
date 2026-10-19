import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface InitializedProject {
  directory: string;
  files: string[];
}

export interface UpdatedProjectTypes {
  directory: string;
  file: string;
  backup?: string;
  changed: boolean;
}

// Plantilla de tsconfig.json para el proyecto generado. La clave de todo
// el cambio es lib: ["es2022"] y types: []:
//   - lib: [] no funciona: sin un lib mínimo, hasta los tipos globales
//     básicos (Array, Boolean, Number, IArguments) se pierden, y eso
//     rompe los .d.ts que importan string[], unknown[], etc.
//   - lib: ["es2022"] da JS moderno sin DOM, que es lo que queremos.
//   - types: [] excluye @types/node y compañía, que es lo que de
//     verdad no soporta el dialecto (no hay Buffer, __dirname, etc.).
// moduleResolution: "bundler" es lo que usan Vite/Deno y no asume
// resolución estilo Node.
const tsconfigJson = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": [],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowJs": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "types/**/*", "estatic.config.ts"]
}
`;

// La declaración del editor tiene una única fuente de verdad en
// types/estatic.d.ts. `etsc init` y `etsc update-types` leen ese archivo.
function projectTemplates(declarations: string): ReadonlyArray<readonly [string, string]> {
  return [
  ["src/main.ts", `print("Hola desde Estatic");
`],
  ["estatic.config.ts", `// Editores (VSCode/Neovim) usan tsconfig.json + types/estatic.d.ts para
// conocer los built-ins del dialecto (ptr/ref, console, fs, path, process...).
// No necesitas importar nada: los globales están disponibles vía
// \'declare global\' en el .d.ts.
export default {
  entry: "src/main.ts",
  moduleRoots: ["src"],
  aliases: {},
  output: {
    cpp: "build/app.cpp",
    binary: "build/app"
  },
  compiler: {
    enabled: true,
    command: "g++",
    flags: ["-std=c++20", "-O2", "-pthread", "-fno-exceptions", "-ffunction-sections", "-fdata-sections"],
    linkFlags: ["-Wl,--gc-sections", "-Wl,--as-needed", "-s"]
  },
  incremental: {
    enabled: true,
    cacheDirectory: "build/.estatic/cache",
    generatedDirectory: "build/.estatic/generated"
  },
  logging: {
    enabled: true,
    file: "build/.estatic/transpiler-report.json",
    level: "debug"
  }
};
`],
  ["tsconfig.json", tsconfigJson],
  ["types/estatic.d.ts", declarations],
  [".gitignore", `build/
node_modules/
`],
  ["README.md", `# Proyecto Estatic

Compila el proyecto desde este directorio:

\`\`\`bash
etsc --config estatic.config.ts
./build/app
\`\`\`

Durante el desarrollo, si ejecutas el CLI desde el repositorio del compilador:

\`\`\`bash
npm start -- --config /ruta/al/proyecto/estatic.config.ts
\`\`\`

## Soporte del editor

El proyecto incluye:

- \`tsconfig.json\` — configura el editor (VSCode/Neovim) para usar
  \`moduleResolution: "bundler"\` y, sobre todo, \`"lib": ["es2022"]\` y
  \`"types": []\`. Eso evita que tsserver añada APIs de DOM o de Node
  (\`Buffer\`, \`__dirname\`, etc.) que el dialecto no implementa.
- \`types/estatic.d.ts\` — declaraciones de los built-ins del dialecto
  (modificadores de memoria V22 \`ptr<T>\`, \`constPtr<T>\`, \`ref<T>\`,
  \`constRef<T>\`; \`readonly<T>\`; envoltorios \`Optional<T>\`, \`Result\`,
  \`Promise\`, \`Map\`, \`Set\`; handles \`Timer\`, \`FsWatcher\`, red/TLS y
  cancelación; \`fs.*Sync\`, \`path.*\`, \`process.*\`, \`JSON\`, \`Console\`
  y \`console\`; transferidor \`move<T>(x: ptr<T>)\`) y los helpers
  del runtime (\`print\`, \`numberToString\`, helpers de Optional/JsonValue).
  \`declare global\` los expone sin imports.

Para refrescar las declaraciones después de actualizar el compilador:

\`\`\`bash
etsc update-types .
\`\`\`

Si el archivo cambió, el comando conserva antes
\`types/estatic.d.ts.bak\`.

Si tu editor sigue marcando errores sobre tipos del dialecto, abre la
paleta de comandos y elige "TypeScript: Restart TS Server".
`]
];
}

const canonicalTypesPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../types/estatic.d.ts");

export async function readCanonicalEstaticTypes(): Promise<string> {
  return readFile(canonicalTypesPath, "utf8");
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch { return false; }
}

export async function initializeProject(target = "."): Promise<InitializedProject> {
  const directory = resolve(target);
  const templates = projectTemplates(await readCanonicalEstaticTypes());
  const files = templates.map(([relative]) => join(directory, relative));
  const conflicts = (await Promise.all(files.map(async file => ({ file, exists: await exists(file) })))).filter(item => item.exists);
  if (conflicts.length > 0) {
    throw new Error(`No se inicializó el proyecto para no sobrescribir: ${conflicts.map(item => item.file).join(", ")}`);
  }
  for (const [relative, contents] of templates) {
    const file = join(directory, relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents, { encoding: "utf8", flag: "wx" });
  }
  return { directory, files };
}

export async function updateProjectTypes(target = "."): Promise<UpdatedProjectTypes> {
  const directory = resolve(target);
  const file = join(directory, "types", "estatic.d.ts");
  const declarations = await readCanonicalEstaticTypes();
  await mkdir(dirname(file), { recursive: true });

  if (!(await exists(file))) {
    await writeFile(file, declarations, { encoding: "utf8", flag: "wx" });
    return { directory, file, changed: true };
  }

  const current = await readFile(file, "utf8");
  if (current === declarations) return { directory, file, changed: false };

  const backup = `${file}.bak`;
  await writeFile(backup, current, { encoding: "utf8", flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") {
      throw new Error(`No se actualizaron los tipos porque ya existe el respaldo: ${backup}`);
    }
    throw error;
  });
  await writeFile(file, declarations, { encoding: "utf8", flag: "w" });
  return { directory, file, backup, changed: true };
}
