// writes a Thai/CJK/emoji response one byte at a time to force UTF-8
// characters to split across separate stdout writes
process.stdin.on("data", (chunk) => {
  const msg = JSON.parse(chunk.toString().trim());
  const response = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { text: "สวัสดีครับ 你好 🎉" } }) + "\n";
  const buf = Buffer.from(response, "utf8");
  let i = 0;
  const writeNext = () => {
    if (i >= buf.length) return process.exit(0);
    process.stdout.write(buf.subarray(i, i + 1));
    i++;
    setImmediate(writeNext);
  };
  writeNext();
});
