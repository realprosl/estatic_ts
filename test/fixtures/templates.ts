// Expected delimiters are checked independently of either lexer implementation.
export const templateCases: readonly (readonly [string, string])[] = [
  ["nested object and template", '`outer ${({value:`inner ${({name:1}).name}`}).value} end`'],
  ["backticks and open interpolation in string", '`${"} ` ${"}`'],
  ["single quoted punctuation", "`${' } ` ${ '}`"],
  ["block comment punctuation", '`${1 /* } ` ${ { */ + 2}`'],
  ["line comment punctuation", '`${1 // } ` ${ {\n + 2}`'],
  ["nested template after string brace", '`${({a:"}",b:`nested ${value}`}).b}`'],
  ["nested template after comment brace", '`${1 /* } */ + `nested ${value}`}`'],
  ["nested empty templates", '`${``}${`x`}`'],
  ["nested escaped interpolation", '`a ${`b \\${literal} ${value}`} c`'],
  ["escaped quotes and punctuation", '`${"\\\"} ` ${"}`'],
  ["nested multiline unicode", '`🙂\n${({value:`España\n${name}`}).value}\n漢字`'],
  ["multiple nested expressions", '`head ${`a${first}`} middle ${`b${second}`} tail`'],
];

export const invalidTemplateCases: readonly (readonly [string, string, string])[] = [
  ["unterminated outer", '`open', "Template sin cerrar"],
  ["unterminated interpolation", '`open ${value', "Interpolación sin cerrar"],
  ["unterminated nested", '`outer ${`inner', "Template sin cerrar"],
  ["unterminated interpolation string", '`${"open}', "Cadena sin cerrar en interpolación"],
  ["newline in interpolation string", '`${"first\nsecond"}`', "Cadena sin cerrar en interpolación"],
  ["unterminated interpolation comment", '`${1 /* } `', "Comentario sin cerrar en interpolación"],
  ["trailing template escape", '`trailing\\', "Template sin cerrar"],
];
