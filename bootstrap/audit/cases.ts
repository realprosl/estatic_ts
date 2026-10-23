// Acceptance obligations for the native frontend. These describe the target
// language, not a snapshot of the current unsupported diagnostics.
export interface AuditCase {
  id: string;
  area: string;
  source: string;
  accept: boolean;
  files?: Record<string, string>;
  rejectionPhase?: string;
  diagnostic?: string;
  symbols?: Record<string, string>;
  constants?: unknown[];
  decorators?: string[];
}
const rejectionPatterns: Record<string,string> = {
  'integer64-overflow':'rango|no cabe',
  'fraction-to-integer-literal':'entero|rango',
  'nonfinite-float':'finito|rango',
  'fixed-array-bound':'índice|rango|límite',
  'generic-constraint-violation':'constraint|restricci|firma compatible',
  'break-outside':'break.*fuera|fuera.*break',
  'continue-switch-only':'continue.*fuera|fuera.*continue',
  'switch-duplicate-label':'duplicad',
  'readonly-external-write':'inmutable|readonly',
  'async-borrow':'E4204|E4210|préstamo.*async|préstamo.*suspensi',
  'owner-use-after-move':'E4102|E4103',
  'borrow-return':'E4203|retorno.*préstamo|préstamo.*retorno',
  'borrow-field':'E4203',
  'callback-escape':'E4210',
  'type-error':'incompatible',
  'unknown-name':'Nombre no declarado',
};
const yes = (id: string, area: string, source: string, files?: Record<string, string>): AuditCase => ({id, area, source, accept: true, files});
const no = (id: string, area: string, source: string): AuditCase => {
  if(!rejectionPatterns[id])throw new Error(`Missing diagnostic contract: ${id}`);
  return {id, area, source, accept: false,diagnostic:rejectionPatterns[id]};
};
const box = 'class Box{value:number=1;}';
export const cases: AuditCase[] = [
  yes('base-primitives', 'types', 'const n:number=1;const s:string="x";const b:boolean=true;print(n);print(s);print(b);'),
  yes('integer-bases', 'numeric', 'const a:u8=0xff;const b:i16=0b1111;const c:u16=0o777;const d:u32=1_000;'),
  yes('fractional-floats', 'numeric', 'const a:f32=1.5;const b:f64=2.25;'),
  yes('integer64', 'numeric', 'const a:u64=18446744073709551615;const b:i64=-9223372036854775808;print(a);print(b);'),
  no('integer64-overflow', 'numeric', 'const a:u64=18446744073709551616;'),
  no('fraction-to-integer-literal', 'numeric', 'const a:i32=1.5;'),
  no('nonfinite-float', 'numeric', 'const a:f64=9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999;'),
  {...yes('numeric-promotions', 'numeric', 'let a:i8=1;let b:u32=2;const c=a+b;print(c);'),symbols:{c:'u32'}},
  yes('fixed-array', 'types', 'const a:number[2]=[1,2];print(a[1]);'),
  yes('fixed-array-constant-size', 'types', 'const N=2;const a:number[N]=[1,2];'),
  no('fixed-array-bound', 'types', 'const a:number[2]=[1,2];print(a[2]);'),
  yes('intersection', 'types', 'interface A{x:number;}interface B{y:string;}const a:A&B={x:1,y:"a"};'),
  yes('structural-interface', 'types', 'interface I{x:number;}class C{x:number=1;}const i:I=new C();'),
  yes('generic-alias', 'generics', 'type List<T> = T[];const a:List<number> =[1,2];'),
  yes('generic-class', 'generics', 'class Box<T>{constructor(public value:T){}}const b=new Box<number>(1);'),
  yes('generic-constraint', 'generics', 'function id<T extends number>(x:T):T{return x;}print(id(1));'),
  no('generic-constraint-violation', 'generics', 'function id<T extends number>(x:T):T{return x;}print(id("x"));'),
  yes('generic-default', 'generics', 'function id<T=number>(x:T):T{return x;}print(id(1));'),
  yes('generic-pack', 'generics', 'function count<...T>(...values:T):number{return 1;}print(count(1,"a"));'),
  yes('enum', 'types', 'enum Color{Red,Green}const c:Color=Color.Green;'),
  yes('declared-union', 'types', 'union Outcome<T,E> = Ok(T)|Err(E);const r:Outcome<number,string> = Outcome<number,string>.Ok(1);'),
  yes('narrowing', 'types', 'union R={ok:true;value:number}|{ok:false;error:string};function f(r:R):number{if(r.ok==true)return r.value;return 0;}'),
  yes('instanceof', 'types', 'class A{x:number=1;}class B{y:number=2;}function f(v:A|B):boolean{return v instanceof A;}'),
  yes('overload-call', 'functions', 'function f(x:number):number{return x;}function f(x:string):string{return x;}print(f(1));'),
  yes('overload-as-value', 'functions', 'function f(x:number):number{return x;}function f(x:string):string{return x;}const g:(x:number)=>number=f;print(g(1));'),
  yes('rest', 'functions', 'function first(...xs:number[]):number{return xs[0];}print(first(1,2));'),
  yes('named-arguments', 'functions', 'function add(x:number,y:number):number{return x+y;}print(add(y:2,x:1));'),
  yes('spread-arguments', 'functions', 'function first(...xs:number[]):number{return xs[0];}const a=[1,2];print(first(...a));'),
  yes('arrow-block-inference', 'functions', 'const f=(x:number)=>{return x+1;};print(f(1));'),
  yes('nested-function-capture', 'functions', 'function f():number{const n=1;function g():number{return n;}return g();}print(f());'),
  yes('optional-parameter-body', 'functions', 'function f(x?:number):number{return optionalValueOr(x,0);}print(f());'),
  yes('array-destructuring', 'bindings', 'const [a,b]=[1,2];print(a+b);'),
  yes('object-destructuring', 'bindings', 'interface I{x:number;}const i:I={x:1};const {x:y}=i;print(y);'),
  yes('destructuring-default', 'bindings', 'const [a:number=1]=[];print(a);'),
  yes('for-of', 'control', 'const a=[1,2];for(const x of a){print(x);}'),
  yes('for-in', 'control', 'const a=[1,2];for(const i in a){print(i);}'),
  yes('switch', 'control', 'function f(n:number):number{switch(n){case 0:return 1;default:return 2;}}'),
  no('break-outside', 'control', 'break;'),
  no('continue-switch-only', 'control', 'switch(1){case 1:continue;}'),
  no('switch-duplicate-label', 'control', 'switch(1){case 1:break;case 1:break;}'),
  yes('using', 'bindings', 'using x=1;print(x);'),
  yes('readonly-constructor', 'objects', 'class C{readonly x:number;constructor(){this.x=1;}}const c=new C();print(c.x);'),
  no('readonly-external-write', 'objects', 'class C{readonly x:number=1;}let c=new C();c.x=2;'),
  yes('array-map', 'collections', 'const a=[1,2];const b=a.map((x:number):number=>x+1);print(b[0]);'),
  yes('array-filter', 'collections', 'const a=[1,2];const b=a.filter((x:number):boolean=>x>1);'),
  yes('array-reduce', 'collections', 'const a=[1,2];const n=a.reduce(0,(s:number,x:number):number=>s+x);'),
  yes('array-sort', 'collections', 'let a=[2,1];a.sort((x:number,y:number):number=>x-y);'),
  yes('array-find', 'collections', 'const a=[1,2];const n=a.find((x:number):boolean=>x>1);'),
  yes('array-spread', 'collections', 'const a=[1,2];const b=[0,...a];'),
  yes('map', 'collections', 'let m:Map<string,number> = new Map<string,number>();m.set("x",1);print(m.has("x"));'),
  yes('set', 'collections', 'let s:Set<string> = new Set<string>();s.add("x");print(s.has("x"));'),
  yes('delete', 'collections', 'let m:Map<string,number> = new Map<string,number>();m.set("x",1);delete m["x"];'),
  yes('optional', 'optional-result', 'const a:Optional<number> = optionalSome(1);print(optionalValueOr(a,0));'),
  yes('nullish', 'optional-result', 'const a:Optional<number> = optionalSome(1);print(a??0);'),
  yes('optional-chain', 'optional-result', box+'const b:Optional<Box> = optionalSome(new Box());const x=b?.value;'),
  yes('result', 'optional-result', 'const r:Result<number> = ok(1);'),
  yes('match', 'control', 'const n=match(1,[when(1,():number=>2),otherwise(():number=>0)]);'),
  yes('async-await', 'async', 'async function f():Promise<number>{await sleep(1);return 1;}'),
  yes('for-await-of', 'async', 'async function f(xs:Promise<number>[]):Promise<void>{for await(const x of xs){print(x);}}'),
  no('async-borrow', 'async', box+'async function f(x:ref<Box>):Promise<number>{await sleep(1);return x.value;}'),
  yes('builtin-string-global', 'builtins', 'print(length("x"));print(charAt("x",0));'),
  yes('builtin-math', 'builtins', 'print(Math.sqrt(4));'),
  yes('builtin-console', 'builtins', 'console.log("hello");'),
  yes('builtin-json', 'builtins', 'const j=JSON.parse("{}");'),
  yes('builtin-filesystem', 'builtins', 'const r=readFile("input.txt");'),
  {...yes('comptime-expression', 'expansions', 'const n=comptime(():number=>1+2);'),constants:[{type:'number',value:3}]},
  {...yes('comptime-function', 'expansions', '@comptime function f(x:number):number{return x+1;}const n=f(1);'),constants:[{type:'number',value:2}],decorators:['comptime']},
  {...yes('decorator', 'expansions', '@deprecated function f():number{return 1;}'),decorators:['deprecated']},
  yes('owner-transfer', 'memory', box+'let p:ptr<Box> = new Box();const q=move(p);print(q.value);'),
  no('owner-use-after-move', 'memory', box+'let p:ptr<Box> = new Box();const q=move(p);print(p.value);'),
  yes('owner-field', 'memory', box+'class Holder{p:ptr<Box> = new Box();}let h=new Holder();'),
  yes('owner-array', 'memory', box+'let a:ptr<Box>[]=[];let p:ptr<Box> = new Box();a.push(move(p));'),
  no('borrow-return', 'memory', box+'function f(x:ref<Box>):ref<Box>{return x;}'),
  no('borrow-field', 'memory', box+'class Holder{x:ref<Box>;}'),
  yes('callback-local', 'effects', 'function apply(cb:()=>number):number{return cb();}let n=0;print(apply(():number=>{n+=1;return n;}));'),
  no('callback-escape', 'effects', 'function f():()=>number{let n=0;return ():number=>{n+=1;return n;};}'),
  yes('module-alias', 'modules', 'import {n as value} from "./lib";print(value);', {'lib.ets':'export const n=1;'}),
  yes('module-barrel', 'modules', 'import {value} from "./barrel";print(value);', {'barrel.ets':'export {n as value} from "./lib";','lib.ets':'export const n=1;'}),
  no('type-error', 'diagnostics', 'const n:number="wrong";'),
  {...no('unknown-name', 'diagnostics', 'print(missing);'),rejectionPhase:'binder'},
];
