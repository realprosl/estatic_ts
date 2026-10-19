@etsgen export function create(): string {
  return `
function identity<T>(value: T): T { return value; }
@etsPublish class Box { value: number; }
@etsPublish function answer<T>(value: T): T { return identity<T>(value); }
`;
}
