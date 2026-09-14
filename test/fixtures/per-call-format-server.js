process.stderr.write(JSON.stringify({ level: "info", label: "no-format", topic: "api" }) + "\n");
process.stderr.write(JSON.stringify({ level: "info", label: "yes-format", topic: "api", format: "opensearch" }) + "\n");
process.exit(0);
