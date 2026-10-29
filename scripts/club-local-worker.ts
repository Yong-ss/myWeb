import { handleRequest } from "../apps/club/worker/index.ts";

type Env = { SUPABASE_URL: string; SUPABASE_PUBLISHABLE_KEY: string; CLUB_ID: string; NEXT_DEV_HOST: string };
export default {
  fetch(request: Request, env: Env) {
    return handleRequest(request, { ...env, ASSETS: { fetch: (request: Request) => {
      const upstream = new URL(request.url);
      upstream.protocol = "http:";
      upstream.host = env.NEXT_DEV_HOST; // the running `next dev` (started by the script, or one that was already open)
      return fetch(new Request(upstream, request));
    } } });
  },
};
