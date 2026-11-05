import { tokenizeExpanded } from "../lexer/lexer";
import { Parser, ParserToken } from "../parser/parser";
import { readSnapshot } from "../modules/platform";
function run(): void {
  const snapshot: string[] = readSnapshot(argument(1));
  if (snapshot[1] != "") { printError(snapshot[1]); exitProcess(2); }
  const lexical = tokenizeExpanded(snapshot[0]);
  let tokens: ParserToken[] = [];
  for (const token of lexical.tokens) {
    tokens.push(new ParserToken(token.kind, token.lexeme, token.offset, token.line, token.column,
      token.endOffset, token.endLine, token.endColumn));
  }
  const rawLimit: string = argument(2);
  let limit: number = 0;
  for (let digit: number = 0; digit < rawLimit.length; digit = digit + 1) {
    const code: number = rawLimit.charCodeAt(digit);
    if (code < 48 || code > 57) exitProcess(2);
    limit = limit * 10 + code - 48;
  }
  let sample: ParserToken[] = [];
  let count: number = 0;
  for (const token of tokens) {
    if (count >= limit || token.kind == "eof") break;
    sample.push(token);
    count = count + 1;
  }
  const last: ParserToken = sample[sample.length - 1];
  sample.push(new ParserToken("eof", "", last.endOffset, last.endLine, last.endColumn,
    last.endOffset, last.endLine, last.endColumn));
  const mode: string = argument(3);
  if (mode == "length") {
    printError("BENCH length BEGIN tokens=" + numberToString(sample.length));
    let total: number = 0;
    for (let i: number = 0; i < count; i = i + 1) total = total + sample.length;
    printError("BENCH length END tokens=" + numberToString(sample.length) + " checksum=" + numberToString(total));
    return;
  }
  if (mode == "index") {
    printError("BENCH index BEGIN tokens=" + numberToString(sample.length));
    let total: number = 0;
    for (let i: number = 0; i < count; i = i + 1) total = total + sample[i].offset;
    printError("BENCH index END tokens=" + numberToString(sample.length) + " checksum=" + numberToString(total));
    return;
  }
  printError("BENCH constructor BEGIN tokens=" + numberToString(sample.length));
  const parser: Parser = new Parser(sample);
  printError("BENCH constructor END tokens=" + numberToString(parser.tokens.length)
    + " diagnostics=" + numberToString(parser.diagnostics.length));
}
run();
