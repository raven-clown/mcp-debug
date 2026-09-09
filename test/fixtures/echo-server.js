process.stdin.setEncoding("utf8");
let buf = "";

process.stderr.write(JSON.stringify({ level: "info", label: "server.start" }) + "\n");

process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;

    const msg = JSON.parse(line);
    process.stderr.write(JSON.stringify({ level: "debug", label: "request.received", data: { method: msg.method } }) + "\n");

    const response = {
      jsonrpc: "2.0",
      id: msg.id,
      result: { echoed: msg.params ?? null },
    };
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});
