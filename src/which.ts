import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Resolves a bare command name against PATH without spawning a process.
 * Windows' `where` and POSIX's `which` are both external processes that
 * have proven slow/unreliable enough on some CI runners to time out, so
 * this does the same lookup natively instead.
 */
export function findOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);

  if (platform === "win32") {
    const extensions = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
    const hasKnownExt = extensions.some((ext) => command.toLowerCase().endsWith(ext.toLowerCase()));
    const candidates = hasKnownExt ? [command] : extensions.map((ext) => command + ext);
    for (const dir of dirs) {
      for (const candidate of candidates) {
        const full = join(dir, candidate);
        if (existsSync(full)) return full;
      }
    }
    return null;
  }

  for (const dir of dirs) {
    const full = join(dir, command);
    try {
      accessSync(full, constants.X_OK);
      return full;
    } catch {
      // not here, or not executable - keep looking
    }
  }
  return null;
}
