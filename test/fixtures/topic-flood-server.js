for (let i = 0; i < 500; i++) {
  process.stderr.write(JSON.stringify({ level: "info", label: "msg", topic: `flood-${i}` }) + "\n");
}
process.exit(0);
