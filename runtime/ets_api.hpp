#pragma once

// Runtime en declaraciones (.hpp) + implementación (.cpp) (#377).
//
// Con -DETS_RUNTIME_PRECOMPILED (lo pone etsc), las cabeceras divididas solo
// declaran: las unidades del programa no vuelven a compilar la implementación
// ni sus plantillas. Los .cpp se compilan una vez a un archivo .a, del que el
// enlazador saca solo lo que se usa.
//
// Sin la macro (etapa 0, scripts, tests que compilan C++ a mano) cada cabecera
// incluye sus .cpp al final y ETS_API vale `inline`: todo sigue siendo
// header-only, igual que antes.
#if defined(ETS_RUNTIME_PRECOMPILED)
#define ETS_API
#else
#define ETS_API inline
#endif
