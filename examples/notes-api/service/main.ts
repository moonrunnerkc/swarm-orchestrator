import { startService } from "./http.ts";

startService(Number(process.env.PORT ?? 8080));
