import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {root} from "../root.ts";
import {nativeTables} from "./native-tables.ts";
import {getTs2cppVersionLabel} from "../../src/core/ts2cpp-version.ts";
export function buildNativeCompiler(directory=join(root,"build/bootstrap/etsc"),cxx=process.env.CXX??"g++"):string {
 mkdirSync(directory,{recursive:true});nativeTables(join(directory,"native-tables.hpp"));
 writeFileSync(join(directory,"install_config.hpp"),`#define ESTC_PLATFORM ${JSON.stringify(process.platform)}\n#define ESTC_ARCH ${JSON.stringify(process.arch)}\n#define ESTC_VERSION ${JSON.stringify(getTs2cppVersionLabel().replace(/^estatic/,"etsc"))}\n`);
 const binary=join(directory,"etsc"),stamp=join(directory,"compiler.sha256"),hash=createHash("sha256").update(root).update(cxx);
 const version=spawnSync(cxx,["--version"],{encoding:"utf8"});if(version.error)throw version.error;if(version.status)throw new Error(version.stderr);hash.update(version.stdout);
 for(const folder of ["src/codegen/ir/native","bootstrap/native","runtime"])for(const file of readdirSync(join(root,folder),{recursive:true}).map(String).filter(f=>/\.(cpp|hpp|h)$/.test(f)).sort())hash.update(folder+"/"+file).update(readFileSync(join(root,folder,file)));
 hash.update(readFileSync(join(directory,"native-tables.hpp"))).update(readFileSync(join(directory,"install_config.hpp")));const identity=hash.digest("hex");
 if(existsSync(binary)&&existsSync(stamp)&&readFileSync(stamp,"utf8")===identity)return binary;
 const p=spawnSync(cxx,["-std=c++20","-O2",`-I${root}`,`-I${directory}`,join(root,"bootstrap/native/driver.cpp"),join(root,"src/codegen/ir/native/generator.cpp"),"-lcrypto","-o",binary],{encoding:"utf8",timeout:180000,maxBuffer:8*1024*1024});if(p.error)throw p.error;if(p.status!==0)throw new Error(p.stdout+p.stderr);writeFileSync(stamp,identity);return binary;
}
