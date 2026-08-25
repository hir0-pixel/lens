// tsx 4.x calls os.userInfo() to create its cache directory on Windows.
// Some Windows environments reject that API with uv_os_get_passwd/ENOMEM,
// preventing the BFF from starting. Supplying the POSIX identity hook makes
// tsx use its existing numeric-cache-directory path instead.
if (process.platform === "win32") {
  process.geteuid = () => 0;
}
