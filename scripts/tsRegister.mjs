/** Installs `tsResolve.mjs`. Node wants the hooks registered from a module it imports first. */
import { register } from "node:module";

register("./tsResolve.mjs", import.meta.url);
