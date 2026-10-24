import assert from 'node:assert/strict';
import type {NativeDiagnostic} from './diagnostic.ts';

// Public wire contract, independently checked at every project entry point.
export function assertDiagnostic(d: any): asserts d is NativeDiagnostic {
  assert.equal(d.schema, 'ets-diagnostic-1');
  assert.ok(['lexer','parser','loader','resolver','binder','checker'].includes(d.phase));
  assert.match(d.code, /^[A-Z][A-Z0-9_]*$/);
  assert.equal(d.severity, 'error'); // All current producers emit errors.
  assert.equal(typeof d.message, 'string'); assert.ok(d.message.length > 0);
  assert.ok(!d.message.startsWith(d.code+': '));
  assert.equal(typeof d.file, 'string'); assert.ok(d.file.length > 0);
  function span(value: any) {
    for (const p of [value.start,value.end]) {
      assert.ok(Number.isInteger(p.offset) && p.offset >= 0);
      assert.ok(Number.isInteger(p.line) && p.line >= 1);
      assert.ok(Number.isInteger(p.column) && p.column >= 1);
    }
    assert.ok(value.end.offset >= value.start.offset);
    assert.ok(value.end.line >= value.start.line);
    if(value.end.line===value.start.line)assert.ok(value.end.column>=value.start.column);
  }
  span(d.span);
  assert.deepEqual([d.offset,d.line,d.column],[d.span.start.offset,d.span.start.line,d.span.start.column]);
  if(d.generated!==null){
    assert.equal(typeof d.generated.sourceId,'string'); assert.ok(d.generated.sourceId.length>0);
    span(d.generated.span);
    assert.deepEqual([d.generated.offset,d.generated.line,d.generated.column],[d.generated.span.start.offset,d.generated.span.start.line,d.generated.span.start.column]);
  }
}
