import {parseIrProject} from "./decode";
import {generateCppFromIr} from "./generator";
import {formatCppResult} from "./wire";
import {readText,stdinText,hostError} from "../../platform/host";
const input:string=argument(1);
if(input==""){printError("Expected verified IR JSON or --codegen-json");exitProcess(2);}
const source:string=input=="--codegen-json"?stdinText():readText(input);
if(hostError()!=""){printError(hostError());exitProcess(1);}
const project=parseIrProject(source);
const result=generateCppFromIr(project);
if(input=="--codegen-json")print(formatCppResult(result));else print(result.cpp);
