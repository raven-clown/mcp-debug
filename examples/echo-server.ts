import { debug, info } from "../src/index.js";

process.stdin.setEncoding("utf8");
let buf = "";

info("server.start", { pid: process.pid });

process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  let idx: number;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;

    const msg = JSON.parse(line);
    debug("request.received", { method: msg.method });

    const response = {
      jsonrpc: "2.0",
      id: msg.id,
      result: { echoed: msg.params ?? null },
    };
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});
