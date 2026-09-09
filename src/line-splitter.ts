import { StringDecoder } from "node:string_decoder";

export class LineSplitter {
  private buf = "";
  // a multi-byte UTF-8 character can land across two separate chunks;
  // StringDecoder buffers the incomplete tail bytes instead of turning
  // them into a replacement character too early
  private decoder = new StringDecoder("utf8");
  constructor(private onLine: (line: string) => void) {}

  push(chunk: Buffer | string): void {
    this.buf += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, "");
      this.buf = this.buf.slice(idx + 1);
      if (line.length > 0) this.onLine(line);
    }
  }

  flush(): void {
    this.buf += this.decoder.end();
    const rest = this.buf.replace(/\r$/, "");
    this.buf = "";
    if (rest.length > 0) this.onLine(rest);
  }
}
