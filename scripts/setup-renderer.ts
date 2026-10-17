import { prepareWindowsBrowserLauncher } from "../apps/renderer-remotion/src/windows-browser-launcher.js";

const executable = await prepareWindowsBrowserLauncher();
console.log(executable ? `Windows renderer launcher ready: ${executable}` : "The renderer launcher needs no additional setup on this platform.");
