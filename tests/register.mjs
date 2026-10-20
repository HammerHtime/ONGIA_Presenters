// Run a server test against an in-memory stand-in for Netlify Blobs: node --import ./tests/register.mjs tests/server/x.mjs
import { register } from "node:module";
register("../scripts/mock-hooks.mjs", import.meta.url);
process.env.ADMIN_KEY ??= "testkey";
