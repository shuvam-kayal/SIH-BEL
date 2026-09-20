// tsx calls os.userInfo() on Windows when process.geteuid is unavailable.
// Some constrained CI runners return ENOMEM for that lookup even though the
// process can run normally; tsx only uses the value for a temp-directory name.
if (typeof process.geteuid !== "function") process.geteuid = () => 0;\n\nconst os = require("node:os");\nconst originalUserInfo = os.userInfo;\ntry {\n  os.userInfo();\n} catch {\n  os.userInfo = () => ({ uid: 0, gid: 0, username: process.env.USER || "runner", homedir: process.env.HOME || "/home/runner", shell: "/bin/bash" });\n}
