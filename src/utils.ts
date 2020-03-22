export function canonical(str: any):any {
  if(typeof str != 'string') return str;
  let m = str.toLowerCase().match(/\w+$/);
  return m && m[0] || str;
}