import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { root, buildLoader } from "../modules/build.ts";
import { compile } from "../../src/compiler.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";

const schema = readFileSync(join(root, "bootstrap/parser/ast-schema.ets"), "utf8");
const parser = readFileSync(join(root, "bootstrap/parser/parser.ets"), "utf8").replace(/^import .*\n/, "");
const vocabularies = [
  ["NodeKind", "nodeKindName", "parseNodeKind"],
  ["EdgeRole", "edgeRoleName", "parseEdgeRole"],
  ["AttributeKind", "attributeKindName", "parseAttributeKind"]
] as const;
const directory = mkdtempSync(join(root, "build-ast-schema-test-"));
const entry = join(directory, "main.ets");
let binary: string;
const checks: string[] = [];
for (const [type, name, parse] of vocabularies) {
  const members = new RegExp(`export enum ${type} \\{([^}]+)\\}`).exec(schema)![1]
    .split(",").map(member => member.trim()).filter(member => member !== "Invalid");
  for (const member of members) checks.push(`print(${parse}(${name}(${type}.${member})) == ${type}.${member});`);
  checks.push(`print(${parse}("") == ${type}.Invalid);`);
  checks.push(`print(${parse}("unknown-category") == ${type}.Invalid);`);
  checks.push(`print(${name}(${type}.Invalid) == "");`);
}
before(async () => {
  writeFileSync(entry, `import { ${vocabularies.flat().join(", ")} } from "../bootstrap/parser/ast-schema";\n${checks.join("\n")}\n`);
  binary = await buildLoader(join(directory, "binary"), relative(root, entry), true);
});
after(() => rmSync(directory, { recursive: true, force: true }));

test("AST schema: all enum names round-trip in native C++ and unknown names stay invalid", () => {
  const output = execFileSync(binary, [], { encoding: "utf8", timeout: 15000 });
  assert.deepEqual(output.trim().split(/\r?\n/), checks.map(() => "1"));
});

for (const [name, source] of [
  ["raw node kind", 'const n: NodeKind = "Program";'],
  ["raw edge role", 'const e: EdgeRole = "initializer";'],
  ["raw attribute name", 'const a: AttributeKind = "name";'],
  ["unknown node member", "const n: NodeKind = NodeKind.Progam;"],
  ["unknown edge member", "const e: EdgeRole = EdgeRole.Initilizer;"],
  ["mixed enum categories", "const n: NodeKind = EdgeRole.Body;"],
  ["node constructor", 'const t = new ParserToken("eof","",0,1,1,0,1,1); const n = new AstNode("Program",t,t);'],
  ["edge constructor", 'const e = new AstEdge("initializer",0);'],
  ["attribute constructor", 'const a = new AstAttribute("name","x");'],
  ["attribute accessor", 'const t = new ParserToken("eof","",0,1,1,0,1,1); const n = new AstNode(NodeKind.Program,t,t); n.get("name");']
]) test(`AST schema rejects ${name}`, () => {
  assert.throws(() => compile(`${schema}\n${parser}\n${source}`), DiagnosticError);
});
