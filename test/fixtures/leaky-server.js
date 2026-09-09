process.stderr.write(
  JSON.stringify({ level: "info", label: "auth.login", data: { token: "super-secret-token-123" } }) + "\n",
);
process.exit(0);
