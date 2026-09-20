// tsx calls os.userInfo() on Windows when process.geteuid is unavailable.
// Some constrained CI runners return ENOMEM for that lookup even though the
// process can run normally; tsx only uses the value for a temp-directory name.
if (typeof process.geteuid !== "function") process.geteuid = () => 0;
