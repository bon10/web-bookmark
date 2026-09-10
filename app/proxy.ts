import {createServerClient} from '@supabase/ssr';
import {NextResponse, type NextRequest} from 'next/server';

/**
 * 全リクエストの前段で Supabase の認証トークンを更新し、更新後の Cookie をレスポンスに書き戻す。
 *
 * Server Component からは Cookie を書けないため、この proxy が無いとトークンを更新できず、
 * ランダムなログアウトやセッション切れが起きる。
 *
 * Next.js 16 で middleware は proxy にリネームされた（proxy は nodejs ランタイム固定）。
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({request});

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const {name, value} of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({request});
          for (const {name, value, options} of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // 認証 Cookie を載せたレスポンスを CDN やリバースプロキシにキャッシュさせないためのヘッダー。
          // キャッシュされると他人のセッショントークンが配信されうる。
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // createServerClient と getClaims() の間に処理を挟まないこと。
  // 挟むとセッションが確定する前に分岐が走り、原因の追いにくいログアウトを招く。
  // getSession() はサーバー側ではトークンを検証しないため使わない。
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: [
    /*
     * 静的アセットと画像最適化のリクエストを除外する。
     * これらはセッション更新を必要とせず、毎回走らせると無駄なトークン更新が発生する。
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
