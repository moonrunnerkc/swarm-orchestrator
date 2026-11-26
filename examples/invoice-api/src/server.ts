import { createServer } from "node:http";
import { handle } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
createServer(handle).listen(port);
