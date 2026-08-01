/**
 * An error anchored to a source location. Every user-facing failure carries
 * one so the message is clickable; a bare stack trace is never surfaced.
 */
export class SourceError extends Error {
  constructor(
    readonly srcPath: string,
    readonly line: number,
    readonly column: number,
    message: string,
  ) {
    super(message)
    this.name = 'SourceError'
  }

  format(): string {
    return `${this.srcPath}:${this.line}:${this.column} ${this.message}`
  }
}

/** A build failure with no single source location (config, routing, nav). */
export class BuildError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message)
    this.name = 'BuildError'
  }

  format(): string {
    return this.details.length === 0
      ? this.message
      : `${this.message}\n${this.details.map((d) => `  ${d}`).join('\n')}`
  }
}
