import { handleRequest } from "../apps/club/worker/index.ts";

type Env = { SUPABASE_URL: string; SUPABASE_PUBLISHABLE_KEY: string; CLUB_ID: string };
export default {
  fetch(request: Request, env: Env) {
    return handleRequest(request, { ...env, ASSETS: { fetch: (request: Request) => {
      const upstream = new URL(request.url);
      upstream.protocol = "http:";
      upstream.host = "127.0.0.1:3002";
      return fetch(new Request(upstream, request));
    } } });
  },
};
