import { ParserToken, inspectAst } from "./parser";

// Decimal conversion is only for the host-to-demo token transport.
function decimal(text: string): number {
  if (text.length == 0) badTransport();
  let value: number = 0;
  for (let i: number = 0; i < text.length; i = i + 1) {
    const code: number = text.charCodeAt(i); if (code < 48 || code > 57) badTransport();
    value = value * 10 + code - 48; if (value > 2147483647) badTransport();
  }
  return value;
}
function badTransport(): void { print("Invalid token transport"); exitProcess(2); }
function decodeToken(record: string): ParserToken {
  let values: string[] = []; let cursor: number = 0;
  for (let field: number = 0; field < 8; field = field + 1) {
    const colon: number = record.indexOf(":", cursor); if (colon <= cursor) badTransport();
    const size: number = decimal(record.slice(cursor, colon));
    cursor = colon + 1; if (size > record.length - cursor) badTransport();
    values.push(record.slice(cursor, cursor + size)); cursor = cursor + size;
  }
  if (cursor != record.length) badTransport();
  return new ParserToken(values[0], values[1], decimal(values[2]), decimal(values[3]), decimal(values[4]),
    decimal(values[5]), decimal(values[6]), decimal(values[7]));
}
function demonstrateParser(tokens: ParserToken[]): void { print(inspectAst(tokens)); }

const tokens: ParserToken[] = [];
if (argumentCount() == 2 && argument(1) == "--empty") {
  // Exercise the public empty-input contract without selecting the demo.
} else if (argumentCount() > 1) {
  if (argument(1) != "--tokens") badTransport();
  for (let i: number = 2; i < argumentCount(); i = i + 1) tokens.push(decodeToken(argument(i)));
} else {
  tokens.push(new ParserToken("number", "1", 0, 1, 1, 1, 1, 2));
  tokens.push(new ParserToken("+", "+", 2, 1, 3, 3, 1, 4));
  tokens.push(new ParserToken("number", "2", 4, 1, 5, 5, 1, 6));
  tokens.push(new ParserToken("*", "*", 6, 1, 7, 7, 1, 8));
  tokens.push(new ParserToken("number", "3", 8, 1, 9, 9, 1, 10));
  tokens.push(new ParserToken(";", ";", 9, 1, 10, 10, 1, 11));
  tokens.push(new ParserToken("eof", "", 10, 1, 11, 10, 1, 11));
}
demonstrateParser(tokens);
