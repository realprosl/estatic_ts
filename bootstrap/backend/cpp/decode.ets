import {IrSource,IrPlace,IrInstruction,IrBlock,IrFunction,IrModule,IrIssue,IrProject,IrDispatch,IrType,IrRuntimeContract,IrCleanupScope,IrLease,IrEffectBorrow,IrEffectContract,IrAnnotation} from "../../ir/model";
function decodestringArray(value:JsonValue):string[]{let decoded:string[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(jsonAsString(jsonArrayGet(value,k)));return decoded;}
function decodenumberArray(value:JsonValue):number[]{let decoded:number[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(jsonAsNumber(jsonArrayGet(value,k)));return decoded;}
function decodeIrSourceArray(value:JsonValue):IrSource[]{let decoded:IrSource[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrSource(jsonArrayGet(value,k)));return decoded;}
function decodeIrPlaceArray(value:JsonValue):IrPlace[]{let decoded:IrPlace[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrPlace(jsonArrayGet(value,k)));return decoded;}
function decodeIrInstructionArray(value:JsonValue):IrInstruction[]{let decoded:IrInstruction[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrInstruction(jsonArrayGet(value,k)));return decoded;}
function decodeIrBlockArray(value:JsonValue):IrBlock[]{let decoded:IrBlock[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrBlock(jsonArrayGet(value,k)));return decoded;}
function decodeIrFunctionArray(value:JsonValue):IrFunction[]{let decoded:IrFunction[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrFunction(jsonArrayGet(value,k)));return decoded;}
function decodeIrModuleArray(value:JsonValue):IrModule[]{let decoded:IrModule[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrModule(jsonArrayGet(value,k)));return decoded;}
function decodeIrIssueArray(value:JsonValue):IrIssue[]{let decoded:IrIssue[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrIssue(jsonArrayGet(value,k)));return decoded;}
function decodeIrProjectArray(value:JsonValue):IrProject[]{let decoded:IrProject[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrProject(jsonArrayGet(value,k)));return decoded;}
function decodeIrDispatchArray(value:JsonValue):IrDispatch[]{let decoded:IrDispatch[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrDispatch(jsonArrayGet(value,k)));return decoded;}
function decodeIrTypeArray(value:JsonValue):IrType[]{let decoded:IrType[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrType(jsonArrayGet(value,k)));return decoded;}
function decodeIrRuntimeContractArray(value:JsonValue):IrRuntimeContract[]{let decoded:IrRuntimeContract[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrRuntimeContract(jsonArrayGet(value,k)));return decoded;}
function decodeIrCleanupScopeArray(value:JsonValue):IrCleanupScope[]{let decoded:IrCleanupScope[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrCleanupScope(jsonArrayGet(value,k)));return decoded;}
function decodeIrLeaseArray(value:JsonValue):IrLease[]{let decoded:IrLease[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrLease(jsonArrayGet(value,k)));return decoded;}
function decodeIrEffectBorrowArray(value:JsonValue):IrEffectBorrow[]{let decoded:IrEffectBorrow[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrEffectBorrow(jsonArrayGet(value,k)));return decoded;}
function decodeIrEffectContractArray(value:JsonValue):IrEffectContract[]{let decoded:IrEffectContract[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrEffectContract(jsonArrayGet(value,k)));return decoded;}
function decodeIrAnnotationArray(value:JsonValue):IrAnnotation[]{let decoded:IrAnnotation[]=[];for(let k:number=0;k<jsonArrayLength(value);k=k+1)decoded.push(decodeIrAnnotation(jsonArrayGet(value,k)));return decoded;}
export function decodeIrSource(value:JsonValue):IrSource{let decoded=new IrSource(jsonAsString(jsonObjectGet(value,"moduleId")),jsonAsString(jsonObjectGet(value,"sourceHash")),jsonAsString(jsonObjectGet(value,"file")),jsonAsNumber(jsonObjectGet(value,"node")),jsonAsNumber(jsonObjectGet(value,"start")),jsonAsNumber(jsonObjectGet(value,"end")));
decoded.generatedId=jsonAsString(jsonObjectGet(value,"generatedId"));
decoded.generatedStart=jsonAsNumber(jsonObjectGet(value,"generatedStart"));
decoded.generatedEnd=jsonAsNumber(jsonObjectGet(value,"generatedEnd"));
decoded.moduleId=jsonAsString(jsonObjectGet(value,"moduleId"));
decoded.sourceHash=jsonAsString(jsonObjectGet(value,"sourceHash"));
decoded.file=jsonAsString(jsonObjectGet(value,"file"));
decoded.node=jsonAsNumber(jsonObjectGet(value,"node"));
decoded.start=jsonAsNumber(jsonObjectGet(value,"start"));
decoded.end=jsonAsNumber(jsonObjectGet(value,"end"));
return decoded;}
export function decodeIrPlace(value:JsonValue):IrPlace{let decoded=new IrPlace(jsonAsString(jsonObjectGet(value,"symbolId")),jsonAsNumber(jsonObjectGet(value,"typeId")),jsonAsNumber(jsonObjectGet(value,"global")),jsonAsBool(jsonObjectGet(value,"parameter")),decodeIrSource(jsonObjectGet(value,"source")));
decoded.name=jsonAsString(jsonObjectGet(value,"name"));
decoded.kind=jsonAsString(jsonObjectGet(value,"kind"));
decoded.base=jsonAsNumber(jsonObjectGet(value,"base"));
decoded.index=jsonAsNumber(jsonObjectGet(value,"index"));
decoded.field=jsonAsNumber(jsonObjectGet(value,"field"));
decoded.readOnly=jsonAsBool(jsonObjectGet(value,"readOnly"));
decoded.symbolId=jsonAsString(jsonObjectGet(value,"symbolId"));
decoded.typeId=jsonAsNumber(jsonObjectGet(value,"typeId"));
decoded.global=jsonAsNumber(jsonObjectGet(value,"global"));
decoded.parameter=jsonAsBool(jsonObjectGet(value,"parameter"));
decoded.source=decodeIrSource(jsonObjectGet(value,"source"));
return decoded;}
export function decodeIrInstruction(value:JsonValue):IrInstruction{let decoded=new IrInstruction(jsonAsString(jsonObjectGet(value,"op")),jsonAsNumber(jsonObjectGet(value,"result")),jsonAsNumber(jsonObjectGet(value,"typeId")),decodeIrSource(jsonObjectGet(value,"source")));
decoded.continuation=jsonAsNumber(jsonObjectGet(value,"continuation"));
decoded.lease=jsonAsNumber(jsonObjectGet(value,"lease"));
decoded.contract=jsonAsNumber(jsonObjectGet(value,"contract"));
decoded.names=decodestringArray(jsonObjectGet(value,"names"));
decoded.signature=jsonAsNumber(jsonObjectGet(value,"signature"));
decoded.effects=decodestringArray(jsonObjectGet(value,"effects"));
decoded.op=jsonAsString(jsonObjectGet(value,"op"));
decoded.result=jsonAsNumber(jsonObjectGet(value,"result"));
decoded.typeId=jsonAsNumber(jsonObjectGet(value,"typeId"));
decoded.operands=decodenumberArray(jsonObjectGet(value,"operands"));
decoded.place=jsonAsNumber(jsonObjectGet(value,"place"));
decoded.callee=jsonAsNumber(jsonObjectGet(value,"callee"));
decoded.text=jsonAsString(jsonObjectGet(value,"text"));
decoded.source=decodeIrSource(jsonObjectGet(value,"source"));
return decoded;}
export function decodeIrBlock(value:JsonValue):IrBlock{let decoded=new IrBlock(decodeIrSource(jsonObjectGet(value,"source")));
decoded.instructions=decodeIrInstructionArray(jsonObjectGet(value,"instructions"));
decoded.terminator=jsonAsString(jsonObjectGet(value,"terminator"));
decoded.value=jsonAsNumber(jsonObjectGet(value,"value"));
decoded.targets=decodenumberArray(jsonObjectGet(value,"targets"));
decoded.source=decodeIrSource(jsonObjectGet(value,"source"));
return decoded;}
export function decodeIrFunction(value:JsonValue):IrFunction{let decoded=new IrFunction(jsonAsString(jsonObjectGet(value,"name")),jsonAsString(jsonObjectGet(value,"symbolId")),jsonAsNumber(jsonObjectGet(value,"returns")),decodeIrSource(jsonObjectGet(value,"source")));
decoded.effectContracts=decodenumberArray(jsonObjectGet(value,"effectContracts"));
decoded.frameValues=decodenumberArray(jsonObjectGet(value,"frameValues"));
decoded.framePlaces=decodenumberArray(jsonObjectGet(value,"framePlaces"));
decoded.leases=decodeIrLeaseArray(jsonObjectGet(value,"leases"));
decoded.receiverType=jsonAsNumber(jsonObjectGet(value,"receiverType"));
decoded.signature=jsonAsString(jsonObjectGet(value,"signature"));
decoded.substitutionFrom=decodestringArray(jsonObjectGet(value,"substitutionFrom"));
decoded.substitutionTo=decodestringArray(jsonObjectGet(value,"substitutionTo"));
decoded.captureSymbols=decodestringArray(jsonObjectGet(value,"captureSymbols"));
decoded.captureTypes=decodenumberArray(jsonObjectGet(value,"captureTypes"));
decoded.captureModes=decodestringArray(jsonObjectGet(value,"captureModes"));
decoded.asynchronous=jsonAsBool(jsonObjectGet(value,"asynchronous"));
decoded.bodyReturns=jsonAsNumber(jsonObjectGet(value,"bodyReturns"));
decoded.name=jsonAsString(jsonObjectGet(value,"name"));
decoded.symbolId=jsonAsString(jsonObjectGet(value,"symbolId"));
decoded.returns=jsonAsNumber(jsonObjectGet(value,"returns"));
decoded.parameterTypes=decodenumberArray(jsonObjectGet(value,"parameterTypes"));
decoded.places=decodeIrPlaceArray(jsonObjectGet(value,"places"));
decoded.values=decodenumberArray(jsonObjectGet(value,"values"));
decoded.blocks=decodeIrBlockArray(jsonObjectGet(value,"blocks"));
decoded.source=decodeIrSource(jsonObjectGet(value,"source"));
return decoded;}
export function decodeIrModule(value:JsonValue):IrModule{let decoded=new IrModule(jsonAsString(jsonObjectGet(value,"id")),jsonAsString(jsonObjectGet(value,"sourceHash")),jsonAsString(jsonObjectGet(value,"file")),jsonAsNumber(jsonObjectGet(value,"initializer")));
decoded.id=jsonAsString(jsonObjectGet(value,"id"));
decoded.sourceHash=jsonAsString(jsonObjectGet(value,"sourceHash"));
decoded.file=jsonAsString(jsonObjectGet(value,"file"));
decoded.initializer=jsonAsNumber(jsonObjectGet(value,"initializer"));
decoded.finalizer=jsonAsNumber(jsonObjectGet(value,"finalizer"));
return decoded;}
export function decodeIrIssue(value:JsonValue):IrIssue{let decoded=new IrIssue(jsonAsString(jsonObjectGet(value,"code")),jsonAsString(jsonObjectGet(value,"message")),decodeIrSource(jsonObjectGet(value,"source")));
decoded.code=jsonAsString(jsonObjectGet(value,"code"));
decoded.message=jsonAsString(jsonObjectGet(value,"message"));
decoded.source=decodeIrSource(jsonObjectGet(value,"source"));
return decoded;}
export function decodeIrProject(value:JsonValue):IrProject{let decoded=new IrProject();
decoded.dispatches=decodeIrDispatchArray(jsonObjectGet(value,"dispatches"));
decoded.effectContracts=decodeIrEffectContractArray(jsonObjectGet(value,"effectContracts"));
decoded.annotations=decodeIrAnnotationArray(jsonObjectGet(value,"annotations"));
decoded.runtimeContracts=decodeIrRuntimeContractArray(jsonObjectGet(value,"runtimeContracts"));
decoded.typeDefinitions=decodeIrTypeArray(jsonObjectGet(value,"typeDefinitions"));
decoded.finalizationOrder=decodenumberArray(jsonObjectGet(value,"finalizationOrder"));
decoded.types=decodestringArray(jsonObjectGet(value,"types"));
decoded.modules=decodeIrModuleArray(jsonObjectGet(value,"modules"));
decoded.globals=decodeIrPlaceArray(jsonObjectGet(value,"globals"));
decoded.functions=decodeIrFunctionArray(jsonObjectGet(value,"functions"));
decoded.initializationOrder=decodenumberArray(jsonObjectGet(value,"initializationOrder"));
decoded.entry=jsonAsNumber(jsonObjectGet(value,"entry"));
decoded.diagnostics=decodeIrIssueArray(jsonObjectGet(value,"diagnostics"));
decoded.success=jsonAsBool(jsonObjectGet(value,"success"));
return decoded;}
export function decodeIrDispatch(value:JsonValue):IrDispatch{let decoded=new IrDispatch(jsonAsNumber(jsonObjectGet(value,"interfaceType")),jsonAsNumber(jsonObjectGet(value,"concreteType")),jsonAsString(jsonObjectGet(value,"name")),jsonAsNumber(jsonObjectGet(value,"signature")),jsonAsNumber(jsonObjectGet(value,"callee")));
decoded.interfaceType=jsonAsNumber(jsonObjectGet(value,"interfaceType"));
decoded.concreteType=jsonAsNumber(jsonObjectGet(value,"concreteType"));
decoded.name=jsonAsString(jsonObjectGet(value,"name"));
decoded.signature=jsonAsNumber(jsonObjectGet(value,"signature"));
decoded.callee=jsonAsNumber(jsonObjectGet(value,"callee"));
return decoded;}
export function decodeIrType(value:JsonValue):IrType{let decoded=new IrType(jsonAsString(jsonObjectGet(value,"kind")));
decoded.methods=decodestringArray(jsonObjectGet(value,"methods"));
decoded.methodTypes=decodenumberArray(jsonObjectGet(value,"methodTypes"));
decoded.variants=decodenumberArray(jsonObjectGet(value,"variants"));
decoded.tag=jsonAsString(jsonObjectGet(value,"tag"));
decoded.discriminator=jsonAsString(jsonObjectGet(value,"discriminator"));
decoded.discriminatorType=jsonAsNumber(jsonObjectGet(value,"discriminatorType"));
decoded.discriminatorValue=jsonAsString(jsonObjectGet(value,"discriminatorValue"));
decoded.numericKind=jsonAsString(jsonObjectGet(value,"numericKind"));
decoded.bits=jsonAsNumber(jsonObjectGet(value,"bits"));
decoded.isSigned=jsonAsBool(jsonObjectGet(value,"isSigned"));
decoded.kind=jsonAsString(jsonObjectGet(value,"kind"));
decoded.arguments=decodenumberArray(jsonObjectGet(value,"arguments"));
decoded.fields=decodenumberArray(jsonObjectGet(value,"fields"));
decoded.names=decodestringArray(jsonObjectGet(value,"names"));
decoded.symbolId=jsonAsString(jsonObjectGet(value,"symbolId"));
decoded.resource=jsonAsBool(jsonObjectGet(value,"resource"));
decoded.length=jsonAsNumber(jsonObjectGet(value,"length"));
return decoded;}
export function decodeIrRuntimeContract(value:JsonValue):IrRuntimeContract{let decoded=new IrRuntimeContract(jsonAsString(jsonObjectGet(value,"name")),decodenumberArray(jsonObjectGet(value,"parameters")),jsonAsNumber(jsonObjectGet(value,"returns")),decodestringArray(jsonObjectGet(value,"effects")),jsonAsString(jsonObjectGet(value,"capability")));
decoded.name=jsonAsString(jsonObjectGet(value,"name"));
decoded.parameters=decodenumberArray(jsonObjectGet(value,"parameters"));
decoded.returns=jsonAsNumber(jsonObjectGet(value,"returns"));
decoded.effects=decodestringArray(jsonObjectGet(value,"effects"));
decoded.capability=jsonAsString(jsonObjectGet(value,"capability"));
return decoded;}
export function decodeIrCleanupScope(value:JsonValue):IrCleanupScope{let decoded=new IrCleanupScope();
decoded.places=decodenumberArray(jsonObjectGet(value,"places"));
return decoded;}
export function decodeIrLease(value:JsonValue):IrLease{let decoded=new IrLease(jsonAsNumber(jsonObjectGet(value,"place")),jsonAsNumber(jsonObjectGet(value,"value")),jsonAsString(jsonObjectGet(value,"mode")));
decoded.place=jsonAsNumber(jsonObjectGet(value,"place"));
decoded.value=jsonAsNumber(jsonObjectGet(value,"value"));
decoded.mode=jsonAsString(jsonObjectGet(value,"mode"));
return decoded;}
export function decodeIrEffectBorrow(value:JsonValue):IrEffectBorrow{let decoded=new IrEffectBorrow(decodeIrSource(jsonObjectGet(value,"source")),jsonAsString(jsonObjectGet(value,"callback")),jsonAsString(jsonObjectGet(value,"root")),jsonAsString(jsonObjectGet(value,"mode")));
decoded.source=decodeIrSource(jsonObjectGet(value,"source"));
decoded.callback=jsonAsString(jsonObjectGet(value,"callback"));
decoded.root=jsonAsString(jsonObjectGet(value,"root"));
decoded.mode=jsonAsString(jsonObjectGet(value,"mode"));
return decoded;}
export function decodeIrEffectContract(value:JsonValue):IrEffectContract{let decoded=new IrEffectContract(decodeIrSource(jsonObjectGet(value,"source")));
decoded.source=decodeIrSource(jsonObjectGet(value,"source"));
decoded.phase=jsonAsString(jsonObjectGet(value,"phase"));
decoded.creation=jsonAsNumber(jsonObjectGet(value,"creation"));
decoded.callees=decodenumberArray(jsonObjectGet(value,"callees"));
decoded.parameters=decodestringArray(jsonObjectGet(value,"parameters"));
decoded.reads=decodestringArray(jsonObjectGet(value,"reads"));
decoded.writes=decodestringArray(jsonObjectGet(value,"writes"));
decoded.moves=decodestringArray(jsonObjectGet(value,"moves"));
decoded.invokes=decodestringArray(jsonObjectGet(value,"invokes"));
decoded.retains=decodestringArray(jsonObjectGet(value,"retains"));
decoded.returned=decodestringArray(jsonObjectGet(value,"returned"));
decoded.borrows=decodeIrEffectBorrowArray(jsonObjectGet(value,"borrows"));
decoded.unknown=jsonAsBool(jsonObjectGet(value,"unknown"));
decoded.recursive=jsonAsBool(jsonObjectGet(value,"recursive"));
decoded.external=jsonAsBool(jsonObjectGet(value,"external"));
return decoded;}
export function decodeIrAnnotation(value:JsonValue):IrAnnotation{let decoded=new IrAnnotation(decodeIrSource(jsonObjectGet(value,"source")),decodeIrSource(jsonObjectGet(value,"target")),jsonAsString(jsonObjectGet(value,"name")),decodestringArray(jsonObjectGet(value,"arguments")));
decoded.source=decodeIrSource(jsonObjectGet(value,"source"));
decoded.target=decodeIrSource(jsonObjectGet(value,"target"));
decoded.name=jsonAsString(jsonObjectGet(value,"name"));
decoded.arguments=decodestringArray(jsonObjectGet(value,"arguments"));
return decoded;}
export function parseIrProject(text:string):IrProject {const value:JsonValue=JSON.parseValue(text);
if(jsonAsString(jsonObjectGet(value,"format"))!="ets-ir-2"||!jsonAsBool(jsonObjectGet(value,"success"))||!jsonIsArray(jsonObjectGet(value,"diagnostics"))||jsonArrayLength(jsonObjectGet(value,"diagnostics"))!=0){printError("Se requiere ets-ir-2 verificado con success:true");exitProcess(1);}return decodeIrProject(value); }
