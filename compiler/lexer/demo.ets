import { inspectTokens } from "./lexer";

function demonstrateLexer(source: string): void {
  print(inspectTokens(source));
}

const source: string = argumentCount() > 1 ? argument(1) : "const answer: number = 42;\nprint(answer);";
demonstrateLexer(source);
