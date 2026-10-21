import { ParserToken, inspectAst } from "./parser";

// Decimal conversion is only for the host-to-demo token transport.
function decimal(text: string): number {
  let value: number = 0;
  for (let i: number = 0; i < text.length; i = i + 1) value = value * 10 + text.charCodeAt(i) - 48;
  return value;
}
function demonstrateParser(tokens: ParserToken[]): void { print(inspectAst(tokens)); }

const tokens: ParserToken[] = [];
if (argumentCount() == 2 && argument(1) == "--empty") {
  // Exercise the public empty-input contract without selecting the demo.
} else if (argumentCount() > 1) {
  if ((argumentCount() - 1) % 8 != 0) { print("Token transport requires eight fields per token"); exitProcess(2); }
  for (let i: number = 1; i + 7 < argumentCount(); i = i + 8) {
    tokens.push(new ParserToken(argument(i), argument(i + 1), decimal(argument(i + 2)), decimal(argument(i + 3)),
      decimal(argument(i + 4)), decimal(argument(i + 5)), decimal(argument(i + 6)), decimal(argument(i + 7))));
  }
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
