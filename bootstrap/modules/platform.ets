@include("bootstrap/modules/platform.hpp")
// Narrow native boundary: filesystem, SHA-256 and build identity only.
@cppgen function platformCode(code: string): string { return code; }
export function canonicalFile(file: string): string {
  platformCode("return ets_bootstrap::canonical(file);"); return "";
}
export function fileMetadata(file: string): string {
  platformCode("return ets_bootstrap::metadata(file);"); return "";
}
export function contentHash(text: string): string {
  platformCode("return ets_bootstrap::sha256(text);"); return "";
}
export function publishRecord(file: string, text: string): boolean {
  platformCode("return ets_bootstrap::atomicWrite(file, text);"); return false;
}
export function syntaxIdentity(): string {
  platformCode("return ets_bootstrap::syntaxIdentity();"); return "";
}
export function readSnapshot(file: string): string[] {
  platformCode("return ets_bootstrap::readSnapshot(file);"); return [];
}
