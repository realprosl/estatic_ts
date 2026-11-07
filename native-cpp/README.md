# native-cpp — compilador Estatic en C++20

Instantánea de fuentes C++ obtenida compilando `bootstrap/ir/demo.ets`
y sus dependencias mediante el compilador de referencia `src/` (stage 0).
No contiene fuentes `.ets`, código TypeScript ejecutable ni binarios precompilados.

En Linux, con G++ C++20 y OpenSSL de desarrollo:

```bash
bash ./build-all.sh
export ESTC_ROOT="$(pwd)"
./native/etsc build /ruta/proyecto/main.ets --no-progress
```

`native/frontend` analiza fuentes Estatic y emite IR verificado.
`native/etsc` es el driver/backend C++ que genera y compila programas.
Ambos se reconstruyen exclusivamente desde este directorio.
Para compilar programas se requieren sus fuentes de entrada, pero no Node.

La Action `regenerate-native-cpp.yml` genera este árbol, lo empaqueta,
reconstruye y prueba los ejecutables desde el artefacto descargado,
y solo entonces publica la instantánea en la rama de trabajo.
