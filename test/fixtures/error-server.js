process.stdin.setEncoding("utf8");
let buf = "";

process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;

    const msg = JSON.parse(line);
    const response = {
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32000, message: "boom" },
    };
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});
