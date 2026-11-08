import {IrSource,IrPlace,IrInstruction,IrBlock,IrFunction,IrModule,IrIssue,IrProject,IrDispatch,IrType,IrRuntimeContract,IrCleanupScope,IrLease,IrEffectBorrow,IrEffectContract,IrAnnotation} from "../../ir/model";
function decodestringArray(value:constRef<JsonValue>):string[]{let decoded:string[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(jsonAsString(item));}return decoded;}
function decodenumberArray(value:constRef<JsonValue>):number[]{let decoded:number[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(jsonAsNumber(item));}return decoded;}
function decodeIrSourceArray(value:constRef<JsonValue>):IrSource[]{let decoded:IrSource[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrSource(item));}return decoded;}
function decodeIrPlaceArray(value:constRef<JsonValue>):IrPlace[]{let decoded:IrPlace[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrPlace(item));}return decoded;}
function decodeIrInstructionArray(value:constRef<JsonValue>):IrInstruction[]{let decoded:IrInstruction[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrInstruction(item));}return decoded;}
function decodeIrBlockArray(value:constRef<JsonValue>):IrBlock[]{let decoded:IrBlock[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrBlock(item));}return decoded;}
function decodeIrFunctionArray(value:constRef<JsonValue>):IrFunction[]{let decoded:IrFunction[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrFunction(item));}return decoded;}
function decodeIrModuleArray(value:constRef<JsonValue>):IrModule[]{let decoded:IrModule[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrModule(item));}return decoded;}
function decodeIrIssueArray(value:constRef<JsonValue>):IrIssue[]{let decoded:IrIssue[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrIssue(item));}return decoded;}
function decodeIrProjectArray(value:constRef<JsonValue>):IrProject[]{let decoded:IrProject[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrProject(item));}return decoded;}
function decodeIrDispatchArray(value:constRef<JsonValue>):IrDispatch[]{let decoded:IrDispatch[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrDispatch(item));}return decoded;}
function decodeIrTypeArray(value:constRef<JsonValue>):IrType[]{let decoded:IrType[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrType(item));}return decoded;}
function decodeIrRuntimeContractArray(value:constRef<JsonValue>):IrRuntimeContract[]{let decoded:IrRuntimeContract[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrRuntimeContract(item));}return decoded;}
function decodeIrCleanupScopeArray(value:constRef<JsonValue>):IrCleanupScope[]{let decoded:IrCleanupScope[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrCleanupScope(item));}return decoded;}
function decodeIrLeaseArray(value:constRef<JsonValue>):IrLease[]{let decoded:IrLease[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrLease(item));}return decoded;}
function decodeIrEffectBorrowArray(value:constRef<JsonValue>):IrEffectBorrow[]{let decoded:IrEffectBorrow[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrEffectBorrow(item));}return decoded;}
function decodeIrEffectContractArray(value:constRef<JsonValue>):IrEffectContract[]{let decoded:IrEffectContract[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrEffectContract(item));}return decoded;}
function decodeIrAnnotationArray(value:constRef<JsonValue>):IrAnnotation[]{let decoded:IrAnnotation[]=[];const count:number=jsonArrayLength(value);for(let k:number=0;k<count;k=k+1){const item:JsonValue=jsonArrayGet(value,k);decoded.push(decodeIrAnnotation(item));}return decoded;}
export function decodeIrSource(value:constRef<JsonValue>):IrSource{
const field_generatedId:JsonValue=jsonObjectGet(value,"generatedId");
const field_generatedStart:JsonValue=jsonObjectGet(value,"generatedStart");
const field_generatedEnd:JsonValue=jsonObjectGet(value,"generatedEnd");
const field_moduleId:JsonValue=jsonObjectGet(value,"moduleId");
const field_sourceHash:JsonValue=jsonObjectGet(value,"sourceHash");
const field_file:JsonValue=jsonObjectGet(value,"file");
const field_node:JsonValue=jsonObjectGet(value,"node");
const field_start:JsonValue=jsonObjectGet(value,"start");
const field_end:JsonValue=jsonObjectGet(value,"end");
let decoded=new IrSource(jsonAsString(field_moduleId),jsonAsString(field_sourceHash),jsonAsString(field_file),jsonAsNumber(field_node),jsonAsNumber(field_start),jsonAsNumber(field_end));
decoded.generatedId=jsonAsString(field_generatedId);
decoded.generatedStart=jsonAsNumber(field_generatedStart);
decoded.generatedEnd=jsonAsNumber(field_generatedEnd);
return decoded;}
export function decodeIrPlace(value:constRef<JsonValue>):IrPlace{
const field_name:JsonValue=jsonObjectGet(value,"name");
const field_kind:JsonValue=jsonObjectGet(value,"kind");
const field_base:JsonValue=jsonObjectGet(value,"base");
const field_index:JsonValue=jsonObjectGet(value,"index");
const field_field:JsonValue=jsonObjectGet(value,"field");
const field_readOnly:JsonValue=jsonObjectGet(value,"readOnly");
const field_symbolId:JsonValue=jsonObjectGet(value,"symbolId");
const field_typeId:JsonValue=jsonObjectGet(value,"typeId");
const field_global:JsonValue=jsonObjectGet(value,"global");
const field_parameter:JsonValue=jsonObjectGet(value,"parameter");
const field_source:JsonValue=jsonObjectGet(value,"source");
let decoded=new IrPlace(jsonAsString(field_symbolId),jsonAsNumber(field_typeId),jsonAsNumber(field_global),jsonAsBool(field_parameter),decodeIrSource(field_source));
decoded.name=jsonAsString(field_name);
decoded.kind=jsonAsString(field_kind);
decoded.base=jsonAsNumber(field_base);
decoded.index=jsonAsNumber(field_index);
decoded.field=jsonAsNumber(field_field);
decoded.readOnly=jsonAsBool(field_readOnly);
return decoded;}
export function decodeIrInstruction(value:constRef<JsonValue>):IrInstruction{
const field_continuation:JsonValue=jsonObjectGet(value,"continuation");
const field_lease:JsonValue=jsonObjectGet(value,"lease");
const field_contract:JsonValue=jsonObjectGet(value,"contract");
const field_names:JsonValue=jsonObjectGet(value,"names");
const field_signature:JsonValue=jsonObjectGet(value,"signature");
const field_effects:JsonValue=jsonObjectGet(value,"effects");
const field_op:JsonValue=jsonObjectGet(value,"op");
const field_result:JsonValue=jsonObjectGet(value,"result");
const field_typeId:JsonValue=jsonObjectGet(value,"typeId");
const field_operands:JsonValue=jsonObjectGet(value,"operands");
const field_place:JsonValue=jsonObjectGet(value,"place");
const field_callee:JsonValue=jsonObjectGet(value,"callee");
const field_text:JsonValue=jsonObjectGet(value,"text");
const field_source:JsonValue=jsonObjectGet(value,"source");
let decoded=new IrInstruction(jsonAsString(field_op),jsonAsNumber(field_result),jsonAsNumber(field_typeId),decodeIrSource(field_source));
decoded.continuation=jsonAsNumber(field_continuation);
decoded.lease=jsonAsNumber(field_lease);
decoded.contract=jsonAsNumber(field_contract);
decoded.names=decodestringArray(field_names);
decoded.signature=jsonAsNumber(field_signature);
decoded.effects=decodestringArray(field_effects);
decoded.operands=decodenumberArray(field_operands);
decoded.place=jsonAsNumber(field_place);
decoded.callee=jsonAsNumber(field_callee);
decoded.text=jsonAsString(field_text);
return decoded;}
export function decodeIrBlock(value:constRef<JsonValue>):IrBlock{
const field_instructions:JsonValue=jsonObjectGet(value,"instructions");
const field_terminator:JsonValue=jsonObjectGet(value,"terminator");
const field_value:JsonValue=jsonObjectGet(value,"value");
const field_targets:JsonValue=jsonObjectGet(value,"targets");
const field_source:JsonValue=jsonObjectGet(value,"source");
let decoded=new IrBlock(decodeIrSource(field_source));
decoded.instructions=decodeIrInstructionArray(field_instructions);
decoded.terminator=jsonAsString(field_terminator);
decoded.value=jsonAsNumber(field_value);
decoded.targets=decodenumberArray(field_targets);
return decoded;}
export function decodeIrFunction(value:constRef<JsonValue>):IrFunction{
const field_effectContracts:JsonValue=jsonObjectGet(value,"effectContracts");
const field_frameValues:JsonValue=jsonObjectGet(value,"frameValues");
const field_framePlaces:JsonValue=jsonObjectGet(value,"framePlaces");
const field_leases:JsonValue=jsonObjectGet(value,"leases");
const field_receiverType:JsonValue=jsonObjectGet(value,"receiverType");
const field_signature:JsonValue=jsonObjectGet(value,"signature");
const field_substitutionFrom:JsonValue=jsonObjectGet(value,"substitutionFrom");
const field_substitutionTo:JsonValue=jsonObjectGet(value,"substitutionTo");
const field_captureSymbols:JsonValue=jsonObjectGet(value,"captureSymbols");
const field_captureTypes:JsonValue=jsonObjectGet(value,"captureTypes");
const field_captureModes:JsonValue=jsonObjectGet(value,"captureModes");
const field_asynchronous:JsonValue=jsonObjectGet(value,"asynchronous");
const field_bodyReturns:JsonValue=jsonObjectGet(value,"bodyReturns");
const field_name:JsonValue=jsonObjectGet(value,"name");
const field_symbolId:JsonValue=jsonObjectGet(value,"symbolId");
const field_returns:JsonValue=jsonObjectGet(value,"returns");
const field_parameterTypes:JsonValue=jsonObjectGet(value,"parameterTypes");
const field_places:JsonValue=jsonObjectGet(value,"places");
const field_values:JsonValue=jsonObjectGet(value,"values");
const field_blocks:JsonValue=jsonObjectGet(value,"blocks");
const field_source:JsonValue=jsonObjectGet(value,"source");
let decoded=new IrFunction(jsonAsString(field_name),jsonAsString(field_symbolId),jsonAsNumber(field_returns),decodeIrSource(field_source));
decoded.effectContracts=decodenumberArray(field_effectContracts);
decoded.frameValues=decodenumberArray(field_frameValues);
decoded.framePlaces=decodenumberArray(field_framePlaces);
decoded.leases=decodeIrLeaseArray(field_leases);
decoded.receiverType=jsonAsNumber(field_receiverType);
decoded.signature=jsonAsString(field_signature);
decoded.substitutionFrom=decodestringArray(field_substitutionFrom);
decoded.substitutionTo=decodestringArray(field_substitutionTo);
decoded.captureSymbols=decodestringArray(field_captureSymbols);
decoded.captureTypes=decodenumberArray(field_captureTypes);
decoded.captureModes=decodestringArray(field_captureModes);
decoded.asynchronous=jsonAsBool(field_asynchronous);
decoded.bodyReturns=jsonAsNumber(field_bodyReturns);
decoded.parameterTypes=decodenumberArray(field_parameterTypes);
decoded.places=decodeIrPlaceArray(field_places);
decoded.values=decodenumberArray(field_values);
decoded.blocks=decodeIrBlockArray(field_blocks);
return decoded;}
export function decodeIrModule(value:constRef<JsonValue>):IrModule{
const field_id:JsonValue=jsonObjectGet(value,"id");
const field_sourceHash:JsonValue=jsonObjectGet(value,"sourceHash");
const field_file:JsonValue=jsonObjectGet(value,"file");
const field_initializer:JsonValue=jsonObjectGet(value,"initializer");
const field_finalizer:JsonValue=jsonObjectGet(value,"finalizer");
let decoded=new IrModule(jsonAsString(field_id),jsonAsString(field_sourceHash),jsonAsString(field_file),jsonAsNumber(field_initializer));
decoded.finalizer=jsonAsNumber(field_finalizer);
return decoded;}
export function decodeIrIssue(value:constRef<JsonValue>):IrIssue{
const field_code:JsonValue=jsonObjectGet(value,"code");
const field_message:JsonValue=jsonObjectGet(value,"message");
const field_source:JsonValue=jsonObjectGet(value,"source");
let decoded=new IrIssue(jsonAsString(field_code),jsonAsString(field_message),decodeIrSource(field_source));
return decoded;}
export function decodeIrProject(value:constRef<JsonValue>):IrProject{
const field_dispatches:JsonValue=jsonObjectGet(value,"dispatches");
const field_effectContracts:JsonValue=jsonObjectGet(value,"effectContracts");
const field_annotations:JsonValue=jsonObjectGet(value,"annotations");
const field_runtimeContracts:JsonValue=jsonObjectGet(value,"runtimeContracts");
const field_typeDefinitions:JsonValue=jsonObjectGet(value,"typeDefinitions");
const field_finalizationOrder:JsonValue=jsonObjectGet(value,"finalizationOrder");
const field_types:JsonValue=jsonObjectGet(value,"types");
const field_modules:JsonValue=jsonObjectGet(value,"modules");
const field_globals:JsonValue=jsonObjectGet(value,"globals");
const field_functions:JsonValue=jsonObjectGet(value,"functions");
const field_initializationOrder:JsonValue=jsonObjectGet(value,"initializationOrder");
const field_entry:JsonValue=jsonObjectGet(value,"entry");
const field_diagnostics:JsonValue=jsonObjectGet(value,"diagnostics");
const field_success:JsonValue=jsonObjectGet(value,"success");
let decoded=new IrProject();
decoded.dispatches=decodeIrDispatchArray(field_dispatches);
decoded.effectContracts=decodeIrEffectContractArray(field_effectContracts);
decoded.annotations=decodeIrAnnotationArray(field_annotations);
decoded.runtimeContracts=decodeIrRuntimeContractArray(field_runtimeContracts);
decoded.typeDefinitions=decodeIrTypeArray(field_typeDefinitions);
decoded.finalizationOrder=decodenumberArray(field_finalizationOrder);
decoded.types=decodestringArray(field_types);
decoded.modules=decodeIrModuleArray(field_modules);
decoded.globals=decodeIrPlaceArray(field_globals);
decoded.functions=decodeIrFunctionArray(field_functions);
decoded.initializationOrder=decodenumberArray(field_initializationOrder);
decoded.entry=jsonAsNumber(field_entry);
decoded.diagnostics=decodeIrIssueArray(field_diagnostics);
decoded.success=jsonAsBool(field_success);
return decoded;}
export function decodeIrDispatch(value:constRef<JsonValue>):IrDispatch{
const field_interfaceType:JsonValue=jsonObjectGet(value,"interfaceType");
const field_concreteType:JsonValue=jsonObjectGet(value,"concreteType");
const field_name:JsonValue=jsonObjectGet(value,"name");
const field_signature:JsonValue=jsonObjectGet(value,"signature");
const field_callee:JsonValue=jsonObjectGet(value,"callee");
let decoded=new IrDispatch(jsonAsNumber(field_interfaceType),jsonAsNumber(field_concreteType),jsonAsString(field_name),jsonAsNumber(field_signature),jsonAsNumber(field_callee));
return decoded;}
export function decodeIrType(value:constRef<JsonValue>):IrType{
const field_methods:JsonValue=jsonObjectGet(value,"methods");
const field_methodTypes:JsonValue=jsonObjectGet(value,"methodTypes");
const field_variants:JsonValue=jsonObjectGet(value,"variants");
const field_tag:JsonValue=jsonObjectGet(value,"tag");
const field_discriminator:JsonValue=jsonObjectGet(value,"discriminator");
const field_discriminatorType:JsonValue=jsonObjectGet(value,"discriminatorType");
const field_discriminatorValue:JsonValue=jsonObjectGet(value,"discriminatorValue");
const field_numericKind:JsonValue=jsonObjectGet(value,"numericKind");
const field_bits:JsonValue=jsonObjectGet(value,"bits");
const field_isSigned:JsonValue=jsonObjectGet(value,"signed");
const field_kind:JsonValue=jsonObjectGet(value,"kind");
const field_arguments:JsonValue=jsonObjectGet(value,"arguments");
const field_fields:JsonValue=jsonObjectGet(value,"fields");
const field_names:JsonValue=jsonObjectGet(value,"names");
const field_symbolId:JsonValue=jsonObjectGet(value,"symbolId");
const field_resource:JsonValue=jsonObjectGet(value,"resource");
const field_length:JsonValue=jsonObjectGet(value,"length");
let decoded=new IrType(jsonAsString(field_kind));
decoded.methods=decodestringArray(field_methods);
decoded.methodTypes=decodenumberArray(field_methodTypes);
decoded.variants=decodenumberArray(field_variants);
decoded.tag=jsonAsString(field_tag);
decoded.discriminator=jsonAsString(field_discriminator);
decoded.discriminatorType=jsonAsNumber(field_discriminatorType);
decoded.discriminatorValue=jsonAsString(field_discriminatorValue);
decoded.numericKind=jsonAsString(field_numericKind);
decoded.bits=jsonAsNumber(field_bits);
decoded.isSigned=jsonAsBool(field_isSigned);
decoded.arguments=decodenumberArray(field_arguments);
decoded.fields=decodenumberArray(field_fields);
decoded.names=decodestringArray(field_names);
decoded.symbolId=jsonAsString(field_symbolId);
decoded.resource=jsonAsBool(field_resource);
decoded.length=jsonAsNumber(field_length);
return decoded;}
export function decodeIrRuntimeContract(value:constRef<JsonValue>):IrRuntimeContract{
const field_name:JsonValue=jsonObjectGet(value,"name");
const field_parameters:JsonValue=jsonObjectGet(value,"parameters");
const field_returns:JsonValue=jsonObjectGet(value,"returns");
const field_effects:JsonValue=jsonObjectGet(value,"effects");
const field_capability:JsonValue=jsonObjectGet(value,"capability");
let decoded=new IrRuntimeContract(jsonAsString(field_name),decodenumberArray(field_parameters),jsonAsNumber(field_returns),decodestringArray(field_effects),jsonAsString(field_capability));
return decoded;}
export function decodeIrCleanupScope(value:constRef<JsonValue>):IrCleanupScope{
const field_places:JsonValue=jsonObjectGet(value,"places");
let decoded=new IrCleanupScope();
decoded.places=decodenumberArray(field_places);
return decoded;}
export function decodeIrLease(value:constRef<JsonValue>):IrLease{
const field_place:JsonValue=jsonObjectGet(value,"place");
const field_value:JsonValue=jsonObjectGet(value,"value");
const field_mode:JsonValue=jsonObjectGet(value,"mode");
let decoded=new IrLease(jsonAsNumber(field_place),jsonAsNumber(field_value),jsonAsString(field_mode));
return decoded;}
export function decodeIrEffectBorrow(value:constRef<JsonValue>):IrEffectBorrow{
const field_source:JsonValue=jsonObjectGet(value,"source");
const field_callback:JsonValue=jsonObjectGet(value,"callback");
const field_root:JsonValue=jsonObjectGet(value,"root");
const field_mode:JsonValue=jsonObjectGet(value,"mode");
let decoded=new IrEffectBorrow(decodeIrSource(field_source),jsonAsString(field_callback),jsonAsString(field_root),jsonAsString(field_mode));
return decoded;}
export function decodeIrEffectContract(value:constRef<JsonValue>):IrEffectContract{
const field_source:JsonValue=jsonObjectGet(value,"source");
const field_phase:JsonValue=jsonObjectGet(value,"phase");
const field_creation:JsonValue=jsonObjectGet(value,"creation");
const field_callees:JsonValue=jsonObjectGet(value,"callees");
const field_parameters:JsonValue=jsonObjectGet(value,"parameters");
const field_reads:JsonValue=jsonObjectGet(value,"reads");
const field_writes:JsonValue=jsonObjectGet(value,"writes");
const field_moves:JsonValue=jsonObjectGet(value,"moves");
const field_invokes:JsonValue=jsonObjectGet(value,"invokes");
const field_retains:JsonValue=jsonObjectGet(value,"retains");
const field_returned:JsonValue=jsonObjectGet(value,"returned");
const field_borrows:JsonValue=jsonObjectGet(value,"borrows");
const field_unknown:JsonValue=jsonObjectGet(value,"unknown");
const field_recursive:JsonValue=jsonObjectGet(value,"recursive");
const field_external:JsonValue=jsonObjectGet(value,"external");
let decoded=new IrEffectContract(decodeIrSource(field_source));
decoded.phase=jsonAsString(field_phase);
decoded.creation=jsonAsNumber(field_creation);
decoded.callees=decodenumberArray(field_callees);
decoded.parameters=decodestringArray(field_parameters);
decoded.reads=decodestringArray(field_reads);
decoded.writes=decodestringArray(field_writes);
decoded.moves=decodestringArray(field_moves);
decoded.invokes=decodestringArray(field_invokes);
decoded.retains=decodestringArray(field_retains);
decoded.returned=decodestringArray(field_returned);
decoded.borrows=decodeIrEffectBorrowArray(field_borrows);
decoded.unknown=jsonAsBool(field_unknown);
decoded.recursive=jsonAsBool(field_recursive);
decoded.external=jsonAsBool(field_external);
return decoded;}
export function decodeIrAnnotation(value:constRef<JsonValue>):IrAnnotation{
const field_source:JsonValue=jsonObjectGet(value,"source");
const field_target:JsonValue=jsonObjectGet(value,"target");
const field_name:JsonValue=jsonObjectGet(value,"name");
const field_arguments:JsonValue=jsonObjectGet(value,"arguments");
let decoded=new IrAnnotation(decodeIrSource(field_source),decodeIrSource(field_target),jsonAsString(field_name),decodestringArray(field_arguments));
return decoded;}
export function parseIrProject(text:string):IrProject {const value:JsonValue=JSON.parseValue(text);
if(jsonAsString(jsonObjectGet(value,"format"))!="ets-ir-2"||!jsonAsBool(jsonObjectGet(value,"success"))||!jsonIsArray(jsonObjectGet(value,"diagnostics"))||jsonArrayLength(jsonObjectGet(value,"diagnostics"))!=0){printError("Se requiere ets-ir-2 verificado con success:true");exitProcess(1);}return decodeIrProject(value); }
