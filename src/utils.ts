export function canonical(str: string): string {
  const m = str.match(/\w+$/);
  return (m && m[0]) || str;
}
