import {createBrowserClient} from '@supabase/ssr';
import type {Database} from '@/types/schema';

/**
 * ブラウザ側の Supabase クライアント。
 * セッションは Cookie に保存され、サーバー側（Server Component / Server Action / proxy）から
 * 同じセッションを読めるようになる。
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
