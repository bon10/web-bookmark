import 'server-only';

import {createClient as createSupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/types/schema';
import type {BookmarkClient} from '@/utils/bookmarks';

/**
 * Chrome 拡張からのリクエストを認証するための入口。
 *
 * 画面からの操作はセッション Cookie を使うが、拡張は別オリジンで動くため Cookie を送れない。
 * そこで拡張は Supabase のアクセストークンを Authorization ヘッダーで送り、この関数が
 * トークンを検証してから、そのトークンで動くクライアントを作る。
 * 行単位の可否は DB 側の RLS が判定するので、この関数は「本当にログイン済みか」だけを見る。
 */
export type Authentication =
  | {client: BookmarkClient; failure: null}
  | {client: null; failure: Response};

export function jsonError(status: number, message: string): Response {
  return Response.json({error: message}, {status});
}

export async function authenticate(request: Request): Promise<Authentication> {
  const header = request.headers.get('authorization') ?? '';
  const token = /^bearer /i.test(header) ? header.slice('bearer '.length).trim() : '';

  if (!token) {
    return {client: null, failure: jsonError(401, 'アクセストークンがありません')};
  }

  const client = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // 受け取ったトークンを以後のすべての問い合わせに載せる。
      // PostgREST はこのトークンからロール（authenticated）を決めるため、RLS がそのまま効く。
      global: {headers: {Authorization: `Bearer ${token}`}},
      // Route Handler はリクエストごとに使い捨てるので、保存も自動更新もしない。
      // トークンの更新は拡張側が自分のリフレッシュトークンで行う。
      auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
    },
  );

  // getSession() はトークンを検証しないため使わない。getClaims() は署名と有効期限を検証する。
  const {data, error} = await client.auth.getClaims(token);
  if (error || !data?.claims) {
    return {client: null, failure: jsonError(401, 'アクセストークンが無効です')};
  }

  return {client, failure: null};
}
