process.stderr.write(JSON.stringify({ level: "info", label: "no-topic message" }) + "\n");
process.stderr.write(JSON.stringify({ level: "info", label: "api call", data: { ip: "127.0.0.1" }, topic: "api" }) + "\n");
process.stderr.write(JSON.stringify({ level: "info", label: "chat message", data: { text: "hi" }, topic: "chat" }) + "\n");
process.exit(0);
