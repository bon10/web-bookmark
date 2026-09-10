import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import type {Database} from '@/types/schema';

/**
 * サーバー側の Supabase クライアント。
 * リクエストごとに必ず新しく生成する（使い回すと別ユーザーのセッションが混ざる）。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const {name, value, options} of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component からは Cookie を書けないため Next.js が例外を投げる。
            // トークン更新の書き戻しは proxy.ts が担当するので、ここでは無視してよい。
          }
        },
      },
    },
  );
}
