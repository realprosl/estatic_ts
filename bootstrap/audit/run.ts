import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {join, dirname, relative, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildLoader, root} from '../modules/build.ts';
import {cases} from './cases.ts';
import {isDeepStrictEqual} from 'node:util';

// This is an explicit, currently failing language-completion gate, separate
// from the stable regression suite. A rejection due to missing coverage is
// never accepted as proof that an invalid program was correctly diagnosed.
const args = process.argv.slice(2);
const options=new Map<string,string>();
for(let i=0;i<args.length;i+=2){
  const flag=args[i],value=args[i+1];
  if(!['--report','--binary'].includes(flag) || !value || value.startsWith('--') || options.has(flag))throw new Error('Usage: audit:bootstrap [--report file.json] [--binary executable]');
  options.set(flag,resolve(value));
}
function option(name: string): string | undefined {
  return options.get(name);
}
const directory=mkdtempSync(join(root,'build-native-audit-'));
try {
  const binary=option('--binary') ?? await buildLoader(join(directory,'binary'),'bootstrap/checker/demo.ets',true);
  const results=[];
  for(const c of cases){
    const project=join(directory,c.id);
    for(const [name,source] of Object.entries({'main.ets':c.source,...c.files})){
      const file=join(project,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);
    }
    const run=spawnSync(binary,[join(project,'main.ets')],{encoding:'utf8',timeout:15000,maxBuffer:32*1024*1024});
    if(run.error)throw run.error;
    if(run.signal || ![0,1].includes(run.status ?? -1))throw new Error(`${c.id}: native process failed (${run.status}, ${run.signal}): ${run.stderr}`);
    let parsed;
    try{parsed=JSON.parse(run.stdout);}catch{throw new Error(`${c.id}: invalid native output: ${run.stdout.slice(-1000)}`);}
    if(typeof parsed.success !== 'boolean' || !Array.isArray(parsed.diagnostics) || parsed.success !== (run.status===0))throw new Error(`${c.id}: inconsistent result`);
    const diagnostics=parsed.diagnostics.map((d:{phase:string;message:string})=>({phase:d.phase,message:d.message}));
    const unsupported=diagnostics.some((d:{phase:string;message:string})=>/pendiente|no soportad/i.test(d.message));
    // Negative cases must reach semantics, not fail on unrelated syntax/name errors.
    const semanticRejection=diagnostics.length>0 && diagnostics.every((d:{phase:string;message:string})=>d.phase===(c.rejectionPhase??'checker')) && !unsupported
      && diagnostics.some((d:{message:string})=>new RegExp(c.diagnostic!,'i').test(d.message));
    const metadataErrors=[];
    const entryModule=parsed.files.findIndex((file:{file:string})=>resolve(file.file)===resolve(project,"main.ets"));
    for(const [name,expected] of Object.entries(c.symbols??{})){
      const matches=parsed.binding.symbols.flatMap((s:{name:string;module:number},i:number)=>s.name===name && s.module===entryModule?[parsed.symbolTypes[i]]:[]);
      if(matches.length!==1 || matches[0]!==expected)metadataErrors.push(`${name}: expected ${expected}, got ${JSON.stringify(matches)}`);
    }
    if(c.constants){
      const values=[];
      for(const file of parsed.files)for(let id=0;id<file.constantValues.length;id++)if(file.constantValues[id]){
        if(file.constantStates[id]!=='evaluated')metadataErrors.push(`constant ${id}: result without evaluated state`);
        try{values.push(JSON.parse(file.constantValues[id]));}catch{metadataErrors.push(`constant ${id}: invalid materialized value`);}
      }
      if(!isDeepStrictEqual(values,c.constants))metadataErrors.push(`constants: expected ${JSON.stringify(c.constants)}, got ${JSON.stringify(values)}`);
    }
    for(const name of c.decorators??[]){
      const metadata=parsed.decorators?.filter((d:{name:string})=>d.name===name)??[];
      if(metadata.length!==1)metadataErrors.push(`decorator ${name}: expected one metadata entry`);
      for(const item of metadata){const nodes=parsed.files[item.module]?.ast.nodes;
        if(nodes?.[item.node]?.kind!=='Decorator'||!nodes?.[item.target]?.edges.some((e:{role:string;node:number})=>e.role==='decorators'&&e.node===item.node))metadataErrors.push(`decorator ${name}: invalid source identity`);
      }
    }
    const passed=c.accept ? parsed.success && diagnostics.length===0 && metadataErrors.length===0 : !parsed.success && semanticRejection;
    results.push({id:c.id,area:c.area,expected:c.accept?'accept':'reject',passed,diagnostics,metadataErrors});
    console.log(`${passed?'PASS':'PENDING'} ${c.id}${passed?'':': '+[...diagnostics.map((d:{message:string})=>d.message),...metadataErrors].join('; ').slice(0,220)}`);
  }
  const report={revision:JSON.parse(readFileSync(join(root,'package.json'),'utf8')).estaticRevision,cases:results.length,passed:results.filter(r=>r.passed).length,pending:results.filter(r=>!r.passed).length,results};
  const target=option('--report');
  if(target){mkdirSync(dirname(target),{recursive:true});writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(`Report: ${relative(root,target)}`);}
  console.log(`${report.passed}/${report.cases} obligations satisfied; ${report.pending} pending. Passing this sample does not certify language completeness.`);
  process.exitCode=report.pending===0?0:1;
}finally{rmSync(directory,{recursive:true,force:true});}
