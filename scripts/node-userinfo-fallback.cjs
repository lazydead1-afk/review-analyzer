// Node preloads must run before tsx initializes its ESM loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("node:os");

try {
  os.userInfo();
} catch {
  Object.defineProperty(os, "userInfo", {
    configurable: true,
    value: () => ({
      uid: -1,
      gid: -1,
      username: process.env.USERNAME || "unknown",
      homedir: process.env.USERPROFILE || "",
      shell: null,
    }),
  });

  const preloadOption = `--require=${__filename}`;

  if (!process.env.NODE_OPTIONS?.includes(preloadOption)) {
    process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, preloadOption]
      .filter(Boolean)
      .join(" ");
  }
}
