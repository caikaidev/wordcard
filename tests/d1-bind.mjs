// D1 bind(...values) uses positional numbered parameters. node:sqlite releases
// differ in whether ?1 accepts anonymous arguments; named keys work on both.
export function d1Args(sql, values) {
  const indices = [...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]))
  return indices.length ? [Object.fromEntries([...new Set(indices)].map((n) => [`?${n}`, values[n - 1]]))] : values
}
