// literal-type-alias — un literal de string es un tipo dentro de un alias `type`.
// El valor concreto se comprueba al compilar; en el binario es un `string`.

type option = "Hola" | "Adios"

function printSaludo(saludo:option):void{
    print(saludo)
}

printSaludo("Hola");
printSaludo("Adios");

// Un literal ensancha a su primitivo.
const widened:string = "Hola";
print(widened);

// El alias tambien admite literales de number y boolean.
type count = 1 | 2;
type flag = true | false;

const n:count = 1;
const f:flag = false;
print(numberToString(n));

// El runtime imprime los booleanos como 0/1.
if (f) { print(1); } else { print(0); }
