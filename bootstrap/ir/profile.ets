import {parseIrProject} from "../backend/cpp/decode";
import {readText,hostError} from "../driver/host";
import {IrVerifier,verifyIr} from "./verify";
import {verifyBorrowRoutes} from "./verify-borrows";
import {verifyOwnershipRoutes} from "./verify-ownership";
import {verifyIrTables} from "./verify-contracts";
const source:string=readText(argument(1));
if(hostError()!=""){printError(hostError());exitProcess(2);}
const started:number=Date.now();
const project=parseIrProject(source);
printError("IR_PROFILE\tdecode\t"+(Date.now()-started));
const verifying:number=Date.now();
const phase:string=argument(2);
let count:number=0;
if(phase=="borrows"||phase=="ownership"){
 const tables=verifyIrTables(project);
 count=tables.length;
 if(count==0){
  let verifier=new IrVerifier(project);
  for(const f of project.functions){
   if(verifier.nativeBinding(f))continue;
   const tick:number=Date.now();
   if(phase=="borrows"){const issues=verifyBorrowRoutes(project,f);count+=issues.length;}
   else{const issues=verifyOwnershipRoutes(project,f);count+=issues.length;}
   printError("IR_PROFILE\t"+phase+".function\t"+(Date.now()-tick)+"\t"+f.source.file+":"+f.name);
  }
 }
 printError("IR_PROFILE\t"+phase+".total\t"+(Date.now()-verifying));
}else{const issues=verifyIr(project,true);count=issues.length;printError("IR_PROFILE\tverify.total\t"+(Date.now()-verifying));}
print("diagnostics="+count);
if(count>0)exitProcess(1);
