console.color("cyan");
console.style("bold");
console.writeLine("Terminal desde ETS");
console.reset();
console.writeLine(`Columnas: ${console.columns()}, filas: ${console.rows()}`);
console.writeLine(`TTY: ${console.isTTY()}, ANSI: ${console.supportsAnsi()}`);
console.flush();
