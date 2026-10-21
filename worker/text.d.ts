/** wrangler 默认把 .txt 当作文本模块打包，import 得到整个文件的字符串 */
declare module '*.txt' {
  const text: string
  export default text
}
