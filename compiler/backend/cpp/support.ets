// Target spelling and validation, implemented entirely in ETS.
export function integerIndex(n:number):boolean{return n>=0&&Math.floor(n)==n;}
export function uniqueStrings(values:string[]):string[]{let output:string[]=[];for(const s of values)if(!output.includes(s))output.push(s);return output;}
export function arrayIndex<T>(values:T[],value:T):number{for(let k:number=0;k<values.length;k=k+1)if(values[k]==value)return k;return -1;}
export function quoteCpp(value:string):string{
 let output:string='"';const octal:string="01234567";
 for(let k:number=0;k<value.length;k=k+1){
  const c:string=value.charAt(k);const n:number=value.charCodeAt(k);
  if(c=='"'||c=="\\")output+="\\"+c;
  else if(c=="\n")output+="\\n";else if(c=="\r")output+="\\r";else if(c=="\t")output+="\\t";
  else if(n<32||n==127)output+="\\"+octal.charAt(Math.floor(n/64))+octal.charAt(Math.floor(n/8)%8)+octal.charAt(n%8);
  else output+=c;
 }
 return output+'"';
}
export function numericBase(value:string):number{
 const at:number=value.startsWith("-")?1:0;const p:string=value.slice(at,at+2).toLowerCase();
 return p=="0x"?16:p=="0b"?2:p=="0o"?8:10;
}
function digit(c:string):number{return "0123456789abcdef".indexOf(c.toLowerCase(),0);}
export function validNumber(value:string):boolean{
 let k:number=value.startsWith("-")?1:0;const base:number=numericBase(value);
 if(base!=10){k+=2;if(k>=value.length)return false;for(;k<value.length;k=k+1){const d:number=digit(value.charAt(k));if(d<0||d>=base)return false;}return true;}
 let count:number=0;
 for(;k<value.length&&"0123456789".includes(value.charAt(k));k=k+1)count+=1;
 if(count==0)return false;
 if(value.charAt(k)=="."){k+=1;count=0;for(;k<value.length&&"0123456789".includes(value.charAt(k));k=k+1)count+=1;if(count==0)return false;}
 if(value.charAt(k)=="e"||value.charAt(k)=="E"){k+=1;if(value.charAt(k)=="+"||value.charAt(k)=="-")k+=1;count=0;for(;k<value.length&&"0123456789".includes(value.charAt(k));k=k+1)count+=1;if(count==0)return false;}
 return k==value.length;
}
export function parseNumber(value:string):number{
 const base:number=numericBase(value);const negative:boolean=value.startsWith("-");let k:number=negative?1:0;let result:number=0;
 if(base!=10)k+=2;
 for(;k<value.length;k=k+1){const d:number=digit(value.charAt(k));if(d<0||d>=base)break;result=result*base+d;}
 return negative?-result:result;
}
function identifier(value:string):boolean{
 const first:string="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";const rest:string=first+"0123456789";
 if(value.length==0||!first.includes(value.charAt(0)))return false;
 for(let k:number=1;k<value.length;k=k+1)if(!rest.includes(value.charAt(k)))return false;
 return true;
}
export function validCppSymbol(value:string):boolean{
 const parts:string[]=value.split("::");for(const s of parts)if(!identifier(s))return false;return parts.length>0;
}
export function validHeader(value:string):boolean{
 const allowed:string="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_0123456789./-";
 if(value.length==0||value.startsWith("/"))return false;
 for(let k:number=0;k<value.length;k=k+1)if(!allowed.includes(value.charAt(k)))return false;
 for(const p of value.split("/"))if(p==""||p=="."||p=="..")return false;
 return true;
}
export function binaryHelper(op:string):string{
 if(op=="+")return "add";if(op=="-")return "sub";if(op=="*")return "mul";if(op=="/")return "divide";if(op=="%")return "remainder";
 if(op=="<<")return "shiftLeft";if(op==">>")return "shiftRight";return "";
}
