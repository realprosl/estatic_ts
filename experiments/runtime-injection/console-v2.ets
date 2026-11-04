@include("experiments/runtime-injection/console.hpp")
@cppgen function nativeCode(text:string):string{return text;}
export function format(value:string):string {
  nativeCode("return ets_poc::decorate(value);");
  return "";
}
export function formatExtra(value:string):string {
  nativeCode("return ets_poc::decorate_twice(value);");
  return "";
}
