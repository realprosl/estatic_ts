import { tokenizeExpanded } from "../../bootstrap/lexer/lexer";
import { Parser, ParserToken } from "../../bootstrap/parser/parser";
import { readSnapshot } from "../../bootstrap/modules/platform";
class IndexedScan {
  items: ParserToken[];
  constructor(items: ParserToken[]) { this.items = items; }
  scan(): number {
    let sum: number = 0;
    for (let i: number = 0; i < this.items.length; i = i + 1) sum = sum + this.items[i].offset;
    return sum;
  }
}
function run(): void {
  const snapshot: string[] = readSnapshot(argument(1));
  if (snapshot[1] != "") { printError(snapshot[1]); exitProcess(2); }
  const lexical = tokenizeExpanded(snapshot[0]);
  let limit: number = 0;
  const raw: string = argument(2);
  for (let i: number = 0; i < raw.length; i = i + 1) limit = limit * 10 + raw.charCodeAt(i) - 48;
  let sample: ParserToken[] = [];
  for (const token of lexical.tokens) {
    if (sample.length >= limit || token.kind == "eof") break;
    sample.push(new ParserToken(token.kind, token.lexeme, token.offset, token.line, token.column,
      token.endOffset, token.endLine, token.endColumn));
  }
  const last: ParserToken = sample[sample.length - 1];
  sample.push(new ParserToken("eof", "", last.endOffset, last.endLine, last.endColumn,
    last.endOffset, last.endLine, last.endColumn));
  printError("TOKENS " + numberToString(sample.length));
  printError("BENCH constructor BEGIN");
  for (let trial: number = 0; trial < 20; trial = trial + 1) {
    const parser: Parser = new Parser(sample);
    if (parser.diagnostics.length != 0) { printError("Invalid token diagnostics"); exitProcess(1); }
  }
  printError("BENCH constructor END");
  const scan: IndexedScan = new IndexedScan(sample);
  let sum: number = 0;
  printError("BENCH indexed BEGIN");
  for (let trial: number = 0; trial < 20; trial = trial + 1) sum = sum + scan.scan();
  printError("BENCH indexed END");
  print(numberToString(sum));
}
run();
