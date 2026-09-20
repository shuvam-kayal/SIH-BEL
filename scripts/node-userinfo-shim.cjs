// tsx calls os.userInfo() on Windows when process.geteuid is unavailable.
// Some constrained CI runners return ENOMEM for that lookup even though the
// process can run normally; tsx only uses the value for a temp-directory name.
if (typeof process.geteuid !== "function") process.geteuid = () => 0;

const os = require("node:os");

try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    uid: 0,
    gid: 0,
    username: process.env.USER || process.env.USERNAME || "runner",
    homedir: process.env.HOME || process.env.USERPROFILE || "/home/runner",
    shell: process.platform === "win32" ? null : "/bin/bash",
  });
}
