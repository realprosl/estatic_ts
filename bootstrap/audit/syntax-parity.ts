import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Lexer} from '../../src/lexer/lexer.ts';
import {Parser} from '../../src/parser/parser.ts';
import {loadModuleGraph} from '../../src/modules/module-loader.ts';
import {buildLoader,root} from '../modules/build.ts';
import {syntaxCases} from './syntax-cases.ts';

const write=process.argv.includes('--write');
if(process.argv.slice(2).some(arg=>arg!=='--write'))throw new Error('Usage: audit:bootstrap:syntax [--write]');
const directory=mkdtempSync(join(root,'build-syntax-parity-'));
function diagnostics(error:unknown):string[]{const e=error as {diagnostics?:{message:string}[];message?:string};return e.diagnostics?.map(d=>d.message)??[e.message??String(error)];}
async function stage0(entry:string,baseDirectory:string):Promise<void>{const graph=await loadModuleGraph(entry,{baseDirectory});for(const module of graph.modules)new Parser(new Lexer(module.source).tokenize()).parseProgram();}
function direct(source:string):boolean{try{new Parser(new Lexer(source).tokenize()).parseProgram();return true;}catch{return false;}}
try {
  const binary=await buildLoader(join(directory,'binary'),'bootstrap/frontend/demo.ets',true);
  const pairs=syntaxCases.flatMap(c=>Object.entries({'main.ets':c.source,...c.files}).flatMap(([file,source])=>[source,`${c.id}/${file}`]));
  const native=spawnSync(binary,pairs,{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024});
  if(native.error)throw native.error;if(native.status!==0)throw new Error(native.stderr);
  const parsed=new Map<string,{success:boolean;diagnostics:{message:string}[]}>(native.stdout.trim().split('\n').map(line=>{const result=JSON.parse(line);return[result.file,result];}));
  const results=[];
  for(const c of syntaxCases){
    const folder=join(directory,c.id);for(const[file,source]of Object.entries({'main.ets':c.source,...c.files})){mkdirSync(dirname(join(folder,file)),{recursive:true});writeFileSync(join(folder,file),source);}
    let old=true,oldDiagnostics:string[]=[];try{await stage0(join(folder,'main.ets'),folder);}catch(error){old=false;oldDiagnostics=diagnostics(error);}
    const files=Object.keys({'main.ets':c.source,...c.files});const nativeResults=files.map(file=>parsed.get(`${c.id}/${file}`)!);
    if(nativeResults.some(r=>!r))throw new Error(`Missing native parse result: ${c.id}`);
    const current=nativeResults.every(r=>r.success),nativeDiagnostics=nativeResults.flatMap(r=>r.diagnostics.map(d=>d.message));
    const status=old?(current?'conservada':'rechazo nativo'):(current?'adición nativa':'rechazada en ambos');
    const passed=current===c.native&&!(old&&!current);
    results.push({id:c.id,area:c.area,stage0Direct:direct(c.source),stage0:old,native:current,status,passed,oldDiagnostics,nativeDiagnostics,note:c.note??''});
    console.log(`${passed?'PASS':'GAP'} ${c.id}: ${old?'TS acepta':'TS rechaza'} / ${current?'ETS acepta':'ETS rechaza'}`);
  }
  // Real examples use the full old module loader. Native parsing checks every
  // physical file independently; name/type errors belong to the checker audit.
  const examples=readdirSync(join(root,'examples'),{recursive:true}).map(String).filter(f=>f.endsWith('.ets')).sort();
  let oldExamples=0,nativeExamples=0;const exampleGaps=[];
  for(const file of examples){const source=readFileSync(join(root,'examples',file),'utf8');let old=true;try{await stage0(join(root,'examples',file),root);}catch{old=false;}
    const run=spawnSync(binary,[source,file],{encoding:'utf8',timeout:15000,maxBuffer:16*1024*1024});if(run.error)throw run.error;if(run.status!==0)throw new Error(run.stderr);
    const current=JSON.parse(run.stdout).success;if(old)oldExamples++;if(current)nativeExamples++;if(old&&!current)exampleGaps.push(file);
  }
  const report={cases:results.length,passed:results.filter(r=>r.passed).length,results,examples:{files:examples.length,stage0:oldExamples,native:nativeExamples,removed:exampleGaps}};
  const additions=results.filter(r=>!r.stage0&&r.native).map(r=>r.id);
  const removals=results.filter(r=>r.stage0&&!r.native).map(r=>r.id);
  const table=results.map(r=>`| ${r.id} | ${r.area} | ${r.stage0?'Sí':'No'} | ${r.native?'Sí':'No'} | ${r.status}${r.note?'. '+r.note:''} |`).join('\n');
  const markdown=`# Sintaxis: frontend ETS frente a stage 0 TypeScript\n\nEsta matriz compara la gramática del frontend ETS con el pipeline de carga y\nparseo de stage 0. El parser TS aislado no representa por sí solo ese pipeline:\nlos imports, exports y cabeceras también se procesan en el cargador antiguo.\nEl informe JSON conserva ambas medidas para stage 0.\n\nNo se confunde aceptación sintáctica con resolución de nombres, tipado, seguridad\nde memoria o generación de código. Los casos que prueban sólo gramática pueden\nser rechazados después por el checker; por ejemplo, los packs de clases.\n\nEl binario ETS se construye mediante el adaptador de stage 0. No hay todavía\ncompilación completa del compilador por sí mismo: IR y backends quedan fuera\nde esta entrega.\n\nReproducir: \`npm run audit:bootstrap:syntax\`. Actualizar este documento y\n\`bootstrap/audit/syntax-parity.json\`: añadir \`-- --write\`.\n\nCasos nombrados: **${report.passed}/${report.cases}** con el resultado esperado.\nCorpus físico: **${nativeExamples}/${examples.length}** archivos aceptados por el\nparser ETS, **${oldExamples}/${examples.length}** por el cargador/parser TS.\nArchivos aceptados antes y rechazados ahora: **${exampleGaps.length}**.\nEstas muestras no constituyen una equivalencia formal para cualquier entrada.\n\n## Resumen de compatibilidad\n\n- Formas aceptadas antes y rechazadas ahora en la matriz: **${removals.length}**${removals.length?': '+removals.join(', '):''}.\n- Adiciones observadas en el parser nativo: **${additions.length}**: ${additions.join(', ')}.\n- Se conservan declaraciones, clases por composición, interfaces, genéricos,\n  funciones/packs, destructuring plano, ownership/préstamos, async, módulos,\n  match, comptime y generadores en el frontend.\n- La escritura histórica \`union<T> U = Some(T)|None;\` también se conserva;\n  sus parámetros se retienen en el AST, corrigiendo una pérdida de stage 0.\n- Herencia, excepciones, imports dinámicos, regex, tagged templates,\n  destructuring anidado/rest, object spread, exponentes numéricos, ===/!== y\n  >>> se rechazan en ambos. No son funcionalidades eliminadas en la migración.\n\n## Matriz reproducible\n\n| Caso | Área | TS: cargador + parser | Parser ETS | Resultado observado |\n|---|---|---|---|---|\n${table}\n\n## Diferencias que no son de sintaxis\n\n- Const, readonly, ref, constRef, ptr y move conservan su escritura. El checker\n  nativo rechaza ciertas mutaciones y préstamos de const aceptados por stage 0.\n- Las capturas y callbacks conservan su sintaxis; el nuevo análisis comprueba\n  escapes, efectos, préstamos activos, suspensión y usos después de move.\n- Los tipos privados en constraints/defaults exportados se comprueban como\n  parte de la superficie pública, también tras @etsgen.\n- @cppgen se conserva como contrato opaco del frontend. Aquí no se ejecuta\n  la emisión C++; eso pertenece al backend que el usuario ha aplazado.\n- Las consultas typeof y los tipos compuestos tienen identidades y metadatos\n  nativos; el formato añade procedencia persistente y claves por módulo.\n- Unq/unSome no se reintroducen. Las aceptaciones heredadas del checker TS\n  directo se distinguen de la sintaxis y del contrato público vigente.\n\nLa aceptación semántica completa se prueba separadamente con el checker: el\ncorpus actual acepta 130 ejemplos y rechaza expected-errors/private-bad.ets por\nacceso privado. El estado de cierre y sus obligaciones están en [PENDING.md](PENDING.md).\n`;
  if(write){writeFileSync(join(root,'bootstrap/SYNTAX-PARITY.md'),markdown);writeFileSync(join(root,'bootstrap/audit/syntax-parity.json'),JSON.stringify(report,null,2)+'\n');}
  console.log(`${report.passed}/${report.cases} syntax contracts; examples TS ${oldExamples}/${examples.length}, ETS ${nativeExamples}/${examples.length}; removed ${exampleGaps.length}`);
  process.exitCode=report.passed===report.cases&&exampleGaps.length===0?0:1;
}finally{rmSync(directory,{recursive:true,force:true});}
