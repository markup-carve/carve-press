/**
 * The fence body without the newline that terminates its last line.
 *
 * carve 0.1.8 made `code_block.content` carry that newline, and two things
 * downstream read the payload as the lines themselves: Shiki counts the
 * trailing `\n` as one more line and emits an empty `<span class="line">` after
 * the code, and the copy buffer hands over a byte the fence never held.
 */
export function fenceContent(content: string): string {
  return content.endsWith('\n') ? content.slice(0, -1) : content
}
