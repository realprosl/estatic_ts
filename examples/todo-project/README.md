# Todo modular

Aplicación de integración para comprobar el dialecto más allá de ejemplos
aislados. Comparte el dominio y la lógica entre una prueba CLI determinista y
un servidor HTTP opcional.

## Qué cubre

- imports y exports entre seis módulos;
- clases, constructores y enums exportados;
- arrays de objetos y estado mutable;
- composición por capas (modelo, repositorio, servicio y presentación);
- validación, bucles, condiciones y resultados de operación;
- backend HTTP Drogon seleccionado con `@cpp_drogon`.

## Prueba local

Desde la raíz del repositorio:

```bash
bash examples/todo-project/run.sh
```

La prueba transpila `main.ets`, compila el C++ y ejecuta ocho comprobaciones.
Debe terminar con:

```text
SUMMARY checks=8 failures=0
```

## Servidor Drogon

Con Drogon y sus dependencias instaladas:

```bash
node --experimental-strip-types src/cli.ts \
  examples/todo-project/server.ets \
  -o build/todo-project-server.cpp

g++ -std=c++20 -O3 -DNDEBUG -pthread -fexceptions -I. \
  -I/usr/include/jsoncpp build/todo-project-server.cpp \
  -ldrogon -ltrantor -ljsoncpp -lssl -lcrypto -lresolv \
  -o build/todo-project-server

./build/todo-project-server
```

Rutas: `GET /health`, `GET /todos`, `GET /stats` y `POST /todos`.

Este proyecto actúa además como regresión para dos errores reparados durante su
desarrollo: importar enums exportados entre módulos y renombrar de forma segura
una variable global `index` que, sin saneamiento, colisionaría con POSIX.
