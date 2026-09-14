for (let i = 0; i < 300; i++) {
  process.stderr.write(JSON.stringify({ level: "info", label: "msg", topic: `fail-${i}` }) + "\n");
}
process.exit(0);
