const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
}

type Level = "info" | "ok" | "warn" | "error" | "debug"

const levelConfig: Record<Level, { color: string; label: string }> = {
  info:  { color: colors.blue,    label: "INFO" },
  ok:    { color: colors.green,   label: " OK " },
  warn:  { color: colors.yellow,  label: "WARN" },
  error: { color: colors.red,     label: "ERR " },
  debug: { color: colors.gray,    label: "DBUG" },
}

function timestamp() {
  const d = new Date()
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`
}

function log(level: Level, tag: string, msg: string) {
  const cfg = levelConfig[level]
  const ts = colors.dim + timestamp() + colors.reset
  const tagStr = colors.cyan + tag.padEnd(18).slice(0, 18) + colors.reset
  const levelStr = cfg.color + cfg.label + colors.reset
  console.log(`${ts} ${levelStr} ${tagStr} ${cfg.color}${msg}${colors.reset}`)
}

export const logger = {
  info:  (tag: string, msg: string) => log("info",  tag, msg),
  ok:    (tag: string, msg: string) => log("ok",    tag, msg),
  warn:  (tag: string, msg: string) => log("warn",  tag, msg),
  error: (tag: string, msg: string) => log("error", tag, msg),
  debug: (tag: string, msg: string) => log("debug", tag, msg),
}
