export class LineSplitter {
  private buf = "";
  constructor(private onLine: (line: string) => void) {}

  push(chunk: Buffer | string): void {
    this.buf += chunk.toString();
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, "");
      this.buf = this.buf.slice(idx + 1);
      if (line.length > 0) this.onLine(line);
    }
  }

  flush(): void {
    const rest = this.buf.replace(/\r$/, "");
    this.buf = "";
    if (rest.length > 0) this.onLine(rest);
  }
}
