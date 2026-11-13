// Mensajes de catálogo (messages/<idioma>.json). Cada fase sigue escribiendo el
// texto completo en español, que es el respaldo si no hay catálogo, con su
// código delante ("E2001: ...") y los datos para traducirlo en líneas
// "\t nombre=valor" al final. El driver los presenta en el idioma elegido.
export function catalogArg(name: string, value: string): string { return "\n\t" + name + "=" + value; }
// Variante del mensaje: busca "E2001/sugerencia" en el catálogo.
export function catalogVariant(variant: string): string { return catalogArg("_variante", variant); }
// Token encontrado o esperado, para que el catálogo lo describa en cada idioma.
export function tokenArg(name: string, kind: string, lexeme: string): string { return catalogArg(name, "tok:" + kind + ":" + lexeme); }
